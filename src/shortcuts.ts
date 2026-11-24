/**
 * Gemeinsame Liste aller Tastenkürzel. Hilfe („?“), Kontextmenü und Aktionsleiste lesen daraus.
 * Die Bezeichnungen folgen den Implementierungen in views.ts (Karte, Board), shell.ts, triage.ts,
 * cleanup.ts, correspondence.ts, cockpit.ts und tabs.ts.
 *
 * `id` ist die stabile Aktionskennung für `shortcutFor`, z. B. `shortcutFor('reply')` → 'R'.
 * Kennungen: status-open, status-progress, status-waiting, status-done, move-folder, open (in Outlook),
 * accept-suggestion, details, preview, reply, reply-all, follow-up, snooze, note, focus, navigate,
 * search, escape, undo, zoom-in, zoom-out, zoom-reset, tabs, unanswered, triage, cleanup,
 * cleanup-status, cleanup-back, cleanup-skip, hide-sent, palette, help, shortcuts.
 */
export type ShortcutGroup = 'Karte'|'Board'|'Ansichten'|'Triage'|'Dialoge'
export type ShortcutAction =
  'status-open'|'status-progress'|'status-waiting'|'status-done'|'move-folder'|'open'|'accept-suggestion'|
  'details'|'preview'|'reply'|'reply-all'|'follow-up'|'snooze'|'note'|'focus'|'navigate'|
  'search'|'escape'|'undo'|'zoom-in'|'zoom-out'|'zoom-reset'|'tabs'|'unanswered'|
  'triage'|'cleanup'|'cleanup-status'|'cleanup-back'|'cleanup-skip'|'hide-sent'|'palette'|'help'|'shortcuts'
export type Shortcut = {id:ShortcutAction, keys:string, action:string, group:ShortcutGroup}

export const shortcutGroups:readonly ShortcutGroup[] = ['Karte','Board','Ansichten','Triage','Dialoge']

const s=(group:ShortcutGroup,id:ShortcutAction,keys:string,action:string):Shortcut=>({id,keys,action,group})

export const shortcuts:readonly Shortcut[] = [
  s('Karte','status-open','1','Status „Offen“ setzen'),
  s('Karte','status-progress','2','Status „In Bearbeitung“ setzen'),
  s('Karte','status-waiting','3','Status „Warten“ setzen'),
  s('Karte','status-done','4','Status „Erledigt“ setzen'),
  s('Karte','move-folder','Strg+1…9','In den n-ten Zielordner verschieben'),
  s('Karte','open','Eingabe','Original in Outlook öffnen'),
  s('Karte','accept-suggestion','Strg+Eingabe','Ablagevorschlag übernehmen'),
  s('Karte','details','Leertaste','Maildetails öffnen'),
  s('Karte','preview','Umschalt+Leertaste','Vorschau ein- oder ausblenden'),
  s('Karte','reply','R','Antwort in Outlook vorbereiten'),
  s('Karte','reply-all','Umschalt+R','Allen antworten'),
  s('Karte','follow-up','N','Nachfassdatum setzen (nur bei „Warten“)'),
  s('Karte','snooze','W','Wiedervorlage setzen'),
  s('Karte','note','K','Notiz bearbeiten'),
  s('Karte','focus','F','Karten in den Fokus nehmen oder herausnehmen'),
  s('Karte','navigate','Pfeiltasten','Zwischen Karten und Spalten wechseln (mit Umschalt: Auswahl erweitern)'),
  s('Board','search','Strg+F','Suche aufrufen'),
  s('Board','escape','Escape','Vorschau schließen, dann Auswahl aufheben, dann Filter zurücksetzen'),
  s('Board','undo','Strg+Z','Letzte Aktion rückgängig machen'),
  s('Board','zoom-in','Strg+Plus','Board vergrößern'),
  s('Board','zoom-out','Strg+Minus','Board verkleinern'),
  s('Board','zoom-reset','Strg+0','Boardgröße zurücksetzen'),
  s('Ansichten','tabs','Pfeiltasten','In der Tab-Leiste zum vorherigen oder nächsten Tab'),
  s('Ansichten','tabs','Pos1','In der Tab-Leiste zum ersten Tab'),
  s('Ansichten','tabs','Ende','In der Tab-Leiste zum letzten Tab'),
  s('Ansichten','unanswered','Strg+G','„Gesendet ohne Antwort“ öffnen'),
  s('Triage','triage','Strg+T','Morgen-Triage starten'),
  s('Triage','cleanup','Strg+R','Posteingang aufräumen'),
  s('Triage','cleanup-status','1–4','Beim Aufräumen: Status setzen'),
  s('Triage','cleanup-back','Rücktaste','Beim Aufräumen: zurück zur vorigen Mail'),
  s('Triage','cleanup-skip','Leertaste','Beim Aufräumen: Mail überspringen'),
  s('Dialoge','palette','Strg+K','Befehlspalette öffnen'),
  s('Dialoge','help','F1','Hilfe öffnen'),
  s('Dialoge','shortcuts','?','Tastenkürzel anzeigen'),
  s('Dialoge','hide-sent','Entf','In „Gesendet ohne Antwort“: Eintrag ausblenden'),
  s('Dialoge','escape','Escape','Dialog schließen'),
]

/** Erste Tastenkombination zu einer Aktion, z. B. für Kontextmenü und Aktionsleiste. */
export function shortcutFor(action:ShortcutAction):string|undefined {
  return shortcuts.find(entry=>entry.id===action)?.keys
}
