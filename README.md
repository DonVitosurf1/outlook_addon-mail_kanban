# Outlook-Kanban mit Tauri

Eigenständiges Windows-Projekt auf Basis des getesteten Mail-Boards (Ausgangsstand e5a6e28 im Repository DonVitosurf1/outlook-addin_mail-kanban-board). TypeScript zeichnet das Board, Rust verbindet die Oberfläche mit dem lokalen C#-Helfer für klassisches Outlook.

## Ausprobieren

Das Windows-x64-ZIP vollständig entpacken und Outlook-Kanban-Demo.exe starten. Die Dateien Outlook-Test.exe und WebView2Loader.dll gehören neben das Programm. Voraussetzungen sind WebView2 und für die Postfachfunktionen klassisches Outlook mit eingerichtetem Profil sowie .NET Framework 4.8.

- Im Demomodus lassen sich 14 Beispielmails suchen, verschieben und mit Strg+Z zurückholen.
- **Outlook-Mails laden** zeigt bis zu 20 echte Mails des Standardposteingangs. Das Board liest die Outlook-Statuskategorien und kann eine ausgewählte Nachricht in Outlook öffnen. Die echten Karten sind schreibgeschützt und bleiben im Arbeitsspeicher.
- **Outlook-Verbindung testen** öffnet ein separates Fenster zum bestätigten Verschieben einer Testmail innerhalb desselben Postfachs und zum Rückgängigmachen.

Lokale KI mit Ollama, automatische Ablagevorschläge und der weitere Funktionsumfang der Python-App sind noch nicht portiert.

## Entwickeln unter Windows

Node.js mit npm, Rust stable (MSVC), Visual Studio Build Tools mit C++ und Windows SDK installieren. Im Projektverzeichnis:

```cmd
npm ci
npm run dev
```

Für eine Release-Version `npm run desktop` ausführen. Die ausführbaren Dateien liegen in `src-tauri/target/release/`. Der kompilierte Outlook-Helfer liegt zusammen mit seiner Quelle in `outlook-test/`. Nach Änderungen an der C#-Quelle zuerst `outlook-test\\build.cmd` ausführen und dann den Desktop-Build wiederholen.

`npm run build` prüft die TypeScript-Typen und erzeugt die Browservorschau in `dist/`.
