import assert from 'node:assert/strict'
import test from 'node:test'
import {shortcutFor,shortcutGroups,shortcuts} from '../src/shortcuts'

test('Jede Gruppe ist belegt und Kürzel doppeln sich nicht innerhalb einer Gruppe',()=>{
  for(const group of shortcutGroups){
    const rows=shortcuts.filter(s=>s.group===group)
    assert.ok(rows.length>0,group)
    const keys=rows.map(s=>s.keys)
    assert.equal(new Set(keys).size,keys.length,group)
  }
  assert.ok(shortcuts.every(s=>shortcutGroups.includes(s.group)&&s.keys&&s.action))
})
test('shortcutFor liefert Kürzel für Aktionen',()=>{
  assert.equal(shortcutFor('reply'),'R')
  assert.equal(shortcutFor('reply-all'),'Umschalt+R')
  assert.equal(shortcutFor('accept-suggestion'),'Strg+Eingabe')
  assert.equal(shortcutFor('status-done'),'4')
})
