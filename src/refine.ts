/**
 * Reine Logik für E4 „Struktur verfeinern“, ohne DOM und ohne Outlook: überfüllte Ordner, Überschneidungen, unklare Namen
 * und der Plan zum Zusammenlegen. Die Oberfläche steht in `setup-refine.ts`, die Ausführung mit Rückgängig in `projects.ts`.
 */
import type {EvaluationResult} from './ai'
import type {OutlierFolder} from './outliers'

/** Ab mehr als so vielen Mails gilt ein Lernordner als überfüllt. */
export const CROWDED_MAILS=150
/** Ordnerprofile mit einem Kosinus über diesem Wert gelten als Überschneidung. */
export const PROFILE_SIMILARITY=0.9
/** Ab diesem Anteil gegenseitiger Verwechslungen in der Messung gilt ein Ordnerpaar als Überschneidung. */
export const CONFUSION_SHARE=0.2
/** Hierhin wandert der leere Ordner nach dem Zusammenlegen, neben dem Ordner selbst (wie `_Abgeschlossen`). */
export const MERGED_FOLDER='_Zusammengelegt'
/** Namen, für die die KI einen klareren Namen vorschlägt. Dazu kommen Namen unter 4 Zeichen. */
export const UNCLEAR_NAMES=['Sonstiges','Diverses','Allgemein','Neuer Ordner','Neu','Verschiedenes','Misc']

const norm=(s:string)=>s.normalize('NFKC').trim().toLocaleLowerCase('de').replace(/ß/g,'ss')
/** Gleicher Ordnername ohne Rücksicht auf Groß- und Kleinschreibung (wie Outlook). */
export const sameName=(a:string,b:string)=>norm(a)===norm(b)
export function isUnclearName(name:string){
  const value=name.trim()
  return [...value].length<4||UNCLEAR_NAMES.some(n=>sameName(n,value))
}
/** Kennung eines Vorschlags für „Verwerfen“. Beim Zusammenlegen unabhängig von der Richtung. */
export function proposalKey(kind:'crowded'|'merge'|'rename',...folders:string[]){
  return kind+':'+JSON.stringify(kind==='merge'?[...folders].sort():folders)
}

export type Crowded={folder:string;mails?:number;outliers?:OutlierFolder}
/** Überfüllte Lernordner: mehr als 150 Mails oder Kandidat aus E3 (viele Ausreißer). Die vollsten zuerst. */
export function crowdedFolders(folders:readonly string[],counts:Record<string,number|undefined>,candidates:readonly OutlierFolder[]):Crowded[]{
  const marked=new Map(candidates.map(c=>[c.folder,c]))
  return folders.flatMap(folder=>{
    const mails=counts[folder],outliers=marked.get(folder)
    return (mails??0)>CROWDED_MAILS||outliers?[{folder,mails,outliers}]:[]
  }).sort((a,b)=>(b.mails??0)-(a.mails??0)||a.folder.localeCompare(b.folder,'de'))
}

export function cosine(a:readonly number[],b:readonly number[]):number|undefined{
  if(a.length!==b.length||!a.length)return undefined
  let dot=0,na=0,nb=0
  for(let i=0;i<a.length;i++){dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i]}
  const score=dot/Math.sqrt(na*nb)
  return Number.isFinite(score)?score:undefined
}
type Pair={a:string;b:string;score:number}
/** Ordnerpaare, deren Profile (Zentroiden) einen Kosinus über `threshold` haben. */
export function similarProfiles(vectors:Record<string,readonly number[]>,threshold=PROFILE_SIMILARITY):Pair[]{
  const keys=Object.keys(vectors).sort((a,b)=>a.localeCompare(b,'de')),pairs:Pair[]=[]
  for(const [i,a] of keys.entries())for(const b of keys.slice(i+1)){
    const score=cosine(vectors[a],vectors[b])
    if(score!==undefined&&score>threshold)pairs.push({a,b,score})
  }
  return pairs
}
/**
 * Ordnerpaare mit gegenseitiger Verwechslung in der Messung: Testmails von A, die als B vorgeschlagen wurden, und umgekehrt,
 * geteilt durch die Testmails beider Ordner. Paare ab `share` zählen. Messungen ohne `confusion` liefern nichts.
 */
export function confusedPairs(report:Pick<EvaluationResult,'byFolder'|'confusion'>,share=CONFUSION_SHARE):Pair[]{
  const confusion=report.confusion??{},pairs=new Map<string,Pair>()
  for(const [truth,guesses] of Object.entries(confusion))for(const guess of Object.keys(guesses)){
    const [a,b]=[truth,guess].sort((x,y)=>x.localeCompare(y,'de')),key=JSON.stringify([a,b])
    if(a===b||pairs.has(key))continue
    const tested=(report.byFolder[a]?.tested??0)+(report.byFolder[b]?.tested??0)
    const wrong=(confusion[a]?.[b]??0)+(confusion[b]?.[a]??0)
    if(tested>0&&wrong/tested>=share)pairs.set(key,{a,b,score:wrong/tested})
  }
  return [...pairs.values()]
}

/** Vorschlag „<source> in <target> zusammenlegen (<mails> Mails)“. */
export type Overlap={key:string;source:string;target:string;mails?:number;similarity?:number;confusion?:number}
/** Richtet einen Vorschlag aus: der kleinere Ordner in den größeren, bei Gleichstand nach Namen. */
export function orient(a:string,b:string,counts:Record<string,number|undefined>):Pick<Overlap,'source'|'target'|'mails'>{
  const na=counts[a]??0,nb=counts[b]??0
  const [source,target]=na<nb||(na===nb&&a.localeCompare(b,'de')>0)?[a,b]:[b,a]
  return {source,target,mails:counts[source]}
}
/** Kehrt die Richtung eines Vorschlags um. */
export function reversed(o:Overlap,counts:Record<string,number|undefined>):Overlap{
  return {...o,source:o.target,target:o.source,mails:counts[o.target]}
}
/**
 * Überschneidungen unter den Lernordnern `folders`: ähnliche Profile (Kosinus über 0,9) oder gegenseitige Verwechslung
 * ab 20 % in der Messung. Ohne Profile (ohne KI) bleibt nur die Messung. Die deutlichsten zuerst.
 */
export function overlaps(input:{folders:readonly string[];counts:Record<string,number|undefined>;vectors:Record<string,readonly number[]>;
  report?:Pick<EvaluationResult,'byFolder'|'confusion'>}):Overlap[]{
  const known=new Set(input.folders),found=new Map<string,Overlap>()
  const add=(pair:Pair,field:'similarity'|'confusion')=>{
    if(!known.has(pair.a)||!known.has(pair.b))return
    const key=proposalKey('merge',pair.a,pair.b)
    const item=found.get(key)??{key,...orient(pair.a,pair.b,input.counts)}
    item[field]=pair.score;found.set(key,item)
  }
  const vectors=Object.fromEntries(Object.entries(input.vectors).filter(([key])=>known.has(key)))
  for(const pair of similarProfiles(vectors))add(pair,'similarity')
  if(input.report)for(const pair of confusedPairs(input.report))add(pair,'confusion')
  return [...found.values()].sort((x,y)=>(y.confusion??0)-(x.confusion??0)||(y.similarity??0)-(x.similarity??0)||x.key.localeCompare(y.key,'de'))
}

export type PlanFolder={id:string;name:string;path:string;parentId?:string;isInbox?:boolean}
/**
 * Schritte beim Zusammenlegen in dieser Reihenfolge:
 * 1. `mails`: alle Mails von `from` nach `to` (Ordner-IDs), seitenweise,
 * 2. `holder`: `_Zusammengelegt` neben dem Quellordner, `id` wenn vorhanden, sonst anlegen,
 * 3. `folder`: den leeren Quellordner dorthin verschieben,
 * 4. `profile`: Steckbrief und Beschreibung vom bisherigen auf den neuen Pfad umschlüsseln (`rekeyProfile`),
 * 5. `targets`: Board- und Lernziele sowie Ablageregeln vom Quell- auf den Zielpfad umschreiben, Lernbeispiele umhängen.
 */
export type MergeStep=
  {kind:'mails';from:string;to:string}|
  {kind:'holder';parent:string;name:string;id?:string}|
  {kind:'folder';folder:string;from:string}|
  {kind:'profile';from:string;to:string}|
  {kind:'targets';from:string;to:string}
export type MergePlan={source:PlanFolder;target:PlanFolder;archived:string;steps:MergeStep[]}
const hidden=(path:string)=>path.split(/[\\/]/).some(part=>part.startsWith('_'))
/** Plan zum Zusammenlegen von `source` in `target`. Wirft mit verständlicher Meldung, wenn es nicht geht. Ändert nichts. */
export function mergePlan(source:PlanFolder,target:PlanFolder,folders:readonly PlanFolder[]):MergePlan{
  const name=(f:PlanFolder)=>'„'+(f.path||f.name)+'“'
  if(source.id===target.id)throw new Error('Ein Ordner lässt sich nicht mit sich selbst zusammenlegen.')
  if(source.isInbox||!source.path||target.isInbox||!target.path)throw new Error('Der Posteingang lässt sich nicht zusammenlegen.')
  if(hidden(source.path)||hidden(target.path))throw new Error('Ordner mit „_“ im Pfad lassen sich nicht zusammenlegen.')
  if(!source.parentId)throw new Error('Der übergeordnete Ordner von '+name(source)+' ist unbekannt. Bitte Outlook aktualisieren.')
  if(folders.some(f=>f.parentId===source.id))throw new Error(name(source)+' hat Unterordner. Verschiebe oder lege zuerst die Unterordner zusammen.')
  const holder=folders.find(f=>f.parentId===source.parentId&&f.name===MERGED_FOLDER)
  const prefix=source.path.endsWith(source.name)?source.path.slice(0,source.path.length-source.name.length):source.path.replace(/[^/]*$/,'')
  const archived=prefix+MERGED_FOLDER+'/'+source.name
  if(holder&&folders.some(f=>f.parentId===holder.id&&sameName(f.name,source.name)))
    throw new Error('In „'+(holder.path||holder.name)+'“ gibt es schon einen Ordner „'+source.name+'“. Benenne zuerst einen der beiden um.')
  return {source,target,archived,steps:[
    {kind:'mails',from:source.id,to:target.id},
    {kind:'holder',parent:source.parentId,name:MERGED_FOLDER,...(holder?{id:holder.id}:{})},
    {kind:'folder',folder:source.id,from:source.parentId},
    {kind:'profile',from:source.path,to:archived},
    {kind:'targets',from:source.path,to:target.path},
  ]}
}

/** Ersetzt `from` durch `to` in einer Ordnerliste, ohne Dubletten. */
export function retarget(list:readonly string[],from:string,to:string):string[]{
  return [...new Set(list.map(p=>p===from?to:p))]
}
/** Rücknahme von `retarget`: `from` wieder dazu, wenn es vorher drin war, `to` heraus, wenn es vorher fehlte. */
export function restoreTargets(list:readonly string[],from:string,to:string,before:{from:boolean;to:boolean}):string[]{
  const result=list.filter(p=>before.to||p!==to)
  return before.from&&!result.includes(from)?[...result,from]:result
}
type Rule={match?:unknown;folder?:unknown}
/** Ablageregeln von `from` auf `to` umschreiben. `changed` sind die Positionen für die Rücknahme. */
export function retargetRules(rules:readonly unknown[],from:string,to:string):{rules:unknown[];changed:number[]}{
  const changed:number[]=[]
  const next=rules.map((r,i)=>{
    if(!r||typeof r!=='object'||(r as Rule).folder!==from)return r
    changed.push(i);return {...r,folder:to}
  })
  return {rules:next,changed}
}
/** Rücknahme von `retargetRules` an den gemerkten Positionen, solange die Regel noch auf `to` zeigt. */
export function restoreRules(rules:readonly unknown[],changed:readonly number[],from:string,to:string):unknown[]{
  return rules.map((r,i)=>changed.includes(i)&&r&&typeof r==='object'&&(r as Rule).folder===to?{...r,folder:from}:r)
}
