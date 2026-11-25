//! Schaltet den Outlook-Zugriff zwischen dem bisherigen C#-Helfer (eine EXE je Befehl)
//! und dem dauerhaft laufenden Python-Hintergrundserver um.
//!
//! Der Server ist der Versuchsaufbau. Er wird nur gestartet, wenn die Umgebungsvariable
//! `MAILBOARD_OUTLOOK_SERVER` gesetzt ist, damit der erprobte EXE-Weg die Vorgabe bleibt
//! und ein Rückwechsel keinen neuen Build braucht.
//!
//! Variablen:
//!   MAILBOARD_OUTLOOK_SERVER  gesetzt => Python-Server statt C#-Helfer
//!   MAILBOARD_PYTHON          Python-Programm (Vorgabe: "python"); z. B. der Pfad
//!                             zur python.exe der vorhandenen venv
//!   MAILBOARD_SERVER_SCRIPT   Pfad zu mailboard_server.py (Vorgabe: neben der EXE
//!                             unter outlook-server/)
//!   MAILBOARD_SERVER_DEMO     gesetzt => Beispieldaten statt echtem Outlook (zum Prüfen)

use mailboard_server_client::Client;
use std::path::PathBuf;
use std::sync::OnceLock;

static SERVER: OnceLock<Client> = OnceLock::new();

/// Soll der Python-Server verwendet werden?
pub fn enabled() -> bool {
    std::env::var_os("MAILBOARD_OUTLOOK_SERVER").is_some()
}

/// Läuft der Server und ist ansprechbar? Nach einem Timeout oder Absturz `false`,
/// damit `run_helper` wieder den C#-Helfer nutzt.
pub fn ready() -> bool {
    SERVER.get().map_or(false, |client| client.alive())
}

/// Startet den Server, wenn er angefordert ist. Schlägt der Start fehl, bleibt der
/// Server aus und die App fällt auf den C#-Helfer zurück; der Grund steht im Protokoll.
pub fn try_start() {
    if !enabled() {
        return;
    }
    match start() {
        Ok(()) => eprintln!("[mailboard] Outlook-Server gestartet."),
        Err(err) => eprintln!(
            "[mailboard] Outlook-Server nicht gestartet, nutze den C#-Helfer: {err}"
        ),
    }
}

fn start() -> Result<(), String> {
    let python = std::env::var("MAILBOARD_PYTHON").unwrap_or_else(|_| "python".into());
    let script = script_path()?;
    if !script.is_file() {
        return Err(format!("Serverskript fehlt: {}", script.display()));
    }
    let demo = std::env::var_os("MAILBOARD_SERVER_DEMO").is_some();
    let client = Client::start(&python, &script, demo, timeout())?;
    SERVER
        .set(client)
        .map_err(|_| "Server läuft bereits.".to_string())
}

/// Höchstwartezeit je Befehl (MAILBOARD_SERVER_TIMEOUT in Sekunden, Vorgabe 120).
fn timeout() -> std::time::Duration {
    let seconds = std::env::var("MAILBOARD_SERVER_TIMEOUT")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|seconds| *seconds > 0)
        .unwrap_or(120);
    std::time::Duration::from_secs(seconds)
}

fn script_path() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("MAILBOARD_SERVER_SCRIPT") {
        return Ok(PathBuf::from(path));
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(exe
        .with_file_name("outlook-server")
        .join("mailboard_server.py"))
}

/// Führt einen Befehl über den Server aus (nur aufrufen, wenn `ready()`).
pub fn call(args: Vec<String>) -> Result<String, String> {
    SERVER
        .get()
        .ok_or_else(|| "Outlook-Server nicht gestartet.".to_string())?
        .call(args)
}

/// Beendet den Serverprozess beim App-Ende.
pub fn shutdown() {
    if let Some(client) = SERVER.get() {
        client.shutdown();
    }
}
