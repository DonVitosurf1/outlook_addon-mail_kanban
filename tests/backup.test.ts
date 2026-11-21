import assert from 'node:assert/strict'
import test from 'node:test'
import { zipSync,strToU8 } from 'fflate'
import { archive, LEGACY, parseBackup, readLegacyConfig, restore, PREVIOUS } from '../src/backup'
test('Python-ZIP mit Config, Statistik und Steckbrief wird als Kopie importiert',()=>{
  const files={'config.yaml':'status_prefix: "Status: "\nvip_senders: [Lisa]','vorschlag-statistik.json':'{"version":1}','knowledge/projekt.md':'---\nfolder: /Projekt\n---\n## Zweck\nArbeit'}
  const zip=zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)])))
  const result=parseBackup(zip)
  assert.deepEqual(JSON.parse(result.values[LEGACY]),files)
  assert.deepEqual(readLegacyConfig(files).vip_senders,['Lisa'])
  assert.equal(parseBackup(archive(result.values)).values[LEGACY],result.values[LEGACY])
})
test('Ungültige Konfiguration wird vor dem Schreiben erkannt',()=>{
  assert.throws(()=>parseBackup(zipSync({'config.yaml':strToU8('hello')})))
})
test('Wiederherstellung behält vorherigen Stand und ersetzt aktuelle Daten vollständig',()=>{
  const map=new Map([['old','old value']])
  const storage={get length(){return map.size}, key:(i:number)=>[...map.keys()][i],getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v),removeItem:(k:string)=>map.delete(k)} as unknown as Storage
  restore(storage,{new:'x'})
  assert.deepEqual(JSON.parse(map.get(PREVIOUS)!),{old:'old value'})
  assert.equal(map.has('old'),false)
  restore(storage,JSON.parse(map.get(PREVIOUS)!))
  assert.equal(map.get('old'),'old value')
})
test('Eine erschöpfte Speicherquote lässt den Ausgangszustand intakt',()=>{
  const map=new Map([['original','erhalten'],[PREVIOUS,'alter Rücksprungpunkt']])
  const storage={get length(){return map.size},key:(i:number)=>[...map.keys()][i],getItem:(k:string)=>map.get(k)??null,
    setItem:(k:string,v:string)=>{if(k==='zu-groß')throw Error('Speicher voll');map.set(k,v)},removeItem:(k:string)=>map.delete(k)} as unknown as Storage
  assert.throws(()=>restore(storage,{'neuer Wert':'schon geschrieben','zu-groß':'abgelehnt'}))
  assert.deepEqual(Object.fromEntries(map),{original:'erhalten',[PREVIOUS]:'alter Rücksprungpunkt'})
})
test('Unlesbare native Optionen werden vor dem Wiederherstellen abgewiesen',()=>{
  assert.throws(()=>parseBackup(archive({'kanban-board-options-v1':'['})))
})
test('Routinen und Vorgänge reisen in der nativen Sicherung mit und werden als Liste geprüft',()=>{
  const values={'mailboard-routines-v1':'[{"id":"r","title":"Ablage","rhythm":"daily","created":"2026-11-20"}]','mailboard-cases-v1':'[]'}
  assert.deepEqual(parseBackup(archive(values)).values,values)
  assert.throws(()=>parseBackup(archive({'mailboard-cases-v1':'{"name":"kein Array"}'})),/Einstellungsliste/)
})
