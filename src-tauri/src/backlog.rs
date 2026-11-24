/// Rückstand im Posteingang, älteste zuerst. Ohne `limit` und `cursor` wie bisher die ältesten 300 als Liste,
/// sonst eine Seite `{cards, next}` mit höchstens `limit` Mails nach dem Fortsetzungspunkt `cursor` der vorigen Seite
/// (seitenweises Lesen in der Einrichtung, E7). `next` ist am Ende des Posteingangs `null`.
#[tauri::command]
pub async fn outlook_backlog(limit: Option<u32>, cursor: Option<String>) -> Result<String, String> {
    crate::run_helper(backlog_args(limit, cursor)?).await
}

/// Fortsetzungspunkt des Helfers: Empfangszeit in Ticks, `|`, EntryID (hexadezimal).
fn valid_cursor(cursor: &str) -> bool {
    match cursor.split_once('|') {
        Some((ticks, id)) => {
            (1..=19).contains(&ticks.len())
                && ticks.bytes().all(|b| b.is_ascii_digit())
                && !id.is_empty()
                && id.len() <= 8192
                && id.bytes().all(|b| b.is_ascii_alphanumeric())
        }
        None => false,
    }
}

fn backlog_args(limit: Option<u32>, cursor: Option<String>) -> Result<Vec<String>, String> {
    match (limit, cursor) {
        (None, None) => Ok(vec!["--backlog".into()]),
        (Some(limit), None) if (1..=5000).contains(&limit) => {
            Ok(vec!["--backlog-page".into(), limit.to_string()])
        }
        (Some(limit), Some(cursor)) if (1..=5000).contains(&limit) && valid_cursor(&cursor) => {
            Ok(vec!["--backlog-page".into(), limit.to_string(), cursor])
        }
        _ => Err("Ungültige Seite für den Rückstand.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::backlog_args;

    #[test]
    fn backlog_pages() {
        assert_eq!(backlog_args(None, None).unwrap(), vec!["--backlog"]);
        assert_eq!(
            backlog_args(Some(250), None).unwrap(),
            vec!["--backlog-page", "250"]
        );
        assert_eq!(
            backlog_args(Some(250), Some("638680000000000000|00AB12".into())).unwrap(),
            vec!["--backlog-page", "250", "638680000000000000|00AB12"]
        );
        assert!(backlog_args(Some(0), None).is_err());
        assert!(backlog_args(Some(5001), None).is_err());
        assert!(backlog_args(None, Some("1|AB".into())).is_err());
        for bad in ["", "1|", "|AB", "x|AB", "1|A B", "-1|AB", "1|AB|C", "12345678901234567890|AB"] {
            assert!(backlog_args(Some(20), Some(bad.into())).is_err(), "{bad}");
        }
    }
}
