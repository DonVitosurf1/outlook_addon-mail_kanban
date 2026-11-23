import assert from 'node:assert/strict'
import test from 'node:test'
import {describeChange, undoTooltip} from '../src/change-label'

test('Beschriftungen je Aktion',()=>{
  assert.equal(describeChange({kind:'status',value:'Erledigt',count:1}),'Status auf Erledigt gesetzt')
  assert.equal(describeChange({kind:'move',value:'x',count:1,folder:'Einkauf'}),'Nach „Einkauf“ verschoben')
  assert.equal(describeChange({kind:'snoozeUntil',value:'2026-01-02',count:1}),'Wiedervorlage gesetzt')
  assert.equal(describeChange({kind:'followUp',value:'2026-01-02',count:1}),'Nachfassen gesetzt')
  assert.equal(describeChange({kind:'note',value:'a',count:1}),'Notiz geändert')
  assert.equal(describeChange({kind:'tags',value:['A'],count:1}),'Kategorien geändert')
})
test('mehrere Mails bekommen einen Zusatz',()=>{
  assert.equal(describeChange({kind:'status',value:'Warten',count:3}),'Status auf Warten gesetzt (3 Mails)')
})
test('Fokus und Vorgang aus den Kategorie-Unterschieden',()=>{
  assert.equal(describeChange({kind:'tags',count:1,added:['Fokus'],removed:[]}),'Fokus geändert')
  assert.equal(describeChange({kind:'tags',count:2,added:[],removed:['Fokus']}),'Fokus geändert (2 Mails)')
  assert.equal(describeChange({kind:'tags',count:1,added:['Vorgang: Wartung'],removed:[]}),'Vorgang zugeordnet')
  assert.equal(describeChange({kind:'tags',count:1,added:[],removed:['Vorgang: Wartung']}),'Vorgangszuordnung gelöst')
  assert.equal(describeChange({kind:'tags',count:1,added:['Fokus','Rot'],removed:[]}),'Kategorien geändert')
})
test('Tooltip fällt ohne Beschriftung auf den alten Text zurück',()=>{
  assert.equal(undoTooltip('Notiz geändert'),'Rückgängig: Notiz geändert (Strg+Z)')
  assert.equal(undoTooltip(),'Letzte Änderung zurücknehmen (Strg+Z)')
})
