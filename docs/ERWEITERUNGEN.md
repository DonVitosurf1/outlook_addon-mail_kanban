# Erweiterungen 0.16 bis 0.20

Die Stufen folgen der Roadmap der Python-Referenz. Umgesetzt sind sie nur in dieser Tauri-Fassung. Die Python-Version wird nicht mehr gepflegt, und sie erhält keine Rückportierung. Das Board bleibt ein persönliches Werkzeug. Alle neuen Daten liegen entweder als Outlook-Kategorie an der Mail oder lokal im Benutzerprofil. Neue COM-Befehle sind nicht hinzugekommen.

| Stufe | Bedienung | Daten |
|---|---|---|
| 0.16 Morgen-Triage auf dem Board | **Strg+T**, Start → „Morgen-Triage starten“ oder Strg+K | Zeitpunkt der letzten beendeten Triage, lokal je Demo und Outlook |
| 0.17 Fokus | **F** auf markierten Karten, Seitenleiste → Fokus | Outlook-Kategorie „Fokus“ |
| 0.18 Routinen | Werkzeuge → Routinen | Lokal unter `mailboard-routines-v1` |
| 0.19 Wochenkalender | Werkzeuge → Wochenkalender, Start, Wochenblick | Liest Fristen der Mails, Routinen und Checklisten |
| 0.20 Vorgänge mit Checklisten | Werkzeuge → Vorgänge, Kontextmenü → „Vorgang zuordnen …“, Strg+K | Zuordnung als Outlook-Kategorie „Vorgang: Name“, Checkliste und Notiz lokal unter `mailboard-cases-v1` |

Die ZIP-Sicherung unter **Lokale Daten und Textbausteine** enthält die lokalen Schlüssel automatisch. Beim Import wird geprüft, dass Routinen und Vorgänge Listen sind.

## 0.16 Morgen-Triage auf dem Board

Bisher war die Triage ein Dialog mit drei Schritten. Ein Klick auf eine Mail schloss den Dialog und unterbrach den Ablauf. Jetzt bleibt das Board die Arbeitsfläche.

- Über den Spalten erscheint ein Banner mit Schritt, Anzahl, Hinweis, Briefing und den Knöpfen „Vorheriger Schritt“, „Nächster Schritt“ bzw. „Triage beenden“ sowie „Triage abbrechen“.
- **Schritte.** 1. *Heute dran* zeigt Karten mit Fälligkeitsgrund: Wiedervorlage heute, Antwort ist da, Nachfassen, überfälliges Warten, Frist. 2. *Offen durchgehen* und 3. *Rest parken* zeigen offene, nicht geparkte Mails. Schritt 3 enthält damit nur noch, was in Schritt 2 unangetastet blieb.
- **Abgang.** Eine Karte verlässt den Schritt, sobald sie dessen Filter verlässt, also durch Statuswechsel, Wiedervorlage oder Ablage. Ein eigenes Merkmal „gesichtet“ gibt es nicht. Was offen bleiben soll, bleibt stehen, bis du weitergehst.
- Gearbeitet wird mit den vorhandenen Kartenaktionen: 1–4, W, N, K, F, Strg+Eingabe, Leertaste, Drag-and-drop und Strg+Z.
- **Briefing.** Es zeigt die Kennzahlen heute dran, Nachfassen fällig, Warten ohne Frist, Antwort nötig, im Fokus und auf Wiedervorlage. Dazu kommen die Mails, die seit der letzten *beendeten* Triage eingegangen sind, beim ersten Mal die der letzten 24 Stunden, sowie fällige Routinen und Checklistenpunkte mit „Erledigt“ bzw. „Abhaken“. Das Briefing ist im ersten Schritt aufgeklappt.
- **Ende.** Beenden und Abbrechen stellen Suche, benannte Sicht, Kategorie- und Fokusfilter wieder her. Sortierung und Gruppierung bleiben ohnehin unverändert. Nur „Triage beenden“ speichert den Zeitpunkt für „neu seit“.
- Die Triage startet nur manuell und übersteht keinen Neustart der App. Mails, die während der Triage per Polling eintreffen, erscheinen im passenden Schritt.

## 0.17 Fokus mit F

- F schaltet den Fokus der markierten Karten um. Sind alle schon im Fokus, nimmt F ihn weg, sonst setzt F ihn für alle. Geschrieben werden nur Mails, deren Kategorien sich ändern. Die Änderung ist ein Undo-Schritt.
- Gespeichert wird der Fokus als Outlook-Kategorie „Fokus“. Er übersteht dadurch Verschiebungen mit neuer EntryID und ist auch in Outlook sichtbar.
- Die Seitenleiste zeigt unter **Fokus** alle nicht erledigten und nicht geparkten Fokuskarten. Briefing und Wochenblick zählen sie.

## 0.18 Routinen

- Rhythmen sind täglich, werktags, wöchentlich (Wochentag) und monatlich (Tag 1–31, in kürzeren Monaten der Monatsletzte).
- Eine Routine ist ab ihrem letzten planmäßigen Termin fällig, frühestens am Anlagetag. Eine verpasste Routine bleibt fällig, bis sie abgehakt ist. Abhaken speichert den heutigen Tag.
- Optional öffnet eine Routine eine Ansicht: Morgen-Triage, Warten-Hygiene, Wochenblick, Posteingang aufräumen, Gesendet ohne Antwort, Wochenkalender oder Vorgänge.
- Fällige Routinen stehen im Briefing, in Start und im Wochenkalender.

## 0.19 Wochenkalender

- Er zeigt eine Woche von Montag bis Sonntag mit Navigation. Überfälliges ist vorn gesammelt: Nachfassen, nicht abgehakte Routinen und offene Checklistenpunkte.
- Einträge sind Nachfasstermine wartender Mails ohne Antwort, künftige Wiedervorlagen, KI-Fristen, Routinen und Checklistenpunkte offener Vorgänge. Erledigte Mails fehlen.
- Ein Klick auf eine Mail öffnet die Maildetails. Ziehst du eine Mail auf einen Tag ab heute, setzt das bei wartenden Mails das Nachfassdatum (wie N), sonst die Wiedervorlage (wie W). Auch das ist mit Strg+Z rücknehmbar. KI-Fristen lassen sich nicht verschieben.
- Routinen lassen sich nur für den fälligen Termin abhaken, Checklistenpunkte jederzeit.

## 0.20 Vorgänge mit Checklisten

- Ein Vorgang bündelt Mails über die Outlook-Kategorie „Vorgang: Name“. Die Zuordnung übersteht Verschiebungen, eine Mail kann zu mehreren Vorgängen gehören, und die Gruppierung nach Kategorie funktioniert ohne Zusatzaufwand.
- Namen sind höchstens 60 Zeichen lang, ohne Komma und Semikolon, weil diese Zeichen Outlook-Kategorien trennen. Die Großschreibung unterscheidet keine Vorgänge.
- Checkliste mit optionalem Termin je Punkt und Notiz liegen lokal. Ein Vorgang, der nur über die Kategorie bekannt ist, etwa nach einem Wechsel des PCs ohne Sicherung, erscheint mit leerer Checkliste.
- Die Seitenleiste listet offene Vorgänge mit der Anzahl geladener Mails. Ein Klick filtert das Board darauf.
- Abschließen blendet einen Vorgang aus Seitenleiste und Kalender aus. Löschen entfernt die lokalen Daten und ist erst möglich, wenn keine geladene Mail mehr zugeordnet ist.

## Prüfung

- `npm test` → `tests/planning.test.ts`: Triage-Schritte, „neu seit“, Fokuslogik, Routinenrhythmen, Kalenderzuordnung, Vorgangsnamen, Bereinigung gespeicherter Daten, Briefing. `tests/backup.test.ts` prüft die neuen Sicherungsschlüssel.
- `python tests/planning-smoke.py`: Ablauf im Demo-Postfach mit Triage, Rückkehr zur Ansicht, Fokus und Undo, Routine im Briefing, Vorgang mit Checkliste, Kalender-Drag-and-drop mit Undo. Dazu kommt ein simuliertes Outlook, das die geschriebenen Kategorien für F und die Vorgangszuordnung prüft.
- Auf Windows mit echtem Outlook noch zu prüfen: das Schreiben der Kategorien „Fokus“ und „Vorgang: …“ in Konten mit verwalteter Hauptkategorienliste sowie deren Anzeige in Outlook-Ansichten.
