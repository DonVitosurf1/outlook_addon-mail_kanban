import assert from 'node:assert/strict'
import test from 'node:test'
import {restore, snapshot} from '../src/backup'
import {normalizeCase} from '../src/planning-logic'
import {CapacitiesSyncError, capacitiesFields, capacitiesNoteMarkdown, capacitiesPageMarkdown, capacitiesPageStructure, capacitiesProjectLine, capacitiesTokenKey, capacitiesWebLinks, saveAtomicNote, saveMailAsNote, saveMailLinks, syncCaseToCapacities} from '../src/capacities'

const pageId='11111111-1111-4111-8111-111111111111'
const taskId='22222222-2222-4222-8222-222222222222'
test('Capacities-Seite enthält Notiz, Checkliste und Mailzeilen, keinen Mailtext',()=>{
  const markdown=capacitiesPageMarkdown({
    name:'Pipettenspitzen bestellen',
    note:'Angebot da, Bestellung noch offen.',
    items:[
      {text:'Angebot prüfen',done:false},
      {text:'bestellen',done:true,due:'2026-11-30'},
    ],
  },[{subject:'Angebot',sender:'Anna',status:'Warten',body:'GEHEIM im Mailtext'}])
  assert.match(markdown,/^# Pipettenspitzen bestellen\n/)
  assert.match(markdown,/## Notiz\n\nAngebot da, Bestellung noch offen\./)
  assert.match(markdown,/- \[ \] Angebot prüfen/)
  assert.match(markdown,/- \[x\] bestellen \(2026-11-30\)/)
  assert.match(markdown,/## Mails\n\n- Angebot · Anna · Warten/)
  assert.equal(markdown.includes('GEHEIM'),false)
})

test('Capacities-Felder: Status „Erledigt“ und das Datumsfeld der Aufgabe',()=>{
  const fields=capacitiesFields([{id:'RootTask',propertyDefinitions:[
    {id:'title',name:'Titel',type:'title'},
    {id:'status',name:'Status',type:'label',labelSet:[{id:'open',name:'Offen'},{id:'done',name:'Erledigt'}]},
    {id:'date',name:'Datum',type:'date'},
  ]}])
  assert.deepEqual(fields,{openId:'open',doneId:'done',dateId:'date'})
})

const projektId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
test('Ein Space mit dem Typ Projekt bekommt den Vorgang dort, sonst als Seite',async()=>{
  assert.equal(capacitiesPageStructure([{id:'RootPage',title:'Seite',pluralName:'Seiten'}]),'RootPage')
  assert.equal(capacitiesPageStructure([
    {id:'RootPage',title:'Seite',pluralName:'Seiten'},
    {id:projektId,title:'Projekt',pluralName:'Projekte'},
  ]),projektId)
  const calls:{body:unknown}[]=[]
  const fetchImpl=async(url:string,init?:RequestInit)=>{
    const path=url.replace('https://api.capacities.io','')
    const body=init?.body?JSON.parse(String(init.body)):undefined
    if(path==='/object/markdown')calls.push({body})
    if(path==='/space/structures')return json({structures:[
      {id:projektId,title:'Projekt',pluralName:'Projekte'},
      {id:'RootTask',propertyDefinitions:[]},
    ]})
    if(path==='/object/markdown')return json({id:pageId})
    return json({id:taskId})
  }
  const created=await syncCaseToCapacities('cap-api-test',{markdown:'# Bestellung\n',tasks:[]},fetchImpl)
  assert.equal(created.pageStructure,projektId)
  assert.deepEqual(calls[0]?.body,{structureId:projektId,markdown:'# Bestellung\n'})
})

test('Anlegen schreibt eine Seite und je Punkt eine Aufgabe, danach nur die Aufgaben',async()=>{
  const calls: {method:string; path:string; body:unknown}[]=[]
  const fetchImpl=async(url:string,init?:RequestInit)=>{
    const path=url.replace('https://api.capacities.io','')
    const body=init?.body?JSON.parse(String(init.body)):undefined
    calls.push({method:init?.method||'GET',path,body})
    assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer cap-api-test')
    assert.equal(JSON.stringify(body??'').includes('GEHEIM'),false)
    if(path==='/space/structures')return json({structures:[{id:'RootTask',propertyDefinitions:[
      {id:'status',name:'Status',type:'label',labelSet:[{id:'todo',name:'Offen'},{id:'done',name:'Erledigt'}]},
      {id:'date',name:'Datum',type:'date'},
    ]}]})
    if(path==='/object/markdown')return json({id:pageId})
    if(path==='/object'&&init?.method==='POST')return json({id:taskId})
    if(path==='/object'&&init?.method==='PATCH')return json({id:body.id})
    return json({})
  }
  const tasks=[{itemId:'a',title:'Angebot prüfen',done:false},{itemId:'b',title:'bestellen',done:true,due:'2026-11-30'}]
  const created=await syncCaseToCapacities('cap-api-test',{markdown:'# Pipettenspitzen\n\nNotiz',tasks},fetchImpl)
  assert.equal(created.createdPage,true)
  assert.equal(created.pageId,pageId)
  assert.deepEqual(created.tasks,[{itemId:'a',capacitiesId:taskId},{itemId:'b',capacitiesId:taskId}])
  const page=calls.find(c=>c.path==='/object/markdown')
  assert.equal(page?.method,'POST')
  assert.deepEqual(page?.body,{structureId:'RootPage',markdown:'# Pipettenspitzen\n\nNotiz'})
  const createdTask=calls.filter(c=>c.path==='/object'&&c.method==='POST')[1]
  assert.deepEqual(createdTask?.body,{structureId:'RootTask',properties:{
    title:{type:'title',title:{value:'bestellen'}},
    status:{type:'label',label:[{id:'done'}]},
    date:{type:'date',date:{dateResolution:'day',start:'2026-11-30T00:00:00.000Z'}},
  }})
  const updated=await syncCaseToCapacities('cap-api-test',{
    pageId,markdown:'# neu',
    tasks:[{itemId:'a',title:'Angebot prüfen',done:true,capacitiesId:taskId},{itemId:'c',title:'Lieferung prüfen',done:false}],
  },fetchImpl)
  assert.equal(updated.createdPage,false)
  assert.equal(calls.filter(c=>c.path==='/object/markdown').length,1)
  const patch=calls.find(c=>c.method==='PATCH')
  assert.deepEqual(patch?.body,{id:taskId,properties:{
    title:{type:'title',title:{value:'Angebot prüfen'}},
    status:{type:'label',label:[{id:'done'}]},
    date:{type:'date',date:{dateResolution:'day',start:null}},
  }})
  assert.equal(updated.tasks.find(t=>t.itemId==='c')?.capacitiesId,taskId)
})

test('Scheitert eine Aufgabe, bleibt die schon angelegte Seite für den nächsten Versuch',async()=>{
  let posts=0
  const fetchImpl=async(url:string,init?:RequestInit)=>{
    const path=url.replace('https://api.capacities.io','')
    if(path==='/space/structures')return json({structures:[]})
    if(path==='/object/markdown')return json({id:pageId})
    posts++
    if(posts===1)return json({id:taskId})
    return new Response(JSON.stringify({message:'zu viele Anfragen'}),{status:429})
  }
  await assert.rejects(()=>syncCaseToCapacities('cap-api-test',{markdown:'# x',tasks:[
    {itemId:'a',title:'bestellen',done:false},{itemId:'b',title:'liefern',done:false},
  ]},fetchImpl),(error:unknown)=>{
    assert.ok(error instanceof CapacitiesSyncError)
    assert.equal(error.message,'zu viele Anfragen')
    assert.equal(error.partial?.pageId,pageId)
    assert.equal(error.partial?.createdPage,true)
    assert.deepEqual(error.partial?.tasks,[{itemId:'a',capacitiesId:taskId}])
    return true
  })
})

test('Der Capacities-Token steht nicht in der Sicherung und überlebt sie',()=>{
  const map=new Map<string,string>([
    [capacitiesTokenKey,'cap-api-geheim'],
    ['mailboard-cases-v1','[]'],
  ])
  const storage={get length(){return map.size},key:(i:number)=>[...map.keys()][i]??null,getItem:(k:string)=>map.get(k)??null,
    setItem:(k:string,v:string)=>map.set(k,v),removeItem:(k:string)=>map.delete(k)} as unknown as Storage
  const saved=snapshot(storage)
  assert.equal(capacitiesTokenKey in saved,false)
  assert.equal(saved['mailboard-cases-v1'],'[]')
  restore(storage,{...saved,[capacitiesTokenKey]:'cap-api-aus-der-sicherung'})
  assert.equal(map.get(capacitiesTokenKey),'cap-api-geheim')
})

test('Eine Capacities-Kennung bleibt am Vorgang, ein unbrauchbarer Wert fällt weg',()=>{
  const today='2026-11-24'
  const kept=normalizeCase({name:'Bestellung',created:today,capacitiesId:pageId,items:[{id:'1',text:'bestellen',done:false,capacitiesId:taskId}]})
  assert.equal(kept?.capacitiesId,pageId)
  assert.equal(kept?.items[0].capacitiesId,taskId)
  const dropped=normalizeCase({name:'Bestellung',created:today,capacitiesId:'kein token',items:[{id:'1',text:'bestellen',done:false,capacitiesId:' '}]})
  assert.equal(dropped?.capacitiesId,undefined)
  assert.equal(dropped?.items[0].capacitiesId,undefined)
})

const notizId='77777777-7777-4777-8777-777777777777'
const personStructureId='88888888-8888-4888-8888-888888888888'
const personObjectId='44444444-4444-4444-8444-444444444444'
const atomStructureId='99999999-9999-4999-8999-999999999999'
const atomObjectId='66666666-6666-4666-8666-666666666666'
const linkObjectId='55555555-5555-4555-8555-555555555555'
const noteObjectId='33333333-3333-4333-8333-333333333333'
const spaceTypes=[
  {id:projektId,title:'Projekt',pluralName:'Projekte'},
  {id:notizId,title:'Notiz',pluralName:'Notizen'},
  {id:personStructureId,title:'Person',pluralName:'Personen'},
  {id:atomStructureId,title:'Atomare Notiz',pluralName:'Atomare Notizen'},
]

test('Eine übernommene Mail wird zur Notiz mit Text, der Verweis am Projekt bleibt ohne Text',()=>{
  const markdown=capacitiesNoteMarkdown({subject:'Angebot',sender:'Anna <anna@labor.de>',status:'Warten',received:'2026-11-24T08:00:00',body:'GEHEIM im Mailtext',attachments:['Kosten.xlsx'],note:'lokal'})
  assert.match(markdown,/^# Angebot\n/)
  assert.match(markdown,/Anna/)
  assert.match(markdown,/GEHEIM im Mailtext/)
  assert.match(markdown,/Kosten\.xlsx/)
  assert.match(markdown,/lokal/)
  assert.equal(capacitiesProjectLine('Angebot').includes('GEHEIM'),false)
  assert.match(capacitiesProjectLine('Angebot'),/Notiz: Angebot/)
  assert.deepEqual(capacitiesWebLinks('siehe https://example.com/angebot). und https://example.com/angebot'),['https://example.com/angebot'])
})

test('Mail als Notiz: vorhandene Person wiederverwenden, Projekt nur anhängen, zweiter Klick legt nichts neu an',async()=>{
  const calls:{method:string;path:string;body:unknown}[]=[]
  const fetchImpl=async(url:string,init?:RequestInit)=>{
    const path=url.replace('https://api.capacities.io','')
    const body=init?.body?JSON.parse(String(init.body)):undefined
    calls.push({method:init?.method||'GET',path,body})
    if(path==='/space/structures')return json({structures:spaceTypes})
    if(path==='/object/markdown')return json({id:noteObjectId})
    if(path==='/objects/search')return json({results:[{id:personObjectId,structureId:personStructureId,title:'Anna'}],nextCursor:null,hasMore:false})
    if(path==='/blocks/append')return json({id:pageId})
    return json({id:personObjectId})
  }
  const created=await saveMailAsNote('cap-api-test',{markdown:'# Angebot\n\nGEHEIM im Mailtext',title:'Angebot',personName:'Anna',projectId:pageId,projectLine:'Notiz: Angebot'},fetchImpl)
  assert.equal(created.created,true)
  assert.equal(created.noteId,noteObjectId)
  assert.equal(created.personId,personObjectId)
  const page=calls.find(c=>c.path==='/object/markdown')
  assert.equal((page?.body as {structureId:string}).structureId,notizId)
  assert.equal(calls.some(c=>c.path==='/object'&&c.method==='POST'),false)
  const append=calls.find(c=>c.path==='/blocks/append')
  assert.equal(JSON.stringify(append?.body).includes('GEHEIM'),false)
  calls.length=0
  const again=await saveMailAsNote('cap-api-test',{noteId:noteObjectId,markdown:'# Angebot\n\nGEHEIM',title:'Angebot',personName:'Anna',projectId:pageId,projectLine:'Notiz: Angebot'},fetchImpl)
  assert.equal(again.created,false)
  assert.equal(calls.length,0)
})

test('Links werden zu Weblinks, ein schon übernommener Link nicht noch einmal',async()=>{
  const calls:{path:string;body:unknown}[]=[]
  const fetchImpl=async(url:string,init?:RequestInit)=>{
    const path=url.replace('https://api.capacities.io','')
    const body=init?.body?JSON.parse(String(init.body)):undefined
    calls.push({path,body})
    if(path==='/object/url')return json({id:linkObjectId})
    return json({id:noteObjectId})
  }
  const saved=await saveMailLinks('cap-api-test',{noteId:noteObjectId,urls:['https://example.com/neu','https://example.com/alt'],known:{'https://example.com/alt':linkObjectId}},fetchImpl)
  assert.deepEqual(saved.links,{
    'https://example.com/alt':linkObjectId,
    'https://example.com/neu':linkObjectId,
  })
  assert.equal(calls.filter(c=>c.path==='/object/url').length,1)
  assert.equal((calls.find(c=>c.path==='/object/url')?.body as {url:string}).url,'https://example.com/neu')
  assert.equal(JSON.stringify(calls).includes('GEHEIM'),false)
})

test('Ein markierter Satz wird eine atomare Notiz und enthält nicht den restlichen Mailtext',async()=>{
  const calls:{path:string;body:unknown}[]=[]
  const fetchImpl=async(url:string,init?:RequestInit)=>{
    const path=url.replace('https://api.capacities.io','')
    const body=init?.body?JSON.parse(String(init.body)):undefined
    calls.push({path,body})
    if(path==='/space/structures')return json({structures:spaceTypes})
    if(path==='/object/markdown')return json({id:atomObjectId})
    return json({})
  }
  const saved=await saveAtomicNote('cap-api-test',{sentence:'Lieferung erst ab 1000 Stück.',subject:'Angebot',body:'GEHEIM im Mailtext'},fetchImpl)
  assert.equal(saved.id,atomObjectId)
  const body=calls.find(c=>c.path==='/object/markdown')?.body as {structureId:string;markdown:string}
  assert.equal(body.structureId,atomStructureId)
  assert.match(body.markdown,/Lieferung erst ab 1000 Stück/)
  assert.equal(body.markdown.includes('GEHEIM'),false)
})

function json(body:unknown){return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}})}
