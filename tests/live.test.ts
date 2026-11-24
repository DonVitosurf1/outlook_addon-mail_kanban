import assert from 'node:assert/strict'
import test from 'node:test'
import {COUNT_CHUNK, LiveBoard, UndoConflict, folderCounts, omittedFolderNote} from '../src/live'

function fixture(onFiled?:(delta:number, occurredAt:Date)=>void){
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
  },onFiled)
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

test('Undo behält Konfliktschritt für Retry und überspringt ihn nur nach expliziter Auswahl',async()=>{
  const fields=new Map<string,string>([['note','ursprünglich'],['followUp',''],['snoozeUntil','']])
  const calls:string[]=[]
  const board=new LiveBoard(async<T>(op:string,args:Record<string,unknown>={})=>{
    assert.equal(op,'outlook_field')
    const {field,value,expected}=args as Record<string,string>
    const previous=fields.get(field)
    if(expected!==undefined && expected!==previous)return JSON.stringify({conflict:true}) as T
    fields.set(field,value)
    calls.push(field)
    return JSON.stringify({previous,value}) as T
  })
  const batch=board.begin()
  await board.field(batch,'11','01','note','meine Notiz')
  await board.field(batch,'11','01','followUp','2026-11-25')
  await board.field(batch,'11','01','snoozeUntil','2026-11-27')
  fields.set('followUp','2026-12-12')
  const conflict=await board.undo().then(()=>assert.fail('Konflikt erwartet'),e=>e as UndoConflict)
  assert.ok(conflict instanceof UndoConflict)
  assert.equal(fields.get('followUp'),'2026-12-12')
  assert.equal(fields.get('snoozeUntil'),'')
  await assert.rejects(board.undo(),UndoConflict)
  assert.equal(calls.filter(x=>x==='snoozeUntil').length,2)
  assert.ok(conflict.skip())
  assert.equal(conflict.skip(),false)
  assert.equal(fields.get('followUp'),'2026-12-12')
  await board.undo()
  assert.equal(fields.get('note'),'ursprünglich')
  assert.equal(board.canUndo,false)
})

test('Status-Undo prüft Status samt Zeitpunkt und erlaubt Wiederholung nach aufgelöstem Konflikt',async()=>{
  let status='Offen', since='',writes=0
  const board=new LiveBoard(async<T>(op:string,args:Record<string,unknown>={})=>{
    assert.equal(op,'outlook_status')
    const previous=status, previousSince=since
    if(args.expected!==undefined){
      assert.equal(args.expected,'Warten')
      assert.equal(args.expectedSince,'2026-11-20')
      if(status!==args.expected || since!==args.expectedSince)return JSON.stringify({conflict:true}) as T
    }
    status=String(args.status);since=String(args.since??'2026-11-20');writes++
    return JSON.stringify({previous,previousSince,statusSince:since}) as T
  })
  await board.status(board.begin(),'11','01','Warten')
  since='2026-11-21'
  const error=await board.undo().then(()=>assert.fail('Konflikt erwartet'),e=>e as UndoConflict)
  assert.ok(error instanceof UndoConflict)
  assert.equal(writes,1)
  since='2026-11-20'
  await board.undo()
  assert.equal(status,'Offen')
  assert.equal(since,'')
  assert.equal(error.skip(),false)
})


test('Ablagestatistik zählt nur erfolgreiche Ablagen und deren erfolgreiche Rücknahme',async()=>{
  let filed=5
  const dates:Date[]=[]
  const {board,rows}=fixture((delta,occurredAt)=>{filed+=delta;dates.push(occurredAt)})
  const batch=board.begin()
  const filedId=await board.move(batch,'11','01','02',true)
  await assert.rejects(board.move(batch,'22','ff','02',true))
  await board.move(batch,'22','01','03',false)
  assert.equal(filed,6)
  rows.get(filedId)!.folder='ff'
  await assert.rejects(board.undo())
  assert.equal(filed,6)
  rows.get(filedId)!.folder='02'
  await board.undo()
  assert.equal(filed,5)
  assert.equal(dates.length,2)
  assert.equal(dates[0],dates[1])
})

test('Undo-Stapel behalten ihre Beschriftung',async()=>{
  const {board}=fixture()
  assert.equal(board.latestLabel,undefined)
  await board.status(board.begin('Erste'),'11','01','Erledigt')
  await board.status(board.begin('Zweite'),'22','01','Offen')
  assert.equal(board.latestLabel,'Zweite')
  await board.undo()
  assert.equal(board.latestLabel,'Erste')
})

test('neue Mail-IDs aus Verschieben und Rücknahme gehen an die Projekt-Historie (Zusammenlegen in E4)',async()=>{
  const {board}=fixture(),seen:string[]=[]
  board.identityChanged=(from,to)=>seen.push(from+'→'+to)
  const moved=await board.move(board.begin(),'11','01','02')
  await board.undo()
  board.remapMail('x','x')
  assert.deepEqual(seen,['11→'+moved,moved+'→'+String(Number(moved)+1)])
})

test('Ordnerzahlen: alle ohne Liste, sonst in Stücken, Fehler einmal gemeldet',async()=>{
  const calls:(string[]|undefined)[]=[],reports:string[]=[]
  let fail=false
  const api={json:async<T>(_command:string,args?:Record<string,unknown>)=>{
    const ids=args?.folders as string[]|undefined
    calls.push(ids)
    if(fail&&ids?.includes('F200'))throw new Error('Outlook beschäftigt')
    return (ids??['A','B']).map(id=>({id,count:id==='B'?null:7})) as T
  }}
  const all=await folderCounts(api,undefined,text=>reports.push(text))
  assert.deepEqual([...all],[['A',7]])
  assert.deepEqual(calls,[undefined])
  calls.length=0
  const ids=Array.from({length:2*COUNT_CHUNK+10},(_,i)=>'F'+i)
  const many=await folderCounts(api,[...ids,'F0'],text=>reports.push(text))
  assert.equal(many.size,ids.length)
  assert.deepEqual(calls.map(c=>c!.length),[COUNT_CHUNK,COUNT_CHUNK,10])
  fail=true
  const partial=await folderCounts(api,ids,text=>reports.push(text))
  assert.equal(partial.size,COUNT_CHUNK)
  await folderCounts(api,ids,text=>reports.push(text))
  assert.deepEqual(reports,['Ordnerzahlen konnten nicht gelesen werden. Outlook beschäftigt'])
})

test('abgeschnittene Ordner werden in einem Satz gezählt',()=>{
  assert.equal(omittedFolderNote([{omitted:0},{omitted:1}]),'1 Ordner liegt tiefer als acht Ebenen und wird nicht angezeigt.')
  assert.equal(omittedFolderNote([{omitted:2},{omitted:3}]),'5 Ordner liegen tiefer als acht Ebenen und werden nicht angezeigt.')
  assert.equal(omittedFolderNote([{name:'Posteingang'}]),'')
})
