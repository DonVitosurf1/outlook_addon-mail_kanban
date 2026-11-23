import assert from 'node:assert/strict'
import test from 'node:test'
import { caseLimits, caseSuggestions, dismissKey } from '../src/case-suggest'

const match=(id:string,best:string,score:number,margin:number)=>({id,best,score,margin})

test('Vorschlag braucht Schwelle und Abstand', () => {
  const found=caseSuggestions([match('a','Umzug',0.8,0.03),match('b','Umzug',0.79,0.5),match('c','Umzug',0.95,0.029),match('d','Messe',0.9,1)],[],0.8,0.03)
  assert.deepEqual([...found],[['a','Umzug'],['d','Messe']])
})

test('Grenzwerte gelten auch bei Gleitkomma-Abweichung', () => {
  assert.equal(caseSuggestions([match('a','Umzug',0.83-0.03,0.83-0.8)],[],0.8,0.03).size,1)
})

test('Abgelehnte Paare aus Inhalts-Signatur und Vorgang fehlen', () => {
  const matches=[match('a','Umzug',0.9,0.2),match('b','Umzug',0.9,0.2)]
  const found=caseSuggestions(matches,new Set([dismissKey('a','umzug ')]),0.8,0.03)
  assert.deepEqual([...found],[['b','Umzug']])
  // Eine Ablehnung gilt nur für diesen Vorgang.
  assert.equal(caseSuggestions([match('a','Messe',0.9,0.2)],[dismissKey('a','Umzug')],0.8,0.03).size,1)
  assert.equal(caseSuggestions(matches,[dismissKey('a','Umzug')],0.8,0.03).size,1)
})

test('Leere Treffer ergeben keinen Vorschlag', () => {
  assert.equal(caseSuggestions([],[],0.8,0.03).size,0)
})

test('Einstellungen: Standard bei fehlenden oder ungültigen Werten', () => {
  assert.deepEqual(caseLimits({}),{threshold:0.8,margin:0.03})
  assert.deepEqual(caseLimits({case_threshold:0.9,case_margin:0.1}),{threshold:0.9,margin:0.1})
  assert.deepEqual(caseLimits({case_threshold:2,case_margin:-1}),{threshold:0.8,margin:0.03})
  assert.deepEqual(caseLimits({case_threshold:'0.9',case_margin:null}),{threshold:0.8,margin:0.03})
})
