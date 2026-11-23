import assert from 'node:assert/strict'
import test from 'node:test'
import { bayesModel, embeddingId, excludeFromLearning, recordFiling, setAiLive, trainFromFolders, withoutExcluded, type LearnRow } from '../src/ai'
import { BAYES_MARGIN, bayesOutliers, minimumMails, openOutliers, outlierFolders } from '../src/outliers'
import { LEGACY } from '../src/backup'

function storage(entries:Record<string,string>={}){
  setAiLive(false);setAiLive(true)
  const map=new Map<string,string>([[LEGACY,'{}'],...Object.entries(entries)])
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>map.set(key,value)
  }})
  return map
}
const row=(folder:string,id:string,features:string[]):LearnRow=>({folder,id,features})
const shop=(i:number)=>row('Einkauf','e'+i,['e:shop@lieferant.de','d:lieferant.de','n:lieferant','w:bestellung','w:pipetten'+i])
const lab=(i:number)=>row('Labor','l'+i,['e:anna@labor.de','d:labor.de','n:anna','w:probe','w:analyse'+i])

test('Bayes-Ausreißer: Lernbeispiel wird ausgelassen, ein fremder Ordner mit Abstand macht die Mail verdächtig',()=>{
  const stray=row('Einkauf','x',['e:anna@labor.de','d:labor.de','n:anna','w:probe','w:messung'])
  const rows=[...Array.from({length:6},(_,i)=>shop(i)),stray,...Array.from({length:5},(_,i)=>lab(i)),row('Labor','ohne-id',[])]
  const found=bayesOutliers(rows,BAYES_MARGIN)
  assert.equal(found.length,1)
  assert.deepEqual({...found[0],own:undefined,other:undefined},{id:'x',folder:'Einkauf',suggested:'Labor',own:undefined,other:undefined})
  assert.ok(found[0].other-found[0].own>=BAYES_MARGIN)
  // Ohne Auslassen zählt die Mail selbst für ihren Ordner.
  const model=bayesModel(rows)
  assert.ok(model(stray.features).probs.get('Einkauf')!>model(stray.features,stray).probs.get('Einkauf')!)
  assert.deepEqual(bayesOutliers(rows,1.01),[])
  // Mails ohne Kennung werden nie gemeldet.
  assert.deepEqual(bayesOutliers(rows.map(r=>({...r,id:undefined})),BAYES_MARGIN),[])
})

test('Bayes-Ausreißer: Ordner, die ohne die Mail unter das Bayes-Minimum fallen, werden nicht geprüft',()=>{
  const small=(n:number)=>Array.from({length:n},(_,i)=>row('Klein','k'+i,['e:team@klein.de','w:bestellung','w:sache'+i]))
  const shops=Array.from({length:6},(_,i)=>shop(i))
  assert.equal(minimumMails.Bayes,4)
  for(const n of [1,2,3]){
    const rows=[...shops,...small(n)]
    // Ohne Mindestgröße fiele der eigene Ordner beim Auslassen aus dem Ranking und jede Mail wäre verdächtig.
    assert.equal(bayesModel(rows)(rows.at(-1)!.features,rows.at(-1)).probs.get('Klein'),undefined)
    assert.deepEqual(bayesOutliers(rows,BAYES_MARGIN),[],'Ordner mit '+n+' Mails')
    assert.deepEqual(outlierFolders({Einkauf:6},bayesOutliers(rows,BAYES_MARGIN)),[])
  }
  // Ab vier Mails bleibt der eigene Ordner im Vergleich, passende Mails sind nicht verdächtig.
  assert.deepEqual(bayesOutliers([...shops,...small(4)],BAYES_MARGIN),[])
})

test('Bayes-Ausreißer: Unterhaltung im fremden Ordner zählt ohne die eigene Stimme',()=>{
  const reply=row('Einkauf','r',['c:thread','w:antwort'])
  const rows=[...Array.from({length:4},(_,i)=>shop(i)),reply,...[0,1,2].map(i=>({...lab(i),features:[...lab(i).features,'c:thread']}))]
  const [found]=bayesOutliers(rows,BAYES_MARGIN)
  assert.equal(found.suggested,'Labor');assert.equal(found.other,1);assert.equal(found.own,0)
})

test('Kennzahl: Ordner mit mehr als 25 % Ausreißern sind Kandidaten für E4',()=>{
  const o=(folder:string,id:string)=>({id,folder,suggested:'X',own:0.2,other:0.9})
  const outliers=[o('Einkauf','1'),o('Einkauf','2'),o('Labor','3'),o('Labor','4'),o('Klein','5')]
  assert.deepEqual(outlierFolders({Einkauf:8,Labor:6,Klein:1,Leer:0},outliers),[
    {folder:'Klein',outliers:1,total:1},{folder:'Labor',outliers:2,total:6}])
  assert.deepEqual(outlierFolders({Einkauf:8},outliers),[])
})

test('Offene Ausreißer: bestätigte fehlen, doppelte erscheinen einmal, deutlichste zuerst',()=>{
  const list=[{id:'a',folder:'A',suggested:'B',own:0.5,other:0.6},{id:'b',folder:'A',suggested:'B',own:0.2,other:0.9},
    {id:'b',folder:'A',suggested:'B',own:0.2,other:0.9},{id:'b',folder:'C',suggested:'B',own:0.3,other:0.9},{id:'c',folder:'A',suggested:'B',own:0,other:1}]
  assert.deepEqual(openOutliers(list,['c']).map(o=>o.id+o.folder),['bA','bC','aA'])
})

const mail=(folder:string,i:number)=>({id:folder+i,subject:'Bestellung '+i,sender:'Lieferant',senderEmail:'shop@'+folder+'.de',body:'Text '+i,received:'2026-10-0'+(i+1)+'T10:00:00'})
test('Nicht lernen: ausgeschlossene Mails fehlen in Lernbeispielen und Ordnerprofil, auch nach erneutem Lernen',async()=>{
  const map=storage({'outlook-kanban-ai-settings-v1':JSON.stringify({enabled:true,embeddings:true})})
  const samples=[0,1,2,3].map(i=>mail('A',i))
  const centroids:number[]=[]
  Object.defineProperty(globalThis,'window',{configurable:true,value:{__TAURI__:{core:{invoke:async(name:string,args:{samples:unknown[]})=>{
    if(name==='ai_centroid'){centroids.push(args.samples.length);return {vector:[1,0],index:{members:[],description:null}}}
    assert.equal(name,'outlook_training')
    return JSON.stringify(samples)
  }}}}})
  const folders=[{id:'A',name:'A',path:'A'}]
  assert.equal((await trainFromFolders(folders)).count,4)
  assert.equal(excludeFromLearning([samples[1]]),true)
  const rows=()=>JSON.parse(map.get('outlook-kanban-ai-training-v1')!).rows.map((r:{id:string})=>r.id)
  assert.deepEqual(rows(),['A0','A2','A3'])
  assert.deepEqual(JSON.parse(map.get('mailboard-learn-excluded-v1')!).ids,[embeddingId(samples[1])])
  assert.equal((await trainFromFolders(folders)).count,3)
  assert.deepEqual(rows(),['A0','A2','A3'])
  assert.deepEqual(centroids,[4,3])
  // Die Kennung hängt am Inhalt, nicht an der Outlook-ID: auch nach einem Verschieben bleibt die Mail ausgeschlossen.
  assert.deepEqual(withoutExcluded(samples.map(m=>({...m,id:'neu-'+m.id}))).map(m=>m.id),['neu-A0','neu-A2','neu-A3'])
  assert.equal(withoutExcluded(samples,new Set()).length,4)
  setAiLive(false)
  assert.equal(excludeFromLearning([samples[2]]),false)
  assert.deepEqual(JSON.parse(map.get('mailboard-learn-excluded-v1')!).ids,[embeddingId(samples[1])])
})

test('Verschieben hängt das Lernbeispiel in den neuen Ordner um',()=>{
  const map=storage({'outlook-kanban-ai-training-v1':JSON.stringify({rows:[row('Einkauf','m1',['w:probe']),row('Einkauf','m2',['w:bestellung'])],stamp:1})})
  recordFiling({...mail('x',1),id:'m1'},'Labor')
  const training=JSON.parse(map.get('outlook-kanban-ai-training-v1')!)
  assert.deepEqual(training.rows.map((r:LearnRow)=>r.id),['m2']);assert.equal(training.stamp,1)
  const feedback=JSON.parse(map.get('outlook-kanban-filing-feedback-v1')!).rows
  assert.deepEqual(feedback.map((r:LearnRow)=>[r.folder,r.id]),[['Labor','m1']])
})
