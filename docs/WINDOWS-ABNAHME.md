# Abnahme im eigenen Windows-Profil

Das frühere Tauri-Demofenster und der Outlook-Helfer wurden auf dem Nutzer-PC ausprobiert. Die aktuelle Fassung wurde als Windows-x64-Anwendung gebaut. Für die folgenden Abläufe steht die Bestätigung mit einem echten Outlook-Profil aus. Für den Test genügen ein eigener Zielordner und eine entbehrliche Mail. Datum, Windows-/Outlook-Version, Paketstand und etwaige Fehlermeldung bei der Rückmeldung angeben.

| Erledigt | Ablauf | Erwartetes Ergebnis |
|---|---|---|
| ☐ | ZIP vollständig entpacken und Mail-Board.exe als angemeldeter Benutzer starten. | Board mit vier Spalten öffnet sich. Demodaten sind als solche erkennbar. |
| ☐ | In klassischem Outlook eine Testmail bereitlegen. Im Board „Outlook-Mails laden“ wählen. | Betreff und Absender der echten Mail sind im Board sichtbar. Das Öffnen des Originals zeigt dieselbe Mail in Outlook. |
| ☐ | Testordner als Board- und Vorschlagsziel wählen. Bei passendem Betreff einen Ablagevorschlag mit ausgeschalteter KI anfordern. | Ein nachvollziehbarer Vorschlag erscheint. Bei unklarem Ergebnis lässt sich ein Ziel manuell wählen. |
| ☐ | Verschieben freigeben, zunächst im Bestätigungsdialog abbrechen, dann erneut vorschlagen und bestätigen. | Nach Abbruch liegt die Mail im ursprünglichen Ordner. Nach Bestätigung liegt sie genau einmal im gewählten Ziel. |
| ☐ | Board aktualisieren, Strg+Z drücken und beide Ordner in Outlook kontrollieren. | Die Nachricht kehrt in ihren ursprünglichen Ordner zurück. Das funktioniert auch bei geänderter Outlook-EntryID. |
| ☐ | Zwei Karten gemeinsam bearbeiten, eine parallel in Outlook verschieben und die Boardaktion zurücknehmen. | Das Board meldet Teilfehler, liest den Postfachstand neu ein und kann bestätigte Änderungen zurücknehmen. |
| ☐ | Status, Notiz und Frist ändern und zurücknehmen. Eine Mail mit schon vorhandenen Kategorien verwenden. | Vorhandene fremde Kategorien und Fachdaten bleiben erhalten. Nach erneutem Laden stimmen Board und Outlook überein. |
| ☐ | Eine wartende Nachricht beantworten lassen, Gesendet ohne Antwort und Warten-Hygiene öffnen. Einen Nachfassentwurf erstellen. | Eine passende Antwort wird zugeordnet. Der Entwurf ist in Outlook editierbar und wird erst durch den eigenen Versand verschickt. |
| ☐ | Outlook schließen oder mit einem modalen Dialog beschäftigen. Board aktualisieren, Outlook wieder öffnen bzw. Dialog schließen und erneut laden. | Das Board bleibt bedienbar, erklärt den Fehler und lädt anschließend ohne Neustart. |
| ☐ | Falls vorhanden, lokale KI mit laufendem Ollama testen, danach den Dienst beenden. | Auswertung oder Entwurf erscheint bei verfügbarem Modell. Das Board bleibt bei Ausfall für die manuelle Arbeit bedienbar. |
| ☐ | Auf einem zweiten Monitor nutzen, Fenster verkleinern, längere Betreffzeilen und große Schrift prüfen. | Suche, Status, Fokusmarkierungen, Dialogaktionen und horizontales Scrollen bleiben erreichbar. |
| ☐ | Auf dem zweiten Monitor schließen, neu starten, erneut schließen und den Monitor trennen. | Größe und Position werden wiederhergestellt. Mit nur einem Monitor bleibt das Fenster erreichbar. |
| ☐ | Während einer bestätigten Sammeländerung auf das Fenster-X klicken und anschließend in Outlook prüfen. | Der Fenstertitel meldet die laufende Änderung. Die App schließt nach Abschluss des Stapels. |
| ☐ | Sicherungs-ZIP aus den lokalen Daten exportieren und eine Kopie importieren. | Vorherige Einstellungen können zurückgeholt werden. Der Import löst keine Postfachoperation aus. |

Für den ersten Meilenstein zählen die Prüfungen mit der echten Mail einschließlich Abbruch, bestätigter Ablage, Aktivieren von „Aktualisieren“ und Strg+Z. Ein Test des separaten Helferfensters deckt diese Bedienfolge nicht ab.
