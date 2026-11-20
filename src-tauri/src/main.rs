#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn demo_board() -> &'static str {
    include_str!("../../src/demo.json")
}

async fn run_helper(args: Vec<String>) -> Result<String, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        tauri::async_runtime::spawn_blocking(move || {
            let helper = std::env::current_exe().map_err(|e| e.to_string())?.with_file_name("Outlook-Test.exe");
            let result = std::process::Command::new(helper).args(args)
                .creation_flags(0x08000000).output().map_err(|e| e.to_string())?;
            if result.status.success() { Ok(String::from_utf8_lossy(&result.stdout).into_owned()) } else { Err(format!("{}: {}", result.status, String::from_utf8_lossy(&result.stderr))) }
        }).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    Err("Der Outlook-Test benötigt Windows.".into())
}

#[tauri::command]
async fn outlook_test() -> Result<String, String> { run_helper(vec![]).await }

#[tauri::command]
async fn outlook_inbox() -> Result<String, String> { run_helper(vec!["--inbox".into()]).await }

#[tauri::command]
async fn outlook_open(id: String) -> Result<String, String> {
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_hexdigit()) { return Err("Ungültige Mail-ID".into()); }
    run_helper(vec!["--open".into(), id]).await
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![demo_board, outlook_test, outlook_inbox, outlook_open])
        .run(tauri::generate_context!())
        .expect("Das Mail-Board konnte nicht gestartet werden");
}
