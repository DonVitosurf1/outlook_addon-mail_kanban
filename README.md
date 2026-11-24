# Mail-Board für klassisches Outlook

Mail-Board ist eine eigenständige Windows-App für das tägliche Sichten, Nachverfolgen und Ablegen von E-Mails. Links stehen Ansichten und Ordner, in der Mitte die vier Statusspalten. Lesen, Antworten und Senden erfolgen in Outlook. Das Board kann Entwürfe in Outlook öffnen. Diese Anleitung gilt für Mail-Board 0.2.2.

![Das über Werkzeuge geöffnete Beispielpostfach mit 14 Mails in vier Statusspalten](docs/mail-board.png)

[Zweitmonitoransicht mit denselben Beispielmails ansehen](docs/mail-board-zweitmonitor.png)

## Inhalt

- [Unter Windows ausprobieren](#unter-windows-ausprobieren)
- [Ohne Postfach ausprobieren](#ohne-postfach-ausprobieren)
- [Bedienung](#bedienung)
- [Lokale Daten und KI](#lokale-daten-und-ki)
- [Weiterlesen](#weiterlesen)
- [Unter Windows selbst bauen](#unter-windows-selbst-bauen)
- [Automatisierte Prüfung](#automatisierte-prüfung)
- [Mitwirken](#mitwirken)

## Unter Windows ausprobieren

1. [Windows-x64-ZIP herunterladen](https://github.com/DonVitosurf1/outlook_addon-mail_kanban/releases/latest/download/Mail-Board-Windows-x64.zip) und den **gesamten Inhalt** in einen beschreibbaren Ordner entpacken. GitHub baut das ZIP nach jeder Änderung an `main` automatisch neu (Release „aktuell“). App und Outlook-Helfer passen darin immer zusammen.
2. **Mail-Board.exe** starten. Die App verbindet sich beim Start automatisch mit dem eingerichteten Profil in **klassischem Outlook für Windows**. Der mitgelieferte Outlook-Helfer muss neben der EXE liegen.
3. Falls die Verbindung fehlschlägt, zeigt das leere Board den Grund an. Klassisches Outlook mit dem gewünschten Profil öffnen, eventuelle Outlook-Dialoge schließen und die Verbindung im Board erneut versuchen.
4. Unter **Werkzeuge → Projektordner verwalten** einen vorhandenen Testordner als Board- und Lernziel wählen. Der Dialog heißt **Ordner und Steckbriefe**. Unter **Werkzeuge → Outlook und lokale KI** „Echte Mails verschieben erlauben“ einschalten. **Werkzeuge → Einrichtung** führt dieselben Entscheidungen als Schritte durch Ordnerwahl, Lernen und Posteingang; für eine einzelne Probe reicht der kürzere Weg über den Projektordner.
5. Eine entbehrliche Testmail mit einem zum Ordner passenden Betreff anklicken, **Ablagevorschlag ermitteln**, das Ziel prüfen und die Verschiebung bestätigen. In Outlook den Zielordner prüfen. Im Board **Aktualisieren**, dann **Strg+Z** drücken und in Outlook den Ursprungsordner prüfen.

Der normale Start aus dem entpackten Ordner benötigt keine Administratorrechte, keinen Rust- oder Node-Dienst und keine Installation der App. Er setzt eine nutzbare **Microsoft Edge WebView2 Runtime** voraus. Für echte Mails benötigt der Helfer **klassisches Outlook für Windows** mit eingerichtetem Standardprofil und **.NET Framework 4.8**. Auf verwalteten Geräten gelten die lokalen Ausführungsrichtlinien für heruntergeladene Programme. Das neue Outlook für Windows stellt die verwendete COM-Schnittstelle nicht bereit.

## Ohne Postfach ausprobieren

**Werkzeuge → Beispielpostfach öffnen** lädt die Beispielkarten. Statuswechsel und Ablagen in dieser Ansicht betreffen ausschließlich die Beispieldaten. **Outlook und lokale KI** sowie **Lokale Daten und Textbausteine** sind dort ausgeblendet. Auch die Browservorschau öffnet zunächst ein leeres Board. Dort lässt sich über dasselbe Menü das Beispielpostfach aufrufen. Das eigene Outlook-Profil ist in der Windows-App erreichbar.

## Bedienung

- Unten links wechselt **Bildschirmansicht** zwischen **Laptop** (kompakte Karten) und **Zweitmonitor** (größere Betreffzeilen und hervorgehobene fällige Aktionen). Die App merkt sich die Auswahl beim Schließen. In beiden Ansichten öffnen sich Filter, Sortierung und Gruppierung über **Ansicht** oberhalb der Register.
- Die Seitenleiste **Ansichten** enthält unter anderem „Heute dran“, „Fokus“ und „Gesendet ohne Antwort“. **F** nimmt markierte Karten in den Fokus oder heraus (Outlook-Kategorie „Fokus“).
- **F1** öffnet die Hilfe, **?** die Kürzelübersicht, **Strg+K** die Befehlspalette, **Strg+F** die Suche. **1–4** ändert den Status ausgewählter Karten. **Strg+Z** nimmt die letzte Aktion zurück.
- **Strg+T** startet die Morgen-Triage direkt auf dem Board. Ein Banner mit Briefing führt durch „Heute dran“, „Offen durchgehen“ und „Rest parken“. Dieselbe Aktion liegt auf dem gelben Button oben rechts und unter **Start und Übersicht**.
- **Start und Übersicht** unten links zeigt die Kennzahlen des Tages, fällige Routinen, den Wochenblick, die Warten-Hygiene, die Ablage-Auswertung und **Posteingang aufräumen**. **Strg+R** öffnet das Aufräumen direkt.
- Die Tabs **Board · Kalender · Vorgänge · Routinen** wechseln zwischen dem Board, dem Wochenkalender, Vorgängen mit Checklisten und Routinen.

Ausführliche Bedienung der Stufen 0.16 bis 0.20 steht in [Erweiterungen 0.16–0.20](docs/ERWEITERUNGEN.md).

## Lokale Daten und KI

Ohne KI lassen sich Mails verarbeiten und Ablageziele anhand von Regeln, Steckbriefen und gelernten Beispielen vorschlagen. Wer die Modellfunktionen nutzen möchte, startet lokal Ollama, llama.cpp oder den Server von LM Studio (Standardadresse `http://127.0.0.1:1234/`), installiert ein passendes Modell und wählt es unter **Werkzeuge → Outlook und lokale KI** aus. Das geht nur mit verbundenem Outlook-Postfach. Mailinhalte erhält nur ein Modell, für das der Server lokale Gewichte nachweist. Modellzugriffe laufen über Rust und sind auf Loopback beschränkt.

**Werkzeuge → Lokale Daten und Textbausteine** exportiert und importiert Sicherungen. Die App speichert lokale Einstellungen im Benutzerprofil. Das bloße Kopieren der EXE auf einen anderen PC überträgt diese Daten nicht.

## Weiterlesen

- [Funktionsmatrix und Unterschiede zur Python-Version](docs/FUNKTIONSMATRIX.md)
- [Erweiterungen 0.16–0.20](docs/ERWEITERUNGEN.md)
- [Plan und offene Punkte](docs/PLAN.md)
- [Datenübernahme](docs/DATEN.md)
- [Windows-Abnahme](docs/WINDOWS-ABNAHME.md)
- [Designentscheidungen](DESIGN.md)

## Unter Windows selbst bauen

Für die normale Nutzung ist das nicht nötig, das fertige ZIP kommt aus dem Release „aktuell“.

Voraussetzungen für den Build sind Node.js mit npm, Rust stable mit dem MSVC-Toolchain für x64, Visual Studio Build Tools mit C++ und Windows SDK sowie die WebView2 Runtime. Den Outlook-Helfer übersetzt der in Windows enthaltene C#-Compiler von .NET Framework 4.8, seine Quellen liegen in outlook-test/.

Doppelklick auf [Mail-Board-bauen.cmd](Mail-Board-bauen.cmd) im Repository-Stamm prüft die Voraussetzungen, installiert die Abhängigkeiten, führt die Tests aus und baut Outlook-Helfer, Desktop-App und ZIP. Dasselbe von Hand:

```cmd
npm ci
npm test
npm run portable
```

`npm run portable` baut den Outlook-Helfer immer mit (`npm run helper`). Das Paket liegt anschließend unter `downloads/Mail-Board-Windows-x64.zip`. Für die Entwicklung startet `npm run dev` das Desktopfenster. `npm run build` prüft TypeScript und erzeugt die Weboberfläche in dist/.

## Automatisierte Prüfung

| Befehl | Prüft |
|---|---|
| `npm test` | Portierte Fachlogik, Ablage, Rücknahme, Ansichten und Datenübernahme |
| `cargo test --manifest-path src-tauri/Cargo.toml -p mailboard-ollama` | Lokales Modellprotokoll und Datenschutzgrenzen |
| `dotnet run --project outlook-test/tests/OutlookContracts.csproj` | C#-Helfer mit simuliertem Outlook, erfordert .NET SDK 8 für den Test |
| `python tests/live-board-smoke.py` | Regulärer Boardablauf mit simuliertem Desktop-Adapter, Bestätigung, Auffrischen und Undo |
| `python tests/board-keyboard-smoke.py` | Tastaturbedienung und Layout bis zur Mindestfenstergröße |
| `python tests/planning-smoke.py` | Morgen-Triage auf dem Board, Fokus, Routinen, Wochenkalender und Vorgänge, auch mit simuliertem Outlook |

Weitere Browsertests unter `tests/` prüfen Morgen-Triage und Aufräumen, die Ordnerunterteilung, Projektabschluss und Rücknahme sowie Kartenaktionen und Antwortverfolgung. Unter Windows prüft [window-reopen.ps1](tests/window-reopen.ps1) das Wiederöffnen des Programmfensters.

Die Browsertests verwenden den vorausgegangenen Frontend-Build (`npm run build`), Python mit Playwright und Chromium. Den Pfad zum installierten Browser kann man mit der Umgebungsvariable `CHROMIUM` setzen.

## Mitwirken

Fachliche offene Punkte und bekannte Kleinigkeiten stehen in [Plan und offene Punkte](docs/PLAN.md). Die Abnahme am echten Postfach steht in [Windows-Abnahme](docs/WINDOWS-ABNAHME.md) und braucht klassisches Outlook für Windows.

Vor einem Vorschlag die betroffene Prüfung aus [Automatisierte Prüfung](#automatisierte-prüfung) laufen lassen. `npm test` deckt die Fachlogik ab. Änderungen an der Oberfläche zusätzlich mit dem passenden Browsertest unter `tests/` prüfen, nach `npm run build`.
