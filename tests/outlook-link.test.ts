import {strict as assert} from 'node:assert'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {missingHelper, outlookLoadError} from '../src/outlook-link'

test('eine fehlende Helferdatei nennt Outlook-Test aus dem funktionierenden Ordner', () => {
  const text = outlookLoadError('Das System kann die angegebene Datei nicht finden. (os error 2)')
  assert.match(text, /Mail-Board-Outlook\.exe/)
  assert.match(text, /Outlook-Test\.exe/)
  assert.match(text, /20\. November/)
  assert.equal(outlookLoadError(missingHelper), missingHelper)
})

test('andere Verbindungsfehler bleiben mit ihrer Ursache erhalten', () => {
  assert.equal(outlookLoadError('Outlook ist geschlossen.'), 'Outlook konnte nicht geladen werden. Outlook ist geschlossen.')
  for (const detail of ['Falscher Parameter. (os error 22)', 'Gerät nicht bereit. (os error 21)',
    'exit code: 1: Die angegebene Datei nicht finden: profil.pst'])
    assert.equal(outlookLoadError(detail), 'Outlook konnte nicht geladen werden. ' + detail)
})

test('die Meldung zur fehlenden Helferdatei stimmt mit der Rust-Seite überein', () => {
  const rust = readFileSync('src-tauri/args/src/lib.rs', 'utf8').match(/pub const MISSING_HELPER: &str = "([^"]*)";/)
  assert.ok(rust, 'MISSING_HELPER nicht gefunden')
  assert.equal(rust[1], missingHelper)
})
