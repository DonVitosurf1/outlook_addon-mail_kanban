import assert from 'node:assert/strict'
import test from 'node:test'
import { addressForm, styleText } from '../src/style'

const samples = [
  {to:'anna@example.test', subject:'Alt', text:'Sehr geehrte Frau Weber,\n\nanbei die Unterlagen.', received:'2026-01-01'},
  {to:'anna@example.test', subject:'Neu', text:'Hallo Anna,\n\nkannst du den Termin bestätigen?', received:'2026-11-01'},
  {to:'labor@example.test', subject:'Sie', text:'Guten Tag,\n\nich sende Ihnen die Rechnung.', received:'2026-11-02'},
]

test('Ansprache folgt der neuesten eigenen Mail an diesen Empfänger', () => {
  assert.equal(addressForm('Anna Weber <anna@example.test>', samples), 'Du')
  assert.equal(addressForm('labor@example.test', samples), 'Sie')
  assert.equal(addressForm('unbekannt@example.test', samples), '')
})

test('Stilsteckbrief bleibt ein prüfbarer Text', () => {
  assert.equal(styleText({anrede:'Guten Tag', form:'Sie', gruss:'Viele Grüße', laenge:'kurz', wendungen:'bitte um Rückmeldung'}),
    'Anrede: Guten Tag\nAnsprache: Sie\nGrußformel: Viele Grüße\nLänge: kurz\nWendungen: bitte um Rückmeldung')
})
