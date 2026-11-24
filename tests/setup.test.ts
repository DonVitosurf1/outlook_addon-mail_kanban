import assert from 'node:assert/strict'
import test from 'node:test'
import { compareMeasurements, diffText, folderSetChange, measuredFolders, defaultScopes, freshState, initialScopes, isComplete, nextOpen, parseState, progressText, shouldOfferSetup, stepIds } from '../src/setup-logic'

const folders=[
  {name:'Posteingang',path:'',isInbox:true},
  {name:'Einkauf',path:'Einkauf'},
  {name:'Angebote',path:'Einkauf/Angebote'},
  {name:'_Abgeschlossen',path:'Einkauf/_Abgeschlossen'},
  {name:'Alt',path:'Einkauf/_Abgeschlossen/Alt'},
  {name:'Gesendete Elemente',path:'/Gesendete Elemente'},
  {name:'Gelöschte Elemente',path:'/Gelöschte Elemente'},
  {name:'Archiv 2024',path:'/Archiv 2024'},
  {name:'Archiv',path:'/Archiv'},
  {name:'Labor',path:'/Labor'},
]

test('Vorbelegung: Lernziele ohne Posteingang, Gesendet, Standardordner und _-Ordner, Archiv ist der erste mit „Archiv“',()=>{
  const scopes=defaultScopes(folders)
  assert.equal(scopes.archive,'/Archiv 2024')
  assert.deepEqual(scopes.learn,['Einkauf','Einkauf/Angebote','/Archiv','/Labor'])
  assert.deepEqual(scopes.board,[])
})

test('Vorbelegung ohne Archivordner lässt das Archiv leer',()=>{
  const scopes=defaultScopes(folders.filter(f=>!f.name.startsWith('Archiv')))
  assert.equal(scopes.archive,'')
  assert.deepEqual(scopes.learn,['Einkauf','Einkauf/Angebote','/Labor'])
})

test('Vorbelegung schließt Unterordner von Gesendet, Standardordnern und Archiv aus',()=>{
  const nested=[...folders,
    {name:'Altprojekt',path:'/Gelöschte Elemente/Altprojekt'},
    {name:'Kunde A',path:'/Gesendete Elemente/Kunde A'},
    {name:'2023',path:'/Archiv 2024/2023'},
    {name:'Archivierte Angebote',path:'/Gelöschte Elemente/Archivierte Angebote'},
    {name:'Archivbelege',path:'/Labor/Archivbelege'},
  ]
  const scopes=defaultScopes(nested)
  assert.equal(scopes.archive,'/Archiv 2024')
  assert.deepEqual(scopes.learn,['Einkauf','Einkauf/Angebote','/Archiv','/Labor','/Labor/Archivbelege'])
})

test('Startauswahl übernimmt gespeicherte Ziele und nutzt die Vorbelegung nur für fehlende',()=>{
  const kept=initialScopes(folders,{board:['Einkauf','Weg'],learn:['/Labor'],archive:'/Archiv'})
  assert.deepEqual(kept,{board:['Einkauf','Weg'],learn:['/Labor'],archive:'/Archiv'})
  const empty=initialScopes(folders,{board:[],learn:[],archive:''})
  assert.deepEqual(empty,defaultScopes(folders))
  // Ein gespeichertes Archiv bleibt erhalten, auch wenn sein Ordner gerade nicht geladen ist.
  assert.equal(initialScopes(folders,{board:[],learn:null,archive:'/Nicht geladen'}).archive,'/Nicht geladen')
  assert.equal(initialScopes(folders,{board:[],learn:null,archive:''}).archive,'/Archiv 2024')
})

test('Hinweis nur mit Outlook, ohne Lernziele, vor Abschluss und ohne „Später“',()=>{
  const state=freshState()
  assert.equal(shouldOfferSetup({mailbox:'outlook',learning:null,state,later:false}),true)
  assert.equal(shouldOfferSetup({mailbox:'outlook',learning:[],state,later:false}),true)
  assert.equal(shouldOfferSetup({mailbox:'outlook',learning:['Einkauf'],state,later:false}),false)
  assert.equal(shouldOfferSetup({mailbox:'demo',learning:null,state,later:false}),false)
  assert.equal(shouldOfferSetup({mailbox:'offline',learning:null,state,later:false}),false)
  assert.equal(shouldOfferSetup({mailbox:'outlook',learning:null,state,later:true}),false)
  const done=freshState();for(const id of stepIds)done.status[id]='skipped'
  assert.equal(isComplete(done),true)
  assert.equal(shouldOfferSetup({mailbox:'outlook',learning:null,state:done,later:false}),false)
})

test('Fortschritt zählt erledigte und übersprungene Schritte, nächster offener Schritt springt nach vorn',()=>{
  const state=freshState()
  state.status.E1='done';state.status.E3='skipped'
  assert.equal(progressText(state),'Einrichtung: 2 von 7 Schritten')
  assert.equal(nextOpen(state,'E1'),'E2')
  for(const id of ['E2','E4','E5','E6','E7'] as const)state.status[id]='done'
  assert.equal(nextOpen(state,'E7'),undefined)
  state.status.E2='open'
  assert.equal(nextOpen(state,'E6'),'E2')
})

test('Gespeicherter Stand wird geprüft gelesen',()=>{
  assert.deepEqual(parseState(null),freshState())
  assert.deepEqual(parseState({version:2,step:'E3'}),freshState())
  const state=parseState({version:1,step:'E4',status:{E1:'done',E2:'kaputt',E3:'skipped'},
    measurements:{baseline:{date:'1.1.2026',report:{tested:0},samples:{A:3},note:''},after:'nein'},
    outliers:{'x':{folder:'A',decision:'stay'},'y':{folder:'A',decision:'löschen'}},data:{E7:{offset:300}}})
  assert.equal(state.step,'E4')
  assert.deepEqual(state.status,{E1:'done',E2:'open',E3:'skipped',E4:'open',E5:'open',E6:'open',E7:'open'})
  assert.deepEqual(state.measurements.baseline?.samples,{A:3})
  assert.equal(state.measurements.after,undefined)
  assert.deepEqual(Object.keys(state.outliers),['x'])
  assert.deepEqual(state.data,{E7:{offset:300}})
  assert.deepEqual(state.confirmed,[]);assert.deepEqual(state.outlierFolders,[])
})

test('Gespeicherter Stand: bestätigte Ausreißer und Kandidaten für E4 werden geprüft gelesen',()=>{
  const state=parseState({version:1,confirmed:['a','a',3,'b'],
    outlierFolders:[{folder:'Labor',outliers:2,total:6},{folder:'Leer',outliers:0,total:0},{folder:'Kaputt',outliers:'2',total:6},'x']})
  assert.deepEqual(state.confirmed,['a','b'])
  assert.deepEqual(state.outlierFolders,[{folder:'Labor',outliers:2,total:6}])
  assert.deepEqual(parseState({version:1,confirmed:'a',outlierFolders:{}}).confirmed,[])
})

test('Vergleich: Differenz in Prozentpunkten, „schlechter“ je Ordner und Quelle, Ordner aus beiden Messungen',()=>{
  const tally=(shown:number,correct:number)=>({shown,correct})
  const measurement=(combined:ReturnType<typeof tally>,byFolder:Record<string,{tested:number;shown:number;correct:number}>,sources={}):any=>
    ({date:'x',note:'',samples:{},report:{tested:0,folders:0,combined,bayes:combined,rule:tally(0,0),sources,embedding:null,plain:null,semanticTested:0,missing:0,byFolder}})
  const before=measurement(tally(20,15),{Einkauf:{tested:10,shown:10,correct:8},Labor:{tested:10,shown:10,correct:7},Alt:{tested:10,shown:0,correct:0},Stumm:{tested:10,shown:5,correct:5},Weg:{tested:10,shown:5,correct:5}},{Bayes:tally(20,15)})
  const after=measurement(tally(20,16),{Einkauf:{tested:10,shown:10,correct:9},Labor:{tested:10,shown:10,correct:6},Neu:{tested:10,shown:10,correct:5},Stumm:{tested:10,shown:0,correct:0}},{Bayes:tally(10,5),Regel:tally(4,4)})
  const result=compareMeasurements(before,after)
  assert.deepEqual(result.folders.map(r=>[r.name,r.before,r.after,r.diff,r.worse]),[
    ['Alt',null,null,null,false],['Einkauf',80,90,10,false],['Labor',70,60,-10,true],['Neu',null,50,null,false],['Stumm',100,null,null,true],['Weg',100,null,null,false]])
  const names=result.sources.map(r=>r.name)
  assert.deepEqual(names,['Gesamtergebnis','Bayes einzeln','Endgültige Quelle · Bayes','Endgültige Quelle · Regel'])
  assert.deepEqual(result.sources[0],{name:'Gesamtergebnis',before:75,after:80,diff:5,worse:false,hint:''})
  assert.deepEqual(result.folders.map(r=>r.hint),['','','schlechter','','schlechter: keine Vorschläge mehr',''])
  assert.equal(result.sources[2].worse,true)
  assert.equal(result.sources[2].diff,-25)
  assert.deepEqual([diffText(5),diffText(-10),diffText(0),diffText(null)],['+5 Pp.','−10 Pp.','±0 Pp.','–'])
})

test('Lernordner einer Messung: gespeicherte Liste, sonst die Ordner der Lernbeispiele, Unterschied als Text',()=>{
  assert.deepEqual(measuredFolders({samples:{Labor:3,Einkauf:5}}),['Einkauf','Labor'])
  assert.deepEqual(measuredFolders({samples:{Labor:3},folders:['Labor','Reisen']}),['Labor','Reisen'])
  assert.equal(folderSetChange(['A','B'],['A','B']),'')
  assert.equal(folderSetChange(['A','B'],['B','C','D']),'neu: „C“, „D“ · nicht mehr: „A“')
  const state=parseState({version:1,step:'E6',status:{},measurements:{
    after:{date:'1.1.2026',note:'',samples:{A:1},report:{},folders:['A',3,'B']},baseline:{date:'1.1.2026',note:'',samples:{A:1},report:{},folders:'kaputt'}}})
  assert.deepEqual(state.measurements.after?.folders,['A','B'])
  assert.equal('folders' in state.measurements.baseline!,false)
})
