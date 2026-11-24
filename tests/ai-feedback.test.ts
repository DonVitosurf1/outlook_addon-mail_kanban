import assert from 'node:assert/strict'
import test from 'node:test'
import { FEEDBACK, VOTES, NO_MODEL, changeDegree, countDraft, countFeedback, currentVote, editRatio, feedbackSummary, filingSource, oldestDay, useSampleFeedback, vote } from '../src/ai-feedback'
import { localDay } from '../src/views-logic'

function storage(){
  const map=new Map<string,string>()
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value)},
  }})
  useSampleFeedback(false)
  return map
}
const daysAgo=(n:number)=>{const d=new Date();d.setDate(d.getDate()-n);return localDay(d)}

test('Rückmeldungen: Zähler je Tag, Funktion und Modell, ohne Mailinhalte',()=>{
  const map=storage()
  countFeedback('ablage:Regel',NO_MODEL,'ok')
  countFeedback('ablage:Regel',NO_MODEL,'ok')
  countFeedback('ablage:Regel',NO_MODEL,'bad')
  countFeedback('aufgaben','qwen3:8b','ok',3)
  countFeedback('aufgaben','qwen3:8b','bad',1,daysAgo(3))
  const stored=JSON.parse(map.get(FEEDBACK)!)
  assert.deepEqual(stored[localDay()],{'ablage:Regel':{'-':{ok:2,bad:1}},aufgaben:{'qwen3:8b':{ok:3}}})
  assert.deepEqual(stored[daysAgo(3)],{aufgaben:{'qwen3:8b':{bad:1}}})
  assert.deepEqual(feedbackSummary(),{'ablage:Regel':{'-':{ok:2,bad:1}},aufgaben:{'qwen3:8b':{ok:3,bad:1}}})
  // Zurücknehmen fällt nicht unter null, leere Einträge verschwinden.
  countFeedback('aufgaben','qwen3:8b','bad',-5,daysAgo(3))
  assert.equal(JSON.parse(map.get(FEEDBACK)!)[daysAgo(3)],undefined)
})

test('Rückmeldungen: höchstens 90 Tage, ungültige Einträge werden verworfen',()=>{
  const map=storage()
  assert.equal(oldestDay('2026-03-01'),'2025-12-02')
  map.set(FEEDBACK,JSON.stringify({[daysAgo(90)]:{alt:{m:{ok:9}}},[daysAgo(89)]:{frist:{m:{ok:1,bad:-2,zahl:'x'}}},
    'kein-datum':{x:{m:{ok:1}}},[localDay()]:{zusammenfassung:{m:'kaputt',n:{bad:1.5}}}}))
  assert.deepEqual(feedbackSummary(),{frist:{m:{ok:1}}})
  countFeedback('frist','m','ok')
  const kept=Object.keys(JSON.parse(map.get(FEEDBACK)!)).sort()
  assert.deepEqual(kept,[daysAgo(89),localDay()])
  // Älter als 90 Tage wird gar nicht erst gezählt.
  countFeedback('frist','m','ok',1,daysAgo(120))
  assert.deepEqual(feedbackSummary(),{frist:{m:{ok:2}}})
})

test('Rückmeldungen: volle oder gesperrte Ablage ist kein Fehler',()=>{
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>{throw Error('gesperrt')},setItem:()=>{throw Error('voll')}}})
  useSampleFeedback(false)
  assert.equal(countFeedback('frist','m','ok'),false)
  assert.deepEqual(feedbackSummary(),{})
})

test('Beispielpostfach zählt nur im Speicher',()=>{
  const map=storage()
  useSampleFeedback(true)
  countFeedback('ablage:Begriff',NO_MODEL,'ok')
  vote('sig','summary','m','bad')
  assert.deepEqual(feedbackSummary(),{'ablage:Begriff':{'-':{ok:1}},zusammenfassung:{m:{bad:1}}})
  assert.equal(map.size,0)
  useSampleFeedback(false)
  assert.deepEqual(feedbackSummary(),{})
})

test('Änderungsgrad eines Antwortentwurfs: unverändert, leicht unter 20 %, sonst stark',()=>{
  const draft='Guten Tag, vielen Dank für Ihre Nachricht. Die Lieferung kommt am Freitag. Viele Grüße'
  assert.equal(editRatio(draft,draft),0)
  assert.equal(changeDegree(draft,'  '+draft.replace(/ /g,'\n')+' '),'unchanged')
  assert.equal(changeDegree(draft,draft.replace('Freitag','Montag')),'light')
  assert.equal(changeDegree(draft,'Hallo Anna, kommt Montag. Gruß'),'strong')
  assert.equal(changeDegree('',''),'unchanged')
  assert.equal(editRatio('a b c d e','a b c d'),0.2)
  assert.equal(changeDegree('a b c d e','a b c d'),'strong')
  storage()
  assert.equal(countDraft('entwurf:14b',draft,draft.replace('Freitag','Montag')),'light')
  countDraft('entwurf:14b',draft,'Ganz anders.')
  assert.deepEqual(feedbackSummary(),{antwortentwurf:{'entwurf:14b':{light:1,ok:1,strong:1,bad:1}}})
})

test('„passt / passt nicht“: eine Stimme je Mail und Feld, erneuter Klick nimmt sie zurück',()=>{
  const map=storage()
  assert.equal(vote('sig-1','summary','qwen3:8b','bad'),'bad')
  assert.equal(currentVote('sig-1','summary'),'bad')
  assert.deepEqual(feedbackSummary(),{zusammenfassung:{'qwen3:8b':{bad:1}}})
  assert.equal(vote('sig-1','summary','qwen3:8b','ok'),'ok')
  assert.deepEqual(feedbackSummary(),{zusammenfassung:{'qwen3:8b':{ok:1}}})
  assert.equal(vote('sig-1','summary','qwen3:8b','ok'),undefined)
  assert.equal(currentVote('sig-1','summary'),undefined)
  assert.deepEqual(feedbackSummary(),{})
  vote('sig-1','deadline','qwen3:8b','ok');vote('sig-2','deadline','qwen3:8b','ok');vote('sig-1','needsReply','qwen3:8b','bad')
  assert.deepEqual(feedbackSummary(),{frist:{'qwen3:8b':{ok:2}},antwort_noetig:{'qwen3:8b':{bad:1}}})
  // Der Merker hält nur Signatur, Feld, Tag und Modell, und höchstens 1.000 Stimmen.
  for(let i=0;i<1100;i++)vote('n'+i,'summary','m','ok')
  const memo=JSON.parse(map.get(VOTES)!)
  assert.equal(Object.keys(memo).length,1000)
  assert.deepEqual(Object.keys(memo['n1099|summary']).sort(),['d','m','v'])
  assert.equal(memo['sig-1|deadline'],undefined)
})

test('Quelle eines Ablagevorschlags aus dem Begründungstext',()=>{
  const cases:[string,string][]=[['Absender-Regel','Regel'],['Domain-Regel','Regel'],['Aus früheren Ablagen gelernt','Bayes'],
    ['Frühere Ablage dieser Unterhaltung','Bayes'],['Bereich aus früheren Ablagen','Bayes'],['Aus früheren Ablagen, ohne hohe Sicherheit','Bayes'],
    ['Bayes und Embeddings · Labor 0.91','Hybrid'],['Lokale Embeddings · Labor 0.91','Embedding'],['KI-Stichwahl · Messgerät','KI-Stichwahl'],
    ['Vorschlag der lokalen KI','KI'],['Begriff aus Ordnername oder Steckbrief · KI nicht verfügbar','Begriff'],['Begriff aus dem Beispielordner','Begriff'],['?','Sonstige']]
  for(const [reason,source] of cases)assert.equal(filingSource(reason),source,reason)
})
