# Gestaltung des Mail-Kanbans

Die Oberfläche dient der täglichen Arbeit im klassischen Outlook auf einem zweiten Monitor. Der Aufbau folgt der Python-Referenz f37f9f0. Ordner und Fokusansichten stehen links. Suche, Arbeitsaktionen und Filter liegen oberhalb der vier Spalten Offen, In Bearbeitung, Warten und Erledigt. Details werden in einem Dialog geöffnet.

## Visuelle Entscheidungen

- Die helle Arbeitsfläche kombiniert Windows-Systemtypografie, weiße Karten und eine petrolfarbene Ordnerleiste. Die Suchleiste bleibt vom Board unterscheidbar. Lange Betreffzeilen umbrechen vollständig und Karten wachsen mit dem Inhalt.
- Schmale Register über den vier Spalten tragen Statusname, Anzahl und Statusfarbe. Der Betreff steht oben auf der weißen Karte, darunter folgen Absender und Zeit. In der Zweitmonitoransicht wächst der Betreff von 14 auf 16 CSS-Pixel bei Standardschriftgröße. Spalten dienen bis an den unteren Rand der Arbeitsfläche als Ablageziele.
- Die Schaltfläche „Ansicht“ bündelt Sortierung, Gruppierung, Filter und Kartenaktionen. Eine Zahl kennzeichnet abweichende Ansichtsoptionen.
- Steuerelemente verwenden relative Schriftgrößen und Abstände, native Auswahllisten und einen sichtbaren Fokusring. Bei schmalen Fenstern oder großer Schrift bleiben die Spalten lesbar und das Board erhält einen eigenen Scrollbereich.
- Strg+F fokussiert die Mailsuche. Strg+K öffnet die Befehlspalette mit den verfügbaren Ordnern, Ansichten und Aktionen. Pfeiltasten wählen einen Treffer, Eingabe führt ihn aus und Escape schließt die Palette.
- Die Morgen-Triage blendet zwischen Kopfbereich und Spalten ein blau umrandetes Banner ein. Schritt, Anzahl und Knöpfe stehen dort, das Board filtert auf den Schritt. Das Briefing ist einklappbar, damit die Karten im Blick bleiben. Wochenkalender, Vorgänge und Routinen öffnen als breite Dialoge mit Schließen oben rechts. Überfälliges steht im Kalender in einer orange getönten Fläche vor den sieben Tagen.
- Der Quellmodus steht am unteren Rand der Navigation. Statusmeldungen, leere Ergebnismengen und Rückmeldungen von Outlook oder lokaler KI stehen als Text zur Verfügung. Vor einer echten Verschiebung zeigt ein Dialog das Ziel und bietet Abbrechen als erste Aktion an.
- Die Oberfläche verwendet Systemschriften und lokale Assets. Suchbegriffe, Betreffzeilen, Ordnernamen und KI-Antworten werden als Text gerendert.
