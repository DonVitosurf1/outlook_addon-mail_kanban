/// Windows CreateProcess stops at 32,767 characters.
const MAX_COMMAND_LINE: usize = 32_767;
/// Room for the helper path. The real path is only known when the process starts.
const HELPER_PATH_BUDGET: usize = 4_096;
/// Höchstlänge der Ordnerliste auf der Befehlszeile (Rest für Programmpfad und andere Argumente).
const MAX_FOLDER_LIST: usize = 24_000;

pub const MISSING_HELPER: &str = "Mail-Board-Outlook.exe fehlt neben Mail-Board.exe. Lege Outlook-Test.exe aus dem Ordner vom 20. November daneben und wähle „Outlook-Verbindung testen“.";
pub const MISSING_LEGACY: &str = "Outlook-Test.exe liegt nicht neben Mail-Board.exe. Kopiere die Datei vom 20. November in denselben Ordner.";

/// Die neue Helferdatei direkt neben der laufenden App.
pub fn full_helper(exe: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let path = exe.with_file_name("Mail-Board-Outlook.exe");
    if path.is_file() {
        Ok(path)
    } else {
        Err(MISSING_HELPER.into())
    }
}

/// Die Programmdatei vom 20. November, die den Posteingang in einem eigenen Fenster zeigt.
pub fn legacy_test(exe: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let path = exe.with_file_name("Outlook-Test.exe");
    if path.is_file() {
        Ok(path)
    } else {
        Err(MISSING_LEGACY.into())
    }
}

pub fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 8192 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Ungültige Outlook-ID.".into());
    }
    Ok(())
}

/// Anzahl der Elemente je Ordner (`[{id, count}]`). Ohne `folders` alle Ordner, sonst nur die genannten.
pub fn folder_counts_args(folders: Option<Vec<String>>) -> Result<Vec<String>, String> {
    let mut args = vec!["--folder-counts".into()];
    if let Some(ids) = folders {
        for id in &ids {
            validate_id(id)?;
        }
        let list = serde_json::to_string(&ids).map_err(|e| e.to_string())?;
        // Die Befehlszeile unter Windows hält höchstens 32.767 Zeichen. Größere Listen teilt der Aufrufer auf.
        if list.len() > MAX_FOLDER_LIST {
            return Err("Zu viele Ordner für einen Aufruf. Bitte in kleineren Teilen abfragen.".into());
        }
        args.push(list);
    }
    Ok(args)
}

/// Quoted length of one Windows command-line argument, including the wrapping quotes.
/// Backslashes before a quote, and backslashes at the end, are doubled. This is an upper bound:
/// arguments without spaces are not always quoted, so a short draft is never rejected by the bound alone.
fn quoted_chars(arg: &str) -> usize {
    let mut length = 2;
    let mut backslashes = 0usize;
    for c in arg.chars() {
        match c {
            '\\' => backslashes += 1,
            '"' => {
                length += backslashes * 2 + 1;
                backslashes = 0;
            }
            _ => {
                length += backslashes + 1;
                backslashes = 0;
            }
        }
    }
    length + backslashes * 2
}

fn command_line_chars(args: &[String]) -> usize {
    HELPER_PATH_BUDGET + args.iter().map(|arg| 1 + quoted_chars(arg)).sum::<usize>()
}

/// `--draft` arguments. Rejects text that would be cut off by the Windows command line.
pub fn draft_args(id: &str, folder: &str, mode: &str, text: &str) -> Result<Vec<String>, String> {
    validate_id(id)?;
    validate_id(folder)?;
    if !matches!(mode, "reply" | "reply-all" | "forward" | "follow-up") {
        return Err("Unbekannte Entwurfsart.".into());
    }
    let args = vec!["--draft".into(), id.into(), folder.into(), mode.into(), text.into()];
    if command_line_chars(&args) > MAX_COMMAND_LINE {
        return Err("Der Entwurf ist zu lang für Outlook. Bitte kürzen.".into());
    }
    Ok(args)
}

#[cfg(test)]
mod tests {
    use super::{draft_args, folder_counts_args, full_helper, legacy_test};
    use std::fs;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mailboard-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn full_helper_requires_the_file_beside_the_app() {
        let dir = scratch("full");
        let exe = dir.join("Mail-Board.exe");
        let message = full_helper(&exe).unwrap_err();
        assert!(message.contains("Outlook-Test.exe"), "{message}");
        assert!(message.contains("20. November"), "{message}");
        fs::write(dir.join("Mail-Board-Outlook.exe"), b"x").unwrap();
        assert_eq!(full_helper(&exe).unwrap(), dir.join("Mail-Board-Outlook.exe"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn legacy_window_uses_the_november_test_program() {
        let dir = scratch("legacy");
        let exe = dir.join("Mail-Board.exe");
        assert!(legacy_test(&exe).unwrap_err().contains("Outlook-Test.exe"));
        fs::write(dir.join("Outlook-Test.exe"), b"x").unwrap();
        assert_eq!(legacy_test(&exe).unwrap(), dir.join("Outlook-Test.exe"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn folder_counts() {
        assert_eq!(folder_counts_args(None).unwrap(), vec!["--folder-counts"]);
        assert_eq!(
            folder_counts_args(Some(vec!["00AB".into(), "01CD".into()])).unwrap(),
            vec!["--folder-counts", r#"["00AB","01CD"]"#]
        );
        assert!(folder_counts_args(Some(vec!["kein".into()])).is_err());
        // 150 lange Outlook-IDs passen, eine Liste über der Höchstlänge nicht.
        assert!(folder_counts_args(Some(vec!["AB".repeat(70); 150])).is_ok());
        assert!(folder_counts_args(Some(vec!["AB".repeat(70); 200])).is_err());
    }

    #[test]
    fn draft_text_stays_inside_the_windows_command_line() {
        let short = draft_args("AB", "01", "reply", "Kurz").unwrap();
        assert_eq!(short, vec!["--draft", "AB", "01", "reply", "Kurz"]);
        assert!(draft_args("AB", "01", "reply", &"a".repeat(30_000)).is_err());
        let wide = "AB".repeat(4096);
        assert!(draft_args(&wide, &wide, "reply", &"b".repeat(15_000)).is_err());
        assert!(draft_args("AB", "01", "anders", "Kurz").is_err());
    }
}
