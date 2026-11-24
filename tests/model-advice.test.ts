import assert from 'node:assert/strict'
import test from 'node:test'
import { ADVICE, advicePull } from '../src/model-advice'

test('Empfehlung nennt Chat- und Embedding-Modell je Grafikspeicher, nur als ollama-pull-Befehl', () => {
  assert.deepEqual(ADVICE.map(row => row.memory), ['8 GB', '12 GB', '24 GB'])
  for (const row of ADVICE) {
    assert.equal(advicePull(row, 'chat'), 'ollama pull '+row.chat)
    assert.equal(advicePull(row, 'embedding'), 'ollama pull '+row.embedding)
    assert.match(row.chat, /^[a-z0-9][a-z0-9.:-]+$/)
    assert.match(row.embedding, /^[a-z0-9][a-z0-9.:-]+$/)
  }
  assert.equal(new Set(ADVICE.map(row => row.embedding)).size, 1)
})
