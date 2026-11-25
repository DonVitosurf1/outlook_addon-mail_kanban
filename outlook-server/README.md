# Outlook-Hintergrundserver (Versuch)

Dieser Ordner enthält einen **Versuchsaufbau**: Statt bei jedem Befehl `Mail-Board-Outlook.exe`
neu zu starten, läuft hier ein Python-Prozess **dauerhaft** im Hintergrund. Die Tauri-App
startet ihn einmal und spricht über eine **stdin/stdout-Pipe** mit ihm.

Ziel ist, auszuprobieren, ob eine dauerhaft laufende Python-Komponente unter dem
Firmen-Virenschutz (Cortex XDR) stabil und schnell genug läuft. Fällt der Versuch aus,
ist der Rückweg ein Umschalten einer Umgebungsvariable – ohne neuen Build.

## Warum eine Pipe und kein HTTP/WebSocket

Ein lokaler HTTP- oder WebSocket-Server, der Mails lesen und verschieben kann, wäre eine
offene Tür für jeden anderen Prozess auf dem Rechner (und über DNS-Rebinding sogar für
Webseiten). Das müsste man mit Token, `127.0.0.1`-Bindung und Origin-Prüfung absichern –
und genau ein lauschender Socket mit Mailzugriff ist ein Muster, auf das ein EDR anschlägt.
Die stdin/stdout-Pipe hat keinen Port, keine Netzwerk-Angriffsfläche, und der Python-Prozess
hängt eindeutig an der App, die ihn gestartet hat. Für diesen Zweck ist sie der ruhigere Weg.

## Ehrlicher Hinweis zu Cortex XDR

Dass der Interpreter `python.exe` signiert ist, schützt **das Skript nicht**. EDR-Werkzeuge
bewerten auch **Verhalten**: „Interpreter greift auf den Mailspeicher zu" kann weiterhin
auffallen. Dieser Versuch kann also klappen oder nicht – genau das soll er zeigen. Der
dauerhaft tragfähige Weg bleibt, den Helfer **signieren zu lassen** und bei der IT
freizugeben.

## Was portiert ist

Nur die Befehle für die Hauptansicht, damit das Board mit echten Daten erscheint:

- `--folders` – Ordnerbaum
- `--inbox` – Karten des Posteingangs
- `--board <ordner-json> …` – Posteingang plus gewählte Ordner
- `--folder <id> …` – ein einzelner Ordner
- `--ping` – Bereitschaftsprüfung

Alle anderen Befehle (Verschieben, Entwürfe, Status, KI-Daten …) liefern bewusst einen
klaren Fehler. Für den vollen Umfang müsste die restliche COM-Logik aus
`outlook-test/BoardCommands.cs` nach Python übertragen werden.

## Einschalten (auf dem Windows-Rechner)

Der Server ist **standardmäßig aus**; die erprobte `Mail-Board-Outlook.exe` bleibt die Vorgabe.

**Am einfachsten:** im entpackten Ordner `Mail-Board-mit-Server.cmd` doppelklicken. Das Skript
schaltet den Server ein, sucht ein passendes Python (zuerst die venv der alten Python-App),
weist bei fehlendem `pywin32` darauf hin und startet die App. Mit `Mail-Board-mit-Server.cmd demo`
läuft es mit Beispieldaten. Zum Zurückschalten einfach wieder `Mail-Board.exe` direkt starten.

Von Hand lässt es sich über diese Variablen steuern (vor dem Start von `Mail-Board.exe` setzen):

| Variable | Wirkung |
|---|---|
| `MAILBOARD_OUTLOOK_SERVER=1` | Python-Server statt C#-Helfer |
| `MAILBOARD_PYTHON=C:\Pfad\zu\python.exe` | Welches Python (z. B. die `python.exe` der vorhandenen venv aus der alten App). Vorgabe: `python` aus dem PATH |
| `MAILBOARD_SERVER_SCRIPT=…\mailboard_server.py` | Pfad zum Skript. Vorgabe: `outlook-server\mailboard_server.py` neben der EXE |
| `MAILBOARD_SERVER_DEMO=1` | Beispieldaten statt echtem Outlook (nur zum Prüfen der Mechanik) |
| `MAILBOARD_SERVER_TIMEOUT=120` | Höchstwartezeit je Befehl in Sekunden. Nach Überschreitung gilt der Server als tot und die App fällt auf den C#-Helfer zurück |

Beispiel (PowerShell):

```powershell
$env:MAILBOARD_OUTLOOK_SERVER = "1"
$env:MAILBOARD_PYTHON = "$env:LOCALAPPDATA\OutlookKanban\venv\Scripts\python.exe"
.\Mail-Board.exe
```

Voraussetzung für echtes Outlook: Python mit `pywin32` (`pip install pywin32`). Die venv der
alten Python-App bringt das bereits mit – dann zeigt `MAILBOARD_PYTHON` einfach dorthin.
Startet der Server nicht (Python fehlt, Skript fehlt), fällt die App auf den C#-Helfer zurück
und schreibt den Grund ins Protokoll. Dasselbe gilt, wenn der Server später abstürzt oder bei
einem Befehl das Zeitlimit überschreitet: Dann gilt er als tot und die App nutzt wieder den Helfer.

## Rückwechsel

`MAILBOARD_OUTLOOK_SERVER` nicht setzen – fertig. Dann läuft wieder der bisherige Weg.
Wenn der Versuch nichts taugt, ist die vollständige Python-App das Repo
`outlook-addin_mail-kanban-board`, das bei dir ja bereits läuft.

## Prüfen ohne Outlook

```bash
python tests/outlook-server-smoke.py          # Protokoll + Datenformen über die echte Pipe
cargo test -p mailboard-server-client          # Rust-Client gegen den echten Server
```

Beide laufen mit der Demo-Quelle, also auch unter Linux/CI. Die COM-Quelle selbst lässt sich
nur unter Windows mit klassischem Outlook bewerten.
