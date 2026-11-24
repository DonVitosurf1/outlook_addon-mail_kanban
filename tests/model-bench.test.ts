import assert from 'node:assert/strict'
import test from 'node:test'
import demo from '../src/demo.json'
import { BENCH, benchGrade } from '../src/model-bench'

test('Modelltest nutzt sechs Mails aus dem Beispielpostfach', () => {
  assert.equal(BENCH.length, 6)
  for (const mail of BENCH) {
    const source = demo.find(row => row.subject===mail.subject && row.sender===mail.sender)
    assert.ok(source, mail.subject)
    assert.equal(mail.body, source.body)
  }
  assert.equal(BENCH.filter(mail => mail.reply).length, 3)
})

test('Note aus Treffern, gültigen Antworten und Tempo', () => {
  const row = (hit: boolean, seconds: number) => ({valid: hit, hit, seconds})
  assert.equal(benchGrade([row(true, 1), row(true, 1), row(true, 1), row(true, 1), row(true, 1), row(true, 1)]),
    'Sehr gut · 6 von 6 Treffer · 6 gültig · 1 s je Mail')
  assert.equal(benchGrade([row(true, 2), row(true, 2), row(true, 2), row(true, 2), row(true, 2), row(false, 2)]),
    'Gut · 5 von 6 Treffer · 5 gültig · 2 s je Mail')
  assert.equal(benchGrade([row(true, 1.25), row(true, 1.25), row(true, 1.25), row(false, 1.25), row(false, 1.25), row(false, 1.25)]),
    'Befriedigend · 3 von 6 Treffer · 3 gültig · 1,3 s je Mail')
  assert.equal(benchGrade([row(false, 0), row(false, 0)]), 'Schwach · 0 von 2 Treffer · 0 gültig · 0 s je Mail')
})
