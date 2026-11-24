/// Rückstand im Posteingang, älteste zuerst. Ohne `limit` und `offset` wie bisher die ältesten 300,
/// sonst eine Seite mit höchstens `limit` Mails ab Position `offset` (seitenweises Lesen in der Einrichtung, E7).
#[tauri::command]
pub async fn outlook_backlog(limit: Option<u32>, offset: Option<u32>) -> Result<String, String> {
    crate::run_helper(backlog_args(limit, offset)?).await
}

fn backlog_args(limit: Option<u32>, offset: Option<u32>) -> Result<Vec<String>, String> {
    match (limit, offset) {
        (None, None) => Ok(vec!["--backlog".into()]),
        (Some(limit), offset) if (1..=5000).contains(&limit) && offset.unwrap_or(0) <= 100_000 => Ok(vec![
            "--backlog".into(),
            limit.to_string(),
            offset.unwrap_or(0).to_string(),
        ]),
        _ => Err("Ungültige Seite für den Rückstand.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::backlog_args;

    #[test]
    fn backlog_pages() {
        assert_eq!(backlog_args(None, None).unwrap(), vec!["--backlog"]);
        assert_eq!(backlog_args(Some(250), Some(500)).unwrap(), vec!["--backlog", "250", "500"]);
        assert_eq!(backlog_args(Some(20), None).unwrap(), vec!["--backlog", "20", "0"]);
        assert!(backlog_args(Some(0), Some(0)).is_err());
        assert!(backlog_args(None, Some(20)).is_err());
        assert!(backlog_args(Some(20), Some(100_001)).is_err());
    }
}
