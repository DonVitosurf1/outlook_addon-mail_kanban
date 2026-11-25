//! Startet den Outlook-Hintergrundserver (Python) und spricht über eine
//! stdin/stdout-Pipe mit ihm. Bewusst ohne Netzwerk-Socket: so entsteht keine
//! lokale Angriffsfläche, kein Port und keine Firewall-Abfrage, und der
//! Kindprozess hängt eindeutig an dieser App.
//!
//! Protokoll siehe outlook-server/mailboard_server.py: eine JSON-Zeile je Nachricht.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;

struct Link {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

/// Dauerhafte Verbindung zum Hintergrundserver. Aufrufe werden serialisiert.
pub struct Client {
    link: Mutex<Link>,
}

impl Client {
    /// Startet `python <script> [--demo]`, prüft mit `--ping` die Bereitschaft.
    pub fn start(python: &str, script: &Path, demo: bool) -> Result<Client, String> {
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
        let stdin = child
            .stdin
            .take()
            .ok_or("Keine Eingabe zum Python-Server.")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("Keine Ausgabe vom Python-Server.")?;

        let client = Client {
            link: Mutex::new(Link {
                child,
                stdin,
                stdout: BufReader::new(stdout),
                next_id: 0,
            }),
        };
        // Bereitschaft bestätigen; scheitert der Start, kommt der Fehler sofort.
        match client.call(vec!["--ping".into()]) {
            Ok(out) if out == "\"pong\"" => Ok(client),
            Ok(other) => Err(format!("Unerwartete Antwort auf --ping: {other}")),
            Err(err) => Err(format!("Python-Server antwortet nicht: {err}")),
        }
    }

    /// Schickt einen Befehl und gibt den JSON-Text zurück (wie der bisherige Helfer),
    /// oder den Fehlertext des Servers.
    pub fn call(&self, args: Vec<String>) -> Result<String, String> {
        let mut link = self
            .link
            .lock()
            .map_err(|_| "Server-Verbindung ist gestört.".to_string())?;
        link.next_id += 1;
        let id = link.next_id;

        let request = serde_json::json!({ "id": id, "args": args });
        let mut line = serde_json::to_string(&request).map_err(|e| e.to_string())?;
        line.push('\n');
        link.stdin
            .write_all(line.as_bytes())
            .and_then(|_| link.stdin.flush())
            .map_err(|e| format!("Befehl an den Server fehlgeschlagen: {e}"))?;

        // Antworten kommen der Reihe nach; die ID wird trotzdem geprüft.
        loop {
            let mut buf = String::new();
            let read = link
                .stdout
                .read_line(&mut buf)
                .map_err(|e| format!("Keine Antwort vom Server: {e}"))?;
            if read == 0 {
                return Err("Der Python-Server hat die Verbindung beendet.".into());
            }
            let trimmed = buf.trim();
            if trimmed.is_empty() {
                continue;
            }
            let value: serde_json::Value = match serde_json::from_str(trimmed) {
                Ok(value) => value,
                Err(_) => continue, // Fremdzeile ignorieren, Antwort steht in der nächsten
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
    }

    /// Beendet den Serverprozess. stdin schließen bittet ihn zum Aufhören; danach sicher töten.
    pub fn shutdown(&self) {
        if let Ok(mut link) = self.link.lock() {
            let _ = link.stdin.flush();
            // stdin fallenlassen schließt die Pipe -> der Server verlässt seine Leseschleife.
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

#[cfg(test)]
mod tests {
    use super::Client;
    use std::path::PathBuf;

    fn script() -> PathBuf {
        // server-client/ -> src-tauri/ -> Projektwurzel
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("outlook-server/mailboard_server.py")
    }

    fn python() -> String {
        std::env::var("MAILBOARD_PYTHON").unwrap_or_else(|_| {
            if cfg!(windows) { "python".into() } else { "python3".into() }
        })
    }

    #[test]
    fn demo_roundtrip_folders_and_board() {
        let client = Client::start(&python(), &script(), true).expect("Start");

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
        let client = Client::start(&python(), &script(), true).expect("Start");
        let err = client
            .call(vec!["--draft".into(), "a".into()])
            .unwrap_err();
        assert!(err.contains("noch nicht portiert"), "{err}");
        // Server lebt weiter
        let again = client.call(vec!["--folders".into()]).expect("weiter nutzbar");
        assert!(again.contains("Posteingang"));
        client.shutdown();
    }
}
