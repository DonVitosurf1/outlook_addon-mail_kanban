# Abnahme im eigenen Windows-Profil

Die Prüfliste gilt für Mail-Board 0.2.1 und klassisches Outlook für Windows. Im eingerichteten Profil zwei Testordner, ein entbehrliches Projekt und mehrere entbehrliche Mails verwenden. Nach Schreibaktionen auch den tatsächlichen Zustand in Outlook prüfen. Für Rückmeldungen Paketversion, Windows- und Outlook-Version sowie gegebenenfalls den Wortlaut der Meldung angeben.

| Erledigt | Ablauf | Erwartetes Ergebnis |
|---|---|---|
| ☐ | In klassischem Outlook eine Testmail bereitlegen, ZIP vollständig entpacken und Mail-Board.exe starten. | Die vier Spalten erscheinen. Die App verbindet sich automatisch. Betreff und Absender der echten Testmail sind sichtbar und das Original lässt sich in Outlook öffnen. |
| ☐ | Die App bei tatsächlich nicht verfügbarem Profil starten. Anschließend das Profil in klassischem Outlook öffnen und im Board erneut verbinden. | Beim Fehler bleiben die vier Spalten leer, die App nennt den Grund. Nach dem erneuten Verbinden erscheinen die echten Mails. |
| ☐ | Werkzeuge → Beispielpostfach öffnen. Eine Beispielkarte verschieben, den Status ändern und rückgängig machen. Im Werkzeugmenü die verfügbaren Aktionen prüfen. | Die Ansicht kennzeichnet die Beispiele. Postfachgebundene Mail- und Projektwerkzeuge stehen hier für Schreibzugriffe auf Outlook nicht zur Verfügung. Echte Mails und Ordner bleiben unberührt. |
| ☐ | Testordner als Board- und Vorschlagsziel wählen. Bei passendem Betreff einen Ablagevorschlag mit ausgeschalteter KI anfordern. | Ein nachvollziehbarer Vorschlag erscheint. Bei unklarem Ergebnis lässt sich ein Ziel manuell wählen. |
| ☐ | Verschieben freigeben, zunächst im Bestätigungsdialog abbrechen, dann erneut vorschlagen und bestätigen. | Nach Abbruch liegt die Mail im ursprünglichen Ordner. Nach Bestätigung liegt sie genau einmal im gewählten Ziel. |
| ☐ | Board aktualisieren, Strg+Z drücken und beide Ordner in Outlook kontrollieren. | Die Nachricht kehrt in ihren ursprünglichen Ordner zurück. Das funktioniert auch bei geänderter Outlook-EntryID. |
| ☐ | Zwei Karten gemeinsam bearbeiten, eine parallel in Outlook verschieben und die Boardaktion zurücknehmen. | Das Board meldet Teilfehler, liest den Postfachstand neu ein und kann bestätigte Änderungen zurücknehmen. |
| ☐ | Status, Notiz und Frist ändern und zurücknehmen. Eine Mail mit schon vorhandenen Kategorien verwenden. | Vorhandene fremde Kategorien und Fachdaten bleiben erhalten. Nach erneutem Laden stimmen Board und Outlook überein. |
| ☐ | Eine wartende Nachricht beantworten lassen, Gesendet ohne Antwort und Warten-Hygiene öffnen. Einen Nachfassentwurf erstellen. | Eine passende Antwort wird zugeordnet. Der Entwurf ist in Outlook editierbar und wird erst durch den eigenen Versand verschickt. |
| ☐ | Outlook schließen oder mit einem modalen Dialog beschäftigen. Board aktualisieren, Outlook wieder öffnen bzw. Dialog schließen und erneut laden. | Das Board bleibt bedienbar, erklärt den Fehler und lädt anschließend ohne Neustart. |
| ☐ | Falls vorhanden, lokale KI mit laufendem Ollama testen, danach den Dienst beenden. | Auswertung oder Entwurf erscheint bei verfügbarem Modell. Das Board bleibt bei Ausfall für die manuelle Arbeit bedienbar. |
| ☐ | Unten links von Laptop auf Zweitmonitor wechseln, neu starten und anschließend wieder auf Laptop wechseln. Das Fenster verkleinern und lange Betreffzeilen lesen. | Die zuletzt gewählte Bildschirmansicht bleibt nach dem Neustart aktiv. Betreff und fällige Aktionen sind in der Zweitmonitoransicht größer. Suche, Fokusmarkierungen und horizontales Scrollen bleiben erreichbar. |
| ☐ | Auf dem zweiten Monitor schließen, neu starten, erneut schließen und den Monitor trennen. | Größe und Position werden wiederhergestellt. Mit nur einem Monitor bleibt das Fenster erreichbar. |
| ☐ | Während einer bestätigten Sammeländerung auf das Fenster-X klicken und anschließend in Outlook prüfen. | Der Fenstertitel meldet die laufende Änderung. Die App schließt nach Abschluss des Stapels. |
| ☐ | Sicherungs-ZIP aus den lokalen Daten exportieren und eine Kopie importieren. | Vorherige Einstellungen können zurückgeholt werden. Der Import löst keine Postfachoperation aus. |

## Regressionen im eigenen Testordner

| Erledigt | Ablauf | Erwartetes Ergebnis |
|---|---|---|
| ☐ | Eine Notiz im Board ändern. Vor Strg+Z denselben Wert im Outlook-Benutzerfeld erneut ändern und speichern. Mit Kategorie und Status wiederholen. | Die Rücknahme bewahrt die neueren Outlook-Änderungen. Ein Konflikt bleibt für den Nutzer sichtbar. |
| ☐ | Ein Testprojekt umbenennen, anschließend abschließen und beide Vorgänge nacheinander zurücknehmen. | Die Rücknahme findet das Projekt auch dann, wenn Outlook beim Verschieben eine neue Ordner-ID vergeben hat. Am Ende stimmen Projektname, Ort und Steckbriefzuordnung. |
| ☐ | Eine Mail ohne Statuskategorie in der Ordnergruppierung in die Spalte Offen eines anderen Testordners ziehen. | Die Mail liegt im gewählten Ziel und trägt in Outlook die explizite Statuskategorie Offen. Eine Rücknahme stellt den ursprünglichen Ordner und die vorherigen Kategorien wieder her. |
| ☐ | Beim Verteilen mehrere Mails markieren und verschiedene Zielordner wählen. Den Bestätigungsdialog prüfen, zunächst abbrechen und anschließend wiederholen. | Die Bestätigung zeigt die betroffenen Ziele und die jeweils zugeordneten Mails oder deren Anzahl. Abbrechen führt keine Verschiebung aus. Nur bestätigte Mails werden verteilt. |
| ☐ | Bei eingeschaltetem Aktualisierungsintervall eine Karte fokussieren. In Outlook eine weitere Mail in den sichtbaren Bestand aufnehmen. Mit aktivem Suchfeld wiederholen. | Der Bestand wird auch mit fokussierter Karte oder Suche aktualisiert. Suchtext, Fokus und weiter vorhandene Auswahl bleiben während der Aktualisierung nutzbar. |
| ☐ | Den Ablagezähler im Wochenblick notieren, eine Mail in einen Lernordner ablegen und Strg+Z drücken. Mit einer Archivablage wiederholen. | Eine gezählte Ablage erhöht den Wochenzähler und ihre erfolgreiche Rücknahme zieht den Zuwachs ab. Eine ungezählte Archivablage und ihre Rücknahme ändern den Zähler nicht. |
