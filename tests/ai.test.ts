import assert from 'node:assert/strict'
import test from 'node:test'
import { setAiLive, suggestFolder, recordFiling, rejectSuggestion, trustedFolderBatch, holdout, evaluateHoldout, trainFromFolders, bindAiBoard, queueAnalyses, restoreAnalysis, pendingEmbeddings, embeddingId, embeddingIndex, embedRetryDelay, configuredModel, MODEL_ROLES } from '../src/ai'
import { LEGACY } from '../src/backup'

function storage(files:Record<string,string>={}){
  setAiLive(false);setAiLive(true)
  const map=new Map<string,string>([[LEGACY,JSON.stringify(files)]])
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>map.set(key,value)
  }})
}
const mail={subject:'Angebot Pipettenspitzen',sender:'Labor GmbH',body:'Bitte Preis prüfen.'}
test('Ohne KI funktioniert die Ablage mit absolutem Ordnerpfad; Archive bleiben ausgeschlossen',async()=>{
  storage()
  assert.equal((await suggestFolder(mail,['/Labor/Pipettenspitzen','/_Archiv/Pipettenspitzen'])).folder,'/Labor/Pipettenspitzen')
  assert.equal((await suggestFolder(mail,['/_Archiv/Pipettenspitzen'])).folder,'')
})
test('Gleichstand lässt die Ordnerauswahl offen',async()=>{
  storage()
  assert.equal((await suggestFolder(mail,['Labor/Pipettenspitzen','Einkauf/Pipettenspitzen'])).folder,'')
})
test('Gelernte Ablagen liefern nach drei passenden Beispielen ein Ziel',async()=>{
  storage()
  for(let i=0;i<3;i++)recordFiling(mail,'Beschaffung')
  assert.equal((await suggestFolder(mail,['Beschaffung','Projekt'])).folder,'Beschaffung')
  assert.equal((await suggestFolder({...mail,sender:'Neu',subject:'Einkauf'},['Beschaffung','Projekt'])).folder,'')
})
test('Steckbrief aus der Python-Kopie liefert eine lokale Zuordnung',async()=>{
  storage({'knowledge/labor.md':'---\nfolder: /LAB\n---\n## Zweck\nPipettenspitzen und Proben\n## Stichworte\nLaboreinkauf'})
  assert.equal((await suggestFolder(mail,['LAB','Projekt'])).folder,'LAB')
})
test('Importierte Absender-Regel hat Vorrang gegenüber Domain-Regel und Wörtern',async()=>{
  storage({'config.yaml':'filing_rules:\n  - match: domain:labor.de\n    folder: Labor\n  - match: sender:anna@labor.de\n    folder: Anna'})
  assert.equal((await suggestFolder({...mail,senderEmail:'anna@labor.de'},['Labor','Anna','Pipettenspitzen'])).folder,'Anna')
})

test('Ein verworfener Treffer bleibt auch nach Wechsel der Outlook-EntryID gesperrt',async()=>{
  storage({'config.yaml':'filing_rules: [{match: domain:labor.de, folder: Labor}]'})
  const first={...mail,received:'2026-02-14T12:15:11',id:'A',senderEmail:'test@labor.de'}
  assert.equal(trustedFolderBatch(['Labor'])(first)?.folder,'Labor')
  rejectSuggestion(first,'Labor')
  assert.equal((await suggestFolder({...first,id:'nach-move'},['Labor'])).folder,'')
})

test('Holdout trennt zehn aktuelle Beispiele je ausreichend großem Ordner vom Training',()=>{
  const rows=Array.from({length:26},(_,i)=>({folder:i%2?'Labor':'IT',features:[i%2?'n:Labor':'n:IT',i%2?'w:Messung':'w:Support'],
    received:'2026-11-'+String(1+Math.floor(i/2)).padStart(2,'0')}))
  assert.deepEqual(holdout(rows),{tested:20,shown:20,correct:20})
  assert.deepEqual(holdout(rows.slice(0,10)),{tested:0,shown:0,correct:0})
})

test('Training ersetzt gelesene Ordner und erhält die letzten Daten eines nicht erreichbaren Ordners',async()=>{
  storage()
  const targets=['A','B'].map(name=>({id:name,name,path:name}))
  let fail=false
  Object.defineProperty(globalThis,'window',{configurable:true,value:{__TAURI__:{core:{invoke:async(name:string,args:{folder:string})=>{
    assert.equal(name,'outlook_training')
    if(args.folder==='A'&&fail)throw Error('Outlook belegt')
    return JSON.stringify(Array.from({length:4},(_,i)=>({...mail,subject:'Neu '+args.folder,sender:'Firma '+args.folder,senderEmail:'team@'+args.folder+'.de',id:args.folder+i})))
  }}}}})
  assert.equal((await trainFromFolders(targets)).count,8)
  fail=true
  const result=await trainFromFolders(targets)
  assert.equal(result.count,8);assert.equal(result.failures.length,1)
  assert.equal(trustedFolderBatch(['A','B'])({...mail,subject:'Neu B',sender:'Firma B',senderEmail:'team@B.de'})?.folder,'B')
})

test('Hintergrundanalyse erfordert aktive Zustimmung, speichert Auswertung, vermeidet Wiederholung',async()=>{
  storage({'ki-cache.json':JSON.stringify({'firma|Projekt|20261120100100':{summary:'Import',needs_reply:false,dated:true,deadline:null,types:[]}})})
  const old={...mail,sender:'Firma',subject:'Projekt',received:'2026-11-20T10:01:00',id:'alt',aiSummary:''}
  restoreAnalysis(old);assert.equal(old.aiSummary,'Import')
  let calls=0
  const raw={zusammenfassung:'Preis klären',antwort_noetig:true,frist:null,ordner:null,arten:['Anfrage']}
  const live={...mail,id:'AI-1',needsReply:false,aiSummary:''}
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:()=>null}})
  Object.defineProperty(globalThis,'window',{configurable:true,value:{dispatchEvent:()=>{},
    __TAURI__:{core:{invoke:async(cmd:string)=>{assert.equal(cmd,'ai_analyze');calls++;return raw}}}}})
  bindAiBoard(()=>[live],()=>['Labor'])
  await queueAnalyses()
  assert.equal(calls,0)
  localStorage.setItem('outlook-kanban-ai-settings-v1',JSON.stringify({enabled:true,auto:true,model:'lokal'}))
  await queueAnalyses()
  await queueAnalyses()
  assert.equal(calls,1);assert.equal(live.aiSummary,'Preis klären');assert.equal(live.needsReply,true)
  const saved=localStorage.getItem('outlook-kanban-ai-cache-v1')!
  assert.ok(saved.includes('Preis klären'));assert.ok(!saved.includes(mail.body))
})

test('Nahe semantische Treffer veranlassen nur eine schnelle Stichwahl zwischen den beiden tatsächlichen Zielen',async()=>{
  storage()
  const calls:string[]=[]
  let answer:unknown={ordner:'Einkauf',grund:'Bestellung von Verbrauchsmaterial'}
  Object.defineProperty(globalThis,'window',{configurable:true,value:{__TAURI__:{core:{invoke:async(cmd:string,args:any)=>{
    calls.push(cmd)
    if(cmd==='ai_suggest')return [{folder:'Labor',score:0.90},{folder:'Einkauf',score:0.86},{folder:'Personal',score:0.32}]
    assert.equal(cmd,'ai_choose')
    assert.deepEqual(args.candidates.map((f:{key:string})=>f.key),['Labor','Einkauf'])
    assert.equal(args.model,'lokal');assert.ok(args.mail.body.length<=1000)
    return answer
  }}}}})
  localStorage.setItem('outlook-kanban-ai-settings-v1',JSON.stringify({enabled:true,embeddings:true,model:'lokal'}))
  const hint=await suggestFolder(mail,['Labor','Einkauf','Personal'])
  assert.equal(hint.folder,'Einkauf');assert.equal(hint.reason,'KI-Stichwahl · Bestellung von Verbrauchsmaterial')
  assert.deepEqual(calls,['ai_suggest','ai_choose'])
  // Dieselbe Mail mit demselben Kandidatenpaar nutzt das gemerkte Ergebnis.
  assert.equal((await suggestFolder(mail,['Labor','Einkauf','Personal'])).folder,'Einkauf')
  assert.deepEqual(calls,['ai_suggest','ai_choose','ai_suggest'])
  // Nennt das Modell keinen der beiden, bleibt es beim gemessenen Embedding-Ergebnis.
  answer=null
  const other={...mail,subject:'Angebot Zentrifuge'}
  const fallback=await suggestFolder(other,['Labor','Einkauf','Personal'])
  assert.equal(fallback.folder,'Labor');assert.ok(fallback.reason.startsWith('Lokale Embeddings'))
  assert.ok(!calls.includes('ai_analyze'))
})

test('Steckbrief-Ausschlüsse erhöhen die lokale Zuordnung nicht',async()=>{
  storage({'knowledge/labor.md':'---\nfolder: /LAB\n---\n## Zweck\nReinigung\n## Passt nicht hierher\nPipettenspitzen'})
  assert.equal((await suggestFolder(mail,['LAB'])).folder,'')
})

test('Gesamttestlauf zählt die tatsächlich ausgewählte Quelle und berücksichtigt ausgeblendete Quellen',()=>{
  const rows=Array.from({length:26},(_,i)=>{
    const truth=i%2?'Labor':'IT',j=Math.floor(i/2)
    return {folder:truth,id:truth+j,received:'2026-11-'+String(20-j).padStart(2,'0'),
      features:['e:'+(i===0?'fest@labor.de':'team@'+truth+'.de'),'n:'+truth,'w:'+truth]}
  })
  const guesses=[
    {truth:'IT',id:'IT0',folder:'IT',gap:0.2},  // specific sender rule overrides both models
    {truth:'Labor',id:'Labor0',folder:'Labor',gap:0.1}, // agreement
    {truth:'IT',id:'IT1',folder:'Labor',gap:0.2},  // clearly stronger semantic score
    {truth:'Labor',id:'Labor1',folder:'IT',gap:0.04}, // narrow disagreement falls back to Bayes
  ]
  const semantic={tested:4,missing:0,profiled:{correct:2,shown:4},plain:{correct:1,shown:4},predictions:guesses}
  const fixed=[{match:'sender:fest@labor.de',folder:'Labor'}]
  const result=evaluateHoldout(rows,['IT','Labor'],fixed,[],semantic)
  assert.equal(result.tested,20);assert.equal(result.folders,2)
  assert.deepEqual(result.rule,{correct:0,shown:1})
  assert.deepEqual(result.bayes,{correct:20,shown:20})
  assert.deepEqual(result.combined,{correct:18,shown:20})
  assert.deepEqual(result.sources,{Regel:{correct:0,shown:1},Hybrid:{correct:1,shown:1},Embedding:{correct:0,shown:1},Bayes:{correct:17,shown:17}})
  // Je Ordner zehn Testmails. Die Fehlablagen durch Regel (IT0) und Embedding (IT1) zählen bei IT.
  assert.deepEqual(result.byFolder,{IT:{tested:10,shown:10,correct:8},Labor:{tested:10,shown:10,correct:10}})
  // Verwechslungen für E4: richtiger Ordner → vorgeschlagener Ordner, nur Fehlablagen.
  assert.deepEqual(result.confusion,{IT:{Labor:2}})
  const filtered=evaluateHoldout(rows,['IT','Labor'],fixed,['Regel','Hybrid'],semantic)
  assert.deepEqual(filtered.combined,{correct:17,shown:18})
  assert.deepEqual(filtered.confusion,{IT:{Labor:1}})
  assert.equal(filtered.sources.Hybrid,undefined);assert.equal(filtered.sources.Regel,undefined)
})

test('Beispielpostfach verwendet nur Beispielordner, ohne reale Regeln, Cache oder Training', async()=>{
  storage({'config.yaml':'filing_rules: [{match: domain:labor.de, folder: Labor}]',
    'ki-cache.json':JSON.stringify({'team@labor.de|Projekt|20261120100100':{summary:'Vertraulich',needs_reply:true}})})
  const sample={...mail,subject:'Projekt',body:'',senderEmail:'team@labor.de',received:'2026-11-20T10:01:00',id:'sample',aiSummary:''}
  const targets=['Labor','Projekt']
  const livePredict=trustedFolderBatch(targets)
  assert.equal(livePredict(sample)?.folder,'Labor')
  setAiLive(false)
  const real=globalThis.localStorage
  const commands:string[]=[]
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:()=>{throw Error('Unerlaubtes Lesen von Outlook-Speicher')},setItem:()=>{throw Error('Unerlaubtes Schreiben in Outlook-Speicher')}
  }})
  Object.defineProperty(globalThis,'window',{configurable:true,value:{__TAURI__:{core:{invoke:async(cmd:string)=>{commands.push(cmd)}}}}})
  try{
    assert.deepEqual(await suggestFolder(sample,targets),{folder:'Projekt',reason:'Begriff aus dem Beispielordner'})
    assert.equal(livePredict(sample),undefined);assert.equal(trustedFolderBatch(targets)(sample),undefined)
    recordFiling(sample,'Labor');rejectSuggestion(sample,'Labor');restoreAnalysis(sample)
    await queueAnalyses()
    assert.equal(sample.aiSummary,'')
    await assert.rejects(trainFromFolders([{id:'123',name:'Labor',path:'Labor'}]),/Outlook/)
    assert.deepEqual(commands,[])
  }finally{Object.defineProperty(globalThis,'localStorage',{configurable:true,value:real})}
})

test('Ein Quellenwechsel verwirft laufende Hintergrundanalysen auch nach erneutem Öffnen von Outlook',async()=>{
  storage()
  localStorage.setItem('outlook-kanban-ai-settings-v1',JSON.stringify({enabled:true,auto:true,model:'lokal'}))
  let started!:()=>void,finish!:(value:unknown)=>void,calls=0
  const ready=new Promise<void>(r=>{started=r}), delayed=new Promise(r=>{finish=r})
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:()=>null}})
  Object.defineProperty(globalThis,'window',{configurable:true,value:{dispatchEvent:()=>{},__TAURI__:{core:{invoke:async()=>{calls++;started();return delayed}}}}})
  const m={...mail,id:'private',aiSummary:''}
  bindAiBoard(()=>[m,{...m,id:'private2'}],()=>['Labor'])
  const running=queueAnalyses()
  await ready
  setAiLive(false);setAiLive(true)
  finish({zusammenfassung:'Vertrauliche Analyse',antwort_noetig:true,arten:[],frist:null,ordner:null})
  await running
  assert.equal(m.aiSummary,'');assert.equal(calls,1)
  assert.equal(localStorage.getItem('outlook-kanban-ai-cache-v1'),null)
})

test('Ein Quellenwechsel während des Lernens verhindert weitere Outlook-Aufrufe und Speicheränderungen',async()=>{
  storage()
  const original=JSON.stringify({rows:[],stamp:1})
  localStorage.setItem('outlook-kanban-ai-training-v1',original)
  let finish!:(s:string)=>void,calls=0
  Object.defineProperty(globalThis,'window',{configurable:true,value:{__TAURI__:{core:{invoke:()=>{calls++;return new Promise<string>(r=>{finish=r})}}}}})
  const running=trainFromFolders(['A','B'].map(path=>({id:path,name:path,path})))
  assert.equal(calls,1)
  setAiLive(false);setAiLive(true)
  finish(JSON.stringify([{...mail,id:'real'}]))
  await assert.rejects(running,/Outlook/)
  assert.equal(calls,1);assert.equal(localStorage.getItem('outlook-kanban-ai-training-v1'),original)
})

test('Einbettung: neueste Mails zuerst, gleiche Inhalte einmal, schon eingebettete übersprungen',()=>{
  const at=(subject:string,received?:string,id?:string)=>({...mail,subject,received,id})
  const mails=[at('Alt','2026-11-01T08:00:00','a'),at('Ohne Datum'),at('Neu','2026-11-20T09:00:00','n'),at('Mitte','2026-11-10T12:00:00','m'),at('Neu','2026-11-20T09:00:00','n-verschoben')]
  assert.deepEqual(pendingEmbeddings(mails,new Set()).map(m=>m.id),['n','m','a',undefined])
  assert.deepEqual(pendingEmbeddings(mails,new Set([embeddingId(mails[2]),embeddingId(mails[0])])).map(m=>m.subject),['Mitte','Ohne Datum'])
  assert.equal(embeddingId(mails[2]),embeddingId(mails[4]))
  assert.notEqual(embeddingId(mails[2]),embeddingId({...mails[2],body:'Geänderter Inhalt'}))
})

test('Hintergrund-Einbettung läuft nach der Analyse in Stapeln und nur mit aktiven Embeddings',async()=>{
  storage()
  const calls:{cmd:string;args:any}[]=[]
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:()=>null}})
  Object.defineProperty(globalThis,'window',{configurable:true,value:{dispatchEvent:()=>{},__TAURI__:{core:{invoke:async(cmd:string,args:any)=>{
    calls.push({cmd,args})
    if(cmd==='ai_rank')return args.items.map((i:{id:string},n:number)=>({id:i.id,score:1-n/10}))
    return args.items.length
  }}}}})
  const board=Array.from({length:20},(_,i)=>({...mail,subject:'Mail '+i,id:'E'+i,received:'2026-11-'+String(i+1).padStart(2,'0')+'T08:00:00'}))
  bindAiBoard(()=>board,()=>['Labor'])
  localStorage.setItem('outlook-kanban-ai-settings-v1',JSON.stringify({enabled:true,embeddings:false,embedModel:'lokal-embed'}))
  await queueAnalyses()
  assert.equal(calls.length,0)
  localStorage.setItem('outlook-kanban-ai-settings-v1',JSON.stringify({enabled:true,embeddings:true,embedModel:'lokal-embed'}))
  await queueAnalyses()
  assert.deepEqual(calls.map(c=>[c.cmd,c.args.items.length]),[['ai_embed',16],['ai_embed',4]])
  assert.equal(calls[0].args.model,'lokal-embed')
  assert.equal(calls[0].args.items[0].id,embeddingId(board[19]))
  assert.ok(calls[0].args.items[0].text.includes('Mail 19'))
  assert.deepEqual(embeddingIndex.ready(board.map(embeddingId)).length,20)
  await queueAnalyses()
  assert.equal(calls.length,2)
  const ids=[embeddingId(board[3]),embeddingId(board[5]),'unbekannt']
  assert.deepEqual((await embeddingIndex.rank('Lieferung',ids)).map(s=>s.id),ids.slice(0,2))
  assert.deepEqual(calls[2].args.items.map((i:{id:string})=>i.id),ids.slice(0,2))
  setAiLive(false)
  assert.deepEqual(embeddingIndex.ready(ids),[])
  await assert.rejects(embeddingIndex.rank('Lieferung',ids),/Outlook/)
})

test('Einbettung: Wartezeit nach Fehlern wächst von 30 Sekunden bis höchstens 15 Minuten',()=>{
  assert.equal(embedRetryDelay(0),0)
  assert.deepEqual([1,2,3,4,5,6,7,8,50].map(embedRetryDelay),[30000,60000,120000,240000,480000,900000,900000,900000,900000])
})

test('Einbettung: nach einem Fehler erst nach der Wartezeit erneut, Erfolg und Quellenwechsel setzen zurück',async()=>{
  storage()
  let fail=true,clock=Date.parse('2026-11-24T10:00:00Z')
  const realNow=Date.now
  Date.now=()=>clock
  const calls:string[]=[]
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:()=>null}})
  Object.defineProperty(globalThis,'window',{configurable:true,value:{dispatchEvent:()=>{},__TAURI__:{core:{invoke:async(cmd:string,args:any)=>{
    calls.push(cmd)
    if(fail)throw new Error('Dienst nicht erreichbar')
    return args.items.length
  }}}}})
  try{
    const board=[{...mail,subject:'Eine',id:'W1',received:'2026-11-20T08:00:00'}]
    bindAiBoard(()=>board,()=>['Labor'])
    localStorage.setItem('outlook-kanban-ai-settings-v1',JSON.stringify({enabled:true,embeddings:true,embedModel:'lokal-embed'}))
    await queueAnalyses()
    assert.equal(calls.length,1)
    clock+=29000;await queueAnalyses()
    assert.equal(calls.length,1,'innerhalb von 30 Sekunden kein neuer Versuch')
    clock+=2000;await queueAnalyses()
    assert.equal(calls.length,2,'nach 30 Sekunden neuer Versuch')
    clock+=59000;await queueAnalyses()
    assert.equal(calls.length,2,'zweiter Fehler: eine Minute warten')
    clock+=2000;fail=false;await queueAnalyses()
    assert.equal(calls.length,3)
    assert.equal(embeddingIndex.ready([embeddingId(board[0])]).length,1)
    // Erfolg setzt zurück: der nächste Fehler wartet wieder nur 30 Sekunden.
    board.push({...mail,subject:'Zwei',id:'W2',received:'2026-11-21T08:00:00'});fail=true
    await queueAnalyses();assert.equal(calls.length,4)
    clock+=31000;await queueAnalyses();assert.equal(calls.length,5)
    // Quellenwechsel setzt zurück: sofort neuer Versuch.
    setAiLive(false);setAiLive(true)
    await queueAnalyses();assert.equal(calls.length,6)
  }finally{Date.now=realNow}
})

test('Zwei Modelle: Hintergrund für Analyse, Stichwahl und Aufgaben, Entwürfe für Texte',()=>{
  const both={model:'hinter:8b',draftModel:'entwurf:14b'}
  for(const fn of ['analyze','choose','tasks'] as const)assert.equal(configuredModel(fn,both),'hinter:8b',fn)
  for(const fn of ['reply','profile','subfolders','folderName','clusterName'] as const)assert.equal(configuredModel(fn,both),'entwurf:14b',fn)
  assert.deepEqual(Object.keys(MODEL_ROLES).sort(),['analyze','choose','clusterName','folderName','profile','reply','subfolders','tasks'])
  // Ältere Einstellungen ohne Entwurfsmodell und ein leeres Feld verhalten sich wie bisher.
  assert.equal(configuredModel('reply',{model:'hinter:8b'}),'hinter:8b')
  assert.equal(configuredModel('reply',{model:'hinter:8b',draftModel:'  '}),'hinter:8b')
  assert.equal(configuredModel('reply',{model:'',draftModel:''}),'')
})
test('Stichwahl nutzt das Hintergrundmodell, nicht das Entwurfsmodell',async()=>{
  storage()
  const models:string[]=[]
  Object.defineProperty(globalThis,'window',{configurable:true,value:{__TAURI__:{core:{invoke:async(cmd:string,args:any)=>{
    if(cmd==='ai_suggest')return [{folder:'Labor',score:0.90},{folder:'Einkauf',score:0.86}]
    models.push(cmd+':'+args.model)
    return {ordner:'Labor',grund:'Messung'}
  }}}}})
  localStorage.setItem('outlook-kanban-ai-settings-v1',JSON.stringify({enabled:true,embeddings:true,model:'hinter',draftModel:'entwurf'}))
  assert.equal((await suggestFolder({...mail,subject:'Messreihe'},['Labor','Einkauf'])).folder,'Labor')
  assert.deepEqual(models,['ai_choose:hinter'])
})
