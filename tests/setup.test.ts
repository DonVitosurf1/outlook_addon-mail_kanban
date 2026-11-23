import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultScopes, freshState, initialScopes, isComplete, nextOpen, parseState, progressText, shouldOfferSetup, stepIds } from '../src/setup-logic'

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
})
