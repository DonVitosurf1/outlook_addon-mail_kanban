/**
 * B1 Rückmeldungen: Zähler je Tag, Funktion und Modell, wie gut die lokalen Vorschläge passen. Grundlage der späteren
 * Auswertung (B2). Gespeichert werden nur Zahlen, keine Mailinhalte und keine Mail-Kennungen.
 *
 * Format unter `mailboard-ai-feedback-v1`: `{[Tag JJJJ-MM-TT]:{[Funktion]:{[Modell]:{ok,bad,…}}}}`, höchstens 90 Tage.
 * `ok`/`bad` sind Treffer und Fehlgriffe. Antwortentwürfe zählen zusätzlich `unchanged`, `light` oder `strong`.
 * Die Stimmen „passt / passt nicht“ merkt sich `mailboard-ai-votes-v1` je Mail-Signatur und Feld (begrenzt), damit
 * jede Mail je Feld nur eine Stimme hat und sie umschaltbar bleibt.
 */
import {localDay} from './views-logic'

export const FEEDBACK='mailboard-ai-feedback-v1'
export const VOTES='mailboard-ai-votes-v1'
/** Abgewählte Aufgaben je Mail-Signatur, nur als Prüfsumme des Texts mit Tag, damit eine spätere Übernahme den Fehlgriff umbucht. */
export const SKIPPED_TASKS='mailboard-ai-skipped-tasks-v1'
/** Modellname für Vorschläge ohne Sprach- oder Embedding-Modell (Regeln, Bayes, Begriffe). */
export const NO_MODEL='-'
/** So viele Tage bleiben die Zähler erhalten. */
export const FEEDBACK_DAYS=90
const VOTE_LIMIT=1000
const OUTCOMES=['ok','bad','unchanged','light','strong'] as const
export type Outcome=typeof OUTCOMES[number]
export type Counts=Partial<Record<Outcome,number>>
type Store=Record<string,Record<string,Record<string,Counts>>>

/** Funktionsnamen der Zähler. Ablagevorschläge zählen je Quelle (`filingFunction`). */
export const FEEDBACK_FUNCTIONS={summary:'zusammenfassung',needsReply:'antwort_noetig',deadline:'frist',
  case:'vorgang',tasks:'aufgaben',draft:'antwortentwurf'} as const
/** Quelle eines Ablagevorschlags, abgeleitet aus seinem Begründungstext. */
export type FilingSource='Regel'|'Bayes'|'Hybrid'|'Embedding'|'KI-Stichwahl'|'KI'|'Begriff'|'Sonstige'
export function filingSource(reason:string):FilingSource{
  const head=reason.split(' · ')[0].trim()
  if(head==='Absender-Regel'||head==='Domain-Regel')return 'Regel'
  if(head.startsWith('Bayes und Embeddings'))return 'Hybrid'
  if(head==='Frühere Ablage dieser Unterhaltung'||/früheren Ablagen/.test(head))return 'Bayes'
  if(head==='Lokale Embeddings')return 'Embedding'
  if(head==='KI-Stichwahl')return 'KI-Stichwahl'
  if(head==='Vorschlag der lokalen KI')return 'KI'
  if(head.startsWith('Begriff aus'))return 'Begriff'
  return 'Sonstige'
}
export const filingFunction=(source:FilingSource)=>'ablage:'+source

// Im Beispielpostfach zählt das Board nur im Speicher, wie bei Einstellungen und Planung.
let sample:Map<string,string>|undefined
export function useSampleFeedback(enabled:boolean){
  if(enabled===!!sample)return
  sample=enabled?new Map():undefined
}
function read(key:string):unknown{
  try{return JSON.parse((sample?sample.get(key):localStorage.getItem(key))||'null')}catch{return null}
}
function write(key:string,value:unknown){
  try{
    const text=JSON.stringify(value)
    if(sample)sample.set(key,text);else localStorage.setItem(key,text)
    return true
  }catch{return false}
}
const isObject=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x)
const validDay=(day:string)=>/^\d{4}-\d{2}-\d{2}$/.test(day)
const name=(value:string,max:number)=>value.trim().slice(0,max)||NO_MODEL

function cleanCounts(raw:unknown):Counts|undefined{
  if(!isObject(raw))return
  const counts:Counts={}
  for(const key of OUTCOMES){const n=raw[key];if(typeof n==='number'&&Number.isInteger(n)&&n>0)counts[key]=n}
  return Object.keys(counts).length?counts:undefined
}
/** Liest den Speicher und lässt alles Ungültige weg. */
function load():Store{
  const raw=read(FEEDBACK),store:Store={}
  if(!isObject(raw))return store
  for(const [day,fns] of Object.entries(raw)){
    if(!validDay(day)||!isObject(fns))continue
    for(const [fn,models] of Object.entries(fns)){
      if(!isObject(models))continue
      for(const [model,counts] of Object.entries(models)){
        const clean=cleanCounts(counts)
        if(clean)((store[day]??={})[fn]??={})[model]=clean
      }
    }
  }
  return store
}
/** Ältester Tag, der noch zählt: heute und die 89 Tage davor. */
export function oldestDay(today=localDay()){
  const [y,m,d]=today.split('-').map(Number)
  return localDay(new Date(y,m-1,d-(FEEDBACK_DAYS-1)))
}
function prune(store:Store,today:string){
  const first=oldestDay(today)
  for(const day of Object.keys(store))if(day<first||day>today)delete store[day]
  return store
}

/**
 * Zählt `delta` (auch negativ, zum Zurücknehmen) für eine Funktion und ein Modell am Tag `day`. Zähler fallen nie unter null,
 * leere Einträge entfallen. Liefert falsch, wenn der Speicher voll oder gesperrt ist.
 */
export function countFeedback(fn:string,model:string,outcome:Outcome,delta=1,day=localDay()){
  if(!delta||!validDay(day))return true
  const today=localDay(),store=prune(load(),today)
  if(day<oldestDay(today)||day>today)return true
  const key=name(fn,60),who=name(model,120)
  const counts=((store[day]??={})[key]??={})[who]??={}
  const next=Math.max(0,(counts[outcome]??0)+Math.round(delta))
  if(next)counts[outcome]=next;else delete counts[outcome]
  if(!Object.keys(counts).length)delete store[day][key][who]
  if(!Object.keys(store[day][key]).length)delete store[day][key]
  if(!Object.keys(store[day]).length)delete store[day]
  return write(FEEDBACK,store)
}

/** Zusammenfassung über alle gespeicherten Tage: `{[Funktion]:{[Modell]:{ok,bad,…}}}`. Für Tests und die spätere Auswertung. */
export function feedbackSummary(){
  const summary:Record<string,Record<string,Counts>>={}
  for(const fns of Object.values(prune(load(),localDay())))
    for(const [fn,models] of Object.entries(fns))
      for(const [model,counts] of Object.entries(models)){
        const target=(summary[fn]??={})[model]??={}
        for(const [key,n] of Object.entries(counts) as [Outcome,number][])target[key]=(target[key]??0)+n
      }
  return summary
}

/** Wörter für den Vergleich: Leerraum zählt nicht, Groß- und Kleinschreibung schon. */
const tokens=(text:string)=>text.trim().split(/\s+/).filter(Boolean).slice(0,1000)
/** Normalisierte Wortdifferenz (Levenshtein über Wörter) zwischen 0 (gleich) und 1 (völlig anders). */
export function editRatio(original:string,edited:string){
  const a=tokens(original),b=tokens(edited)
  if(!a.length&&!b.length)return 0
  let previous=Array.from({length:b.length+1},(_,j)=>j)
  for(let i=1;i<=a.length;i++){
    const row=[i]
    for(let j=1;j<=b.length;j++)row[j]=Math.min(previous[j]+1,row[j-1]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1))
    previous=row
  }
  return previous[b.length]/Math.max(a.length,b.length)
}
/** Änderungsgrad eines Antwortentwurfs beim Öffnen in Outlook: unverändert, leicht (unter 20 %) oder stark. */
export function changeDegree(original:string,edited:string):'unchanged'|'light'|'strong'{
  const ratio=editRatio(original,edited)
  return ratio===0?'unchanged':ratio<0.2?'light':'strong'
}
/** Zählt einen geöffneten Antwortentwurf: unverändert und leicht geändert als Treffer, stark geändert als Fehlgriff. */
export function countDraft(model:string,original:string,edited:string){
  const degree=changeDegree(original,edited)
  countFeedback(FEEDBACK_FUNCTIONS.draft,model,degree)
  countFeedback(FEEDBACK_FUNCTIONS.draft,model,degree==='strong'?'bad':'ok')
  return degree
}

type SkippedEntry={m:string;h:Record<string,string>}
const SKIPPED_LIMIT=1000
function skippedTasks():Record<string,SkippedEntry>{
  const raw=read(SKIPPED_TASKS),result:Record<string,SkippedEntry>={}
  if(!isObject(raw))return result
  for(const [id,value] of Object.entries(raw)){
    if(!isObject(value)||typeof value.m!=='string'||!isObject(value.h))continue
    const h=Object.fromEntries(Object.entries(value.h).filter((e):e is [string,string]=>typeof e[1]==='string'&&validDay(e[1])))
    if(Object.keys(h).length)result[id]={m:value.m,h}
  }
  return result
}
function saveSkipped(all:Record<string,SkippedEntry>){
  const keys=Object.keys(all)
  for(const k of keys.slice(0,Math.max(0,keys.length-SKIPPED_LIMIT)))delete all[k]
  write(SKIPPED_TASKS,all)
}
/** Kurze Prüfsumme eines Aufgabentexts. Der Text selbst wird nicht gespeichert. */
function checksum(text:string){
  let hash=2166136261
  for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619)
  return (hash>>>0).toString(36)
}
/**
 * B1 Aufgaben beim Übernehmen: übernommene zählen als Treffer, abgewählte als Fehlgriff. Wird eine früher abgewählte Aufgabe
 * später doch übernommen, bucht das den Fehlgriff an seinem Tag in einen Treffer um, statt doppelt zu zählen.
 * `id` ist die Mail-Signatur. Liefert die Rücknahme für Rückgängig.
 */
export function countTasks(id:string,model:string,taken:readonly string[],skipped:readonly string[]){
  const fn=FEEDBACK_FUNCTIONS.tasks,today=localDay(),who=name(model,120)
  const all=skippedTasks(),entry=all[id]??{m:who,h:{}}
  const moved:[string,string][]=[],added:string[]=[]
  for(const text of taken){const h=checksum(text);if(entry.h[h]){moved.push([h,entry.h[h]]);delete entry.h[h]}}
  for(const text of skipped){const h=checksum(text);if(!entry.h[h]){entry.h[h]=today;added.push(h)}}
  countFeedback(fn,who,'ok',taken.length,today)
  for(const [,day] of moved)countFeedback(fn,entry.m,'bad',-1,day)
  countFeedback(fn,who,'bad',added.length,today)
  delete all[id]
  if(Object.keys(entry.h).length)all[id]=entry
  saveSkipped(all)
  return ()=>{
    countFeedback(fn,who,'ok',-taken.length,today)
    for(const [,day] of moved)countFeedback(fn,entry.m,'bad',1,day)
    countFeedback(fn,who,'bad',-added.length,today)
    const now=skippedTasks(),back=now[id]??{m:entry.m,h:{}}
    for(const [h,day] of moved)back.h[h]=day
    for(const h of added)delete back.h[h]
    delete now[id]
    if(Object.keys(back.h).length)now[id]=back
    saveSkipped(now)
  }
}

export type VoteField='summary'|'needsReply'|'deadline'
type Vote={v:'ok'|'bad';d:string;m:string}
function votes():Record<string,Vote>{
  const raw=read(VOTES),result:Record<string,Vote>={}
  if(!isObject(raw))return result
  for(const [key,value] of Object.entries(raw)){
    if(isObject(value)&&(value.v==='ok'||value.v==='bad')&&typeof value.d==='string'&&validDay(value.d)&&typeof value.m==='string')result[key]={v:value.v,d:value.d,m:value.m}
  }
  return result
}
const voteKey=(id:string,field:VoteField)=>id+'|'+field
/** Bisherige Stimme dieser Mail für ein Feld. */
export function currentVote(id:string,field:VoteField):'ok'|'bad'|undefined{return id?votes()[voteKey(id,field)]?.v:undefined}
/**
 * „passt“ oder „passt nicht“ für ein Feld einer Mail. Dieselbe Stimme noch einmal nimmt sie zurück, die andere ersetzt sie.
 * `id` ist die Mail-Signatur (`embeddingId`). Liefert die neue Stimme.
 */
export function vote(id:string,field:VoteField,model:string,value:'ok'|'bad'):'ok'|'bad'|undefined{
  if(!id)return
  const all=votes(),key=voteKey(id,field),old=all[key]
  delete all[key]
  const entry:Vote|undefined=old?.v===value?undefined:{v:value,d:localDay(),m:name(model,120)}
  if(entry)all[key]=entry
  const keys=Object.keys(all)
  for(const k of keys.slice(0,Math.max(0,keys.length-VOTE_LIMIT)))delete all[k]
  // Erst den Merker schreiben: Scheitert das, bleiben Stimme und Zähler unverändert und passen zueinander.
  if(!write(VOTES,all))return old?.v
  if(old)countFeedback(FEEDBACK_FUNCTIONS[field],old.m,old.v,-1,old.d)
  if(entry)countFeedback(FEEDBACK_FUNCTIONS[field],entry.m,value)
  return entry?.v
}
