/** Muss wörtlich `MISSING_HELPER` in src-tauri/args/src/lib.rs entsprechen (ein Test prüft das). */
export const missingHelper = 'Mail-Board-Outlook.exe fehlt neben Mail-Board.exe. Lege Outlook-Test.exe aus dem Ordner vom 20. November daneben und wähle „Outlook-Verbindung testen“.'

/** Verbindungsfehler für die Statuszeile. Eine fehlende Helferdatei nennt die Datei, die am 20. November funktioniert hat. */
export function outlookLoadError(detail: string) {
  if (detail.startsWith(missingHelper)) return detail
  // Nur der Startfehler selbst („… (os error 2)“ am Ende), nicht os error 20, 22 oder Meldungen des Helfers.
  if (/\(os error 2\)\s*$/.test(detail)) return missingHelper
  return 'Outlook konnte nicht geladen werden. ' + detail
}
