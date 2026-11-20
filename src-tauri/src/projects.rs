use crate::{run_helper, validate_id};

fn valid_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() || name.len() > 255 || name.contains(['/', '\\']) || name.chars().any(char::is_control) {
        return Err("Bitte einen gültigen Ordnernamen ohne Pfadtrennzeichen eingeben.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn project_create(parent: String, name: String) -> Result<String, String> {
    validate_id(&parent)?;
    valid_name(&name)?;
    run_helper(vec!["--folder-create".into(), parent, name]).await
}

#[tauri::command]
pub async fn project_rename(folder: String, name: String) -> Result<String, String> {
    validate_id(&folder)?;
    valid_name(&name)?;
    run_helper(vec!["--folder-rename".into(), folder, name]).await
}

#[tauri::command]
pub async fn project_move(folder: String, source: String, target: String) -> Result<String, String> {
    for id in [&folder, &source, &target] { validate_id(id)?; }
    run_helper(vec!["--folder-move".into(), folder, source, target]).await
}
