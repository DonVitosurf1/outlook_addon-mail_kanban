import assert from 'node:assert/strict'
import test from 'node:test'
import {cleanFolderName,selectedNames,structureChoices} from '../src/structure'

test('Neue Unterordner bereinigen, vorhandene Namen und Dubletten ausfiltern',()=>{
  const proposals=['Zugänge/Passwörter','zugänge  passwörter','Hardware','Drucker','Lizenzen','Systeme','Support']
    .map(name=>({name,subjects:['Bestellung','Bestellung']}))
  const actual=structureChoices(proposals,['DRUCKER'])
  assert.deepEqual(actual.map(p=>p.name),['Zugänge Passwörter','Hardware','Lizenzen','Systeme'])
  assert.deepEqual(actual[0].subjects,['Bestellung'])
  assert.equal(cleanFolderName('x'.repeat(60)).length,40)
  assert.throws(()=>structureChoices(proposals.slice(0,2),[]),/mindestens zwei/)
})

test('Geänderte Auswahl beim Bestätigen erneut auf Kollisionen und Mindestanzahl prüfen',()=>{
  assert.throws(()=>selectedNames(['Drucker','Laptops'],['Drucker'],0),/bereits vorhanden/)
  assert.throws(()=>selectedNames(['Straße','STRASSE'],[],0),/doppelt/)
  assert.throws(()=>selectedNames(['  ','Hardware'],[],0),/Namen/)
  assert.throws(()=>selectedNames(['Einzeln'],[],0),/mindestens zwei/)
  assert.deepEqual(selectedNames(['Einkauf\\Lizenzen'],['Hardware'],1),['Einkauf Lizenzen'])
})
