# Umsetzungsplan für docs/PLAN.md (Abschnitte 2, 4, 5)

**Spec:** [docs/PLAN.md](../PLAN.md). Sie ist die verbindliche Quelle. Jeder Task nennt den Abschnitt, aus dem er stammt. Die Reihenfolge folgt der dort empfohlenen Gesamtreihenfolge: zuerst Bedienbarkeit, dann K2 → K3 → Einrichtungsassistent → K1 → K4 → K5.

## Global Constraints

- **Arbeitsort:** `/home/user/outlook_addon-mail_kanban`, Branch `claude/sharp-newton-h2hkci`. Committen ja, pushen nein.
- **Sprache:** Oberflächentexte auf Deutsch in Du-Form, im Ton der vorhandenen Texte. Kurze Sätze, keine Marketingsprache.
- **Abhängigkeiten:** keine neuen npm-, Cargo- oder NuGet-Pakete.
- **Datenschutz:** Mailinhalte gehen nur an lokale Modelle. Jeder neue Modellaufruf läuft über den Rust-Crate `src-tauri/ollama` und ruft vorher `check_local_model` auf. Jeder Prompt sagt, dass Mailinhalt Daten und keine Anweisung ist.
- **Postfachänderungen** (Verschieben, Kategorien, Status, Ordner anlegen, umbenennen, verschieben) brauchen eine Bestätigung mit Zielliste. Sie laufen im Outlook-Modus als Undo-Schritt über `LiveBoard`/`writeBatch` bzw. die Projekt-Rücknahme in `src/projects.ts`, im Beispielpostfach über `demoUndo`. Nichts wird gelöscht.
- **Beispielpostfach** (`mailbox==='demo'`): keine Modellaufrufe. Planungsdaten liegen nur im Speicher (`useSamplePlanning`), Einstellungen im Beispielmodus (`useSampleSettings`).
- **Bedienbarkeit:** alles per Tastatur bedienbar, sichtbarer Fokus, passende ARIA-Rollen. Daten werden als `textContent` gerendert, nie als `innerHTML`.
- **Gestaltung:** nach `DESIGN.md` (Tokens `--accent`, `--accent-ink`, `--sun`, `--soft`, `--radius-panel` …). Styles gehören nach `board.css`. Die Dichte richtet sich nach `[data-display-profile]`.
- **Tests:** Alle bestehenden Tests bleiben grün. Neue Logik bekommt Unit-Tests (`tests/*.test.ts`, Node-Test, laufen über `npm test`). Neue Oberfläche bekommt einen Browser-Smoke-Test (`tests/*-smoke.py`, Playwright, Muster wie `tests/planning-smoke.py`). Befehle:
  - `npm run build` (TypeScript-Prüfung und Bundle) und `npm test`
  - Smoke-Tests: `CHROMIUM=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome PATH=/tmp/claude-0/-home-user-outlook-addon-mail-kanban/07ce7d33-19c4-52d7-be66-bad34ad28813/scratchpad/bin:$PATH python3 tests/<name>-smoke.py` (vorher `npm run build`)
  - alles zusammen: `/tmp/claude-0/-home-user-outlook-addon-mail-kanban/07ce7d33-19c4-52d7-be66-bad34ad28813/scratchpad/run-tests.sh`
  - Rust: `cargo test --manifest-path src-tauri/Cargo.toml -p mailboard-ollama`, bei Änderungen in `src-tauri/src` zusätzlich `cargo check --manifest-path src-tauri/Cargo.toml -p mail-board`
  - C#: `cd outlook-test/tests && dotnet run --project OutlookContracts.csproj`, bei Änderungen in `outlook-test/`
- **Hilfe:** Ändert sich etwas Sichtbares, wird die Hilfe in `src/cockpit.ts` (Array `help`) angepasst, wo sie betroffen ist.
- **Plan abhaken:** Jeder Task setzt die zugehörigen Kästchen in `docs/PLAN.md` auf `[x]`, im selben Commit.
- **Commits:** deutsche Nachricht mit Betreff und kurzem Text, am Ende genau diese beiden Zeilen:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_0172C4tQ88Hkc3FXkW3bzJgo`

## Task 1: U2 Verschieben im Dialog freigeben und U11 Begriffe klären

Spec: `docs/PLAN.md` Abschnitt 5, U2 und U11.

**U2**
- In `change()` in `src/board.ts` endet die erste Ablage nicht mehr mit dem Fehler „Verschieben ist gesperrt …“, wenn `allow_move` fehlt. Stattdessen öffnet sich der vorhandene Bestätigungsdialog `#moveConfirm` mit der Frage: „Das Board darf noch keine Mails in Outlook verschieben. Jetzt erlauben und „<Betreff/Anzahl>“ nach „<Ziel>“ verschieben?“ Der Bestätigungsknopf heißt dann „Erlauben und verschieben“.
- Bestätigen setzt `updateConfig({allow_move:true})`, aktualisiert die Checkbox `#allowMove` in den Einstellungen und verschiebt. Abbrechen ändert nichts.
- Das gilt auch für das Archivieren beim Erledigen.

**U11**
- `index.html`: Die Seitenleisten-Überschrift „Fokus“ (Abschnitt `.focus-section`) heißt „Ansichten“. Der Ansichtsknopf „Fokus“ bleibt.
- Gemeinsame Erklärungen der Datumsarten in einem neuen Modul `src/date-terms.ts`, exportiert als Objekt mit genau diesen Texten:
  - Wiedervorlage: „Die Karte ist bis zu diesem Tag geparkt und erscheint dann wieder.“
  - Nachfassen: „An diesem Tag beim Gegenüber nachhaken, wenn noch keine Antwort da ist.“
  - Frist: „Bis zu diesem Tag muss es erledigt sein.“
  - KI-Frist: „Von der lokalen KI in der Mail erkannte Frist.“
- Verwendung als `title` an den Datumszeilen der Karten (`card-content.ts`, Zeilen mit „Wiedervorlage am“, „Nachfassen …“, „KI-Frist …“) und an den Datumsfeldern im Bearbeitungsdialog (`editField` in `src/views.ts`, als Hinweistext unter dem Feld).
- Neues Hilfethema „Welche Datumsarten gibt es?“ in `src/cockpit.ts` mit allen vier Erklärungen.

**Tests:**
- `tests/live-board-smoke.py` erweitern bzw. einen neuen Smoke-Test schreiben: Ohne `allow_move` erscheint beim ersten Verschieben der Freigabedialog. Abbrechen ruft `outlook_move` nicht auf. Erlauben verschiebt und setzt `allow_move`.
- Unit-Test, dass `src/date-terms.ts` alle vier Begriffe liefert.
- Smoke-Prüfung des Seitenleistentitels „Ansichten“.

## Task 2: U10 Werkzeuge aufräumen

Spec: `docs/PLAN.md` Abschnitt 5, U10.

- **„Gesendet ohne Antwort“** wird aus dem Werkzeuge-Menü entfernt (heute erzeugt in `src/correspondence.ts`). Es kommt als Eintrag in die Seitenleisten-Ansichten unter `#focusViews`, nach „Wiedervorlage“, und öffnet den vorhandenen Dialog. Strg+G und die Befehlspalette funktionieren weiter. Im Offline-Zustand ist der Eintrag verborgen.
- **„Unterhaltungen zusammenfassen“** wird aus dem Werkzeuge-Menü entfernt (heute in `src/views.ts` an `.tools-panel` gehängt). Es kommt als Checkbox mit sichtbarem Zustand in das Menü Ansicht (`#viewControls`). Gespeichert wird wie bisher unter `remember('threads')`.
- **VIP-Liste** wird aus dem Werkzeuge-Menü entfernt. Der Bearbeitungsdialog (`editVip`) wird über einen Knopf „VIP-Liste bearbeiten …“ im Einstellungsdialog `#aiSettings` geöffnet. Er sitzt vorerst unter den Board-Einstellungen, den Abschnitt ordnet Task 8 neu.
- **Werkzeuge** enthält danach in dieser Reihenfolge: Befehl suchen (Strg+K), Outlook und lokale KI, Projektordner verwalten, Lokale Daten und Textbausteine, Beispielpostfach öffnen, Hilfe und Tastenkürzel. Bestehende IDs bleiben erhalten.

**Tests:** Bestehende Smoke-Tests anpassen, die diese Einträge im Werkzeuge-Menü suchen (mit `grep` nach „Gesendet ohne Antwort“, „VIP-Liste“ und „Unterhaltungen zusammenfassen“ in `tests/`). Ein Smoke-Test prüft den neuen Ort aller drei Funktionen.

## Task 3: U7 Rückmeldung mit Rückgängig

Spec: `docs/PLAN.md` Abschnitt 5, U7.

- **Neues Modul** `src/toast.ts` mit `showToast(text:string, undo?:()=>void)`. Es zeigt einen Bereich unten mittig (`role="status"`, `aria-live="polite"`) mit Text und optionalem Knopf „Rückgängig“ für 8 Sekunden. Ein neuer Toast ersetzt den alten. Escape oder ein Schließen-Knopf beendet ihn. Fokus wird nicht gestohlen. Gestaltung als weiße Pille mit Schatten.
- **Beschriftung von Undo-Schritten:**
  - Outlook-Modus: `LiveBoard` in `src/live.ts` bekommt eine optionale Beschriftung je Stapel (`begin(label?)` oder ähnlich, passend zum vorhandenen Code) und einen Getter `latestLabel`.
  - Beispielpostfach: `demoUndo` in `src/board.ts` speichert ein `label`.
  - Beschriftungen entstehen in `change()` aus der Aktion: „Status auf Erledigt gesetzt“, „Nach „Einkauf“ verschoben“, „Kategorien geändert“, „Wiedervorlage gesetzt“, „Nachfassen gesetzt“, „Notiz geändert“, bei mehreren Mails mit „(3 Mails)“.
- **Nach jeder erfolgreichen Änderung** zeigt `change()` den Toast mit dieser Beschriftung und einem Rückgängig-Knopf, der `undo()` aufruft. Teilfehler bleiben wie bisher in `notify()`. Der Knopf `#undo` bekommt den Tooltip „Rückgängig: <Beschriftung> (Strg+Z)“ bzw. ohne Beschriftung den heutigen Text.
- **Nach dem Rückgängigmachen** erscheint ein Toast „Zurückgenommen: <Beschriftung>“ ohne Knopf.

**Tests:**
- Unit-Test für die Beschriftung, als reine Funktion `describeChange(...)` in einem testbaren Modul.
- Smoke-Test: Status ändern → Toast mit Text → Klick auf „Rückgängig“ → Karte zurück, Toast „Zurückgenommen …“. Tooltip von `#undo` prüfen.

## Task 4: U8 Tastenkürzel-Übersicht

Spec: `docs/PLAN.md` Abschnitt 5, U8.

- **Neues Modul** `src/shortcuts.ts` mit einer gemeinsamen Liste `{keys:string, action:string, group:'Karte'|'Board'|'Ansichten'|'Triage'|'Dialoge'}`. Sie enthält alle heute vorhandenen Kürzel: 1–4, Strg+1…9, Eingabe, Strg+Eingabe, Leertaste, Umschalt+Leertaste, R, Umschalt+R, N, W, K, F, Pfeiltasten, Strg+Z, Strg+F, Strg+K, Strg+T, Strg+R, Strg+G, F1, Escape, Strg+Plus/Minus/0, dazu die Tab-Leiste (Pfeiltasten, Pos1, Ende). Die Bezeichnungen sollen genau zu den Implementierungen in `src/views.ts`, `src/board.ts`, `src/shell.ts`, `src/cockpit.ts`, `src/cleanup.ts`, `src/correspondence.ts`, `src/triage.ts` und `src/tabs.ts` passen. Bitte im Code nachsehen, nichts erfinden.
- **Die Taste `?`** (außerhalb von Eingabefeldern, kein Dialog offen) und ein Hilfethema „Tastenkürzel“ zeigen eine Übersicht: eine Tabelle je Gruppe mit `<kbd>`-Darstellung. Sie läuft als Seite im vorhandenen Cockpit-Dialog (`page` „shortcuts“ in `src/cockpit.ts`). Der Knopf „Hilfe und Tastenkürzel“ im Werkzeuge-Menü erreicht sie über einen Link in der Hilfe.
- Task 5 und Task 6 nutzen dieselbe Liste für ihre Kürzelanzeige. Deshalb exportiert das Modul eine Funktion `shortcutFor(action)` o. ä.

**Tests:**
- Unit-Test: keine doppelten Kürzel innerhalb einer Gruppe, alle Gruppen nicht leer.
- Smoke-Test: `?` öffnet die Übersicht, Escape schließt sie.

## Task 5: U6 Kontextmenü gruppiert

Spec: `docs/PLAN.md` Abschnitt 5, U6.

- **Ersatz** für den heutigen Aktionsdialog `editSelection()` in `src/views.ts`: ein Menü (`role="menu"`, Einträge `role="menuitem"`, Gruppen mit `role="group"` und Überschrift) an der Mausposition, das im Fenster bleibt.
- **Bedienung:**
  - Öffnen per Rechtsklick auf eine Karte, per Umschalt+F10 oder Menütaste auf einer fokussierten Karte und über den Knopf „Kartenaktionen“ im Menü Ansicht.
  - Pfeiltasten hoch/runter wechseln den Eintrag, Pos1/Ende springen, Eingabe führt aus, Escape schließt und gibt den Fokus an die Karte zurück. Klick außerhalb schließt.
- **Gruppen und Einträge** (nur verfügbare anzeigen, wie heute):
  - **Status:** Offen, In Bearbeitung, Warten, Erledigt (Kürzel 1–4)
  - **Antworten:** Details, In Outlook öffnen, Antworten (R), Allen antworten (Umschalt+R), Eingegangene Antwort öffnen, Warten abschließen
  - **Planen:** Wiedervorlage (W), Nachfassen (N, nur bei Warten), Notiz (K), Fokus umschalten (F)
  - **Ordnen:** Kategorien bearbeiten, Vorgang zuordnen …, Ablagevorschlag prüfen (Strg+Eingabe)
- **Kürzel** stehen rechtsbündig aus `src/shortcuts.ts` (Task 4). Bei mehreren markierten Karten zeigt der Kopf „3 markierte Mails“, und Einträge, die nur für eine Mail gelten, entfallen wie heute.
- Die Aktionen bleiben die bisherigen Aufrufe (`this.api…`, `editField`, Events `kanban-resolve-reply`/`kanban-show-reply`).

**Tests:** Bestehende Tests, die das Kontextmenü als `.view-dialog[open]` ansprechen, auf das neue Menü umstellen (`grep -n "view-dialog\|Vorgang zuordnen\|Kartenaktionen" tests/*.py`). Neuer Smoke-Test: Rechtsklick → Menü mit Gruppen, Pfeiltasten + Eingabe setzen den Status, Umschalt+F10 an einer Karte, Escape gibt den Fokus zurück.

## Task 6: U5 Aktionsleiste in den Maildetails

Spec: `docs/PLAN.md` Abschnitt 5, U5.

- Im Dialog `#detail` (`index.html`, gefüllt durch `fillDetail` in `src/board.ts`) steht direkt unter Betreff und Absender eine Knopfleiste `role="toolbar"` mit: Antworten, Allen antworten, Weiterleiten, Wiedervorlage, Nachfassen (nur bei Warten), Notiz, Fokus, Vorgang zuordnen.
- Jeder Knopf zeigt sein Kürzel aus `src/shortcuts.ts` als `aria-keyshortcuts` und als kleines `<kbd>`.
- Antworten, Allen antworten und Weiterleiten ersetzen die bisherigen Knöpfe in `#replyActions` (dort bleibt nur die Zeile mit Textbaustein und Nachfassentwurf). Im Beispielpostfach sind sie deaktiviert, mit dem Tooltip „Entwürfe gibt es nur im Outlook-Postfach.“
- Wiedervorlage, Nachfassen und Notiz öffnen den vorhandenen Bearbeitungsdialog (`editField` in `src/views.ts`, dafür eine öffentliche Methode ergänzen). Fokus nutzt `toggleFocus`, Vorgang zuordnen nutzt `assignCase`. Nach Fokus und Vorgang bleibt der Dialog offen und zeigt den neuen Zustand. Der Fokus-Knopf hat `aria-pressed`.
- Innerhalb des offenen Detaildialogs funktionieren die Buchstabenkürzel W, N, K, F und R, wenn der Fokus nicht in einem Eingabefeld liegt.

**Tests:** Smoke-Test im Beispielpostfach: Karte öffnen → Fokus-Knopf → Pille „Fokus“ auf der Karte. W öffnet das Datumsfeld. Antworten ist deaktiviert mit Tooltip. Bestehende Tests mit `button[data-draft]` anpassen.

## Task 7: U9 Start entschlacken

Spec: `docs/PLAN.md` Abschnitt 5, U9.

- Die Startseite in `src/cockpit.ts` (`render()`, Zweig `page==='start'`) zeigt nur noch:
  1. **Heute:** drei klickbare Kennzahlen „fällig“, „im Fokus“ und „wartend und fällig“. Ein Klick schließt den Dialog und setzt die Fokusansicht `today`, `focus` bzw. die benannte Sicht „Überfällig“. Dafür eine kleine öffentliche Methode in `BoardViews` ergänzen.
  2. **Morgen-Triage:** großer Knopf „Morgen-Triage starten“ bzw. „… fortsetzen“.
  3. **Routinen heute:** fällige Routinen mit „Erledigt“ (`markRoutine`). Ohne fällige Routine steht „Keine Routine fällig.“
  4. **Weitere Ansichten** als eine Zeile mit Warten-Hygiene, Wochenblick, Ablage-Auswertung und Posteingang aufräumen.
  5. Die Checkbox „Diese Übersicht beim Start öffnen“.
  6. Den Versionshinweis als eine Zeile mit „Ausblenden“ statt eines eigenen Abschnitts.
  7. Den Tipp des Tages in einer Zeile.
- **Entfallen** auf der Startseite die Knöpfe Wochenkalender, Routinen, Vorgänge, Heute dran, Hilfe und Gesendet ohne Antwort (Tabs, Seitenleiste und F1 decken sie ab). Die Options-Callbacks `openCalendar`/`openRoutines`/`openCases` dürfen bleiben, wenn andere Stellen sie nutzen, sonst werden sie entfernt.
- **Ohne Postfach** bleibt die heutige Offline-Darstellung.

**Tests:** `tests/cockpit-smoke.py` und `tests/planning-smoke.py` (`check_start`) anpassen. Neuer Prüfpunkt: Klick auf „im Fokus“ setzt die Ansicht Fokus. Eine fällige Routine lässt sich in Start abhaken.

## Task 8: U1 Einstellungen neu ordnen

Spec: `docs/PLAN.md` Abschnitt 5, U1.

- Der Dialog `#settingsDialog` („Outlook und lokale KI“, Inhalt `#aiSettings`, heute aufgebaut in `start()` in `src/board.ts`, `renderAiSettings` in `src/ai.ts`, `colorSettings` in `src/category-colors.ts`) wird in fünf Abschnitte mit `<h3>` und einem erklärenden Satz gegliedert. Bei mehr als einer Bildschirmhöhe kommt oben eine Sprungleiste zu den Abschnitten dazu.
  - **Outlook:** Echte Mails verschieben erlauben, Outlook-Statuspräfix, Aktualisieren · Sekunden, Farben und Outlook-Kategorien.
  - **Board:** Posteingang · Tage, Erledigt · Tage, Gesendet · Tage, Überfällig ab Werktagen, Archivierung anbieten ab Tagen, Limit pro Ordner, Bei erkannter Antwort automatisch bearbeiten, VIP-Liste bearbeiten.
  - **Lokale KI:** Lokale KI verwenden, Adressen, Sprachmodell, Embedding-Modell, Hintergrundanalyse, Embeddings vergleichen, Modelle laden und speichern.
  - **Lernen:** Lernordner stündlich aktualisieren, Ablageregeln und Lernstatistik.
  - **Darstellung:** Zeichen in der Kartenvorschau, Ablagevorschläge auf Karten, Kompakte Karten, KI-Zusammenfassung auf Karten.
- **Jeder KI-Schalter** bekommt einen Hinweissatz unter dem Label (`aria-describedby`):
  - Hintergrundanalyse: „Analysiert geladene Mails nacheinander mit dem Sprachmodell. Belastet Rechner und Grafikkarte, solange sie läuft.“
  - Embeddings: „Vergleicht Mails mit gelernten Ordnerprofilen. Schnell, braucht das Embedding-Modell.“
  - Stündlich lernen: „Liest die Lernordner jede Stunde neu ein.“
- **Neuer Knopf „Verbindung testen“** im Abschnitt Lokale KI: Er ruft die vorhandenen Befehle (`ai_models` sowie eine kurze Analyse einer festen Beispielmail über den vorhandenen Analysepfad, nur im Outlook-Modus) auf. Er zeigt das tatsächlich gewählte Sprachmodell (auch bei „Automatisch auswählen“, siehe `activeModel()` in `src/ai.ts`), ob das Embedding-Modell vorhanden ist, und die gemessene Antwortzeit in Sekunden. Fehler erscheinen als Text. Im Beispielpostfach ist der Knopf deaktiviert.
- **Funktion und gespeicherte Schlüssel** bleiben unverändert. Es wird nur umgeordnet und ergänzt.

**Tests:** `tests/board-keyboard-smoke.py` prüft den Dialog bei großer Schrift. Weiter grün halten und erweitern: Alle fünf Überschriften sind vorhanden. Neuer Smoke-Test mit simuliertem Outlook: „Verbindung testen“ zeigt Modell und Zeit.

## Task 9: U4 Kurze Einführung

Spec: `docs/PLAN.md` Abschnitt 5, U4.

- **Ersatz** für den Hinweis `board-hint` mit dem Schlüssel „intro“ in `src/views-layout.ts`: eine Einführung mit drei Schritten als schwebende Hinweisblase (Popover-Panel mit Pfeil, `role="dialog"`, `aria-modal="false"`), jeweils an einem Element:
  1. Board (`#board`): „Jede Spalte ist ein Status. Zieh Karten zwischen Spalten oder drücke 1–4.“
  2. Erste Karte (oder das Board, wenn keine da ist): „Klick öffnet die Mail, Rechtsklick zeigt alle Aktionen. F setzt den Tagesfokus.“
  3. Tab-Leiste (`#viewTabs`): „Kalender, Vorgänge und Routinen findest du hier. Strg+T startet die Morgen-Triage.“
- **Knöpfe** Weiter / Fertig und Überspringen. Escape überspringt. Der Fokus springt beim Öffnen in die Blase und am Ende zurück.
- **Merken** getrennt für Beispielpostfach und Outlook (`board.layout.intro-demo`, `board.layout.intro-outlook`). Startet erst, wenn ein Postfach geöffnet ist. Ein vorhandener alter Schlüssel `board.layout.intro` gilt als „gesehen“ für beide.
- **Hilfethema** „Einführung erneut zeigen“ mit einem Knopf, der die Einführung sofort startet (Event oder exportierte Funktion).
- Der zweite Hinweis `waiting-tip` bleibt unverändert.

**Tests:** Smoke-Test: Beispielpostfach öffnen → Schritt 1 sichtbar → Weiter → Schritt 2 → Überspringen → nach Neuladen keine Einführung → über die Hilfe erneut starten. Bestehende Tests, die „Verstanden“ des alten Hinweises klicken oder `board.layout.intro` setzen, anpassen.

## Task 10: K2 Briefing-Text

Spec: `docs/PLAN.md` Abschnitt 2, K2.

- **Reine Funktion** `briefingText(b, options)` in `src/planning-logic.ts`, Eingabe ist das Ergebnis von `briefing()`. Daraus entstehen höchstens drei Sätze:
  1. „<n> neue Mails seit <Zeitpunkt>.“ bzw. „Keine neuen Mails seit <Zeitpunkt>.“ Der Zeitpunkt wird von außen übergeben, ohne Triage gilt „in den letzten 24 Stunden“.
  2. „Antwort nötig: <Betreff> (<aiSummary gekürzt auf 60 Zeichen>), …“ für bis zu drei Mails mit `needsReply`, danach „und <k> weitere“. Ohne Zusammenfassung nur der Betreff.
  3. „Frist heute: <Betreff>, …“ für Mails mit Grund „Frist“ heute, bis zu drei.

  Leere Teile entfallen. Ohne Analysen erscheint nur Satz 1.
- **Anzeige** als erster Absatz im aufgeklappten Briefing in `src/triage.ts`, über den Kennzahlen.
- Feld `aufgaben` gibt es noch nicht. K1 erweitert die Funktion später um „<n> offene Aufgaben.“, deshalb wird das hier nicht vorgegriffen.

**Tests:** Unit-Tests in `tests/planning.test.ts`: keine Analysen; drei bzw. fünf Antwort-nötig-Mails mit „und 2 weitere“; Kürzung der Zusammenfassung; Frist heute; nur neue Mails.

## Task 11: K3 Hintergrund-Einbettung

Spec: `docs/PLAN.md` Abschnitt 2, K3.

- **Rust, Crate `mailboard-ollama`** (`src-tauri/ollama/src/lib.rs`, Cache in `cache.rs`): neue öffentliche Methoden auf `Ollama`, die Vektoren im `VectorCache` halten. Schlüssel sind Modell und Inhalts-Hash, wie die vorhandene Methode `vector_token`.
  - `embed(model, items:&[Item{id,text}]) -> Result<usize>` füllt den Cache. Nur fehlende Einträge werden angefragt, in Stapeln von 16. Die Rückgabe ist die Zahl neu eingebetteter Einträge.
  - `rank(model, query:&str, items:&[Item]) -> Result<Vec<Score{id,score}>>`: Kosinus-Ähnlichkeit, absteigend sortiert, nutzt den Cache. Fehlende Einträge werden nachgeladen.
  - `groups(model, groups:&[Group{name, items}], items:&[Item]) -> Result<Vec<GroupMatch{id, best, score, margin}>>`: Mittelwert-Vektor je Gruppe, für jedes Item die beste Gruppe mit Abstand zur zweitbesten.
  - Alle drei rufen vorher `check_local_model` auf. Die Texte kommen fertig vom Aufrufer.
- **Tauri** (`src-tauri/src/ai.rs`, Registrierung in `src-tauri/src/main.rs`): Befehle `ai_embed`, `ai_rank`, `ai_groups` analog zu den vorhandenen `ai_*`-Befehlen (Adresse, Modell, Cache-Pfad wie bei `ai_suggest`).
- **TypeScript** (`src/ai.ts`): eine Warteschlange `queueEmbeddings()`, die nach `queueAnalyses()` angestoßen wird.
  - Bedingungen: nur Outlook-Modus, KI und Embeddings aktiv.
  - Sie bettet geladene Mails (`readBoard()`) mit `embedText()` neueste zuerst in Stapeln ein.
  - Abbruch bei Quellwechsel (`sourceEpoch`), Status über `reportQueue`.
  - Ein exportiertes Hilfsobjekt `embeddingIndex` liefert `ready(ids)` sowie `rank(query, ids)` und `groups(groups, ids)` als Promise-Wrapper um die Befehle. Mails werden über `feedbackId(m)` bzw. eine stabile Inhalts-Signatur identifiziert, nicht über die EntryID allein.

**Tests:**
- Rust: HTTP-Tests in `src-tauri/ollama/tests/local_http.rs` im vorhandenen Mock-Stil:
  - `embed` mit 20 Items schickt 2 Stapelanfragen, ein zweiter Lauf schickt keine,
  - `rank` sortiert korrekt,
  - `groups` liefert Abstand,
  - alle drei verweigern ohne lokale Modellprüfung bzw. bei einem Cloud-Modell.
- `cargo check -p mail-board`.
- Unit-Test für die Reihenfolge der Warteschlange (neueste zuerst, schon eingebettete werden übersprungen), als reine Hilfsfunktion.

## Task 12: E0 Rahmen, U3 Hinweis, E1 Ordner wählen, E2 Lernen und messen

Spec: `docs/PLAN.md` Abschnitt 4 (E0, E1, E2) und Abschnitt 5 (U3).

- **E0:** neues Modul `src/setup.ts` mit einer Ansicht „Einrichtung“.
  - Sie entsteht über `viewPanel` aus `src/tabs.ts`. `ViewName` wird um `'setup'` erweitert, ohne eigenen Tab, geöffnet über Werkzeuge → „Einrichtung“ (neuer Eintrag hinter „Projektordner verwalten“), Start und Hinweis.
  - Eine Schrittleiste (E1–E7, Status offen, erledigt oder übersprungen) mit „Pausieren“ (zurück zum Board) und „Weiter“.
  - Fortschritt in `localStorage` unter `mailboard-setup-v1` (Schritt, Status je Schritt, Messwerte, Ausreißerentscheidungen), nur im Outlook-Modus. Im Beispielpostfach zeigt die Ansicht „Die Einrichtung arbeitet mit deinem Outlook-Postfach.“
  - Die Schritte E3–E7 sind in diesem Task Platzhalter mit Titel, Beschreibung und „Überspringen“. Spätere Tasks füllen sie über eine Registrierungsfunktion `registerStep(id, render)`.
  - Ohne KI sind die Schritte E3–E5 mit Hinweis überspringbar.
- **U3:** Nach dem Verbinden mit Outlook, wenn keine Lernziele gesetzt sind (`getLearningScope()` leer bzw. null und `suggestion_folders` fehlt) und die Einrichtung nicht abgeschlossen ist, erscheint ein deutlicher Hinweis über dem Board. Er hat einen gelben Knopf „Einrichtung starten“ und „Später“ (merkt sich das je Sitzung). Start zeigt den Fortschritt, z. B. „Einrichtung: 2 von 7 Schritten“, mit Link.
- **E1 Ordner wählen:** eine Tabelle aller Outlook-Ordner (`outlook_folders`) mit Pfad, Mailanzahl (soweit bekannt) und drei Checkbox-Spalten Board / Lernen / Archiv (Archiv als Radio, nur einer).
  - Vorbelegung wie in der Spec: Lernen = alle außer Posteingang, Gesendet und Namen mit `_`; Archiv = erster Ordner mit „Archiv“ im Namen.
  - Wenn kein Archiv vorhanden ist, gibt es den Knopf „Archivordner anlegen“. Er nutzt die vorhandene Ordneranlage in `src/projects.ts` samt Rücknahme.
  - Speichern über dieselben Konfigurationsschlüssel wie der Ordnerdialog (`project_folders`, `suggestion_folders`, `archive_folder`), siehe `scopes` in `src/projects.ts`.
- **E2 Lernen und messen:**
  - Knopf „Lernen und messen“ ruft `trainFromFolders` und danach die Auswertung auf (`evaluateHoldout` bzw. die vorhandene Ablage-Auswertung in `src/ai.ts`).
  - Gezeigt werden die Trefferquote je Quelle und je Ordner. Ordner unter 10 Mails sind markiert.
  - Die Werte werden als Ausgangswert in `mailboard-setup-v1` gespeichert.
  - Ohne KI läuft nur der Bayes-Teil.

**Tests:**
- Unit-Tests für die Vorbelegung (`defaultScopes(folders)`) und für die Hinweisbedingung.
- Smoke-Test mit simuliertem Outlook (Mock wie in `tests/projects-smoke.py`): Hinweis erscheint → Einrichtung starten → E1 vorbelegt → Speichern setzt die Konfiguration → E2 mit simuliertem `outlook_training` zeigt eine Messung → Pausieren und Fortsetzen erhält den Schritt.

## Task 13: E3 Ausreißer prüfen

Spec: `docs/PLAN.md` Abschnitt 4, E3.

- **Rust:** `Ollama::outliers(model, folders:&[Folder{key, items}], threshold, margin) -> Result<Vec<Outlier{id, folder, suggested, own, other}>>`.
  - Für jede Mail: Ähnlichkeit zum eigenen Ordnerprofil *ohne* diese Mail gegen das beste fremde Profil.
  - Verdächtig, wenn `other - own >= margin` und `other >= threshold`.
  - Nutzt Cache und Einbettung aus Task 11 (`embed`). Tauri-Befehl `ai_outliers`.
- **Bayes-Variante ohne Embeddings** in TypeScript: Das Lernbeispiel wird beim Trainieren ausgelassen. Sagt der Klassifikator mit Abstand einen anderen Ordner voraus, ist die Mail verdächtig. Das ist eine reine Funktion `bayesOutliers(rows, margin)` in einem testbaren Modul, das die vorhandene `classifier`-Logik aus `src/ai.ts` nutzt (exportieren, falls nötig).
- **Setup-Schritt E3** (registriert in `src/setup.ts`): je Lernordner eine aufklappbare Liste der verdächtigen Mails (Betreff, Absender, Datum, vorgeschlagenes Ziel), sortiert nach Deutlichkeit. Je Mail und als Stapel je Ordner gibt es:
  - **„Verschieben nach X“:** vorhandener Move-Pfad (`change(...,{kind:'move'})` über eine neue Option in `src/board.ts`) mit Bestätigung und Undo. Danach wird das Lernbeispiel umgehängt (`recordFiling`).
  - **„Bleibt hier“:** wird in `mailboard-setup-v1.confirmed` gespeichert und nie wieder gemeldet.
  - **„Nicht lernen“:** wird unter `mailboard-learn-excluded-v1` gespeichert. `learnFolders` und `trainCenter` filtern diese Einträge heraus.
- **Kennzahl:** Ordner mit mehr als 25 % Verdächtigen werden markiert und als Kandidaten für E4 gespeichert.
- Die Daten der Trainingsmails kommen aus `outlook_training`. Dafür eine Funktion bereitstellen, die die Lernmails je Ordner liefert, statt sie in `learnFolders` nur zu Features zu verdichten.

**Tests:** Rust-HTTP-Test für `outliers` mit simulierten Vektoren. Unit-Tests für `bayesOutliers`, für den Filter ausgeschlossener Beispiele und für die 25-%-Kennzahl. Smoke-Test mit simuliertem Outlook und simuliertem `ai_outliers`: verschieben (Bestätigung, Undo), bleibt hier (nicht erneut gemeldet), nicht lernen.

## Task 14: E4a Struktur verfeinern – Unterordner, Zusammenlegen, Umbenennen

Spec: `docs/PLAN.md` Abschnitt 4, E4 (die ersten drei Punkte).

- **Setup-Schritt E4** (Teil 1) zeigt drei Blöcke. Jeder Vorschlag wird einzeln bestätigt oder verworfen.
- **Überfüllte Ordner:** mehr als 150 Mails oder als Kandidat aus E3 markiert. Je Ordner: „Unterteilung vorschlagen“ öffnet den vorhandenen Ablauf aus `src/structure.ts` (`ai_subfolders`) und das Verteilen aus `src/distribute.ts`. Wiederverwenden, nicht nachbauen.
- **Überschneidungen:**
  - Paare mit Profil-Kosinus über 0,9 (neuer Rust-Befehl oder `ai_groups` aus Task 11 mit Ordnerprofilen) oder mit gegenseitiger Verwechslung von mindestens 20 % in der E2-Messung.
  - Vorschlag: „<kleiner> in <größer> zusammenlegen (<n> Mails)“, die Richtung ist umkehrbar.
  - Ausführung als ein Undo-Schritt (Erweiterung in `src/projects.ts`, das schon Ordnerverschiebungen mit Rücknahme kennt):
    1. alle Mails des Quellordners verschieben (seitenweise über vorhandene Befehle, Bestätigung mit Anzahl),
    2. leeren Ordner unter `_Zusammengelegt` verschieben (anlegen, falls nötig, wie `_Abgeschlossen`),
    3. `rekeyProfile`,
    4. Lern- und Board-Ziele umschreiben.
  - Undo stellt den Ordner an seinen Platz zurück und verschiebt die Mails zurück.
- **Umbenennen:**
  - Für Ordnernamen aus der Liste „Sonstiges“, „Diverses“, „Allgemein“, „Neuer Ordner“, „Neu“, „Verschiedenes“, „Misc“ oder Namen unter 4 Zeichen schlägt die KI einen Namen vor.
  - Neue Methode `Ollama::folder_name(model, key, profile, subjects)` mit JSON-Schema `{name}`, Tauri-Befehl `ai_folder_name`. Prüfung mit `cleanFolderName`, keine Dubletten.
  - Ausführung über das vorhandene Umbenennen mit Undo in `src/projects.ts`.
- **Ohne KI:** Überschneidungen werden nur über die Messung erkannt, Umbenennen entfällt.

**Tests:** Unit-Tests für die Erkennung von Überschneidungen (Schwelle, Verwechslung) und den Plan zum Zusammenlegen (Reihenfolge der Schritte, Umschlüsselung). Rust-HTTP-Test für `folder_name`. Smoke-Test mit simuliertem Outlook: Zusammenlegen mit Bestätigung → Ordner unter `_Zusammengelegt` → Undo stellt beides her. Umbenennen-Vorschlag übernehmen. Erweiterte C#-Befehle bekommen Vertragstests.

## Task 15: E4b Neue Ordner aus dem Posteingang

Spec: `docs/PLAN.md` Abschnitt 4, E4 (letzter Punkt).

- **Rust:** `Ollama::clusters(model, items, min_size, threshold) -> Result<Vec<Cluster{ids}>>`. Einfaches Verfahren auf Cache-Vektoren: greedy, eine Mail beginnt eine Gruppe, Mails mit Kosinus ≥ Schwelle (Start 0,82) zum Gruppenmittel kommen hinzu, Gruppen unter `min_size` (5) entfallen. Deterministisch, nach Größe sortiert. Tauri-Befehl `ai_clusters`.
- **Benennung:** `Ollama::cluster_name(model, subjects)` mit Schema `{name}`, Tauri-Befehl `ai_cluster_name`. Prüfung mit `cleanFolderName`.
- **Setup-Schritt E4** (Teil 2), Block „Neue Ordner aus dem Posteingang“:
  - Posteingangsmails, deren bester Ablagevorschlag unter der Schwelle liegt (vorhandenes `chooseFolder`/`suggestFolder` ohne Ergebnis), werden gruppiert.
  - Je Gruppe gibt es einen Namensvorschlag (änderbar), drei Beispielbetreffs, die Mailanzahl, eine Auswahl des Elternordners (Lernziele und Wurzel) sowie „Anlegen und verteilen“ oder „Verwerfen“.
  - Anlegen und Verteilen nutzen die vorhandene Ordneranlage und die Verschiebung, mit Bestätigung und Undo. Der neue Ordner wird Lernziel.

**Tests:** Rust-HTTP-Tests für `clusters` (zwei klare Gruppen, Rauschen fällt raus, deterministisch) und `cluster_name`. Smoke-Test mit simuliertem Outlook: Gruppe → Name ändern → Anlegen und verteilen → Undo.

## Task 16: E5 Steckbriefe und E6 Neu lernen und vergleichen

Spec: `docs/PLAN.md` Abschnitt 4, E5 und E6.

- **E5:**
  - „Steckbriefe entwerfen“ ruft für jeden Lernordner ohne Steckbrief nacheinander `draftProfile` auf (`src/ai.ts`). Fortschritt „3 von 12“, „Abbrechen“ hält nach dem laufenden Entwurf an.
  - Die Entwürfe erscheinen als Liste. Je Eintrag gibt es ein Textfeld mit dem Entwurf, „Übernehmen“ (`setProfile` mit Ordnerschlüssel wie im Ordnerdialog), „Verwerfen“ und den Status.
  - Ohne KI ist der Schritt überspringbar.
- **E6:**
  - „Neu lernen und vergleichen“ wiederholt E2 und zeigt eine Vergleichstabelle Ausgangswert ↔ jetzt je Quelle und je Ordner, mit Differenz in Prozentpunkten.
  - Ordner, die schlechter wurden, sind hervorgehoben, mit der Farbe für „fällig“ und zusätzlich als Text „schlechter“.
  - Ausgeschlossene Ausreißer und neue Steckbriefe fließen ein.

**Tests:** Unit-Test für den Vergleich (Differenzen, Markierung „schlechter“). Smoke-Test mit simuliertem Outlook: Entwürfe (simuliertes `ai_profile`) übernehmen und verwerfen, Vergleichstabelle sichtbar.

## Task 17: E7 Posteingang abarbeiten

Spec: `docs/PLAN.md` Abschnitt 4, E7.

- **C#** (`outlook-test/BoardCommands.cs`): Der Befehl, der heute den Backlog (älteste 300) liefert, bekommt Parameter für Grenze und Versatz (Standard wie heute). Weitergereicht über Rust (`src-tauri/src/backlog.rs` bzw. den Ort des Befehls `outlook_backlog`) und TypeScript.
  - Vertragstest in `outlook-test/tests/Contracts.cs`: Seite 1 und Seite 2 überschneiden sich nicht, Grenze wird eingehalten, ohne Parameter bleibt das Verhalten wie bisher.
- **Setup-Schritt E7:**
  - **Lesen:** alle Posteingangsmails ohne Status seitenweise (bis 2.000), mit Fortschritt.
  - **Einteilen** jeder Mail in sicher (`trustedFolderBatch` aus `src/ai.ts`), unsicher (Vorschlag ohne hohe Sicherheit) und ohne Ziel (kein Vorschlag). Das ist eine reine Funktion `classifyBacklog(...)`.
  - **Sicher:** Stapel je Zielordner mit aufklappbarer Betreffliste, „Stapel ablegen“ je Ziel (Bestätigung, ein Undo-Schritt je Stapel).
  - **Unsicher:** „Einzeln durchgehen“ öffnet „Posteingang aufräumen“ (`src/cleanup.ts`) mit genau diesen Mails. Dafür bekommt cleanup eine Möglichkeit, eine vorgegebene Mailliste zu verwenden.
  - **Ohne Ziel:** Mails älter als die eingestellte Grenze (Standard 3 Monate, Zahlenfeld in Monaten) als Sammelangebot „<n> Mails ins Archiv verschieben“ (Bestätigung, ein Undo-Schritt). Ohne Archivziel gibt es einen Hinweis mit Sprung zu E1. Jüngere bleiben liegen, mit Anzahl.
  - Nach Abschluss ist die Einrichtung „abgeschlossen“. Hinweis und Fortschritt in Start (Task 12) verschwinden.

**Tests:** C#-Vertragstest. Unit-Tests für `classifyBacklog` und die Altersgrenze. Smoke-Test mit simuliertem Outlook (40 Posteingangsmails, zwei Seiten): sichere Stapel ablegen + Undo, Archivangebot + Undo, Einzeln durchgehen öffnet Aufräumen mit den unsicheren Mails.

## Task 18: K1 Aufgaben → Checkliste

Spec: `docs/PLAN.md` Abschnitt 2, K1.

- **Rust** `analyze` in `src-tauri/ollama/src/lib.rs`:
  - Das Schema bekommt `aufgaben: [{text:string, frist:string|null}]` (Pflichtfeld, darf leer sein).
  - Der Systemprompt ergänzt: „aufgaben: nur ausdrücklich verlangte, konkrete Handlungen an den Empfänger, höchstens 5“.
  - Validierung: höchstens 5, Text getrimmt, nicht leer, bis 120 Zeichen; `frist` über `plausible_deadline`, sonst `null`.
  - `Analysis`-Struct und Serialisierung anpassen.
- **TypeScript:**
  - `Analysis` in `src/ai.ts` um `aufgaben` ergänzen. Gespeicherte Analysen ohne das Feld gelten beim Öffnen der Maildetails als unvollständig und werden dann neu berechnet, wenn KI aktiv ist. Die Hintergrund-Warteschlange rechnet nicht alles neu.
  - Die Mail bekommt `aiTasks` analog zu `aiSummary`.
  - Übernommene Aufgaben je Mail-Signatur werden unter `mailboard-tasks-taken-v1` gemerkt.
- **Karte:** Zähler-Pille „<n> Aufgaben“ (`counter()` in `src/card-content.ts`, Art `tasks`) für noch nicht übernommene Aufgaben.
- **Maildetails:** Abschnitt „Aufgaben“ mit Checkbox je Aufgabe (vorgehakt), Text und Datum änderbar, Zielauswahl und „Übernehmen“.
  - Zielauswahl: Vorgang der Mail. Bei mehreren gibt es eine Auswahl, ohne Vorgang „Neuer Vorgang: <Name aus Betreff>“.
  - Namensbildung als reine Funktion `caseNameFromSubject(subject, existing)`: Präfixe AW/WG/RE/FW/FWD entfernen, `,;` durch ` ` ersetzen, auf 60 Zeichen kürzen, bei Konflikt „ (2)“ usw.; Prüfung mit `caseNameProblem`.
  - Ein neuer Vorgang wird angelegt, die Mail zugeordnet (`assign`).
  - Die Punkte werden per `updateCase` hinzugefügt.
- **Briefing:** `briefingText` (Task 10) ergänzt „<n> offene Aufgaben.“ für nicht übernommene Aufgaben der geladenen Mails.

**Tests:** Rust-HTTP-Test (ungültige Frist → null, 7 Aufgaben → 5, leere entfernt). Unit-Tests für `caseNameFromSubject` und die `briefingText`-Ergänzung. Smoke-Test mit simuliertem Outlook und simuliertem `ai_analyze` mit Aufgaben: Pille „2 Aufgaben“ → Details → übernehmen → Checkliste im Tab Vorgänge → Kalender zeigt den Punkt → Pille verschwindet.

## Task 19: K4 Vorgang-Vorschlag

Spec: `docs/PLAN.md` Abschnitt 2, K4.

- **Berechnung** in TypeScript über `embeddingIndex.groups` (Task 11). Gruppen sind die offenen Vorgänge mit ihren zugeordneten geladenen Mails, Kandidaten sind geladene Mails ohne Vorgang.
- **Vorschlag**, wenn `score >= 0.80` und `margin >= 0.03`. Die Werte sind in den Einstellungen (Abschnitt Lernen) einstellbar, Schlüssel `case_threshold` und `case_margin`.
- **Ergebnis** im Speicher, neu berechnet nach der Einbettung bzw. bei Änderungen an Vorgängen. Nicht im Beispielpostfach, nicht ohne Embeddings.
- **Karte:** Pille „Vorgang <Name>?“ (Stil `card-flag`, eigene Farbe, `button` innerhalb der Karte mit eigenem Klick, der das Öffnen der Karte nicht auslöst). Klick ordnet zu (`assign`, ein Undo-Schritt). Ein kleines „×“ lehnt ab.
- **Ablehnung** je Inhalts-Signatur und Vorgang unter `mailboard-case-dismissed-v1`, damit sie auch nach einer neuen EntryID gilt.
- **Befehlspalette:** Eintrag „Vorgangsvorschlag übernehmen“ für die markierte Karte. In Triage-Schritt 2 gibt es keine Sonderlogik, die Pille ist dort ohnehin sichtbar.

**Tests:** Unit-Tests für Schwelle, Abstand und Ablehnung als reine Funktion `caseSuggestions(matches, dismissed, threshold, margin)`. Smoke-Test mit simuliertem Outlook und simuliertem `ai_groups`: Pille → Klick → Kategorie geschrieben → Undo. Ablehnen blendet aus und bleibt nach Aktualisieren ausgeblendet.

## Task 20: K5 Suche nach Bedeutung

Spec: `docs/PLAN.md` Abschnitt 2, K5.

- **Umschalter** „≈ Bedeutung“ im Suchfeld (`index.html` `.search-box`, `aria-pressed`), nur sichtbar im Outlook-Modus mit aktiven Embeddings. Der Zustand gilt für die Sitzung, Escape im Suchfeld setzt ihn zurück.
- **Bei aktivem Umschalter** ersetzt die Rangfolge aus `embeddingIndex.rank(query, ids)` die Wortsuche (`matchesQuery`) in `render()`/`BoardViews.filter`:
  - höchstens 50 Mails mit `score >= 0.35` (Konstante),
  - innerhalb der Spalten nach Relevanz statt nach der gewählten Sortierung,
  - Eingabe entprellt (300 ms),
  - bei laufender Einbettung der Hinweis „Bedeutungssuche: <x> von <y> Mails vorbereitet.“ in `#summary`.
- **„Ähnliche Mails“** in den Maildetails: die fünf ähnlichsten geladenen Mails ohne dieselbe `conversationId`, als Knöpfe, die die jeweilige Mail öffnen. Abschnitt nur bei aktiven Embeddings.

**Tests:** Smoke-Test mit simuliertem Outlook und simuliertem `ai_rank`: Umschalten → Treffer ohne gemeinsames Wort erscheinen in Relevanz-Reihenfolge → Escape stellt die Wortsuche wieder her. „Ähnliche Mails“ zeigt Einträge und öffnet sie. Unit-Test für die Sortierung nach Relevanz innerhalb der Spalten.
