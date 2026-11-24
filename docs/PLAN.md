# Plan und offene Punkte

Fortlaufende Arbeitsliste. Neue Themen kommen als eigener Abschnitt hinzu. Erledigte Punkte werden abgehakt und mit Commit oder Pull Request verknüpft. Die Umsetzung beginnt erst nach Freigabe.

## 1. Wartet auf dich

- [ ] **Redesign testen** (PR #1): Laptop- und Zweitmonitor-Ansicht, Tabs, Karten-Pillen, Triage-Banner, Ziersymbole ☀ ☰ ⚙ 📎 ✉ unter Windows mit Segoe UI. Rückmeldungen zu Farben, Abständen und Elementen sammeln.
- [ ] **Windows-Abnahme** nach [WINDOWS-ABNAHME.md](WINDOWS-ABNAHME.md) mit echtem klassischen Outlook.
- [ ] **Kategorien „Fokus“ und „Vorgang: …“** im echten Postfach prüfen, auch bei verwalteter Hauptkategorienliste.
- [ ] **LM Studio** mit einem echten Modell ausprobieren (Adresse `http://127.0.0.1:1234`).
- [ ] **Genutztes KI-Modell** in Ollama nachsehen (`ollama list`). Es entscheidet über die erreichbare Qualität der KI-Funktionen in Abschnitt 2.

## 2. KI-Erweiterungen (entschieden am 23.11.2026)

Ausgangslage: Das Sprachmodell liefert heute Analyse (Zusammenfassung, Antwort nötig, Frist, Mail-Arten, Ordner), KI-Stichwahl, Antwort-, Steckbrief- und Unterordner-Entwürfe. Das Embedding-Modell wird nur für Ablagevorschläge genutzt. Praxiserfahrung mit der Qualität liegt noch nicht vor. Der Rechner hat eine GPU.

| Entscheidung | Gewählt |
|---|---|
| Pakete | Nur **D: neue KI-Funktionen**. A (Einrichtung und Modellwahl), B (Qualität messbar machen) und C (bessere Eingaben) sind zurückgestellt, siehe Abschnitt 3. |
| Funktionen | Aufgaben → Checkliste, Briefing-Text, Vorgang-Vorschlag, Suche nach Bedeutung |
| Aufgaben erkennen | Als Teil der vorhandenen Mail-Analyse, kein eigener KI-Aufruf |
| Briefing-Text | Fester Satzbau aus gespeicherten Analysen, **ohne** KI-Aufruf |
| Einbettung der Mails | Automatisch im Hintergrund, zwischengespeichert |
| Bedeutungssuche | Umschalter „≈ Bedeutung“ im Suchfeld, Wortsuche bleibt unverändert |

Für alle Punkte gilt:
- Nur lokale Modelle erhalten Mailinhalte. Die vorhandene Prüfung in `src-tauri/ollama/src/lib.rs` (`check_local_model`) bleibt für jeden neuen Aufruf Pflicht.
- Ohne eingeschaltete KI bzw. Embeddings bleiben die Funktionen unsichtbar.
- Im Beispielpostfach laufen keine Modellaufrufe.
- Mailinhalte sind Daten, keine Anweisungen. Das steht in jedem Prompt.

**Reihenfolge innerhalb von Abschnitt 2:** K2 → K1 → K3 → K4 → K5. K2 ist klein und unabhängig. K3 ist die Grundlage für K4, K5 und den Einrichtungsassistenten. Die Gesamtreihenfolge steht in Abschnitt 4.

### K1 Aufgaben → Checkliste

- [x] **Analyse erweitern** (`lib.rs`, `analyze`): Das Schema bekommt `aufgaben: [{text, frist|null}]`, der Prompt fordert nur ausdrücklich verlangte, konkrete Handlungen an *mich*. Validierung: höchstens 5 Aufgaben, Text bis 120 Zeichen, Frist über `plausible_deadline`, sonst `null`.
- [x] **Typen und Cache** (`src/ai.ts`): `Analysis` um `aufgaben` ergänzen. Ältere gespeicherte Analysen ohne das Feld gelten beim Öffnen der Maildetails als unvollständig und werden dann neu berechnet. Die Hintergrund-Warteschlange rechnet *nicht* alles neu.
- [x] **Karte**: Zähler-Pille „2 Aufgaben“ in der Fußzeile (`card-content.ts`, `counter()`), nur für noch nicht übernommene Aufgaben.
- [x] **Maildetails**: Abschnitt „Aufgaben“ mit Haken je Aufgabe, Datum änderbar. Ziel ist der Vorgang der Mail oder bei mehreren eine Auswahl. Ohne Vorgang wird ein neuer angelegt, nach dem Betreff benannt (Präfixe AW/WG/RE entfernt, `,;` ersetzt, Prüfung mit `caseNameProblem`), und die Mail zugeordnet. „Übernehmen“ schreibt die Punkte per `updateCase` und merkt sich übernommene Aufgaben je Mail.
- [x] **Tests**: ein HTTP-Test in Rust für Schema und Validierung (ungültige Frist, mehr als 5 Aufgaben), Unit-Test für die Namensbildung, Smoke-Test mit simulierter Analyse: übernehmen → Checkliste → Kalender.
- **Fertig, wenn** eine Mail mit „Bitte bis Freitag das Angebot freigeben“ eine übernehmbare Aufgabe mit Freitagsdatum zeigt, die danach im Vorgang und im Kalender steht.

### K2 Briefing-Text

- [x] **Reine Funktion** `briefingText(briefing)` in `src/planning-logic.ts`. Sie nutzt nur vorhandene Felder (`aiSummary`, `needsReply`, `deadline`, später `aufgaben`) und erzeugt Sätze wie „6 neue Mails seit gestern 17:40. Antwort nötig: Angebot Weber (Preis klären), Raumplanung Krüger. Frist heute: Bestellung 2026-118. 3 offene Aufgaben.“ Bei mehr als drei Einträgen kommt „und N weitere“ dazu.
- [x] **Anzeige** als erster Absatz im Triage-Briefing (`src/triage.ts`). Ohne Analysen erscheint nur die Anzahl, ohne Fehlermeldung.
- [x] **Tests**: Unit-Tests für leere, einfache und lange Listen sowie für Mails ohne Analyse.
- **Fertig, wenn** das Briefing ohne Wartezeit einen Absatz zeigt, der nur Inhalte aus vorhandenen Analysen nennt.

### K3 Hintergrund-Einbettung (Grundlage)

- [x] **Rust-Befehle**, die Vektoren im vorhandenen `VectorCache` halten statt sie an die Oberfläche zu geben:
  - `ai_embed(model, items:[{id,text}])` füllt den Cache.
  - `ai_rank(model, query, ids)` liefert Ähnlichkeiten.
  - `ai_groups(model, groups:[{name, ids}], ids)` liefert die beste Gruppe je Mail mit Abstand zur zweitbesten.
  - Den Text liefert `embedText()` aus `src/ai.ts`, der Cache-Schlüssel ist Modell plus Inhalts-Hash.
- [x] **Warteschlange** in `src/ai.ts`: nach `queueAnalyses` neue bzw. geänderte geladene Mails stapelweise (z. B. 16) einbetten, neueste zuerst. Abbruch bei Quellwechsel (`sourceEpoch`), Fortschritt in der KI-Statuszeile.
- [x] **Tests**: Rust-HTTP-Test für Stapel und Cache-Treffer (zweiter Lauf ohne Modellaufruf), Unit-Test für die Reihenfolge.

### K4 Vorgang-Vorschlag

- [x] **Profil je offenem Vorgang** aus den Vektoren seiner zugeordneten Mails (Mittelwert, ab 1 Mail).
- [x] **Vorschlag** nur für Mails ohne Vorgang, wenn die Ähnlichkeit über einer Schwelle liegt (Start: 0,80) und der Abstand zum zweitbesten Vorgang mindestens 0,03 beträgt. Beide Werte sind wie bei der Ablage einstellbar.
- [x] **Karte**: Pille „Vorgang Umzug?“ (Stil wie `card-flag`). Klick ordnet zu (`assign`, ein Undo-Schritt), ein „×“ lehnt ab. Die Ablehnung wird je Inhalts-Signatur und Vorgang lokal gespeichert, damit sie auch nach dem Verschieben mit neuer EntryID gilt.
- [x] **Triage**: In Schritt 2 „Offen durchgehen“ sind die Vorschläge sichtbar. Strg+K bietet „Vorgangsvorschlag übernehmen“.
- [x] **Tests**: Unit-Test für Schwelle, Abstand und Ablehnung, Smoke-Test mit simuliertem Ranking: Pille → Klick → Kategorie → Undo.

### K5 Suche nach Bedeutung

- [x] **Umschalter** „≈ Bedeutung“ im Suchfeld (`index.html`, `aria-pressed`). Der Zustand gilt nur für die Sitzung.
- [x] **Bei aktivem Umschalter** ersetzt die Rangfolge aus `ai_rank` die Wortsuche (`matchesQuery`). Gezeigt werden höchstens 50 Mails über einer Mindestähnlichkeit, innerhalb der Spalten nach Relevanz sortiert. Die Eingabe wird entprellt (300 ms). Ist die Einbettung noch nicht fertig, sagt das ein Hinweis.
- [x] **„Ähnliche Mails“** in den Maildetails: die fünf ähnlichsten geladenen Mails ohne dieselbe Unterhaltung, als Links.
- [x] **Tests**: Smoke-Test mit simuliertem Ranking: Umschalten, Treffer ohne gemeinsames Wort, Zurückschalten stellt die Wortsuche wieder her.

## 3. Zurückgestellt

- **A Einrichtung und Modellwahl:** Modell mit Größe und Tempo anzeigen, „Modell testen“, Empfehlung für GPU-Rechner, getrennte Modelle für Hintergrund und Entwürfe. Wieder aufgreifen, sobald klar ist, welches Modell läuft (Abschnitt 1).
- **B Qualität messbar machen:** „Passt / passt nicht“ an KI-Ergebnissen und eine Auswertung je Funktion. Sinnvoll, sobald es Praxiserfahrung gibt.
- **C Bessere Eingaben:** Verlauf der Unterhaltung und Anhangnamen für die Analyse, eigener schneller Prompt für die KI-Stichwahl (heute startet sie eine volle Analyse), Stil aus eigenen früheren Antworten für Entwürfe.
- **Weitere Ideen:** KI-Vorschläge für den Tagesfokus in der Triage, vorgeschlagene Nachfasstermine.

## 4. Einrichtungsassistent (entschieden am 23.11.2026)

Ausgangslage:
- Im Posteingang liegen etwa 500–2.000 Mails.
- Die Zielordner sind grob vorhanden, ihre Zuordnung ist von Hand entstanden und **gemischt**: Manche Ordner sind sauber, andere Sammelbecken oder überschneiden sich.
- Heute ist die Einrichtung auf Einzelwerkzeuge verteilt: Projektordner verwalten, Steckbrief entwerfen, Unterteilung für *einen* Ordner, Lernen, Ablage-Auswertung, Posteingang aufräumen (älteste 300). Die Reihenfolge muss man selbst kennen. Alles in den Ordnern gilt ungeprüft als richtig.

| Entscheidung | Gewählt |
|---|---|
| Form | Geführter Assistent mit festen Schritten, pausierbar |
| Struktur | Deine Struktur ist das Gerüst, die KI verfeinert. Jeder Vorschlag wird bestätigt. |
| Ausreißer | Prüfliste je Ordner: **verschieben nach X** / **bleibt hier** (gilt dann als sicher richtig) / **nicht zum Lernen verwenden** |
| KI darf vorschlagen | Unterordner, neue Ordner für Posteingangsgruppen, **zusammenlegen** und **umbenennen**, alles nach Bestätigung in Outlook ausgeführt |
| Leerer Ordner nach Zusammenlegen | Wird nach `_Zusammengelegt` verschoben, nichts wird gelöscht, rücknehmbar |
| Alte Posteingangsmails ohne Ziel | Sammelangebot „ins Archiv“ ab einem Alter von 3 Monaten (einstellbar) |
| Steckbriefe | Die KI entwirft für alle Lernordner ohne Steckbrief einen Vorschlag, du prüfst jeden |

Für alle Schritte gilt:
- Jede Änderung am Postfach braucht eine Bestätigung mit Zielliste, ist ein Undo-Schritt und läuft über den vorhandenen Schreibstapel (`writeBatch`).
- Schritt 5 (Steckbriefe) braucht die lokale KI, in Schritt 4 brauchen Unterteilen, Umbenennen und Gruppen aus dem Posteingang sie. Ohne KI lassen sich beide überspringen. Schritt 3 prüft ohne Embeddings mit Bayes, Schritt 4 legt ohne KI Ordner nach der Messung aus Schritt 2 zusammen.
- Ausreißerprüfung, Gruppen im Posteingang und die Erkennung von Überschneidungen nutzen die Einbettungen aus **K3** (Abschnitt 2). K3 kommt deshalb vor den Assistenten.

**Empfohlene Gesamtreihenfolge:** K2 → K3 → E0–E7 → K1 → K4 → K5.

### E0 Rahmen

- [x] **Neues Modul** `src/setup.ts` als eigene Ansicht `Einrichtung` (Panel wie in `tabs.ts`). Erreichbar über Start und Werkzeuge. Wird angeboten, wenn Outlook verbunden ist und noch keine Lernziele gesetzt sind.
- [x] **Fortschritt** lokal in `mailboard-setup-v1`: aktueller Schritt, erledigte Schritte, Ausgangswerte der Messung, Entscheidungen zu Ausreißern. Gespeichert wird nur für Outlook, nie im Beispielpostfach.
- [x] **Schrittleiste** oben mit Status je Schritt (offen, erledigt, übersprungen), dazu „Pausieren“ und „Weiter“.

### E1 Ordner wählen

- [x] **Ordnerbaum** mit Mailanzahl und den Spalten Board / Lernen / Archiv. Er nutzt die vorhandenen Ziele (`getBoardScope`, `getLearningScope`, `getArchiveScope`, `updateConfig`).
- [x] **Vorbelegung:** alle Ordner außer Posteingang, Gesendet und `_…` als Lernziele. Ein Ordner mit „Archiv“ im Namen wird als Archiv vorgeschlagen. Gibt es keinen, kann der Assistent einen anlegen.

### E2 Lernen und Ausgangswert messen

- [x] **Lernen** wie bisher (`learnFolders`: bis zu 300 Mails je Ordner aus zwei Jahren, Bayes und Embedding-Profil).
- [x] **Messen** mit `evaluateHoldout`. Die Trefferquote je Quelle und je Ordner wird als Ausgangswert gespeichert. Ordner mit wenigen Mails (unter 10) werden markiert.

### E3 Ausreißer prüfen

- [x] **Erkennung je Lernordner** über dessen Trainingsmails: Ähnlichkeit zum *eigenen* Profil ohne die Mail selbst gegen das beste *fremde* Profil. Verdächtig ist eine Mail, wenn das fremde Profil um mindestens 0,05 vorne liegt und über der Ablageschwelle. Ohne Embeddings gibt es eine Bayes-Variante, die die Mail beim Training auslässt.
  - Neuer Rust-Befehl `ai_outliers(model, folders:[{key, items:[{id,text}]}])` auf Basis des Vektor-Caches.
- [x] **Prüfliste** je Ordner, sortiert nach Deutlichkeit. Je Mail und als Stapel gibt es:
  - **Verschieben nach X:** Bestätigung, Undo, Lernbeispiel wird umgehängt.
  - **Bleibt hier:** wird lokal als bestätigt gespeichert und nie wieder gemeldet.
  - **Nicht lernen:** wird aus `LearnRow` und Profil herausgefiltert.
- [x] **Ordner mit vielen Ausreißern** (z. B. über 25 %) gehen als Kandidaten für Unterteilung oder Zusammenlegen in E4.

### E4 Struktur verfeinern

- [x] **Überfüllte Ordner** (viele Mails, geringer innerer Zusammenhalt): Unterordner-Vorschlag mit dem vorhandenen `ai_subfolders` (`structure.ts`), Verteilen mit `distribute.ts`.
- [x] **Überschneidungen:** Ordnerpaare mit sehr ähnlichem Profil (Kosinus über 0,9) oder häufiger gegenseitiger Verwechslung in der Messung. Vorschlag: den kleineren in den größeren zusammenlegen, mit Vorschau der Mailanzahl.
  - Ausführung: alle Mails verschieben (Stapel), den leeren Ordner nach `_Zusammengelegt` verschieben (wie `_Abgeschlossen` in `projects.ts`), Steckbrief und Lernziele umschlüsseln (`rekeyProfile`), Lernbeispiele umhängen. Alles zusammen ist ein Undo-Schritt.
- [x] **Umbenennen:** Für unklare Namen (z. B. „Sonstiges“, „Diverses“, „Neuer Ordner“, sehr kurze Namen) schlägt die KI aus Steckbrief und Beispielbetreffs einen klareren Namen vor. Ausgeführt wird mit dem vorhandenen Umbenennen samt Undo.
- [x] **Neue Ordner aus dem Posteingang:** Mails ohne Ziel über der Schwelle werden nach Bedeutung gruppiert (neuer Rust-Befehl `ai_clusters` auf dem Vektor-Cache). Gruppen ab 5 Mails benennt die KI mit drei Beispielbetreffs (Namensprüfung wie `cleanFolderName`). Du wählst den Elternordner, dann wird angelegt und verteilt.

### E5 Steckbriefe

- [x] **Entwürfe** für alle Lernordner ohne Steckbrief nacheinander (`draftProfile`), mit Fortschritt und Abbruchmöglichkeit.
- [x] **Prüfung** als Liste mit Übernehmen / Bearbeiten / Verwerfen. Gespeichert wird nur Übernommenes (`setProfile`).

### E6 Neu lernen und vergleichen

- [x] **Lernen** mit bereinigten Ordnern, ausgeschlossenen Ausreißern und neuen Steckbriefen.
- [x] **Vergleich** vorher/nachher je Quelle und je Ordner. Ordner, die schlechter geworden sind, werden hervorgehoben.

### E7 Posteingang abarbeiten

- [x] **Lesen:** Alle Posteingangsmails ohne Status werden gelesen. Heute liest `__backlog` die ältesten 300 (`outlook_backlog`). Der Befehl bekommt eine Grenze und einen Fortsetzungspunkt (Empfangszeit und EntryID der zuletzt geprüften Mail, `--backlog-page`), damit bis zu 2.000 Mails in Seiten gelesen werden, ohne die vorigen Seiten erneut zu lesen. Das betrifft den C#-Helfer und braucht einen Vertragstest in `outlook-test/tests`.
- [x] **Einteilen** jeder Mail in **sicher** (Vorschlag mit hoher Sicherheit, wie `trustedFolderBatch`), **unsicher** oder **ohne Ziel**.
- [x] **Sicher:** Stapel je Zielordner mit Betreffliste, je Stapel bestätigen (wie die sicheren Sammelvorschläge beim Aufräumen).
- [x] **Unsicher:** öffnet „Posteingang aufräumen“ mit genau diesen Mails.
- [x] **Ohne Ziel und älter als 3 Monate:** Sammelangebot „ins Archiv“ mit Anzahl und Altersgrenze, als ein Undo-Schritt. Jüngere bleiben im Posteingang.

### Tests und Abnahme

- [x] **Unit-Tests:** Ausreißer-Regel (Schwelle, Abstand, Bestätigte, Ausgeschlossene), Erkennung von Überschneidungen, Plan für das Zusammenlegen (Reihenfolge, Umschlüsseln), Einteilung des Posteingangs, Altersgrenze.
- [x] **Rust-HTTP-Tests:** `ai_outliers` und `ai_clusters` mit simulierten Vektoren, Cache-Treffer.
- [ ] **Smoke-Test** mit simuliertem Outlook (drei Ordner, einer davon Sammelbecken, 40 Posteingangsmails): Assistent komplett durchlaufen, pausieren und fortsetzen, Ausreißer verschieben mit Undo, zusammenlegen nach `_Zusammengelegt` mit Undo, Stapelablage, Archivangebot.
  - Offen als ein durchgehender Test. Abgedeckt ist es durch die Smoke-Tests der einzelnen Schritte: `setup-smoke.py` (Hinweis, Ordnerwahl, Lernen und Messen, Pausieren und Fortsetzen), `outliers-smoke.py` (Ausreißer verschieben mit Undo), `refine-smoke.py` und `structure-smoke.py` (Unterteilen, Zusammenlegen nach `_Zusammengelegt` mit Undo, Umbenennen, Gruppen aus dem Posteingang), `profiles-smoke.py` (Steckbriefe, Vergleich) und `inbox-smoke.py` (40 Posteingangsmails, Stapelablage, Archivangebot).
- [x] **C#-Vertragstest** für den seitenweisen Backlog.
- **Fertig, wenn** ein Postfach mit grober Struktur in einer Sitzung zu bereinigten Lernordnern mit Steckbriefen, gemessener Trefferquote vorher/nachher und einem abgearbeiteten Posteingang kommt. Jede Postfachänderung muss dabei bestätigt und rücknehmbar sein.

## 5. Bedienbarkeit (entschieden am 23.11.2026)

Ausgangslage aus einem Rundgang als Anwender (Erststart, Verbinden mit Outlook, Einstellungen, Ordnerdialog, Maildetails, Kontextmenü, Start, Werkzeuge):
- Die Grundbedienung ist klar. Die Einrichtung ist es nicht.
- Im Alltag sind viele Funktionen nur über Rechtsklick oder Tasten erreichbar.
- Start, Werkzeuge und Seitenleiste überschneiden sich teilweise.

**Empfohlene Reihenfolge:**
1. Kleine, unabhängige Punkte zuerst: U2, U11, U10, U7.
2. Danach die tägliche Bedienung: U5, U6, U8, U9.
3. Dann U1 und U4.
4. U3 kommt zusammen mit dem Einrichtungsassistenten (E0).

Diese Punkte lassen sich vor den KI-Erweiterungen umsetzen.

### Ersteinrichtung und Einstellungen

- [x] **U1 Einstellungen neu ordnen.** Der Dialog „Outlook und lokale KI“ wird in die Abschnitte **Outlook**, **Board**, **Lokale KI**, **Lernen** und **Darstellung** aufgeteilt, jeder mit einem erklärenden Satz.
  - Betroffen sind heute `start()` in `src/board.ts`, `renderAiSettings` in `src/ai.ts` und `colorSettings`.
  - Jeder KI-Schalter bekommt einen Satz, was er bewirkt und was er kostet.
  - „Verbindung testen“ zeigt den Outlook-Status, das tatsächlich gewählte Sprachmodell (statt „Automatisch auswählen“), das Embedding-Modell und die Antwortzeit an einer kurzen Probe.
  - Test: Bestehende Layoutprüfung bei 24 px Grundschrift, alle Abschnitte erreichbar.
- [x] **U2 Verschieben im Dialog freigeben.** Die erste Ablage endet nicht mehr mit einer Fehlermeldung. Der Bestätigungsdialog fragt stattdessen: „Das Board darf noch keine Mails verschieben. Jetzt erlauben und verschieben?“
  - Betroffen ist `change()` in `src/board.ts`, gesetzt wird `allow_move`.
  - Abbrechen lässt die Mail unverändert. Die Freigabe bleibt in den Einstellungen änderbar.
  - Test: `live-board-smoke.py`.
- [x] **U3 „Nächster Schritt“-Hinweis.** Nach dem ersten Verbinden ohne Lernziele zeigt das Board einen deutlichen Hinweis „Einrichtung starten“. Er führt in den Assistenten (E0).
  - Solange die Einrichtung nicht abgeschlossen ist, zeigt Start den Fortschritt, z. B. „3 von 7 Schritten“.
- [x] **U4 Kurze Einführung.** Der lange Hinweistext (`board-hint` „intro“ in `src/views-layout.ts`) wird durch drei kurze Hinweise direkt an Board, Karte und Tabs ersetzt.
  - Weiter und Überspringen gehen per Tastatur, Escape schließt.
  - Über die Hilfe lässt sich die Einführung erneut zeigen.
  - Im Beispielpostfach und im Outlook-Postfach getrennt merkbar.

### Tägliche Bedienung

- [x] **U5 Aktionsleiste in den Maildetails.** Eine Knopfleiste unter dem Betreff mit Antworten, Allen antworten, Weiterleiten, Wiedervorlage (W), Nachfassen (N), Notiz (K), Fokus (F) und Vorgang, jeweils mit Tastenkürzel.
  - Genutzt werden dieselben Aktionen wie im Kontextmenü (`BoardActions` in `src/views.ts`).
  - Nicht verfügbare Aktionen, etwa Antworten im Beispielpostfach, sind deaktiviert und haben einen Tooltip, warum.
- [x] **U6 Kontextmenü gruppiert.** Ein echtes Menü an der Mausposition (`role=menu`, Pfeiltasten, Escape) ersetzt den heutigen Dialog (`editSelection`).
  - Die Tastatur öffnet es mit Umschalt+F10 oder der Menütaste an der Karte.
  - Gruppen: **Status** (1–4), **Antworten** (R, Umschalt+R), **Planen** (W, N, K, F), **Ordnen** (Kategorien, Vorgang, Ablagevorschlag).
  - Tastenkürzel stehen rechts. Bei mehreren markierten Karten nennt der Kopf die Anzahl.
- [x] **U7 Rückmeldung mit Rückgängig.** Nach jeder Aktion erscheint für etwa 8 Sekunden eine Meldung wie „Nach Einkauf verschoben · Rückgängig“, mit `role=status`.
  - Der Knopf „Rückgängig“ oben zeigt im Tooltip, was er zurücknimmt.
  - Dafür bekommen Undo-Schritte eine Beschriftung, in `LiveBoard.batches` und `demoUndo` in `src/board.ts`. `notify()` bleibt für Fehler und Hinweise.
- [x] **U8 Tastenkürzel-Übersicht.** Die Taste `?` öffnet eine Hilfeseite „Tastenkürzel“, gruppiert nach Karte, Board, Ansichten, Triage und Dialogen.
  - Die Daten kommen aus einer gemeinsamen Liste, damit Hilfe, Kontextmenü und Aktionsleiste dieselben Kürzel zeigen.

### Orientierung und Begriffe

- [x] **U9 Start entschlacken.** Start zeigt nur noch:
  - **Heute** (fällig, Fokus, wartend fällig, jeweils klickbar als Ansicht),
  - die Morgen-Triage,
  - fällige Routinen zum Abhaken,
  - solange nötig den Einrichtungsfortschritt.

  Doppelte Knöpfe zu Tabs und Seitenleiste entfallen (Wochenkalender, Routinen, Vorgänge, Heute dran, Hilfe). Der Versionshinweis schrumpft auf eine Zeile.
- [x] **U10 Werkzeuge aufräumen.**
  - „Gesendet ohne Antwort“ wird ein Eintrag unter den Ansichten der Seitenleiste.
  - „Unterhaltungen zusammenfassen“ wandert als Schalter mit sichtbarem Zustand ins Menü Ansicht.
  - Die VIP-Liste kommt in die Einstellungen (Abschnitt Board).
  - Werkzeuge enthält danach nur noch: Befehl suchen, Einstellungen, Ordner und Steckbriefe, Einrichtung, Lokale Daten und Textbausteine, Beispielpostfach, Hilfe.
- [x] **U11 Begriffe klären.**
  - Der Seitenleisten-Abschnitt „Fokus“ heißt künftig **„Ansichten“**. Er enthält auch eine Ansicht „Fokus“.
  - Die Datumsarten bekommen eine einheitliche Erklärung, als Tooltip an Karten und Feldern und als Hilfethema:
    - **Wiedervorlage** = die Karte ist bis zu diesem Tag geparkt,
    - **Nachfassen** = an diesem Tag beim Gegenüber nachhaken,
    - **Frist** = bis dahin muss es erledigt sein,
    - **KI-Frist** = von der lokalen KI erkannte Frist.

### Tests

- [x] **Smoke-Tests:** Aktionsleiste und Kontextmenü per Maus und Tastatur, Meldung mit Rückgängig, Freigabe des Verschiebens im Dialog, Einführung überspringen und erneut zeigen, `?`-Übersicht.
- [x] **Bestehende Tests anpassen,** die heute `.view-dialog` als Kontextmenü, die Start-Knöpfe oder den Werkzeug-Eintrag „Gesendet ohne Antwort“ verwenden (`board-views-smoke.py`, `cockpit-smoke.py`, `planning-smoke.py`).

## 6. Weitere Themen

*Folgen aus dem nächsten Gespräch.*
