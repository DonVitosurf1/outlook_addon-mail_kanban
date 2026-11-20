# Einstellungen und Daten übernehmen

In der Python-App eine ZIP-Sicherung erstellen. Eine Kopie dieser ZIP-Datei in Mail-Board unter **Werkzeuge → Lokale Daten und Textbausteine → ZIP importieren** auswählen und die Übernahme bestätigen. Die App prüft das Archiv vor der Übernahme. **Stand vor Import wiederherstellen** bringt den lokalen Zustand unmittelbar vor diesem Vorgang zurück.

| Inhalt der Python-Sicherung | Verwendung im neuen Board |
|---|---|
| config.yaml | Dient als Grundlage für die unterstützten Einstellungen, etwa Ordnerauswahl, Statuspräfix, Regeln, Fristen, Modellzugang und Textbausteine. Bereits in Tauri überschriebene Werte haben Vorrang. |
| knowledge/*.md | Steckbriefe werden über den Ordnerschlüssel im Frontmatter zugeordnet. Im Ordnerdialog lassen sie sich bearbeiten sowie einzeln als Markdown laden und exportieren. |
| vorschlag-statistik.json / art-vorschlaege.json | Die Importkopie bleibt erhalten. Regeln, Rückmeldungen, Arten und neu eingelesene Lernbeispiele verwendet die Tauri-Fassung in ihren eigenen lokalen Datenformaten. |
| ki-cache.json | Das Board berücksichtigt kompatible gespeicherte Analysen. Fehlende oder nicht mehr passende Ergebnisse lassen sich lokal neu berechnen. |
| fenster.ini | Die Python-Datei bleibt in der Importkopie erhalten. Qt- und WebView-Fenster verwenden unterschiedliche Layoutformate. |

Eine native Sicherung enthält das Manifest `tauri-board-v1.json` mit den lokalen Boarddaten einschließlich übernommener Python-Dateien. Beim Einspielen einer nativen ZIP ersetzt dieser Stand die Boarddaten. Das ZIP kann u. a. Steckbriefe, Adressen, Lernbeispiele und KI-Ergebnisse enthalten. Es gehört daher an denselben geschützten Speicherort wie die bisherigen Sicherungen. Archive dürfen komprimiert und entpackt je höchstens 16 MiB groß sein. Zusätzlich gilt der Speicherplatz des WebView-Profils. Bei Schreibfehlern versucht der Import, den vorherigen Zustand vollständig wiederherzustellen.

**Was im Postfach bleibt.** Nachrichten, Anhänge, Outlook-Statuskategorien, Notizen und Fristen liegen im Outlook-Profil. Die Board-Sicherung ersetzt keine Postfachsicherung. Die Rücknahme von Postfachaktionen gilt innerhalb der laufenden Sitzung, auch nach einem Board-Refresh.

**Neuer Rechner.** Auf dem bisherigen Gerät eine native Sicherung exportieren, auf dem neuen Gerät das Windows-Paket vollständig entpacken und die Sicherung dort importieren. Für Postfachoperationen muss das betreffende Profil in klassischem Outlook eingerichtet sein. Pfade und Vorschlagsziele im Ordnerdialog prüfen.
