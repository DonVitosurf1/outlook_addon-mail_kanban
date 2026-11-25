import {strict as assert} from 'node:assert'
import test from 'node:test'
import {outlookLoadError} from '../src/outlook-link'

test('eine fehlende Helferdatei nennt Outlook-Test aus dem funktionierenden Ordner', () => {
  const text = outlookLoadError('Das System kann die angegebene Datei nicht finden. (os error 2)')
  assert.match(text, /Mail-Board-Outlook\.exe/)
  assert.match(text, /Outlook-Test\.exe/)
  assert.match(text, /20\. November/)
  assert.equal(outlookLoadError('Mail-Board-Outlook.exe fehlt neben Mail-Board.exe. Lege Outlook-Test.exe aus dem Ordner vom 20. November daneben und wähle „Outlook-Verbindung testen“.'),
    'Mail-Board-Outlook.exe fehlt neben Mail-Board.exe. Lege Outlook-Test.exe aus dem Ordner vom 20. November daneben und wähle „Outlook-Verbindung testen“.')
})

test('andere Verbindungsfehler bleiben mit ihrer Ursache erhalten', () => {
  assert.equal(outlookLoadError('Outlook ist geschlossen.'), 'Outlook konnte nicht geladen werden. Outlook ist geschlossen.')
})
