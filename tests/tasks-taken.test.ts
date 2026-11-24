import {strict as assert} from 'node:assert'
import test from 'node:test'
import {openTasks, setTaken, takenTasks, TAKEN} from '../src/tasks-taken'

const data=new Map<string,string>()
;(globalThis as {localStorage?:unknown}).localStorage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)},removeItem:(k:string)=>{data.delete(k)}}
const tasks=[{text:'A',frist:null},{text:'B',frist:'2026-11-27'}]

test('Ältere Analysen ohne Aufgaben liefern undefined',()=>{
  assert.equal(openTasks(undefined,'x'),undefined)
  assert.deepEqual(openTasks([],'x'),[])
})
test('Übernommene Aufgaben werden je Signatur herausgefiltert',()=>{
  data.clear()
  assert.deepEqual(openTasks(tasks,'m1'),tasks)
  setTaken('m1',['A'])
  assert.deepEqual(takenTasks('m1'),['A'])
  assert.deepEqual(openTasks(tasks,'m1'),[tasks[1]])
  assert.deepEqual(openTasks(tasks,'m2'),tasks)
  setTaken('m1',[])
  assert.deepEqual(openTasks(tasks,'m1'),tasks)
  assert.equal(JSON.parse(data.get(TAKEN)!)['m1'],undefined)
})
test('Gleich lautende Aufgaben zählen einzeln',()=>{
  data.clear()
  const twice=[{text:'Anrufen',frist:null},{text:'Anrufen',frist:'2026-12-01'},{text:'B',frist:null}]
  setTaken('m3',['Anrufen'])
  assert.deepEqual(openTasks(twice,'m3'),[twice[1],twice[2]])
  setTaken('m3',[...takenTasks('m3'),'Anrufen'])
  assert.deepEqual(takenTasks('m3'),['Anrufen','Anrufen'])
  assert.deepEqual(openTasks(twice,'m3'),[twice[2]])
})
test('Defekter Speicher gilt als leer',()=>{
  data.set(TAKEN,'{kaputt')
  assert.deepEqual(takenTasks('m1'),[])
  data.set(TAKEN,'[1]')
  assert.deepEqual(takenTasks('m1'),[])
})
