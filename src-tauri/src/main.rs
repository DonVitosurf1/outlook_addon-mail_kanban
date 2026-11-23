#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

static STATUS_PREFIX: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

#[tauri::command]
fn outlook_prefix(prefix: String) -> Result<(), String> {
    if prefix.trim().is_empty() || prefix.chars().count() > 128 || prefix.contains(char::is_control)
    {
        return Err("Ungültiges Statuspräfix.".into());
    }
    *STATUS_PREFIX.lock().map_err(|e| e.to_string())? = Some(prefix);
    Ok(())
}

async fn run_helper(args: Vec<String>) -> Result<String, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        tauri::async_runtime::spawn_blocking(move || {
            let _write_guard = desktop::WriteGuard::for_command(args.first())?;
            let helper = std::env::current_exe()
                .map_err(|e| e.to_string())?
                .with_file_name("Mail-Board-Outlook.exe");
            let mut command = std::process::Command::new(helper);
            if let Some(prefix) = STATUS_PREFIX.lock().map_err(|e| e.to_string())?.as_ref() {
                command.env("KANBAN_STATUS_PREFIX", prefix);
            }
            let result = command
                .args(args)
                .creation_flags(0x08000000)
                .output()
                .map_err(|e| e.to_string())?;
            if result.status.success() {
                Ok(String::from_utf8_lossy(&result.stdout).into_owned())
            } else {
                Err(format!(
                    "{}: {}",
                    result.status,
                    String::from_utf8_lossy(&result.stderr)
                ))
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    Err("Die Verbindung zu Outlook benötigt Windows.".into())
}

#[tauri::command]
async fn outlook_inbox() -> Result<String, String> {
    run_helper(vec!["--inbox".into()]).await
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 8192 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Ungültige Outlook-ID.".into());
    }
    Ok(())
}

#[tauri::command]
async fn outlook_folders() -> Result<String, String> {
    run_helper(vec!["--folders".into()]).await
}

#[tauri::command]
async fn outlook_folder(
    folder: String,
    inbox_days: u32,
    done_days: u32,
    limit: u32,
) -> Result<String, String> {
    validate_id(&folder)?;
    run_helper(vec![
        "--folder".into(),
        folder,
        inbox_days.to_string(),
        done_days.to_string(),
        limit.to_string(),
    ])
    .await
}

#[tauri::command]
async fn outlook_open(id: String, folder: String) -> Result<String, String> {
    validate_id(&id)?;
    validate_id(&folder)?;
    run_helper(vec!["--open".into(), id, folder]).await
}

async fn change_folder(
    action: &str,
    id: String,
    source: String,
    target: String,
) -> Result<String, String> {
    for value in [&id, &source, &target] {
        validate_id(value)?;
    }
    if source == target {
        return Err("Die Mail liegt bereits im Zielordner.".into());
    }
    run_helper(vec![action.into(), id, source, target]).await
}

#[tauri::command]
async fn outlook_move(id: String, source: String, target: String) -> Result<String, String> {
    change_folder("--move", id, source, target).await
}

#[tauri::command]
async fn outlook_undo(id: String, source: String, target: String) -> Result<String, String> {
    change_folder("--undo", id, source, target).await
}

#[tauri::command]
async fn outlook_status(
    id: String,
    folder: String,
    status: String,
    since: Option<String>,
    expected: Option<String>,
    expected_since: Option<String>,
) -> Result<String, String> {
    validate_id(&id)?;
    validate_id(&folder)?;
    if !matches!(
        status.as_str(),
        "" | "Offen" | "In Bearbeitung" | "Warten" | "Erledigt"
    ) {
        return Err("Ungültiger Status.".into());
    }
    let mut args = vec!["--status".into(), id, folder, status];
    if let Some(value) = expected {
        args.push(since.unwrap_or_default());
        args.push(value);
        if let Some(stamp) = expected_since {
            args.push(stamp);
        }
    } else if let Some(stamp) = since {
        args.push(stamp);
    }
    run_helper(args).await
}

#[tauri::command]
async fn outlook_field(
    id: String,
    folder: String,
    field: String,
    value: String,
    expected: Option<String>,
) -> Result<String, String> {
    validate_id(&id)?;
    validate_id(&folder)?;
    if !matches!(field.as_str(), "note" | "followUp" | "snoozeUntil") {
        return Err("Unbekanntes Mailfeld.".into());
    }
    let mut args = vec!["--field".into(), id, folder, field, value];
    if let Some(value) = expected {
        args.push(value);
    }
    run_helper(args).await
}

#[tauri::command]
async fn outlook_tags(
    id: String,
    folder: String,
    previous: Vec<String>,
    wanted: Vec<String>,
) -> Result<String, String> {
    validate_id(&id)?;
    validate_id(&folder)?;
    let encode = |tags: Vec<String>| serde_json::to_string(&tags).map_err(|e| e.to_string());
    run_helper(vec![
        "--tags".into(),
        id,
        folder,
        encode(previous)?,
        encode(wanted)?,
    ])
    .await
}

#[tauri::command]
async fn outlook_connect() -> Result<String, String> {
    run_helper(vec!["--connect".into()]).await
}

#[tauri::command]
async fn outlook_draft(
    id: String,
    folder: String,
    mode: String,
    text: String,
) -> Result<String, String> {
    validate_id(&id)?;
    validate_id(&folder)?;
    if !matches!(
        mode.as_str(),
        "reply" | "reply-all" | "forward" | "follow-up"
    ) {
        return Err("Unbekannte Entwurfsart.".into());
    }
    run_helper(vec!["--draft".into(), id, folder, mode, text]).await
}

#[tauri::command]
async fn outlook_board(
    folders: Vec<String>,
    inbox_days: u32,
    done_days: u32,
    limit: u32,
) -> Result<String, String> {
    for id in &folders {
        validate_id(id)?;
    }
    run_helper(vec![
        "--board".into(),
        serde_json::to_string(&folders).map_err(|e| e.to_string())?,
        inbox_days.to_string(),
        done_days.to_string(),
        limit.to_string(),
    ])
    .await
}

#[tauri::command]
async fn outlook_training(folder: String, limit: u32, days: u32) -> Result<String, String> {
    validate_id(&folder)?;
    run_helper(vec![
        "--training".into(),
        folder,
        limit.to_string(),
        days.to_string(),
    ])
    .await
}

#[tauri::command]
async fn outlook_correspondence(days: u32, folders: Vec<String>) -> Result<String, String> {
    for id in &folders {
        validate_id(id)?;
    }
    let mut args = vec!["--correspondence".into(), days.to_string()];
    args.extend(folders);
    run_helper(args).await
}

#[tauri::command]
async fn outlook_categories() -> Result<String, String> {
    run_helper(vec!["--categories".into()]).await
}

#[tauri::command]
async fn outlook_sync_colors(colors: [u8; 4]) -> Result<String, String> {
    if colors.iter().any(|color| *color > 25) {
        return Err("Unbekannte Outlook-Farbe.".into());
    }
    let mut args = vec!["--sync-colors".into()];
    args.extend(colors.iter().map(|color| color.to_string()));
    run_helper(args).await
}

mod ai;
mod backlog;
mod desktop;
mod lifetime;
mod projects;
fn main() {
    use tauri_plugin_window_state::{Builder as WindowState, StateFlags};
    tauri::Builder::default()
        .plugin(
            WindowState::new()
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE | StateFlags::MAXIMIZED)
                .build(),
        )
        .on_window_event(desktop::window_event)
        .on_page_load(|_, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                desktop::end_batch();
            }
        })
        .invoke_handler(tauri::generate_handler![
            desktop::outlook_batch,
            outlook_categories,
            outlook_sync_colors,
            outlook_prefix,
            outlook_inbox,
            outlook_open,
            outlook_folders,
            outlook_folder,
            outlook_move,
            outlook_undo,
            outlook_status,
            outlook_board,
            outlook_training,
            outlook_correspondence,
            backlog::outlook_backlog,
            outlook_field,
            outlook_tags,
            outlook_draft,
            outlook_connect,
            projects::project_create,
            projects::project_rename,
            projects::project_move,
            ai::ai_models,
            ai::ai_analyze,
            ai::ai_suggest,
            ai::ai_subfolders,
            ai::ai_reply,
            ai::ai_profile,
            ai::ai_centroid,
            ai::ai_holdout,
            ai::ai_embed,
            ai::ai_rank,
            ai::ai_groups,
            ai::ai_outliers
        ])
        .run(tauri::generate_context!())
        .expect("Das Mail-Board konnte nicht gestartet werden");
}
