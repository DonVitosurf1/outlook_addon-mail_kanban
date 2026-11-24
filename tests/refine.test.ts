import assert from 'node:assert/strict'
import test from 'node:test'
import { relabelLearning, setAiLive } from '../src/ai'
import { LEGACY } from '../src/backup'
import { CONFUSION_SHARE, CROWDED_MAILS, MERGED_FOLDER, PROFILE_SIMILARITY, confusedPairs, cosine, crowdedFolders, isUnclearName, mergePlan,
  overlaps, proposalKey, restoreRules, restoreTargets, retarget, retargetRules, reversed, similarProfiles } from '../src/refine'
import { parseState } from '../src/setup-logic'

test('Unklare Namen: feste Liste ohne Groß- und Kleinschreibung und Namen unter 4 Zeichen',()=>{
  for(const name of ['Sonstiges','diverses',' Allgemein ','Neuer Ordner','NEU','Verschiedenes','Misc','IT','Abc'])assert.ok(isUnclearName(name),name)
  for(const name of ['Labor','Einkauf','Neuigkeiten','Büro'])assert.ok(!isUnclearName(name),name)
})

test('Überfüllte Ordner: mehr als 150 Mails oder Kandidat aus E3, die vollsten zuerst',()=>{
  assert.equal(CROWDED_MAILS,150)
  const result=crowdedFolders(['A','B','C','D'],{A:150,B:151,C:20,D:400},[{folder:'C',outliers:8,total:20},{folder:'X',outliers:5,total:10}])
  assert.deepEqual(result.map(c=>c.folder),['D','B','C'])
  assert.deepEqual(result[2].outliers,{folder:'C',outliers:8,total:20})
})

test('Profilähnlichkeit: nur Paare mit Kosinus über 0,9',()=>{
  assert.equal(PROFILE_SIMILARITY,0.9)
  assert.equal(cosine([1,0],[1,0]),1);assert.equal(cosine([0,0],[1,0]),undefined);assert.equal(cosine([1],[1,0]),undefined)
  const at=(c:number)=>[c,Math.sqrt(1-c*c)]
  const pairs=similarProfiles({A:[1,0],B:at(0.95),C:[0.89,-Math.sqrt(1-0.89*0.89)],D:[0,1]})
  assert.deepEqual(pairs.map(p=>[p.a,p.b]),[['A','B']])
  assert.ok(Math.abs(pairs[0].score-0.95)<1e-9)
  // Genau auf der Schwelle zählt nicht („über“).
  assert.deepEqual(similarProfiles({A:[1,0],B:[2,0]},1),[])
})

test('Verwechslung: beide Richtungen zusammen über die Testmails beider Ordner, ab 20 %',()=>{
  assert.equal(CONFUSION_SHARE,0.2)
  const byFolder={A:{tested:10,shown:10,correct:7},B:{tested:10,shown:10,correct:9},C:{tested:10,shown:10,correct:8}}
  // A↔B: 3+1 von 20 = 20 % zählt, A↔C: 2+1 von 20 = 15 % nicht.
  const pairs=confusedPairs({byFolder,confusion:{A:{B:3},B:{A:1},C:{A:1,B:1}}})
  assert.deepEqual(pairs.map(p=>[p.a,p.b,p.score]),[['A','B',0.2]])
  assert.deepEqual(confusedPairs({byFolder}),[])
})

test('Überschneidungen: kleiner in größer, Richtung umkehrbar, nur aktuelle Lernordner, Verwechslung vor Profil',()=>{
  const counts={A:40,B:300,C:12,D:90}
  const report={byFolder:{A:{tested:10,shown:10,correct:5},B:{tested:10,shown:10,correct:10},C:{tested:10,shown:10,correct:10}},
    confusion:{A:{B:5},C:{Weg:9}}}
  const found=overlaps({folders:['A','B','C','D'],counts,vectors:{C:[1,0],D:[0.99,0.141],Weg:[1,0]},report})
  assert.deepEqual(found.map(o=>[o.source,o.target,o.mails]),[['A','B',40],['C','D',12]])
  assert.equal(found[0].confusion,0.25);assert.equal(found[0].similarity,undefined)
  assert.ok(found[1].similarity!>0.9)
  assert.equal(found[0].key,proposalKey('merge','B','A'))
  const back=reversed(found[0],counts)
  assert.deepEqual([back.source,back.target,back.mails,back.key],['B','A',300,found[0].key])
  // Ohne KI gibt es keine Profile: nur die Messung.
  assert.deepEqual(overlaps({folders:['A','B','C','D'],counts,vectors:{},report}).map(o=>o.key),[found[0].key])
})

const folders=[
  {id:'in',name:'Posteingang',path:'',isInbox:true,parentId:'root'},
  {id:'a',name:'Sonstiges',path:'/Sonstiges',parentId:'root'},
  {id:'b',name:'Labor',path:'/Labor',parentId:'root'},
  {id:'p',name:'Projekte',path:'/Projekte',parentId:'root'},
  {id:'q',name:'Alt',path:'/Projekte/Alt',parentId:'p'},
  {id:'z',name:MERGED_FOLDER,path:'/'+MERGED_FOLDER,parentId:'root'},
  {id:'z1',name:'Labor',path:'/'+MERGED_FOLDER+'/Labor',parentId:'z'},
  {id:'s',name:'Sub',path:'Sub',parentId:'in'},
]
test('Plan zum Zusammenlegen: Mails, Ablageordner, Ordner, Steckbrief, Ziele in dieser Reihenfolge',()=>{
  const plan=mergePlan(folders[1],folders[2],folders)
  assert.equal(plan.archived,'/_Zusammengelegt/Sonstiges')
  assert.deepEqual(plan.steps,[
    {kind:'mails',from:'a',to:'b'},
    {kind:'holder',parent:'root',name:MERGED_FOLDER,id:'z'},
    {kind:'folder',folder:'a',from:'root'},
    {kind:'profile',from:'/Sonstiges',to:'/_Zusammengelegt/Sonstiges'},
    {kind:'targets',from:'/Sonstiges',to:'/Labor'},
  ])
  // Unterordner des Posteingangs: Ablageordner wird neben dem Ordner angelegt.
  const inbox=mergePlan(folders[7],folders[2],folders)
  assert.equal(inbox.archived,'_Zusammengelegt/Sub')
  assert.deepEqual(inbox.steps[1],{kind:'holder',parent:'in',name:MERGED_FOLDER})
})

test('Plan zum Zusammenlegen lehnt ab: gleicher Ordner, Posteingang, Unterordner, _-Ordner, Namenskonflikt',()=>{
  assert.throws(()=>mergePlan(folders[1],folders[1],folders),/mit sich selbst/)
  assert.throws(()=>mergePlan(folders[0],folders[1],folders),/Posteingang/)
  assert.throws(()=>mergePlan(folders[3],folders[1],folders),/Unterordner/)
  assert.throws(()=>mergePlan(folders[6],folders[1],folders),/„_“/)
  assert.throws(()=>mergePlan(folders[2],folders[1],folders),/schon einen Ordner „Labor“/)
  assert.throws(()=>mergePlan({...folders[1],parentId:undefined},folders[2],folders),/unbekannt/)
})

test('Umschlüsselung: Ziele und Regeln auf den Zielordner, Rücknahme stellt den alten Stand her',()=>{
  assert.deepEqual(retarget(['/Sonstiges','/Labor','/IT'],'/Sonstiges','/Labor'),['/Labor','/IT'])
  assert.deepEqual(retarget(['/Sonstiges','/IT'],'/Sonstiges','/Labor'),['/Labor','/IT'])
  assert.deepEqual(restoreTargets(['/Labor','/IT'],'/Sonstiges','/Labor',{from:true,to:true}),['/Labor','/IT','/Sonstiges'])
  assert.deepEqual(restoreTargets(['/Labor','/IT'],'/Sonstiges','/Labor',{from:true,to:false}),['/IT','/Sonstiges'])
  assert.deepEqual(restoreTargets(['/IT'],'/Sonstiges','/Labor',{from:false,to:false}),['/IT'])
  const rules=[{match:'domain:a.de',folder:'/Sonstiges'},{match:'domain:b.de',folder:'/IT'},null]
  const moved=retargetRules(rules,'/Sonstiges','/Labor')
  assert.deepEqual(moved.changed,[0]);assert.deepEqual(moved.rules[0],{match:'domain:a.de',folder:'/Labor'})
  assert.deepEqual(restoreRules(moved.rules,moved.changed,'/Sonstiges','/Labor'),rules)
})

test('Lernbeispiele umhängen und gezielt zurückhängen',()=>{
  setAiLive(false);setAiLive(true)
  const map=new Map<string,string>([[LEGACY,'{}'],
    ['outlook-kanban-ai-training-v1',JSON.stringify({stamp:1,rows:[{folder:'A',id:'1',features:['w:x']},{folder:'B',id:'2',features:['w:y']}]})],
    ['outlook-kanban-filing-feedback-v1',JSON.stringify({rows:[{folder:'A',id:'3',features:['w:z']}]})]])
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v)}})
  const rows=(key:string)=>JSON.parse(map.get(key)!).rows.map((r:{folder:string;id:string})=>r.folder+r.id)
  const moved=relabelLearning('A','B')
  assert.equal(moved.length,2)
  assert.deepEqual(rows('outlook-kanban-ai-training-v1'),['B1','B2']);assert.deepEqual(rows('outlook-kanban-filing-feedback-v1'),['B3'])
  assert.equal(JSON.parse(map.get('outlook-kanban-ai-training-v1')!).stamp,1)
  relabelLearning('B','A',new Set(moved))
  assert.deepEqual(rows('outlook-kanban-ai-training-v1'),['A1','B2']);assert.deepEqual(rows('outlook-kanban-filing-feedback-v1'),['A3'])
})

test('Gespeicherte Messung: Verwechslungen werden geprüft, ältere Messungen bleiben gültig',()=>{
  const measurement=(confusion?:unknown)=>({version:1,measurements:{baseline:{date:'1.1.2026',samples:{A:20},note:'',
    report:{tested:10,byFolder:{},...(confusion===undefined?{}:{confusion})}}}})
  assert.equal(parseState(measurement()).measurements.baseline!.report.confusion,undefined)
  assert.deepEqual(parseState(measurement({A:{B:3,A:2,C:-1,D:1.5,E:'x'},F:'kaputt',G:{}})).measurements.baseline!.report.confusion,{A:{B:3}})
  assert.deepEqual(parseState(measurement('kaputt')).measurements.baseline!.report.confusion,{})
})
