import assert from 'node:assert/strict'
import test from 'node:test'
import {LiveBoard} from '../src/live'

function fixture(){
  const rows=new Map([['11',{folder:'01',status:'Offen'}],['22',{folder:'01',status:'Warten'}]])
  let seq=100
  const board=new LiveBoard(async<T>(op:string,args:Record<string,unknown>={})=>{
    const {id,source,target,folder,status}=args as Record<string,string>
    const row=rows.get(id)
    if(!row||row.folder!==(folder||source))throw new Error('Outlook konnte die Mail nicht zuordnen.')
    if(op==='outlook_status'){
      const previous=row.status
      row.status=status
      return JSON.stringify({previous}) as T
    }
    if(!['outlook_move','outlook_undo'].includes(op))throw new Error('Unbekannte Operation')
    const newId=String(++seq)
    rows.delete(id);rows.set(newId,{...row,folder:target})
    return JSON.stringify({id:newId,source,target}) as T
  })
  return {board,rows}
}

test('nach Ablage und neu gelesener Mail-ID macht Strg+Z auch den vorherigen Status rückgängig',async()=>{
  const {board,rows}=fixture()
  await board.status(board.begin(),'11','01','Erledigt')
  const first=await board.move(board.begin(),'11','01','02')
  const second=await board.move(board.begin(),first,'02','03')
  assert.equal(rows.get(second)?.folder,'03')
  await board.undo();await board.undo();await board.undo()
  assert.deepEqual([...rows.values()],[{folder:'01',status:'Warten'},{folder:'01',status:'Offen'}])
  assert.equal(board.canUndo,false)
})

test('nur erfolgreiche Schritte eines Stapels werden rückgängig gemacht; fehlgeschlagenes Undo ist wiederholbar',async()=>{
  const {board,rows}=fixture(), batch=board.begin()
  const moved=await board.move(batch,'11','01','02')
  await assert.rejects(board.move(batch,'22','ff','02'))
  rows.get(moved)!.folder='03'
  await assert.rejects(board.undo())
  assert.equal(board.canUndo,true)
  rows.get(moved)!.folder='02'
  await board.undo()
  assert.equal(board.canUndo,false)
  assert.equal(rows.get('22')?.folder,'01')
})

test('ein Undo für gruppiertes Verschieben und Statuswechsel verwendet die neuen Outlook-IDs',async()=>{
  const {board,rows}=fixture()
  const batch=board.begin()
  const newId=await board.move(batch,'22','01','02')
  await board.status(batch,newId,'02','Erledigt')
  assert.equal(rows.get(newId)?.status,'Erledigt')
  assert.equal(rows.get(newId)?.folder,'02')
  await board.undo()
  const restored=[...rows.entries()].find(([id])=>id!=='11')
  assert.notEqual(restored?.[0],newId)
  assert.deepEqual(restored?.[1],{folder:'01',status:'Warten'})
  assert.equal(board.canUndo,false)
})

test('Schreibschutz endet auch bei einem Fehler im Stapel',async()=>{
  const requests:boolean[]=[]
  const board=new LiveBoard(async <T>(name:string,args?:Record<string,unknown>)=>{
    assert.equal(name,'outlook_batch')
    requests.push(args!.active as boolean)
    return undefined as T
  })
  await assert.rejects(board.writeBatch(async()=>{throw new Error('Schreiben fehlgeschlagen')}))
  assert.deepEqual(requests,[true,false])
})

test('zehn erfolgreiche Aktionen bleiben erhalten, auch nach leeren und fehlgeschlagenen Stapeln',async()=>{
  const {board,rows}=fixture()
  let current='11'
  for(let i=0;i<12;i++){
    const source=rows.get(current)!.folder
    current=await board.move(board.begin(),current,source,source==='01'?'02':'01')
  }
  for(let i=0;i<12;i++){
    board.begin()
    await assert.rejects(board.move(board.begin(),current,'ff','03'))
  }
  let count=0
  while(board.canUndo){await board.undo();count++}
  assert.equal(count,10)
})
