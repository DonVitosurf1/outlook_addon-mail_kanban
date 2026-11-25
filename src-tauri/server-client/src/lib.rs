//! Startet den Outlook-Hintergrundserver (Python) und spricht über eine
//! stdin/stdout-Pipe mit ihm. Bewusst ohne Netzwerk-Socket: so entsteht keine
//! lokale Angriffsfläche, kein Port und keine Firewall-Abfrage, und der
//! Kindprozess hängt eindeutig an dieser App.
//!
//! Ein eigener Lese-Thread nimmt die Antwortzeilen entgegen, damit `call` mit einem
//! Zeitlimit warten kann: Bleibt der Server an einem COM-Aufruf hängen (z. B. offener
//! Outlook-Dialog), bricht der Aufruf ab, statt die App dauerhaft einzufrieren.
//!
//! Protokoll siehe outlook-server/mailboard_server.py: eine JSON-Zeile je Nachricht.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;

struct Link {
    child: Child,
    stdin: ChildStdin,
    rx: Receiver<String>,
    next_id: u64,
}

/// Dauerhafte Verbindung zum Hintergrundserver. Aufrufe werden serialisiert.
pub struct Client {
    link: Mutex<Link>,
    alive: AtomicBool,
    timeout: Duration,
}

impl Client {
    /// Startet `python <script> [--demo]`, prüft mit `--ping` die Bereitschaft.
    /// `timeout` ist die Höchstwartezeit je Befehl.
    pub fn start(
        python: &str,
        script: &Path,
        demo: bool,
        timeout: Duration,
    ) -> Result<Client, String> {
        let mut command = Command::new(python);
        command.arg(script);
        if demo {
            command.arg("--demo");
        }
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: kein Konsolenfenster
        }

        let mut child = command
            .spawn()
            .map_err(|e| format!("Python-Server ließ sich nicht starten ({python}): {e}"))?;
        let stdin = child.stdin.take().ok_or("Keine Eingabe zum Python-Server.")?;
        let stdout = child.stdout.take().ok_or("Keine Ausgabe vom Python-Server.")?;

        // Lese-Thread: schiebt jede Antwortzeile in den Kanal und endet, wenn die
        // Ausgabe schließt (Server beendet) oder eine Zeile kein gültiges UTF-8 ist.
        let (tx, rx) = mpsc::channel::<String>();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                match line {
                    Ok(line) => {
                        if tx.send(line).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        let client = Client {
            link: Mutex::new(Link {
                child,
                stdin,
                rx,
                next_id: 0,
            }),
            alive: AtomicBool::new(true),
            timeout,
        };
        match client.call(vec!["--ping".into()]) {
            Ok(out) if out == "\"pong\"" => Ok(client),
            Ok(other) => Err(format!("Unerwartete Antwort auf --ping: {other}")),
            Err(err) => Err(format!("Python-Server antwortet nicht: {err}")),
        }
    }

    /// Läuft der Server noch? Gibt `false` zurück, sobald ein Aufruf abgebrochen ist
    /// (Timeout, geschlossene Pipe), damit die App auf den C#-Helfer zurückfallen kann.
    pub fn alive(&self) -> bool {
        self.alive.load(Ordering::Relaxed)
    }

    /// Schickt einen Befehl und gibt den JSON-Text zurück (wie der bisherige Helfer),
    /// oder den Fehlertext des Servers. Wartet höchstens `timeout`.
    pub fn call(&self, args: Vec<String>) -> Result<String, String> {
        if !self.alive() {
            return Err("Der Outlook-Server ist nicht mehr aktiv.".into());
        }
        let mut link = self
            .link
            .lock()
            .map_err(|_| "Server-Verbindung ist gestört.".to_string())?;
        link.next_id += 1;
        let id = link.next_id;

        if let Err(e) = write_request(&mut link.stdin, id, &args) {
            return Err(self.die(&mut link, format!("Befehl an den Server fehlgeschlagen: {e}")));
        }

        // Antworten kommen der Reihe nach; die ID wird trotzdem geprüft.
        loop {
            match link.rx.recv_timeout(self.timeout) {
                Ok(line) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let value: serde_json::Value = match serde_json::from_str(trimmed) {
                        Ok(value) => value,
                        Err(_) => continue,
                    };
                    if value.get("id").and_then(|v| v.as_u64()) != Some(id) {
                        continue;
                    }
                    if value.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                        return Ok(value
                            .get("out")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string());
                    }
                    return Err(value
                        .get("err")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unbekannter Serverfehler.")
                        .to_string());
                }
                Err(RecvTimeoutError::Timeout) => {
                    return Err(self.die(
                        &mut link,
                        "Der Outlook-Server hat nicht rechtzeitig geantwortet.".into(),
                    ));
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(self.die(
                        &mut link,
                        "Der Python-Server hat die Verbindung beendet.".into(),
                    ));
                }
            }
        }
    }

    /// Markiert den Server als tot und beendet den Prozess. Gibt den Grund zurück.
    fn die(&self, link: &mut Link, reason: String) -> String {
        self.alive.store(false, Ordering::Relaxed);
        let _ = link.child.kill();
        let _ = link.child.wait();
        reason
    }

    /// Beendet den Serverprozess beim App-Ende.
    pub fn shutdown(&self) {
        self.alive.store(false, Ordering::Relaxed);
        if let Ok(mut link) = self.link.lock() {
            let _ = link.child.kill();
            let _ = link.child.wait();
        }
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        if let Ok(mut link) = self.link.lock() {
            let _ = link.child.kill();
            let _ = link.child.wait();
        }
    }
}

fn write_request(stdin: &mut ChildStdin, id: u64, args: &[String]) -> std::io::Result<()> {
    let request = serde_json::json!({ "id": id, "args": args });
    let mut line = serde_json::to_string(&request).unwrap_or_default();
    line.push('\n');
    stdin.write_all(line.as_bytes())?;
    stdin.flush()
}

#[cfg(test)]
mod tests {
    use super::Client;
    use std::path::PathBuf;
    use std::time::Duration;

    fn script() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("outlook-server/mailboard_server.py")
    }

    fn python() -> String {
        std::env::var("MAILBOARD_PYTHON").unwrap_or_else(|_| {
            if cfg!(windows) {
                "python".into()
            } else {
                "python3".into()
            }
        })
    }

    fn start() -> Client {
        Client::start(&python(), &script(), true, Duration::from_secs(10)).expect("Start")
    }

    #[test]
    fn demo_roundtrip_folders_and_board() {
        let client = start();

        let folders = client.call(vec!["--folders".into()]).expect("folders");
        let parsed: serde_json::Value = serde_json::from_str(&folders).unwrap();
        let list = parsed.as_array().unwrap();
        assert!(!list.is_empty());
        let inboxes = list
            .iter()
            .filter(|f| f["isInbox"].as_bool() == Some(true))
            .count();
        assert_eq!(inboxes, 1);

        let board = client
            .call(vec!["--board".into(), "[\"F-PROJ\"]".into()])
            .expect("board");
        let rows: serde_json::Value = serde_json::from_str(&board).unwrap();
        let ids: Vec<&str> = rows
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["folderId"].as_str().unwrap())
            .collect();
        assert!(ids.contains(&"INBOX"));
        assert!(ids.contains(&"F-PROJ"));
        assert!(!ids.contains(&"F-TIPS"));

        client.shutdown();
    }

    #[test]
    fn unsupported_command_reports_error_and_server_survives() {
        let client = start();
        let err = client.call(vec!["--draft".into(), "a".into()]).unwrap_err();
        assert!(err.contains("noch nicht portiert"), "{err}");
        let again = client.call(vec!["--folders".into()]).expect("weiter nutzbar");
        assert!(again.contains("Posteingang"));
        client.shutdown();
    }

    #[test]
    fn slow_answer_times_out_and_marks_server_dead() {
        // Kurzes Zeitlimit, Server soll länger "arbeiten".
        let client =
            Client::start(&python(), &script(), true, Duration::from_millis(300)).expect("Start");
        let err = client
            .call(vec!["--sleep".into(), "3000".into()])
            .unwrap_err();
        assert!(err.contains("nicht rechtzeitig"), "{err}");
        assert!(!client.alive(), "Server muss nach Timeout als tot gelten");
        // Danach lehnt jeder Aufruf sofort ab (App fällt auf den C#-Helfer zurück).
        assert!(client.call(vec!["--folders".into()]).is_err());
    }

    #[test]
    fn dead_after_shutdown() {
        let client = start();
        client.shutdown();
        assert!(!client.alive());
        assert!(client.call(vec!["--folders".into()]).is_err());
    }
}
