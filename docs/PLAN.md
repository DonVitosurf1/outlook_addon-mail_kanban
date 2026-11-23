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

**Reihenfolge:** K2 → K1 → K3 → K4 → K5. K2 ist klein und unabhängig. K3 ist die Grundlage für K4 und K5.

### K1 Aufgaben → Checkliste

- [ ] **Analyse erweitern** (`lib.rs`, `analyze`): Das Schema bekommt `aufgaben: [{text, frist|null}]`, der Prompt fordert nur ausdrücklich verlangte, konkrete Handlungen an *mich*. Validierung: höchstens 5 Aufgaben, Text bis 120 Zeichen, Frist über `plausible_deadline`, sonst `null`.
- [ ] **Typen und Cache** (`src/ai.ts`): `Analysis` um `aufgaben` ergänzen. Ältere gespeicherte Analysen ohne das Feld gelten beim Öffnen der Maildetails als unvollständig und werden dann neu berechnet. Die Hintergrund-Warteschlange rechnet *nicht* alles neu.
- [ ] **Karte**: Zähler-Pille „2 Aufgaben“ in der Fußzeile (`card-content.ts`, `counter()`), nur für noch nicht übernommene Aufgaben.
- [ ] **Maildetails**: Abschnitt „Aufgaben“ mit Haken je Aufgabe, Datum änderbar. Ziel ist der Vorgang der Mail oder bei mehreren eine Auswahl. Ohne Vorgang wird ein neuer angelegt, nach dem Betreff benannt (Präfixe AW/WG/RE entfernt, `,;` ersetzt, Prüfung mit `caseNameProblem`), und die Mail zugeordnet. „Übernehmen“ schreibt die Punkte per `updateCase` und merkt sich übernommene Aufgaben je Mail.
- [ ] **Tests**: ein HTTP-Test in Rust für Schema und Validierung (ungültige Frist, mehr als 5 Aufgaben), Unit-Test für die Namensbildung, Smoke-Test mit simulierter Analyse: übernehmen → Checkliste → Kalender.
- **Fertig, wenn** eine Mail mit „Bitte bis Freitag das Angebot freigeben“ eine übernehmbare Aufgabe mit Freitagsdatum zeigt, die danach im Vorgang und im Kalender steht.

### K2 Briefing-Text

- [ ] **Reine Funktion** `briefingText(briefing)` in `src/planning-logic.ts`. Sie nutzt nur vorhandene Felder (`aiSummary`, `needsReply`, `deadline`, später `aufgaben`) und erzeugt Sätze wie „6 neue Mails seit gestern 17:40. Antwort nötig: Angebot Weber (Preis klären), Raumplanung Krüger. Frist heute: Bestellung 2026-118. 3 offene Aufgaben.“ Bei mehr als drei Einträgen kommt „und N weitere“ dazu.
- [ ] **Anzeige** als erster Absatz im Triage-Briefing (`src/triage.ts`). Ohne Analysen erscheint nur die Anzahl, ohne Fehlermeldung.
- [ ] **Tests**: Unit-Tests für leere, einfache und lange Listen sowie für Mails ohne Analyse.
- **Fertig, wenn** das Briefing ohne Wartezeit einen Absatz zeigt, der nur Inhalte aus vorhandenen Analysen nennt.

### K3 Hintergrund-Einbettung (Grundlage)

- [ ] **Rust-Befehle**, die Vektoren im vorhandenen `VectorCache` halten statt sie an die Oberfläche zu geben:
  - `ai_embed(model, items:[{id,text}])` füllt den Cache.
  - `ai_rank(model, query, ids)` liefert Ähnlichkeiten.
  - `ai_groups(model, groups:[{name, ids}], ids)` liefert die beste Gruppe je Mail mit Abstand zur zweitbesten.
  - Den Text liefert `embedText()` aus `src/ai.ts`, der Cache-Schlüssel ist Modell plus Inhalts-Hash.
- [ ] **Warteschlange** in `src/ai.ts`: nach `queueAnalyses` neue bzw. geänderte geladene Mails stapelweise (z. B. 16) einbetten, neueste zuerst. Abbruch bei Quellwechsel (`sourceEpoch`), Fortschritt in der KI-Statuszeile.
- [ ] **Tests**: Rust-HTTP-Test für Stapel und Cache-Treffer (zweiter Lauf ohne Modellaufruf), Unit-Test für die Reihenfolge.

### K4 Vorgang-Vorschlag

- [ ] **Profil je offenem Vorgang** aus den Vektoren seiner zugeordneten Mails (Mittelwert, ab 1 Mail).
- [ ] **Vorschlag** nur für Mails ohne Vorgang, wenn die Ähnlichkeit über einer Schwelle liegt (Start: 0,80) und der Abstand zum zweitbesten Vorgang mindestens 0,03 beträgt. Beide Werte sind wie bei der Ablage einstellbar.
- [ ] **Karte**: Pille „Vorgang Umzug?“ (Stil wie `card-flag`). Klick ordnet zu (`assign`, ein Undo-Schritt), ein „×“ lehnt ab. Die Ablehnung wird je Inhalts-Signatur und Vorgang lokal gespeichert, damit sie auch nach dem Verschieben mit neuer EntryID gilt.
- [ ] **Triage**: In Schritt 2 „Offen durchgehen“ sind die Vorschläge sichtbar. Strg+K bietet „Vorgangsvorschlag übernehmen“.
- [ ] **Tests**: Unit-Test für Schwelle, Abstand und Ablehnung, Smoke-Test mit simuliertem Ranking: Pille → Klick → Kategorie → Undo.

### K5 Suche nach Bedeutung

- [ ] **Umschalter** „≈ Bedeutung“ im Suchfeld (`index.html`, `aria-pressed`). Der Zustand gilt nur für die Sitzung.
- [ ] **Bei aktivem Umschalter** ersetzt die Rangfolge aus `ai_rank` die Wortsuche (`matchesQuery`). Gezeigt werden höchstens 50 Mails über einer Mindestähnlichkeit, innerhalb der Spalten nach Relevanz sortiert. Die Eingabe wird entprellt (300 ms). Ist die Einbettung noch nicht fertig, sagt das ein Hinweis.
- [ ] **„Ähnliche Mails“** in den Maildetails: die fünf ähnlichsten geladenen Mails ohne dieselbe Unterhaltung, als Links.
- [ ] **Tests**: Smoke-Test mit simuliertem Ranking: Umschalten, Treffer ohne gemeinsames Wort, Zurückschalten stellt die Wortsuche wieder her.

## 3. Zurückgestellt

- **A Einrichtung und Modellwahl:** Modell mit Größe und Tempo anzeigen, „Modell testen“, Empfehlung für GPU-Rechner, getrennte Modelle für Hintergrund und Entwürfe. Wieder aufgreifen, sobald klar ist, welches Modell läuft (Abschnitt 1).
- **B Qualität messbar machen:** „Passt / passt nicht“ an KI-Ergebnissen und eine Auswertung je Funktion. Sinnvoll, sobald es Praxiserfahrung gibt.
- **C Bessere Eingaben:** Verlauf der Unterhaltung und Anhangnamen für die Analyse, eigener schneller Prompt für die KI-Stichwahl (heute startet sie eine volle Analyse), Stil aus eigenen früheren Antworten für Entwürfe.
- **Weitere Ideen:** KI-Vorschläge für den Tagesfokus in der Triage, vorgeschlagene Nachfasstermine.

## 4. Weitere Themen

*Folgen aus dem nächsten Gespräch.*
