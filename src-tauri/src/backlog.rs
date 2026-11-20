#[tauri::command]
pub async fn outlook_backlog() -> Result<String, String> {
    crate::run_helper(vec!["--backlog".into()]).await
}
