const missingHelper = 'Mail-Board-Outlook.exe fehlt neben Mail-Board.exe. Lege Outlook-Test.exe aus dem Ordner vom 20. November daneben und wähle „Outlook-Verbindung testen“.'

/** Verbindungsfehler für die Statuszeile. Eine fehlende Helferdatei nennt die Datei, die am 20. November funktioniert hat. */
export function outlookLoadError(detail: string) {
  if (detail.startsWith('Mail-Board-Outlook.exe fehlt')) return detail
  if (/os error 2|angegebene Datei nicht finden/i.test(detail)) return missingHelper
  return 'Outlook konnte nicht geladen werden. ' + detail
}
