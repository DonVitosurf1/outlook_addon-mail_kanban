import {strict as assert} from 'node:assert'
import test from 'node:test'
import {ArrivalMarks,collapseThreads, dueReasons, groupCards, matchesFocus, matchesQuery, matchesSplit, orderByRelevance, orderCards, selectRelevant, workdaysSince, type ViewMail} from '../src/views-logic'

const today='2026-11-23' // Montag
const mail:ViewMail={id:'A',subject:'Preisangebot',sender:'Labor Braun',folder:'Einkauf',body:'Neue Serie',tags:['Wichtig'],attachments:['Kosten.xlsx'],status:'Warten',received:'2026-11-16T18:30:00'}

test('Suche verlangt alle Wörter, auch über mehrere Felder und Anhangnamen verteilt',()=>{
  assert(matchesQuery(mail,'  XLSX  WICHTIG   einkauf PREIS'))
  assert(!matchesQuery(mail,'braun andere'))
  assert(matchesQuery(mail,''))
})
test('Werktage und Nachfassdatum bestimmen Überfälligkeit',()=>{
  assert.equal(workdaysSince('2026-11-20',today),1)
  assert.equal(workdaysSince('2026-11-19','2026-11-22'),1)
  assert.equal(workdaysSince('2026-11-01','2026-11-01'),0)
  assert.deepEqual(dueReasons(mail,today,5),['Überfällig'])
  assert.deepEqual(dueReasons({...mail,followUp:'2026-11-24'},today),[])
  assert(matchesFocus({...mail,followUp:today},'today',today))
  assert(!matchesFocus({...mail,status:'Erledigt'},'today',today))
})
test('Wiedervorlage versteckt bis zum Datum, eingegangene Antwort holt sofort zurück',()=>{
  const sleeping={...mail,snoozeUntil:'2026-11-24'}
  assert(matchesFocus(sleeping,'snoozed',today))
  assert(!matchesFocus(sleeping,'all',today))
  assert(!matchesSplit(sleeping,'undated',[],today))
  assert.deepEqual(dueReasons({...sleeping,hasReply:true},today),['Antwort ist da'])
  assert.deepEqual(dueReasons({...sleeping,snoozeUntil:today},today),['Wiedervorlage','Überfällig'])
})
test('Benannte Filtersichten verwenden Status, VIP-Token und KI-Entscheidung',()=>{
  assert(matchesSplit(mail,'undated',[],today))
  assert(!matchesSplit({...mail,status:'Offen'},'undated',[],today))
  assert(matchesSplit(mail,'vip',['BRAUN'],today))
  assert(!matchesSplit(mail,'reply',[],today))
  assert(matchesSplit({...mail,needsReply:true},'reply',[],today))
  assert(matchesSplit({...mail,followUp:today},'overdue',[],today))
})
test('Sortierung verändert den Quellbestand nicht und gruppiert Mails ohne Schlagwort separat',()=>{
  const other={...mail,id:'B',tags:[],received:'2026-11-23T00:01:00'}
  const rows=[{...mail,status:'Offen'},{...other,status:'Offen'}]
  assert.deepEqual(orderCards(rows,'recent').map(m=>m.id),['B','A'])
  assert.deepEqual(rows.map(m=>m.id),['A','B'])
  assert.deepEqual(groupCards(rows,'tag').map(([name])=>name),['Wichtig','Ohne Kategorie'])
})

test('Kategorien gruppieren mehrfach zugeordnete Karten und ignorieren Großschreibung',()=>{
  const rows=groupCards([{...mail,tags:['Labor','Labor','Wichtig']},{...mail,id:'B',tags:['labor']}],'tag')
  assert.deepEqual(rows.map(([k,r])=>[k,r.length]),[['Labor',2],['Wichtig',1]])
})
test('Zusammenfassen behält die neueste Nachricht je Status und alle schlafenden Karten',()=>{
  const a={...mail,conversationId:'t'}, b={...a,id:'B',received:'2026-11-23'}, c={...a,id:'C',status:'Offen'}
  const d={...a,id:'D',snoozeUntil:'2026-11-25'}
  const result=collapseThreads([a,b,c,d],today)
  assert.deepEqual(result.rows.map(m=>m.id),['B','C','D'])
  assert.equal(result.hidden.get('B'),1)
})

test('Warten sortiert unabhängig von gewählter Sortierung nach Nachfasstermin oder Werktag',()=>{
  const a={...mail,statusSince:'2026-11-20T09:00:00',id:'A'}
  const b={...mail,followUp:'2026-11-21',id:'B'}
  const c={...mail,id:'C',received:undefined,statusSince:undefined,subject:'A'}
  for(const mode of ['recent','oldest','subject','sender'] as const){
    assert.deepEqual(orderCards([a,b,c],mode,1).map(m=>m.id),['B','A','C'])
  }
})

test('Nur frische zusätzliche Eingänge und zurückkehrende Wiedervorlagen werden bis zur Auswahl markiert',()=>{
  const state=new ArrivalMarks(),now=new Date('2026-11-23T12:00:00')
  const row={...mail,folderId:'inbox',received:'2026-11-23T11:59:00'}
  state.sync('Ordner A',[row],'inbox',now)
  const snoozed={...row,id:'C',folderId:'C',snoozeUntil:'2026-11-24'}
  const fresh={...row,id:'B'},old={...row,id:'D',received:'2026-10-01'}
  state.sync('Ordner A',[row,fresh,snoozed,old],'inbox',now)
  assert.deepEqual([...state.fresh],['B'])
  state.sync('Ordner B',[{...row,id:'unbekannt'}],'inbox',now)
  assert.deepEqual([...state.fresh],['B'])
  state.sync('Ordner A',[{...snoozed,hasReply:true}],'inbox',now)
  assert.deepEqual([...state.returned],['C'])
  state.seen('C')
  state.sync('Ordner A',[{...snoozed,hasReply:true}],'inbox',now)
  assert.equal(state.returned.size,0)
})
test('Bedeutungssuche: höchstens 50 Treffer über der Mindestähnlichkeit, Spalten nach Relevanz',()=>{
  const ranked=[{id:'a',score:0.5},{id:'b',score:0.9},{id:'c',score:0.34},{id:'d',score:0.35}]
  assert.deepEqual([...selectRelevant(ranked)],[['b',0.9],['a',0.5],['d',0.35]])
  assert.equal(selectRelevant(Array.from({length:80},(_,i)=>({id:'m'+i,score:0.9-i/200}))).size,50)
  const row=(id:string,status:string):ViewMail=>({...mail,id,status})
  const rows=[row('1','Offen'),row('2','Warten'),row('3','Offen'),row('4','Offen'),row('5','Warten')]
  const sorted=orderByRelevance(rows,new Map([['3',0.8],['1',0.4],['5',0.6],['2',0.4]]))
  assert.deepEqual(sorted.map(m=>m.id),['3','1','4','5','2'])
})
