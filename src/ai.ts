import { getLegacyConfig, getLegacyProfiles, getLegacyFile, updateConfig } from './data-settings'
import type { Folder, Invoke } from './live'
import { openTasks, type Task } from './tasks-taken'
import { formatModelInfo } from './model-info'
import { localDay } from './views-logic'
import { NO_MODEL, countDraft, countFeedback, currentVote, filingFunction, filingSource, vote, type VoteField } from './ai-feedback'
import { addressForm, formOf, styleKey, styleText, type SentSample, type StyleCard } from './style'

export type AiMail = {subject:string; sender:string; body:string; senderEmail?:string; conversationId?:string; received?:string;id?:string;storeId?:string;folder?:string;folderId?:string;folderPath?:string;tags?:string[];attachments?:string[];needsReply?:boolean;deadline?:string;aiSummary?:string;aiTypes?:string[];aiTasks?:Task[]}
export type EarlierMessage = {direction:'eingegangen'|'gesendet'|string; text:string}
/**
 * `model`: Modell, von dem der Vorschlag stammt (für die Rückmeldungen B1), fehlt bei Regeln, Bayes und Begriffen.
 * `passive`: nur angezeigt (Kartenhinweis, sicherer Stapel), nicht ausdrücklich angefordert. Zählt für B1, nicht für die Quellenstatistik.
 */
export type Suggestion = {folder:string;reason:string;model?:string;passive?:boolean}
type FolderInfo = {key:string;profile:string}
/** `modell`: Hintergrundmodell der Analyse, fehlt bei älteren gespeicherten Analysen. */
type Analysis = {zusammenfassung:string;antwort_noetig:boolean;frist:string|null;ordner:string|null;arten:string[];aufgaben?:Task[];modell?:string}
/** `model`: Modell für Hintergrund (Analyse, Stichwahl, Aufgaben). `draftModel`: Modell für Entwürfe, leer = wie `model`. */
type Config = {enabled:boolean;auto:boolean;autoLearn:boolean;embeddings:boolean;context:boolean;url:string;embedUrl:string;model:string;draftModel:string;embedModel:string}
const settingsKey='outlook-kanban-ai-settings-v1'
const feedbackKey='outlook-kanban-filing-feedback-v1'
const stop=new Set('und der die das für mit von den dem des ein eine einer auf aus bei ihre ihr ist zur zum the and for your you with from bitte info anfrage rückfrage frage'.split(' '))

let mailboxMode:'offline'|'demo'|'outlook'='offline'
let liveSource=false
let sourceEpoch=0
let refreshAiPanel:(()=>void)|undefined
function current(epoch:number){return liveSource&&epoch===sourceEpoch}
function requireLive(epoch=sourceEpoch){
  if(!current(epoch))throw new Error('Für diesen Vorgang bitte das Outlook-Postfach öffnen.')
}
export function setAiLive(live:boolean,mode:'offline'|'demo'|'outlook'=live?'outlook':'offline'){
  if(mode===mailboxMode&&live===liveSource)return
  mailboxMode=mode;liveSource=live;sourceEpoch++
  if(typeof window!=='undefined')window.clearTimeout?.(learnTimer)
  training=undefined;processing=false;embedding=false;embedded.clear();embedFailures=0;embedRetryAt=0;retryAt=0;retryDelay=120000;lastTraining='';queueStatus=''
  recent=undefined;legacyCache=undefined;importedCache.clear();runoffs.clear();passiveHints.clear()
  refreshAiPanel?.()
  if(typeof document!=='undefined')document.dispatchEvent?.(new Event('mailboard:source-changed'))
}

function object(x:unknown): Record<string,unknown> {
  return x && typeof x==='object' && !Array.isArray(x)? x as Record<string,unknown> : {}
}
function stored(key:string):Record<string,unknown> {
  try{return object(JSON.parse(localStorage.getItem(key)||'{}'))}catch{return {}}
}
function config(): Config {
  const old=object(getLegacyConfig()), own=stored(settingsKey)
  return {
    enabled:(own.enabled??old.llm_enabled)===true, auto:own.auto===true, autoLearn:own.autoLearn===true, embeddings:(own.embeddings??old.embeddings_enabled)===true,
    context:own.context!==false,
    url:String(own.url||old.llm_url||'http://127.0.0.1:11434'),
    embedUrl:String(own.embedUrl||old.embedding_url||own.url||old.llm_url||'http://127.0.0.1:11434'),
    model:String(own.model??old.llm_model??''), draftModel:typeof own.draftModel==='string'?own.draftModel:'', embedModel:String(own.embedModel||old.embedding_model||'qwen3-embedding:0.6b'),
  }
}
function native():Invoke {
  const epoch=sourceEpoch
  requireLive(epoch)
  const bridge=window.__TAURI__?.core
  if(!bridge) throw new Error('Für Ollama bitte die Desktop-App öffnen.')
  const invoke=bridge.invoke as Invoke
  return async<T>(command:string,args?:Record<string,unknown>)=>{
    requireLive(epoch)
    const result=await invoke<T>(command,args)
    requireLive(epoch)
    return result
  }
}
function words(s:string) {
  return [...new Set(s.toLocaleLowerCase('de').match(/[\p{L}][\p{L}\p{N}-]{2,}/gu)||[])].filter(w=>!stop.has(w))
}
export function features(m:AiMail):string[] {
  const tokens=words(m.subject).map(w=>'w:'+w)
  if(m.sender)tokens.push('n:'+m.sender.trim().toLocaleLowerCase('de'))
  if(m.senderEmail){
    const email=m.senderEmail.trim().toLowerCase()
    tokens.push('e:'+email);if(email.includes('@'))tokens.push('d:'+email.split('@').pop())
  }
  if(m.conversationId)tokens.push('c:'+m.conversationId)
  return tokens
}
function allowed(key:string) {
  return !!key.trim() && !key.split(/[\\/]/).some(s=>s.startsWith('_'))
}
function folderInfo(folders:string[]):FolderInfo[] {
  const old=object(getLegacyConfig())
  const descriptions=object(old.folder_descriptions)
  const profiles:Record<string,string>=getLegacyProfiles()
  return [...new Set(folders)].filter(allowed).map(key=>{
    const alternate=key.startsWith('/')?key.slice(1):'/'+key
    const md=profiles[key]||profiles[alternate]||''
    const section=(name:string)=>md.split('## '+name)[1]?.split(/\n## |\n# /)[0].trim()||''
    const profile=md ? [section('Zweck'),section('Stichworte'),section('Passt hierher'),section('Passt nicht hierher') && 'Nicht: '+section('Passt nicht hierher')].filter(Boolean).join(' · ') : String(descriptions[key]||descriptions[alternate]||'')
    return {key,profile}
  })
}
function rules():unknown[] {
  const configured=stored('outlook-kanban-ai-rules-v1').items ?? getLegacyConfig().filing_rules
  return Array.isArray(configured)?configured:[]
}
function rule(mail:AiMail,folders:FolderInfo[]):Suggestion|undefined {
  return ruleForSender(mail.senderEmail||mail.sender,folders,rules())
}
function ruleForSender(address:string,folders:FolderInfo[],rulesList:unknown[]):Suggestion|undefined {
  const sender=address.trim().toLowerCase()
  if(!sender.includes('@'))return
  const domain=sender.split('@').pop()
  for(const kind of ['sender','domain']){
    for(const entry of rulesList){
      const r=object(entry)
      const raw=String(r.match||'').trim().toLowerCase()
      const k=raw.startsWith('sender:')?'sender':raw.startsWith('domain:')?'domain':raw.includes('@')?'sender':'domain'
      const val=raw.replace(/^(sender:|domain:)/,'').trim().replace(/^@/,'')
      if(k!==kind || val!==(k==='sender'?sender:domain))continue
      const folder=folders.find(f=>f.key===r.folder)
      if(folder)return {folder:folder.key,reason:k==='sender'?'Absender-Regel':'Domain-Regel'}
    }
  }
}
export type LearnRow = { folder:string; features:string[]; id?:string; received?:string }
const trainingKey='outlook-kanban-ai-training-v1'
const statisticsKey='outlook-kanban-ai-statistics-v1'
const sourceHints = new WeakMap<AiMail,Suggestion>()
/**
 * Passive Hinweise aus `trustedFolderBatch` je Inhalts-Signatur. Stapel und Aufräumen verschieben Kopien der Mails,
 * deshalb genügt die Objekt-Zuordnung nicht. Nur im Speicher, begrenzt, ohne Mailinhalte.
 */
const passiveHints=new Map<string,Suggestion>()
const PASSIVE_LIMIT=5000
function hintFor(mail:AiMail){return sourceHints.get(mail)??passiveHints.get(embeddingId(mail))}
function keepPassive(mail:AiMail,hint:Suggestion){
  const id=embeddingId(mail)
  passiveHints.delete(id);passiveHints.set(id,{...hint,passive:true})
  if(passiveHints.size>PASSIVE_LIMIT)passiveHints.delete(passiveHints.keys().next().value!)
}
function legacyId(m:AiMail){
  const stamp=(m.received||'').slice(0,19).replace(/[^0-9]/g,'')
  return stamp.length===14?[(m.senderEmail||m.sender).toLowerCase(),m.subject,stamp].join('|'):''
}
const feedbackId=(m:AiMail)=>legacyId(m)||(m.id ? JSON.stringify([m.storeId??'',m.id]) : '')
function history(key=feedbackKey):LearnRow[] {
  const rows=stored(key).rows
  return Array.isArray(rows)?rows.filter(r=> r && typeof r.folder==='string'&&Array.isArray(r.features)&&r.features.every((v:unknown)=>typeof v==='string')):[]
}
type Counts={correct:number;wrong:number}
function sourceStats():Record<string,Counts>{
  const raw=object(stored(statisticsKey).sources)
  return Object.fromEntries(Object.entries(raw).map(([name,v])=>[name,{correct:Number(object(v).correct)||0,wrong:Number(object(v).wrong)||0}]))
}
function rate(reason:string, correct:boolean) {
  const stats=stored(statisticsKey),sources=sourceStats()
  reason=reason.split(' · ')[0]
  const counts=sources[reason]||{correct:0,wrong:0}
  counts[correct?'correct':'wrong']++
  sources[reason]=counts
  localStorage.setItem(statisticsKey,JSON.stringify({...stats,sources}))
}
function rejected(mail:AiMail):string[] {
  const native=object(stored(statisticsKey).rejected)[feedbackId(mail)]
  const value=native??object(imported('vorschlag-statistik.json').rejected)[legacyId(mail)]
  return Array.isArray(value)?value.filter(v=>typeof v==='string'):[]
}
/** Rücknahme einer Rückmeldung, wenn der zugehörige Schritt rückgängig gemacht wird. */
export type FeedbackRevert=()=>void
/**
 * B1: Rückmeldung zum Ablagevorschlag dieser Mail. `filed`: abgelegt nach `folder` (Treffer, wenn es der Vorschlag war, sonst
 * Fehlgriff), `rejected`: „Unpassend“ für `folder`. Die Quellenstatistik zählt nur ausdrücklich angeforderte Vorschläge, und nur
 * mit Outlook. Liefert die Rücknahme für Rückgängig, die auch den Hinweis wiederherstellt.
 */
function settleHint(mail:AiMail,folder:string,mode:'filed'|'rejected'):FeedbackRevert|undefined{
  const hint=hintFor(mail)
  if(!hint?.folder||(mode==='rejected'&&hint.folder!==folder))return
  const ok=mode==='filed'&&hint.folder===folder
  const fn=filingFunction(filingSource(hint.reason)),model=hint.model?.trim()||NO_MODEL,outcome=ok?'ok':'bad' as const,day=localDay()
  countFeedback(fn,model,outcome,1,day)
  if(liveSource&&!hint.passive)try{rate(hint.reason,ok)}catch{ /* Die Quellenstatistik ist nur eine Bequemlichkeit. */ }
  sourceHints.delete(mail);passiveHints.delete(embeddingId(mail))
  return ()=>{
    countFeedback(fn,model,outcome,-1,day)
    if(hint.passive)keepPassive(mail,hint);else sourceHints.set(mail,hint)
  }
}
export function rejectSuggestion(mail:AiMail, folder:string) {
  if(!liveSource){settleHint(mail,folder,'rejected');return}
  const id=feedbackId(mail)
  if(!id||!allowed(folder)||rejected(mail).includes(folder))return
  const stats=stored(statisticsKey)
  const mapping=object(stats.rejected)
  delete mapping[id]
  mapping[id]=[...rejected(mail),folder]
  localStorage.setItem(statisticsKey,JSON.stringify({...stats,rejected:Object.fromEntries(Object.entries(mapping).slice(-500))}))
  settleHint(mail,folder,'rejected')
}
/** Merkt eine Ablage als Lernbeispiel und zählt die Rückmeldung zum Vorschlag. Liefert deren Rücknahme für Rückgängig. */
export function recordFiling(mail:AiMail,folder:string):FeedbackRevert|undefined {
  if(!liveSource)return settleHint(mail,folder,'filed')
  if(!allowed(folder))return
  const rows=history()
  rows.push({folder,features:features(mail),id:mail.id,received:mail.received})
  // Outlook has already committed the move when this callback runs.
  try{
    localStorage.setItem(feedbackKey,JSON.stringify({rows:rows.slice(-3000)}))
    // Lernbeispiel umhängen: Ein Lernbeispiel derselben Mail aus dem bisherigen Ordner zählt nicht mehr.
    if(mail.id)dropTrainingRows(r=>r.id===mail.id&&r.folder!==folder)
  }catch{ /* Local statistics are best effort if WebView storage is full. */ }
  return settleHint(mail,folder,'filed')
}
function dropTrainingRows(drop:(row:LearnRow)=>boolean){
  const state=stored(trainingKey),rows=history(trainingKey),kept=rows.filter(r=>!drop(r))
  if(kept.length!==rows.length)localStorage.setItem(trainingKey,JSON.stringify({...state,rows:kept}))
}
const rowKey=(r:LearnRow)=>JSON.stringify([r.id??'',r.received??'',r.features])
/**
 * Hängt die gespeicherten Lernbeispiele (Lernlauf und Ablagen) von Ordner `from` an Ordner `to` um, etwa beim Zusammenlegen (E4).
 * Mit `only` nur die Beispiele mit diesen Kennungen. Liefert die Kennungen der umgehängten Beispiele für die Rücknahme.
 */
export function relabelLearning(from:string,to:string,only?:ReadonlySet<string>):string[]{
  const moved:string[]=[]
  if(!from||!to||from===to)return moved
  for(const key of [trainingKey,feedbackKey]){
    const state=stored(key),rows=history(key)
    let changed=false
    const next=rows.map(r=>{
      if(r.folder!==from||(only&&!only.has(rowKey(r))))return r
      changed=true;moved.push(rowKey(r));return {...r,folder:to}
    })
    try{if(changed)localStorage.setItem(key,JSON.stringify({...state,rows:next}))}catch{ /* Lernbeispiele sind nur ein Zwischenstand, E6 lernt neu. */ }
  }
  return moved
}
const excludedKey='mailboard-learn-excluded-v1'
/** Kennungen (`embeddingId`) der Mails, die nach „Nicht lernen“ (E3) kein Lernbeispiel und kein Teil eines Ordnerprofils mehr sind. */
export function learnExcluded():Set<string>{
  const ids=stored(excludedKey).ids
  return new Set(Array.isArray(ids)?ids.filter((id):id is string=>typeof id==='string'):[])
}
/** Lässt ausgeschlossene Mails weg. Gilt für die Lernbeispiele (`learnFolders`) und das Ordnerprofil (`trainCenter`). */
export function withoutExcluded<T extends AiMail>(mails:T[],excluded:ReadonlySet<string>=learnExcluded()):T[]{
  return excluded.size?mails.filter(m=>!excluded.has(embeddingId(m))):mails
}
/** „Nicht lernen“: merkt die Mails unter `mailboard-learn-excluded-v1` und entfernt ihre gespeicherten Lernbeispiele sofort. Falsch ohne Outlook oder Speicher. */
export function excludeFromLearning(list:AiMail[]):boolean{
  if(!liveSource)return false
  if(!list.length)return true
  try{
    const ids=[...new Set([...learnExcluded(),...list.map(embeddingId)])].slice(-5000)
    localStorage.setItem(excludedKey,JSON.stringify({ids}))
    const drop=new Set(list.flatMap(m=>m.id?[m.id]:[]))
    dropTrainingRows(r=>!!r.id&&drop.has(r.id))
    const feedback=history()
    if(feedback.some(r=>r.id&&drop.has(r.id)))localStorage.setItem(feedbackKey,JSON.stringify({rows:feedback.filter(r=>!(r.id&&drop.has(r.id)))}))
    return true
  }catch{return false}
}
/** Mindestzahl an Lernbeispielen, ab der Bayes einen Ordner vorschlägt. */
export const BAYES_MIN_DOCS=3
const weight=(token:string)=>token.startsWith('c:')?4:token.startsWith('e:')?2:1
/** Bayes-Ergebnis: `best` ist der Vorschlag nach den bisherigen Regeln, `probs` die Wahrscheinlichkeit je Ordner (bei Unterhaltungen der Stimmenanteil). */
export type BayesVerdict={best?:Suggestion;probs:Map<string,number>}
/**
 * Multinomial Bayes over sender and subject, with the reference's minimum support and certainty.
 * `without` lässt ein Lernbeispiel des Modells aus (Leave-one-out für die Ausreißerprüfung), ohne neu zu trainieren.
 */
export function bayesModel(rows:LearnRow[]) {
  const vocab=new Map<string,number>()
  const groups=new Map<string,{docs:number;total:number;counts:Map<string,number>}>()
  const conversations=new Map<string,Map<string,number>>()
  for(const row of rows){
    const group=groups.get(row.folder)??{docs:0,total:0,counts:new Map<string,number>()}
    group.docs++;groups.set(row.folder,group)
    for(const token of row.features){
      vocab.set(token,(vocab.get(token)||0)+1)
      const w=weight(token);group.total+=w
      group.counts.set(token,(group.counts.get(token)||0)+w)
      if(token.startsWith('c:')){
        const votes=conversations.get(token)??new Map<string,number>()
        votes.set(row.folder,(votes.get(row.folder)||0)+1);conversations.set(token,votes)
      }
    }
  }
  return (feat:string[],without?:LearnRow):BayesVerdict=>{
    const own=new Map<string,number>()
    for(const token of without?.features??[])own.set(token,(own.get(token)||0)+1)
    const left=(token:string)=>(vocab.get(token)||0)-(own.get(token)||0)
    const conv=feat.find(t=>t.startsWith('c:'))
    const votes=new Map(conversations.get(conv||''))
    if(without&&conv&&own.has(conv))votes.set(without.folder,(votes.get(without.folder)||0)-own.get(conv)!)
    const matches=[...votes].filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1])
    if(matches.length && matches[0][1]>=3*(matches[1]?.[1]||0)){
      const total=matches.reduce((n,[,v])=>n+v,0)
      return {best:{folder:matches[0][0],reason:'Frühere Ablage dieser Unterhaltung'},probs:new Map(matches.map(([f,v])=>[f,v/total]))}
    }
    const known=feat.filter(t=>left(t)>0)
    if(!known.length||known.every(t=>t.startsWith('w:'))&&known.length<2)return {probs:new Map()}
    const size=vocab.size-[...own.keys()].filter(t=>left(t)<=0).length
    const ranked=[...groups.entries()].map(([folder,g])=>{
      const mine=without?.folder===folder
      const docs=mine?g.docs-1:g.docs
      const total=mine?g.total-without.features.reduce((n,t)=>n+weight(t),0):g.total
      const count=(t:string)=>(g.counts.get(t)||0)-(mine?weight(t)*(own.get(t)||0):0)
      return {folder,docs,score:Math.log(docs)+known.reduce((n,t)=>n+weight(t)*Math.log((count(t)+1)/(size+total)),0)}
    }).filter(g=>g.docs>=BAYES_MIN_DOCS).sort((a,b)=>b.score-a.score)
    if(!ranked.length)return {probs:new Map()}
    const best=ranked[0],sum=ranked.reduce((n,r)=>n+Math.exp(r.score-best.score),0)
    const probs=new Map(ranked.map(r=>[r.folder,Math.exp(r.score-best.score)/sum]))
    return {best:probs.get(best.folder)!>=0.85?{folder:best.folder,reason:'Aus früheren Ablagen gelernt'}:undefined,probs}
  }
}
function classifier(rows:LearnRow[]) {
  const model=bayesModel(rows)
  return (feat:string[]):Suggestion|undefined=>model(feat).best
}
function area(key:string){
  const first=key.replace(/\\/g,'/').split('/').filter(Boolean)[0]||''
  return first && key.startsWith('/')?'/'+first:first
}
function learned(mail:AiMail,targets:FolderInfo[],allowArea=true) {
  const valid=new Set(targets.map(f=>f.key)), feat=features(mail)
  const rows=[...history(trainingKey),...history()].filter(r=>valid.has(r.folder))
  const result=classifier(rows)(feat)
  if(result||!allowArea)return result
  const parent=classifier(rows.map(r=>({...r,folder:area(r.folder)})))(feat)
  if(parent && valid.has(parent.folder))return {folder:parent.folder,reason:'Bereich aus früheren Ablagen'}
}
/** Evaluate the training-set baseline with latest ten samples held out per eligible folder. */
function splitHoldout(rows:LearnRow[]){
  const groups=new Map<string,LearnRow[]>()
  for(const r of rows){const g=groups.get(r.folder)||[];g.push(r);groups.set(r.folder,g)}
  const test:LearnRow[]=[],train:LearnRow[]=[]
  for(const samples of groups.values()){
    samples.sort((a,b)=>(b.received||'').localeCompare(a.received||''))
    const n=samples.length>=13?10:0
    test.push(...samples.slice(0,n));train.push(...samples.slice(n))
  }
  return {train,test}
}
export function holdout(rows:LearnRow[]){
  const {train,test}=splitHoldout(rows)
  const predict=classifier(train)
  let shown=0,correct=0
  for(const sample of test){const guess=predict(sample.features);if(guess){shown++;if(guess.folder===sample.folder)correct++}}
  return {tested:test.length,shown,correct}
}
type Tally={shown:number;correct:number}
type Source='Regel'|'Bayes'|'Hybrid'|'Embedding'
type Prediction={truth:string;id:string;folder:string;gap:number}
type SemanticEvaluation={tested:number;missing:number;profiled:Tally;plain:Tally;predictions:Prediction[]}
/**
 * `byFolder` zählt das Gesamtergebnis je Ordner der zurückgehaltenen Mails (`tested` = Testmails des Ordners).
 * `confusion` zählt falsche Gesamtvorschläge als `confusion[richtiger Ordner][vorgeschlagener Ordner]`, Grundlage für
 * Überschneidungen in E4. Ältere gespeicherte Messungen haben das Feld nicht.
 */
export type EvaluationResult={tested:number;folders:number;combined:Tally;bayes:Tally;rule:Tally;sources:Partial<Record<Source,Tally>>;
  embedding:Tally|null;plain:Tally|null;semanticTested:number;missing:number;byFolder:Record<string,Tally&{tested:number}>;
  confusion?:Record<string,Record<string,number>>}
const tally=():Tally=>({shown:0,correct:0})
function count(target:Tally,guess:string|undefined,truth:string){
  if(!guess)return
  target.shown++
  if(guess===truth)target.correct++
}
function combineForecast(bayes:string|undefined,semantic:Prediction|undefined):{folder:string;source:Source}|undefined{
  if(semantic){
    if(semantic.folder===bayes)return {folder:bayes,source:'Hybrid'}
    if(!bayes||semantic.gap>=0.08)return {folder:semantic.folder,source:'Embedding'}
  }
  if(bayes)return {folder:bayes,source:'Bayes'}
}
export function evaluateHoldout(rows:LearnRow[],targets:string[],configuredRules:unknown[],hidden:string[],semantics?:SemanticEvaluation):EvaluationResult {
  const valid=new Set(targets)
  const {train,test}=splitHoldout(rows.filter(r=>valid.has(r.folder)))
  const predict=classifier(train),destinations=targets.map(key=>({key,profile:''}))
  const evidence=new Map(semantics?.predictions.map(p=>[JSON.stringify([p.truth,p.id]),p]))
  const result:EvaluationResult={tested:test.length,folders:new Set(test.map(r=>r.folder)).size,
    combined:tally(),bayes:tally(),rule:tally(),sources:{},embedding:semantics?.profiled??null,plain:semantics?.plain??null,
    semanticTested:semantics?.tested??0,missing:semantics?.missing??0,byFolder:{},confusion:{}}
  for(const row of test){
    const own=result.byFolder[row.folder]??={tested:0,...tally()}
    own.tested++
    const bayes=predict(row.features)?.folder, sender=row.features.find(f=>f.startsWith('e:'))?.slice(2)||''
    count(result.bayes,bayes,row.folder)
    const rule=hidden.includes('Regel')?undefined:ruleForSender(sender,destinations,configuredRules)?.folder
    count(result.rule,rule,row.folder)
    const hit=row.id?evidence.get(JSON.stringify([row.folder,row.id])):undefined
    const sem=hit&&valid.has(hit.folder)?hit:undefined
    const final=rule?{folder:rule,source:'Regel' as const}:combineForecast(bayes,sem)
    if(!final||hidden.includes(final.source))continue
    count(result.combined,final.folder,row.folder)
    count(own,final.folder,row.folder)
    if(final.folder!==row.folder){const wrong=result.confusion![row.folder]??={};wrong[final.folder]=(wrong[final.folder]||0)+1}
    count(result.sources[final.source]??=tally(),final.folder,row.folder)
  }
  return result
}
export function renderEvaluation(parent:HTMLElement,result:EvaluationResult){
  const table=document.createElement('table'),caption=document.createElement('caption')
  table.className='ai-evaluation'
  caption.textContent='Ablage-Testlauf · '+result.tested+' zurückgehaltene Mails aus '+result.folders+' Ordnern'
  table.append(caption)
  const head=table.createTHead().insertRow()
  for(const name of ['Auswertung','Vorschläge','Richtig','Trefferquote']){const cell=document.createElement('th');cell.scope='col';cell.textContent=name;head.append(cell)}
  const body=table.createTBody()
  const row=(label:string,v:Tally)=>{
    const r=body.insertRow(),title=document.createElement('th');title.scope='row';title.textContent=label;r.append(title)
    for(const value of [String(v.shown),String(v.correct),v.shown?Math.round(100*v.correct/v.shown)+' %':'–'])r.insertCell().textContent=value
  }
  row('Gesamtergebnis',result.combined);row('Regeln einzeln',result.rule);row('Bayes einzeln',result.bayes)
  if(result.embedding)row('Embeddings mit Steckbrief',result.embedding)
  if(result.plain)row('Embeddings ohne Steckbrief',result.plain)
  for(const [source,n] of Object.entries(result.sources))row('Endgültige Quelle · '+source,n)
  parent.append(table)
  if(result.embedding){
    const note=document.createElement('p')
    note.textContent=result.semanticTested+' Testmails mit lokalem Vektor.'+(result.missing?' '+result.missing+' Vektoren fehlen. Bitte Lernordner aktualisieren.':'')
    parent.append(note)
  }
}
const centersKey='outlook-kanban-ai-centroids-v1'
type SampleIndex={members:{token:string;weight:number}[];description:string|null}
type Centers=Record<string,{url?:string;model:string;profile:string;options:string;vector:number[];index?:SampleIndex;memberIds?:string[]}>
function embeddingOptions(){
  const config=getLegacyConfig()
  return {sender:config.embedding_include_sender!==false,instruction:String(config.embedding_instruction??'Instruct: Represent this email for folder classification. '),
    recent:config.embedding_weight_recent!==false,profileWeight:Number(config.embedding_description_weight??0.15)}
}
function embedText(mail:AiMail){
  const opt=embeddingOptions()
  return [opt.instruction,mail.subject.slice(0,300),opt.sender?mail.sender:'',opt.sender?mail.senderEmail?.split('@')[1]:'',mail.body.split(/\n(?:>+|Von:|From:|_{4,}|-{3,}Original)/i)[0].slice(0,1500)].filter(Boolean).join('\n')
}
type SemanticScore={folder:string;score:number}
async function semanticScores(mail:AiMail,targets:FolderInfo[],cfg:Config){
  const state=stored(centersKey) as Centers
  const stamp=JSON.stringify(embeddingOptions())
  const centroids:Record<string,number[]>=Object.create(null)
  for(const f of targets){
    const e=state[f.key]
    if(e && e.url===cfg.embedUrl && e.model===cfg.embedModel && e.profile===f.profile && e.options===stamp)centroids[f.key]=e.vector
  }
  return native()<SemanticScore[]>('ai_suggest',{url:cfg.embedUrl,model:cfg.embedModel,text:embedText(mail),
    folders:targets.map(f=>({...f,profile:f.profile.split(/(?:^| · )Nicht: /)[0]})),centroids})
}
async function trainCenter(folder:string,samples:AiMail[],ai:Config){
  const profile=folderInfo([folder])[0].profile, options=embeddingOptions()
  const selected=withoutExcluded(samples).slice(0,Math.min(300,Math.max(1,Number(getLegacyConfig().embedding_samples)||150)))
  const weighted=selected.map((m,i)=>{
    const weight=options.recent&&selected.length>1?1-i/(2*(selected.length-1)):1
    return {text:embedText(m),weight}
  })
  const {vector,index}=await native()<{vector:number[];index:SampleIndex}>('ai_centroid',{url:ai.embedUrl,model:ai.embedModel,samples:weighted,description:profile.split(/(?:^| · )Nicht: /)[0],descriptionWeight:options.profileWeight})
  return {model:ai.embedModel,url:ai.embedUrl,profile,options:JSON.stringify(options),index,memberIds:selected.map(m=>m.id||''),vector:vector.map(x=>Number(x.toPrecision(6)))}
}
export async function draftProfile(folder:string,key:string){
  const invoke=native()
  if(!allowed(key))throw new Error('Bitte einen aktiven Projekt- oder Bereichsordner auswählen.')
  const cfg=config(), model=await activeModel(cfg,'profile')
  const raw=await invoke<string>('outlook_training',{folder,limit:24,days:0})
  const samples:AiMail[]=JSON.parse(raw)
  if(!samples.length)throw new Error('Im Ordner fehlen Nachrichten für einen Steckbriefentwurf.')
  return invoke<string>('ai_profile',{url:cfg.url,model,key,samples:samples.map(m=>({sender:'',subject:m.subject,body:m.body.slice(0,260)}))})
}
let training:Promise<{count:number;failures:string[]}>|undefined
export function trainFromFolders(folders:Folder[],progress?:(message:string)=>void){
  const epoch=sourceEpoch
  if(!liveSource)return Promise.reject(new Error('Für das Lernen bitte das Outlook-Postfach öffnen.'))
  if(!training)training=learnFolders(folders,progress).finally(()=>{if(current(epoch))training=undefined})
  return training
}
function scopeStamp(folders:Folder[]){return JSON.stringify(folders.filter(f=>!f.isInbox&&allowed(f.path)).map(f=>[f.id,f.path]).sort())}
/** Lernmails eines Lernordners aus `outlook_training`, ohne ausgeschlossene Mails. `error`, wenn Outlook den Ordner nicht liefern konnte. */
export type TrainingFolder={folder:Folder;mails?:AiMail[];error?:string}
/**
 * Liest die Lernmails je Lernordner (bis zu 300 aus `learn_max_days`, Standard zwei Jahre) wie das Lernen selbst.
 * Posteingang und `_`-Ordner zählen nicht. „Nicht lernen“-Mails fehlen bereits. Genutzt von `learnFolders` und der Ausreißerprüfung (E3).
 */
export async function trainingMails(folders:Folder[],progress?:(message:string)=>void):Promise<TrainingFolder[]>{
  const epoch=sourceEpoch,invoke=native(),cfg=getLegacyConfig()
  const days=Math.max(0,Math.min(3650,Number(cfg.learn_max_days??730)))
  const excluded=learnExcluded(),targets=folders.filter(f=>!f.isInbox && allowed(f.path)),result:TrainingFolder[]=[]
  for(const [index,folder] of targets.entries()){
    requireLive(epoch)
    progress?.('Lese '+folder.path+' ('+(index+1)+'/'+targets.length+') …')
    try{result.push({folder,mails:withoutExcluded(JSON.parse(await invoke<string>('outlook_training',{folder:folder.id,limit:300,days})),excluded)})}
    catch(err){result.push({folder,error:String(err)})}
  }
  requireLive(epoch)
  return result
}
async function learnFolders(folders:Folder[],progress?:(message:string)=>void) {
  const epoch=sourceEpoch
  requireLive(epoch)
  const known=history(trainingKey)
  const rows:LearnRow[]=[], failures:string[]=[],semanticFailures:string[]=[]
  const ai=config(),centers:Centers=Object.create(null), oldCenters=stored(centersKey) as Centers
  const targets=folders.filter(f=>!f.isInbox && allowed(f.path))
  if(!targets.length)throw new Error('Bitte Outlook laden und mindestens einen Lernordner auswählen.')
  for(const {folder:f,mails:samples,error} of await trainingMails(targets,progress)){
    requireLive(epoch)
    if(!samples){failures.push(f.path+': '+error);rows.push(...known.filter(r=>r.folder===f.path));if(oldCenters[f.path])centers[f.path]=oldCenters[f.path];continue}
    if(ai.enabled&&ai.embeddings&&samples.length){
      progress?.('Ordnerprofil für '+f.path+' …')
      try{centers[f.path]=await trainCenter(f.path,samples,ai)}
      catch(e){semanticFailures.push(f.path+': '+String(e));if(oldCenters[f.path])centers[f.path]=oldCenters[f.path]}
    }
    rows.push(...samples.map(m=>({folder:f.path,id:m.id,received:m.received,features:features(m)})))
  }
  requireLive(epoch)
  if(failures.length!==targets.length)localStorage.setItem(trainingKey,JSON.stringify({rows,stamp:Date.now(),scope:scopeStamp(folders)}))
  if(ai.enabled&&ai.embeddings&&failures.length!==targets.length)localStorage.setItem(centersKey,JSON.stringify(centers))
  return {count:rows.length,failures:[...failures,...semanticFailures]}
}
function lexical(m:AiMail,folders:FolderInfo[]):Suggestion|undefined {
  const terms=new Set(words([m.subject,m.body].join(' ')))
  const rank=folders.map(f=>{
    const [positive,negative='']=f.profile.split(/(?:^| · )Nicht: /)
    const overlap=(value:string)=>words(value).filter(w=>terms.has(w)).length
    return {folder:f.key,score:overlap(f.key+' '+positive)-overlap(negative)}
  }).sort((a,b)=>b.score-a.score)
  if(rank[0]?.score>0 && rank[0].score>(rank[1]?.score||0))return {folder:rank[0].folder,reason:'Begriff aus Ordnername oder Steckbrief'}
}

/** Rolle eines Sprachmodells (A4): Hintergrund für Analyse, Stichwahl und Aufgaben, Entwürfe für Texte, die du liest und bearbeitest. */
export type ModelRole='background'|'draft'
/** Welche Modellrolle jede KI-Funktion nutzt. */
export const MODEL_ROLES={analyze:'background',choose:'background',tasks:'background',
  reply:'draft',profile:'draft',subfolders:'draft',folderName:'draft',clusterName:'draft'} as const satisfies Record<string,ModelRole>
export type AiFunction=keyof typeof MODEL_ROLES
/** Eingestellter Modellname für eine Funktion. Ein leeres Entwurfsmodell bedeutet „wie Hintergrund“, leer insgesamt „automatisch“. */
export function configuredModel(fn:AiFunction,cfg:{model:string;draftModel?:string}){
  const background=cfg.model.trim()
  return MODEL_ROLES[fn]==='draft'?(cfg.draftModel||'').trim()||background:background
}
/** Erstes installiertes Sprachmodell, wie bei „Automatisch auswählen“. */
const firstChatModel=(names:string[])=>names.find(s=>!s.toLowerCase().includes('embed'))
async function activeModel(cfg:Config,fn:AiFunction) {
  if(!cfg.enabled)throw new Error('Lokale KI ist ausgeschaltet.')
  const invoke=native()
  const model=configuredModel(fn,cfg) || firstChatModel(await invoke<string[]>('ai_models',{url:cfg.url}))
  if(!model)throw new Error('Bitte in den Einstellungen ein lokal installiertes Sprachmodell wählen.')
  return model
}
/** Adresse und Entwurfsmodell für Entwürfe außerhalb dieses Moduls (Unterordner, `ai_subfolders`). */
export async function localDraftModel() {
  requireLive()
  const cfg=config()
  return {url:cfg.url,model:await activeModel(cfg,'subfolders')}
}
async function threadOf(m:AiMail):Promise<EarlierMessage[]>{
  if(!m.id||!m.folderId)return []
  try{
    const raw=await native()<string>('outlook_thread',{id:m.id,folder:m.folderId})
    const rows:unknown=JSON.parse(raw)
    if(!Array.isArray(rows))return []
    return rows.flatMap(row=>{
      const item=object(row)
      const text=typeof item.text==='string'?item.text:''
      if(!text.trim())return []
      const direction=item.direction==='gesendet'?'gesendet':'eingegangen'
      return [{direction,text}]
    })
  }catch{return []}
}
function savedStyleText(){
  try{const raw=JSON.parse(localStorage.getItem(styleKey)||'{}') as {text?:unknown};return typeof raw.text==='string'?raw.text:''}catch{return ''}
}
function savedForm():''|'Du'|'Sie'{return formOf(savedStyleText())}
async function sentSamples():Promise<SentSample[]>{
  try{
    const raw=await native()<string>('outlook_sent_style')
    const rows:unknown=JSON.parse(raw)
    if(!Array.isArray(rows))return []
    return rows.flatMap(row=>{
      const item=object(row)
      const text=typeof item.text==='string'?item.text:''
      if(!text.trim())return []
      return [{to:typeof item.to==='string'?item.to:'',subject:typeof item.subject==='string'?item.subject:'',text,received:typeof item.received==='string'?item.received:''}]
    })
  }catch{return []}
}
async function replyGuide(mail:AiMail,cfg:Config){
  const samples=liveSource?await sentSamples():[]
  const form=addressForm(mail.senderEmail||mail.sender,samples)||savedForm()
  const style=[savedStyleText(),form?'Ansprache an diesen Empfänger: '+form:''].filter(Boolean).join('\n')
  let examples:{subject:string;body:string}[]=[]
  if(cfg.embeddings&&samples.length){
    try{
      const ranked=await native()<{id:string}[]>('ai_rank',{url:cfg.embedUrl,model:cfg.embedModel,query:embedText(mail),items:samples.slice(0,30).map((sample,index)=>({id:String(index),text:sample.subject+'\n'+sample.text}))})
      examples=ranked.slice(0,2).flatMap(row=>{const sample=samples[Number(row.id)];return sample?[{subject:sample.subject,body:sample.text}]:[]})
    }catch{examples=[]}
  }
  return {style,examples}
}
async function analyze(m:AiMail, folders:FolderInfo[],cfg:Config) {
  const invoke=native(), model=await activeModel(cfg,'analyze')
  const earlier=cfg.context?await threadOf(m):[]
  const attachments=cfg.context?(m.attachments??[]).filter(name=>name.trim()):[]
  const result=await invoke<Analysis>('ai_analyze',{url:cfg.url, model,mail:{...m,earlier,attachments},folders})
  return {...result,aufgaben:Array.isArray(result.aufgaben)?result.aufgaben:[],modell:model}
}

const cacheKey='outlook-kanban-ai-cache-v1'
const typeKey='outlook-kanban-ai-types-v1'
const defaults=['Anfrage','Angebot','Bestellung','Auftragsbestätigung','Lieferung','Rechnung','Reklamation','Termin','Info']
function knownTypes(){
  const types=getLegacyConfig().mail_types
  return Array.isArray(types)?types.filter((x):x is string=>typeof x==='string'&&!!x.trim()):defaults
}
function fold(s:string){return s.trim().toLocaleLowerCase('de')}
const importedCache=new Map<string,{source:string|undefined;value:Record<string,unknown>}>()
function imported(name:string){
  const raw=getLegacyFile(name),cached=importedCache.get(name)
  if(cached&&raw===cached.source)return cached.value
  try{
    const value=object(JSON.parse(raw||'{}'));importedCache.set(name,{source:raw,value});return value
  }catch{return {}}
}
type Proposal={name:string;keys:string[]}
function typeState(){
  const state=stored(typeKey)
  const base=Object.hasOwn(state,'proposals')?state:imported('art-vorschlaege.json')
  const proposals=new Map<string,Proposal>()
  for(const [key,raw] of Object.entries(object(base.proposals))){
    const item=object(raw)
    if(typeof item.name==='string'&&Array.isArray(item.keys))
      proposals.set(key,{name:item.name,keys:item.keys.filter((id):id is string=>typeof id==='string')})
  }
  const discarded=Array.isArray(base.discarded)?base.discarded.filter((v):v is string=>typeof v==='string'):[]
  return {proposals,discarded}
}
function saveTypes(state:ReturnType<typeof typeState>){
  localStorage.setItem(typeKey,JSON.stringify({proposals:Object.fromEntries(state.proposals),discarded:state.discarded}))
}
function rememberTypes(mail:AiMail,types:string[]){
  const id=feedbackId(mail), known=knownTypes().map(fold)
  if(!id)return
  const state=typeState()
  let dirty=false
  for(const name of types){
    const key=fold(name)
    if(!key||known.includes(key)||state.discarded.includes(key))continue
    const entry=state.proposals.get(key)||{name,keys:[]}
    if(!entry.keys.includes(id)&&entry.keys.length<5){entry.keys.push(id);state.proposals.set(key,entry);dirty=true}
  }
  if(dirty)saveTypes(state)
}
type CacheEntry={signature:string;result:Analysis}
let recent:Map<string,CacheEntry>|undefined
function cache(){
  if(!recent) recent=new Map(Object.entries(object(stored(cacheKey).entries)) as [string,CacheEntry][])
  return recent
}
// Keep content-sensitive invalidation without retaining mail bodies in the analysis cache.
function signature(mail:AiMail,seed=2166136261){
  let hash=seed
  for(const value of [mail.subject,mail.sender,mail.body,mail.received||'']){
    for(let i=0;i<value.length;i++)hash=Math.imul(hash^value.charCodeAt(i),16777619)
    hash=Math.imul(hash,16777619)
  }
  return String(hash>>>0)
}
let legacyCache:Record<string,unknown>|undefined
function lookupAnalysis(mail:AiMail):Analysis|undefined {
  const entry=cache().get(feedbackId(mail))
  if(entry)return entry.signature===signature(mail)?entry.result:undefined
  legacyCache??=imported('ki-cache.json')
  const old=object(legacyCache[legacyId(mail)])
  if(typeof old.summary!=='string'||typeof old.needs_reply!=='boolean')return
  return {zusammenfassung:old.summary,antwort_noetig:old.needs_reply,
    frist:old.dated===true&&typeof old.deadline==='string'?old.deadline:null,
    ordner:typeof old.folder==='string'?old.folder:null,arten:Array.isArray(old.types)?old.types.filter((v):v is string=>typeof v==='string'):[]}
}
function applyAnalysis(mail:AiMail,result:Analysis){
  Object.assign(mail,{needsReply:result.antwort_noetig,deadline:result.frist||'',aiSummary:result.zusammenfassung,aiTypes:result.arten,aiTasks:openTasks(result.aufgaben,embeddingId(mail))})
}
function retainAnalysis(mail:AiMail,result:Analysis){
  const key=feedbackId(mail)
  if(key){
    const entries=cache()
    entries.delete(key);entries.set(key,{signature:signature(mail),result})
    if(entries.size>1000)entries.delete(entries.keys().next().value!)
    try{localStorage.setItem(cacheKey,JSON.stringify({entries:Object.fromEntries(entries)}));rememberTypes(mail,result.arten)}catch{ /* Keep this session's insights when storage is full. */ }
  }
  applyAnalysis(mail,result)
  window.dispatchEvent(new Event('kanban-analysis'))
}
/** Hintergrundmodell der gespeicherten Analyse dieser Mail, sonst das eingestellte (für die Rückmeldungen B1). */
export function analysisModel(mail:AiMail){
  return (liveSource?lookupAnalysis(mail)?.modell:undefined)||configuredModel('analyze',config())||NO_MODEL
}
/** Eingestelltes Embedding-Modell (für die Rückmeldungen B1). */
export function embeddingModelName(){return config().embedModel.trim()||NO_MODEL}
const voteLabels:[VoteField,string][]=[['summary','Zusammenfassung'],['needsReply','„Antwort nötig“'],['deadline','Frist']]
/**
 * B1: Knöpfe „passt“ und „passt nicht“ für Zusammenfassung, „Antwort nötig“ und Frist (nur, wenn eine erkannt wurde). Je Mail-Signatur eine Stimme je Feld,
 * ein zweiter Klick auf dieselbe Stimme nimmt sie zurück.
 */
function renderVotes(host:HTMLElement,mail:AiMail,model:string,deadline:boolean){
  host.replaceChildren()
  const id=embeddingId(mail)
  // Ohne erkannte Frist gibt es nichts zu bewerten.
  for(const [field,label] of voteLabels.filter(([field])=>deadline||field!=='deadline')){
    const group=document.createElement('span');group.className='ai-vote';group.setAttribute('role','group');group.setAttribute('aria-label','Rückmeldung: '+label)
    const buttons=(['ok','bad'] as const).map(value=>{
      const b=document.createElement('button');b.type='button';b.className='ai-vote-button'
      b.textContent=value==='ok'?'passt':'passt nicht'
      b.setAttribute('aria-label',label+(value==='ok'?' passt':' passt nicht'))
      b.onclick=()=>{const now=vote(id,field,model,value);buttons[0].setAttribute('aria-pressed',String(now==='ok'));buttons[1].setAttribute('aria-pressed',String(now==='bad'))}
      return b
    })
    const now=currentVote(id,field)
    buttons[0].setAttribute('aria-pressed',String(now==='ok'));buttons[1].setAttribute('aria-pressed',String(now==='bad'))
    const name=document.createElement('span');name.textContent=label.replace(/[„“]/g,'')
    group.append(name,...buttons);host.append(group)
  }
}
export function restoreAnalysis(mail:AiMail){
  if(!liveSource)return
  const result=lookupAnalysis(mail)
  if(result)applyAnalysis(mail,result)
}
export function trustedFolderBatch(folders:string[]){
  const epoch=sourceEpoch
  if(!liveSource)return ()=>undefined
  const targets=folders.filter(allowed).map(key=>({key,profile:''}))
  const all=new Set(targets.map(f=>f.key))
  const predict=classifier([...history(trainingKey),...history()].filter(r=>all.has(r.folder)))
  return (mail:AiMail):Suggestion|undefined=>{
    if(!current(epoch))return
    const ignored=rejected(mail)
    const hidden=getLegacyConfig().hidden_sources
    const hide=Array.isArray(hidden)?hidden:[]
    const match=(!hide.includes('Regel')?rule(mail,targets.filter(f=>!ignored.includes(f.key))):undefined)||(!hide.includes('Bayes')?predict(features(mail)):undefined)
    const shown=match&&!ignored.includes(match.folder)?match:undefined
    // B1: Auch ein nur angezeigter Hinweis zählt, wenn die Mail abgelegt wird. Ein angeforderter Vorschlag hat Vorrang.
    if(shown&&!sourceHints.has(mail))keepPassive(mail,shown)
    return shown
  }
}
/** Mindestanteil des Bayes-Favoriten für einen Vorschlag ohne hohe Sicherheit (`likelyFolderBatch`). */
export const LIKELY_SHARE=0.5
/**
 * Vorschlag ohne hohe Sicherheit und ohne Modellaufruf, für das Einteilen des Posteingangs (E7): der Bayes-Favorit ab
 * `LIKELY_SHARE` auch unter der Sicherheitsschwelle, sonst ein Begriff aus Ordnername oder Steckbrief. Abgelehnte Ordner zählen nicht.
 */
export function likelyFolderBatch(folders:string[]){
  const epoch=sourceEpoch
  if(!liveSource)return ()=>undefined
  const targets=folderInfo(folders)
  const all=new Set(targets.map(f=>f.key))
  const model=bayesModel([...history(trainingKey),...history()].filter(r=>all.has(r.folder)))
  return (mail:AiMail):Suggestion|undefined=>{
    if(!current(epoch))return
    const ignored=rejected(mail)
    const hidden=getLegacyConfig().hidden_sources
    if(!(Array.isArray(hidden)&&hidden.includes('Bayes'))){
      const [best]=[...model(features(mail)).probs].filter(([f])=>!ignored.includes(f)).sort((a,b)=>b[1]-a[1])
      if(best&&best[1]>=LIKELY_SHARE)return {folder:best[0],reason:'Aus früheren Ablagen, ohne hohe Sicherheit'}
    }
    return lexical(mail,targets.filter(f=>!ignored.includes(f.key)))
  }
}
export function trustedFolder(mail:AiMail,folders:string[]){
  return trustedFolderBatch(folders)(mail)
}
export async function suggestFolder(mail:AiMail, folders:string[]):Promise<Suggestion> {
  const epoch=sourceEpoch
  if(!liveSource){
    const match=lexical(mail,folders.filter(allowed).map(key=>({key,profile:''})))
    if(!match)return {folder:'',reason:'Kein eindeutiger Beispielordner gefunden.'}
    const hint={folder:match.folder,reason:'Begriff aus dem Beispielordner'}
    if(mailboxMode==='demo')sourceHints.set(mail,hint)
    return hint
  }
  const dismissed=rejected(mail)
  const targets=folderInfo(folders.filter(f=>!dismissed.includes(f)))
  const hint=await chooseFolder(mail,targets)
  requireLive(epoch)
  if(hint.folder){
    const source=filingSource(hint.reason)
    if(!hint.model?.trim()&&(source==='Embedding'||source==='Hybrid'))hint.model=config().embedModel.trim()
    sourceHints.set(mail,hint)
  }
  return hint
}
type Choice={ordner:string;grund:string}
/** Stichwahl-Ergebnisse je Mail-Signatur, Modell und Kandidatenpaar, nur im Speicher. `null`: Modell nannte keinen der beiden. */
const runoffs=new Map<string,Choice|null>()
/** Schnelle Stichwahl (C2) zwischen genau zwei Ordnern über `ai_choose` statt einer vollen Analyse. */
async function runoff(mail:AiMail,two:FolderInfo[],cfg:Config,model:string):Promise<Choice|null>{
  const invoke=native()
  const key=JSON.stringify([embeddingId(mail),cfg.url,model,...two.map(f=>[f.key,f.profile]).sort()])
  if(runoffs.has(key))return runoffs.get(key)!
  let choice:Choice|null=null
  try{
    // Nach Zeichen, nicht nach UTF-16-Einheiten kürzen. Rust kürzt ohnehin noch einmal.
    const body=Array.from(mail.body).slice(0,1000).join('')
    const raw=await invoke<Choice|null>('ai_choose',{url:cfg.url,model,mail:{subject:mail.subject,sender:'',body,received:mail.received||''},candidates:two})
    if(raw&&typeof raw.ordner==='string'&&two.some(f=>f.key===raw.ordner))choice={ordner:raw.ordner,grund:typeof raw.grund==='string'?Array.from(raw.grund.trim()).slice(0,120).join(''):''}
  }catch{ /* Ein Fehlschlag gilt für diese Sitzung wie „keiner der beiden“, damit nicht jede Anzeige erneut fragt. */ }
  requireLive()
  runoffs.delete(key);runoffs.set(key,choice)
  if(runoffs.size>500)runoffs.delete(runoffs.keys().next().value!)
  return choice
}
async function chooseFolder(mail:AiMail, targets:FolderInfo[]):Promise<Suggestion> {
  const epoch=sourceEpoch
  const legacy=getLegacyConfig()
  const hidden=new Set(Array.isArray(legacy.hidden_sources)?legacy.hidden_sources:[])
  const fixed=rule(mail,targets)
  if(fixed&&!hidden.has('Regel'))return fixed
  const predicted=learned(mail,targets)
  const bayes=hidden.has('Bayes')?undefined:predicted
  const cfg=config(), issues:string[]=[]
  const local=lexical(mail,targets)
  let shortlist=targets
  if(!targets.length)return {folder:'',reason:'Keine Ablageziele zur Auswahl.'}
  if(cfg.enabled && cfg.embeddings && !hidden.has('Embedding')) {
    try{
      const scores=await semanticScores(mail,targets,cfg)
      const best=scores[0], gap=scores[1]?best.score-scores[1].score:Infinity
      if(legacy.embedding_prefilter!==false&&scores.length)shortlist=targets.filter(f=>scores.some(s=>s.folder===f.key))
      if(best&&best.score>Number(legacy.embedding_threshold??0.78)&&gap>0&&gap>=Number(legacy.embedding_min_margin??0.03)){
        const detail=scores.map(s=>s.folder+' '+s.score.toFixed(2)).join(' · ')
        if(bayes?.folder===best.folder&&!hidden.has('Hybrid'))return {folder:best.folder,reason:'Bayes und Embeddings · '+detail}
        if(bayes&&gap<0.08)return bayes
        if(scores[1]&&gap<0.05&&!hidden.has('KI-Stichwahl')){
          const two=targets.filter(f=>[best.folder,scores[1].folder].includes(f.key))
          try{
            const model=await activeModel(cfg,'choose')
            const choice=two.length===2?await runoff(mail,two,cfg,model):null
            if(choice&&two.some(f=>f.key===choice.ordner))return {folder:choice.ordner,reason:'KI-Stichwahl · '+(choice.grund||detail),model}
          }catch{ /* Keep the measured embedding result when the chat model is unavailable. */ }
        }
        return {folder:best.folder,reason:'Lokale Embeddings · '+detail}
      }
    }catch(error){issues.push(String(error))}
  }
  requireLive(epoch)
  if(bayes)return bayes
  if(cfg.enabled&&!hidden.has('KI')) {
    try{
      const insight=await analyze(mail,shortlist,cfg)
      if(insight.ordner && targets.some(f=>f.key===insight.ordner))return {folder:insight.ordner,reason:'Vorschlag der lokalen KI',model:insight.modell}
    }catch(error){issues.push(String(error))}
  }
  if(local)return {...local,reason:local.reason+(issues.length?' · KI nicht verfügbar':'')}
  return {folder:'',reason:['Kein eindeutiger Ablagevorschlag.',...new Set(issues)].join(' ')}
}
export function renderAnalysis(container:HTMLElement, mail:AiMail, folders:string[],
    openDraft?:(text:string)=>Promise<boolean|void>, applyTags?:(tags:string[])=>Promise<void>) {
  container.replaceChildren()
  if(!liveSource)return
  const epoch=sourceEpoch, cfg=config()
  if(!cfg.enabled)return
  const button=document.createElement('button')
  button.type='button';button.textContent='Mit lokaler KI analysieren'
  const feedback=document.createElement('p')
  feedback.setAttribute('role','status')
  const types=document.createElement('div')
  const votes=document.createElement('div');votes.className='ai-votes'
  const show=(result:Analysis)=>{
    renderVotes(votes,mail,result.modell||configuredModel('analyze',cfg)||NO_MODEL,!!result.frist)
    feedback.textContent=[result.zusammenfassung, result.antwort_noetig?'Antwort nötig':'Kein Antwortbedarf erkannt',
      result.frist?'Fristvorschlag: '+result.frist:'',result.arten.length?'Art-Vorschlag: '+result.arten.join(', '):''].filter(Boolean).join(' · ')
    types.replaceChildren()
    const accepted=knownTypes()
    if(applyTags)for(const proposal of result.arten){
      const art=accepted.find(t=>fold(t)===fold(proposal))
      if(!art)continue
      const tag=String(getLegacyConfig().mail_type_prefix||'Art: ')+art
      if(mail.tags?.includes(tag))continue
      const apply=document.createElement('button'); apply.type='button';apply.textContent='„'+tag+'“ übernehmen'
      apply.onclick=async()=>{if(!current(epoch))return;apply.disabled=true;try{await applyTags([...new Set([...(mail.tags||[]),tag])])}catch(e){feedback.textContent=String(e)}finally{apply.disabled=false}}
      types.append(apply)
    }
  }
  container.append(button,feedback,votes,types)
  const cached=lookupAnalysis(mail)
  if(cached)show(cached)
  const run=async()=>{
    if(!current(epoch))return
    button.disabled=true
    feedback.textContent='Lokale KI wertet die Mail aus …'
    try{
      const result=await analyze(mail,folderInfo(folders),cfg)
      requireLive(epoch)
      retainAnalysis(mail,result)
      show(result)
    }catch(error){feedback.textContent=String(error)}
    finally{button.disabled=false}
  }
  button.onclick=run
  // Ältere Analysen kennen keine Aufgaben. Beim Öffnen der Details werden sie einmal neu berechnet.
  if(cached&&!Array.isArray(cached.aufgaben))void run()
  if(openDraft){
    const generate=document.createElement('button');generate.type='button';generate.textContent='KI-Antwort entwerfen'
    const draft=document.createElement('textarea');draft.hidden=true;draft.rows=6;draft.setAttribute('aria-label','KI-Antwort vor dem Öffnen bearbeiten')
    const open=document.createElement('button');open.type='button';open.hidden=true;open.textContent='Als Entwurf in Outlook öffnen'
    // B1: Der erzeugte Entwurf und sein Modell. Beim ersten Öffnen in Outlook zählt, wie stark er geändert wurde.
    let generated:{text:string;model:string}|undefined
    generate.onclick=async()=>{
      if(!current(epoch))return
      generate.disabled=true; feedback.textContent='Antwortvorschlag wird erstellt …'
      try{
        const key=mail.folderPath||mail.folder||''
        const profiles=getLegacyProfiles(), model=await activeModel(cfg,'reply')
        const guide=await replyGuide(mail,cfg)
        draft.value=await native()<string>('ai_reply',{url:cfg.url,model,mail,profile:profiles[key]||profiles[key.replace(/^\//,'')]||'',style:guide.style,examples:guide.examples})
        generated={text:draft.value,model}
        draft.hidden=false;open.hidden=false;feedback.textContent='Antwortvorschlag prüfen und bei Bedarf bearbeiten.'
      }catch(error){feedback.textContent=String(error)}
      finally{generate.disabled=false}
    }
    open.onclick=async()=>{
      if(!current(epoch)||!draft.value.trim())return
      open.disabled=true
      try{
        const text=draft.value
        const opened=await openDraft(text)
        if(opened!==false&&generated&&current(epoch)){countDraft(generated.model,generated.text,text);generated=undefined}
      }catch(error){feedback.textContent=String(error)}
      finally{open.disabled=false}
    }
    container.append(generate,draft,open)
  }
}
let learningFolders:(()=>Folder[])|undefined
let learnTimer:number|undefined, retryAt=0, retryDelay=120000
function scheduleLearning(){
  window.clearTimeout?.(learnTimer)
  const epoch=sourceEpoch
  if(!current(epoch)||!config().autoLearn||!learningFolders)return
  const folders=learningFolders()
  if(!folders.length)return
  const previous=stored(trainingKey)
  const next=previous.scope===scopeStamp(folders)?Number(previous.stamp||0)+3600000:0
  const wait=Math.max(0,(retryAt||next)-Date.now())
  learnTimer=window.setTimeout(async()=>{
    if(!current(epoch)||!config().autoLearn||!learningFolders?.().length)return
    try{
      const r=await trainFromFolders(learningFolders(),msg=>reportTraining(msg))
      if(!current(epoch))return
      if(r.failures.length)throw new Error(r.failures.join(' · '))
      retryAt=0;retryDelay=120000;reportTraining(r.count+' Lernbeispiele · stündliche Aktualisierung aktiv.')
    }catch(error){
      if(!current(epoch))return
      retryAt=Date.now()+retryDelay;retryDelay=Math.min(retryDelay*2,600000)
      reportTraining('Lernen angehalten. '+String(error)+' · Neuer Versuch in '+Math.ceil((retryAt-Date.now())/60000)+' Min.')
    }
    scheduleLearning()
  },wait)
}
let lastTraining=''
function reportTraining(s:string){lastTraining=s;const p=document.getElementById('aiTrainingState');if(p)p.textContent=s}
let readBoard:(()=>AiMail[])|undefined, readFolders:(()=>string[])|undefined, processing=false, queueStatus=''
export function bindAiBoard(mails:()=>AiMail[],folders:()=>string[]){readBoard=mails;readFolders=folders}
function reportQueue(text:string){queueStatus=text;const node=document.getElementById('aiQueueState');if(node)node.textContent=text}
export async function queueAnalyses(){
  if(!liveSource)return
  const epoch=sourceEpoch
  await analysisQueue()
  if(current(epoch)&&!processing)await queueEmbeddings()
}
async function analysisQueue(){
  const epoch=sourceEpoch
  scheduleLearning()
  const cfg=config()
  if(!cfg.enabled||!cfg.auto||processing||!readBoard)return
  processing=true
  try{
    const pending=readBoard().filter(m=>!!feedbackId(m)&&!lookupAnalysis(m))
    const folders=folderInfo(readFolders?.()||[])
    for(const [i,mail] of pending.entries()){
      if(!current(epoch)||!config().auto||!config().enabled)break
      reportQueue('Hintergrundanalyse '+(i+1)+' von '+pending.length+' …')
      const result=await analyze(mail,folders,cfg)
      if(current(epoch)&&config().auto&&config().enabled)retainAnalysis(mail,result)
    }
    if(current(epoch))reportQueue('Hintergrundanalyse abgeschlossen.')
  }catch(error){if(current(epoch))reportQueue('Hintergrundanalyse angehalten. '+String(error))}
  finally{if(current(epoch))processing=false}
}
/** Stable across Outlook moves (new EntryID): two content hashes of subject, sender, body and receipt time. */
export function embeddingId(mail:AiMail){return signature(mail)+'.'+signature(mail,0x5bd1e995)}
/** Mails still to embed: newest first, each content only once, already embedded ones skipped. */
export function pendingEmbeddings(mails:AiMail[],done:ReadonlySet<string>):AiMail[]{
  const seen=new Set(done)
  return mails.filter(m=>{const id=embeddingId(m);if(seen.has(id))return false;seen.add(id);return true})
    .sort((a,b)=>(b.received||'').localeCompare(a.received||''))
}
const embedBatch=16
let embedding=false, embeddedStamp=''
/** Fehler in Folge und frühester nächster Versuch der Hintergrund-Einbettung. Zurück auf 0 bei Erfolg, Quellen- oder Modellwechsel. */
let embedFailures=0, embedRetryAt=0
/** Wartezeit nach `failures` Fehlern in Folge: 30 Sekunden, dann 1, 2, 4 … Minuten, höchstens 15 Minuten. */
export function embedRetryDelay(failures:number){return failures<1?0:Math.min(30000*2**Math.min(failures-1,10),15*60000)}
const waitText=(ms:number)=>ms<60000?Math.ceil(ms/1000)+' s':Math.ceil(ms/60000)+' Min.'
const embedded=new Set<string>()
function embeddingsOn(cfg:Config){return mailboxMode==='outlook'&&cfg.enabled&&cfg.embeddings}
const embeddingStamp=(cfg:Config)=>JSON.stringify([cfg.embedUrl,cfg.embedModel,embeddingOptions()])
/** Vectors live in the Rust cache; this only remembers which contents were sent for the current model and text options. */
function embeddedFor(cfg:Config){
  const stamp=embeddingStamp(cfg)
  if(stamp!==embeddedStamp){embedded.clear();embeddedStamp=stamp;embedFailures=0;embedRetryAt=0}
  return embedded
}
export async function queueEmbeddings(){
  if(!liveSource)return
  const epoch=sourceEpoch, cfg=config()
  if(!embeddingsOn(cfg)||embedding||!readBoard)return
  const done=embeddedFor(cfg)
  // Nach einem Fehler wartet der nächste Versuch, damit ein nicht erreichbarer Dienst nicht bei jedem Aktualisieren angefragt wird.
  if(Date.now()<embedRetryAt)return
  embedding=true
  try{
    const pending=pendingEmbeddings(readBoard(),done)
    if(!pending.length)return
    const invoke=native(), stamp=embeddedStamp
    for(let i=0;i<pending.length;i+=embedBatch){
      if(!current(epoch)||!embeddingsOn(config())||embeddingStamp(config())!==stamp)return
      const batch=pending.slice(i,i+embedBatch)
      reportQueue('Einbettung '+(i+batch.length)+' von '+pending.length+' …')
      await invoke<number>('ai_embed',{url:cfg.embedUrl,model:cfg.embedModel,items:batch.map(m=>({id:embeddingId(m),text:embedText(m)}))})
      if(current(epoch)&&embeddedStamp===stamp){for(const m of batch)done.add(embeddingId(m));if(typeof document!=='undefined')document.dispatchEvent?.(new CustomEvent('mailboard:embedding-progress'))}
    }
    if(current(epoch)){embedFailures=0;embedRetryAt=0;reportQueue('Einbettung abgeschlossen.');if(typeof document!=='undefined')document.dispatchEvent?.(new CustomEvent('mailboard:embedded'))}
  }catch(error){
    if(!current(epoch))return
    const wait=embedRetryDelay(++embedFailures)
    embedRetryAt=Date.now()+wait
    reportQueue('Einbettung angehalten. '+String(error)+' · Neuer Versuch frühestens in '+waitText(wait)+'.')
  }
  finally{if(current(epoch))embedding=false}
}
export type GroupMatch={id:string;best:string;score:number;margin:number}
type IndexItem={id:string;text:string}
/** Ids are `embeddingId(mail)` of loaded board mails; unknown ids are ignored. */
function indexItems(ids:string[]):IndexItem[]{
  const board=new Map((readBoard?.()||[]).map(m=>[embeddingId(m),m]))
  return [...new Set(ids)].flatMap(id=>{const m=board.get(id);return m?[{id,text:embedText(m)}]:[]})
}
async function indexCall<T>(command:string,args:Record<string,unknown>,items:IndexItem[]):Promise<T>{
  const invoke=native(), cfg=config()
  if(!embeddingsOn(cfg))throw new Error('Bitte die lokale KI und Embeddings in den Einstellungen aktivieren.')
  const done=embeddedFor(cfg), stamp=embeddedStamp
  const result=await invoke<T>(command,{url:cfg.embedUrl,model:cfg.embedModel,...args})
  if(embeddedStamp===stamp)for(const item of items)done.add(item.id)
  return result
}
/** Similarity over the background embeddings; vectors stay in Rust, only scores come back. */
export const embeddingIndex={
  ready(ids:string[]):string[]{
    const cfg=config()
    if(!liveSource||!embeddingsOn(cfg))return []
    const done=embeddedFor(cfg)
    return ids.filter(id=>done.has(id))
  },
  rank(query:string,ids:string[]):Promise<{id:string;score:number}[]>{
    const items=indexItems(ids)
    return indexCall('ai_rank',{query,items},items)
  },
  /** Ähnlichkeit der Mails `ids` zum Text von `mail` (K5, „Ähnliche Mails“). */
  similar(mail:AiMail,ids:string[]):Promise<{id:string;score:number}[]>{return this.rank(embedText(mail),ids)},
  groups(groups:{name:string;ids:string[]}[],ids:string[]):Promise<GroupMatch[]>{
    const sets=groups.map(g=>({name:g.name,items:indexItems(g.ids)})), items=indexItems(ids)
    return indexCall('ai_groups',{groups:sets,items},[...sets.flatMap(g=>g.items),...items])
  },
}
/** Verdächtige Lernmail (E3). `id` ist `embeddingId(mail)`, `own`/`other` die Ähnlichkeit zum eigenen bzw. besten fremden Profil. */
export type Outlier={id:string;folder:string;suggested:string;own:number;other:number}
/** Ob Embeddings eingeschaltet sind. Ohne sie prüft die Ausreißerprüfung mit Bayes. */
export function embeddingsEnabled(){return liveSource&&embeddingsOn(config())}
/**
 * Ausreißer über den Vektor-Cache (`ai_outliers`): Ähnlichkeit zum eigenen Profil ohne die Mail gegen das beste fremde Profil.
 * Verdächtig ab `margin` Vorsprung und über der Ablageschwelle (`embedding_threshold`). Gleicher Einbettungstext wie beim Lernen.
 */
export async function embeddingOutliers(groups:{key:string;mails:AiMail[]}[],margin=0.05):Promise<Outlier[]>{
  const invoke=native(),cfg=config()
  if(!embeddingsOn(cfg))throw new Error('Bitte die lokale KI und Embeddings in den Einstellungen aktivieren.')
  return invoke<Outlier[]>('ai_outliers',{url:cfg.embedUrl,model:cfg.embedModel,threshold:Number(getLegacyConfig().embedding_threshold??0.78),margin,
    folders:groups.map(g=>({key:g.key,items:g.mails.map(m=>({id:embeddingId(m),text:embedText(m)}))}))})
}
/** Start der Gruppierung: Mails mit Kosinus ab diesem Wert zum Gruppenmittel gehören zusammen. */
export const CLUSTER_THRESHOLD=0.82
/** Gruppen mit weniger Mails entfallen. */
export const CLUSTER_MIN=5
/**
 * Gruppen ähnlicher Mails über den Vektor-Cache (`ai_clusters`), größte zuerst (E4, neue Ordner aus dem Posteingang).
 * Mails mit gleichem Einbettungstext zählen als eine Anfrage und landen zusammen in einer Gruppe.
 */
export async function embeddingClusters<T extends AiMail>(mails:T[],minSize=CLUSTER_MIN,threshold=CLUSTER_THRESHOLD):Promise<T[][]>{
  const invoke=native(),cfg=config()
  if(!embeddingsOn(cfg))throw new Error('Bitte die lokale KI und Embeddings in den Einstellungen aktivieren.')
  const byId=new Map<string,T[]>()
  for(const m of mails){const id=embeddingId(m);byId.set(id,[...(byId.get(id)??[]),m])}
  const items=[...byId.keys()].map(id=>({id,text:embedText(byId.get(id)![0])}))
  const found=await invoke<{ids:string[]}[]>('ai_clusters',{url:cfg.embedUrl,model:cfg.embedModel,items,minSize,threshold})
  return found.map(c=>c.ids.flatMap(id=>byId.get(id)??[])).filter(g=>g.length>=minSize)
}
/**
 * Namensvorschlag der lokalen KI für eine Gruppe von Posteingangsmails (E4, `ai_cluster_name`) aus bis zu 20 Betreffs.
 * Der Aufrufer prüft das Ergebnis mit `cleanFolderName` und auf Dubletten.
 */
export async function suggestClusterName(subjects:string[]){
  const invoke=native(),cfg=config(),model=await activeModel(cfg,'clusterName')
  return invoke<string>('ai_cluster_name',{url:cfg.url,model,subjects:subjects.map(s=>s.slice(0,200)).filter(s=>s.trim()).slice(0,20)})
}
/**
 * Gespeicherte Ordnerprofile (Zentroiden aus dem Lernlauf) der Ordner `keys`, nur passend zum aktuellen Embedding-Modell
 * und nur mit eingeschalteten Embeddings. Grundlage für ähnliche Ordner in E4, ohne neuen Modellaufruf.
 */
export function profileVectors(keys:string[]):Record<string,number[]>{
  const cfg=config()
  if(!liveSource||!embeddingsOn(cfg))return {}
  const state=stored(centersKey) as Centers,options=JSON.stringify(embeddingOptions())
  return Object.fromEntries(keys.flatMap(key=>{
    const c=state[key]
    return c&&Array.isArray(c.vector)&&c.url===cfg.embedUrl&&c.model===cfg.embedModel&&c.options===options?[[key,c.vector]]:[]
  }))
}
/**
 * Namensvorschlag der lokalen KI für einen Ordner mit unklarem Namen (E4, `ai_folder_name`) aus Steckbrief und bis zu
 * 20 Beispielbetreffs. Der Aufrufer prüft das Ergebnis mit `cleanFolderName` und auf Dubletten.
 */
export async function suggestFolderName(folder:Folder){
  const invoke=native(),cfg=config(),model=await activeModel(cfg,'folderName')
  const mails:AiMail[]=JSON.parse(await invoke<string>('outlook_training',{folder:folder.id,limit:20,days:0}))
  const subjects=mails.map(m=>(m.subject||'').slice(0,200)).filter(s=>s.trim())
  if(!subjects.length)throw new Error('Im Ordner „'+(folder.path||folder.name)+'“ fehlen Mails für einen Namensvorschlag.')
  const profile=folderInfo([folder.path])[0]?.profile??''
  return invoke<string>('ai_folder_name',{url:cfg.url,model,key:folder.path,profile,subjects})
}
/** Beobachter für das Öffnen der Einstellungen. Beim Neuaufbau des KI-Bereichs wird der alte getrennt. */
let infoObserver:MutationObserver|undefined
export function renderAiSettings(container:HTMLElement,getTrainingFolders?:()=>Folder[],learningContainer=container) {
  learningFolders=getTrainingFolders
  const panel=document.createElement('div'),learnPanel=learningContainer===container?panel:document.createElement('div')
  container.append(panel);if(learnPanel!==panel)learningContainer.append(learnPanel)
  refreshAiPanel=()=>{
    panel.replaceChildren();learnPanel.replaceChildren()
    infoObserver?.disconnect();infoObserver=undefined
    if(liveSource)renderLiveAiSettings(panel,getTrainingFolders,learnPanel)
    else renderOfflineAiSettings(panel)
  }
  refreshAiPanel()
}
function renderOfflineAiSettings(container:HTMLElement) {
  const test=document.createElement('button');test.type='button';test.textContent='Verbindung testen';test.disabled=true
  const note=document.createElement('p');note.className='field-hint';note.textContent='Die lokale KI gibt es nur mit geöffnetem Outlook-Postfach.'
  container.append(note,test)
}
const sampleMail:AiMail={subject:'Rückfrage zur Lieferung',sender:'Beispiel Lieferant',body:'Guten Tag, wann wird unsere Bestellung 4711 geliefert? Bitte um kurze Rückmeldung bis Freitag.'}
/**
 * Zeile unter einem Modellfeld mit Größe, Quantisierung, Kontextlänge und Ladezustand (`ai_model_info`). Sendet nur den
 * Modellnamen an den lokalen Server. Lädt bei Modellwechsel neu, ältere Antworten werden verworfen.
 */
function modelInfoLine(input:HTMLInputElement,address:()=>string,enabled:()=>boolean,auto?:()=>Promise<string|undefined>){
  const line=document.createElement('p');line.className='field-hint model-info'
  line.id='model-info-'+(++modelInfoIds);input.setAttribute('aria-describedby',line.id)
  input.closest('label')?.after(line)
  let version=0
  const load=()=>{
    const mine=++version, typed=input.value.trim()
    if(!enabled()||(!typed&&!auto)){line.textContent='';return}
    line.textContent='Modellangaben werden geladen …'
    const failed=(error:unknown)=>{if(mine===version)line.textContent='Keine Modellangaben: '+(error instanceof Error?error.message:String(error))}
    void (async()=>{
      // Leeres Feld mit automatischer Auswahl: Angaben zum Modell, das das Board tatsächlich nimmt.
      const name=typed||await auto!()
      if(mine!==version)return
      if(!name){line.textContent='';return}
      const info=await native()<unknown>('ai_model_info',{url:address().trim(),model:name})
      if(mine===version)line.textContent=(typed?'':'automatisch: '+name+' · ')+formatModelInfo(info)
    })().catch(failed)
  }
  input.addEventListener('change',load)
  return load
}
let modelInfoIds=0
function renderLiveAiSettings(container:HTMLElement,getTrainingFolders?:()=>Folder[],learningContainer=container) {
  const epoch=sourceEpoch
  const cfg=config()
  const section=document.createElement('fieldset')
  section.className='ai-section'
  const legend=document.createElement('legend');legend.textContent='Lokale KI · Ollama, llama.cpp oder LM Studio'
  section.append(legend)
  const bool=(title:string,v:boolean,hint?:string,target:HTMLElement=section)=>{
    const label=document.createElement('label'),input=document.createElement('input')
    input.type='checkbox';input.checked=v;label.append(input,' '+title);target.append(label)
    if(hint){
      const note=document.createElement('p');note.className='field-hint';note.textContent=hint
      note.id='hint-'+title.replace(/\W+/g,'-').toLowerCase();input.setAttribute('aria-describedby',note.id);target.append(note)
    }
    return input
  }
  const field=(title:string,v:string)=>{
    const label=document.createElement('label'),input=document.createElement('input')
    input.value=v;label.append(title,input);section.append(label);return input
  }
  const on=bool('Lokale KI verwenden',cfg.enabled)
  const url=field('Adresse des lokalen Modellservers',cfg.url)
  const model=field('Modell für Hintergrund',cfg.model)
  model.placeholder='Automatisch auswählen'
  const draftModel=field('Modell für Entwürfe',cfg.draftModel)
  draftModel.placeholder='wie Hintergrund'
  const roles=document.createElement('p');roles.className='field-hint'
  roles.textContent='Hintergrund: Analyse, Stichwahl und Aufgaben. Entwürfe: Antworten, Steckbriefe und Ordnernamen. Beide müssen lokal laufen.'
  section.append(roles)
  const learnSection=document.createElement('div')
  const autoLearn=bool('Lernordner stündlich aktualisieren',cfg.autoLearn,'Liest die Lernordner jede Stunde neu ein.',learnSection)
  const trainingState=document.createElement('p');trainingState.id='aiTrainingState';trainingState.setAttribute('role','status')
  trainingState.textContent=lastTraining;learnSection.append(trainingState)
  const auto=bool('Geladene Outlook-Mails im Hintergrund analysieren',cfg.auto,'Analysiert geladene Mails nacheinander mit dem Sprachmodell. Belastet Rechner und Grafikkarte, solange sie läuft.')
  const context=bool('Verlauf und Anhänge mitschicken',cfg.context,'Die Analyse bekommt bis zu drei frühere Nachrichten der Unterhaltung und die Anhangnamen. Beides gilt nur als Daten.')
  const queue=document.createElement('p');queue.id='aiQueueState';queue.setAttribute('role','status');queue.textContent=queueStatus;section.append(queue)
  const embeddings=bool('Ordner mit Embeddings vergleichen',cfg.embeddings,'Vergleicht Mails mit gelernten Ordnerprofilen und bettet geladene Mails im Hintergrund ein. Schnell, braucht das Embedding-Modell.')
  const styleBox=document.createElement('textarea')
  styleBox.rows=5
  styleBox.value=savedStyleText()
  styleBox.setAttribute('aria-label','Stilsteckbrief')
  const styleHint=document.createElement('p');styleHint.className='field-hint'
  styleHint.textContent='Einmal aus gesendeten Mails lernen, dann prüfen und speichern. Kein automatisches Nachlernen. Der Text gilt als Daten.'
  const learnStyle=document.createElement('button');learnStyle.type='button';learnStyle.textContent='Stil aus gesendeten Mails lernen'
  const saveStyle=document.createElement('button');saveStyle.type='button';saveStyle.textContent='Stilsteckbrief speichern'
  section.append(styleHint,styleBox,learnStyle,saveStyle)
  const embedModel=field('Embedding-Modell',cfg.embedModel)
  const embedUrl=field('Adresse des lokalen Embedding-Servers',cfg.embedUrl)
  const list=document.createElement('datalist')
  list.id='local-models-list';model.setAttribute('list',list.id);draftModel.setAttribute('list',list.id);embedModel.setAttribute('list',list.id)
  const check=document.createElement('button');check.type='button';check.textContent='Lokale Modelle laden'
  const save=document.createElement('button');save.type='button';save.textContent='KI-Einstellungen speichern'
  const test=document.createElement('button');test.type='button';test.textContent='Verbindung testen'
  const feedback=document.createElement('p');feedback.setAttribute('role','status')
  section.append(list,check,test,save,feedback);container.append(section)
  learnStyle.onclick=async()=>{
    if(!liveSource){feedback.textContent='Den Schreibstil gibt es nur im Outlook-Postfach.';return}
    learnStyle.disabled=true
    feedback.textContent='Schreibstil wird aus gesendeten Mails gelesen …'
    try{
      const probe={...config(),enabled:on.checked,url:url.value.trim(),model:model.value.trim(),draftModel:draftModel.value.trim()}
      const samples=await sentSamples()
      if(!samples.length)throw new Error('Keine gesendeten Mails.')
      const card=await native()<StyleCard>('ai_style',{url:probe.url,model:await activeModel(probe,'reply'),samples:samples.map(sample=>({sender:sample.to,subject:sample.subject,body:sample.text}))})
      if(current(epoch)){styleBox.value=styleText(card);feedback.textContent='Stilsteckbrief prüfen und speichern. Er wird nicht von allein erneuert.'}
    }catch(error){if(current(epoch))feedback.textContent=error instanceof Error?error.message:String(error)}
    finally{learnStyle.disabled=false}
  }
  saveStyle.onclick=()=>{
    localStorage.setItem(styleKey,JSON.stringify({text:styleBox.value,form:formOf(styleBox.value)}))
    feedback.textContent='Stilsteckbrief gespeichert.'
  }
  // A1: Angaben zu jedem gewählten Modell, beim Öffnen der Einstellungen und nach einem Modellwechsel.
  const chosen=async()=>firstChatModel(await native()<string[]>('ai_models',{url:url.value.trim()}))
  const infos=[modelInfoLine(model,()=>url.value,()=>on.checked,chosen),modelInfoLine(draftModel,()=>url.value,()=>on.checked),
    modelInfoLine(embedModel,()=>embedUrl.value,()=>on.checked&&embeddings.checked)]
  const loadInfos=()=>{if(current(epoch))for(const load of infos)load()}
  const dialog=container.closest('dialog')
  infoObserver?.disconnect();infoObserver=undefined
  if(dialog){
    infoObserver=new MutationObserver(()=>{if(dialog.open&&section.isConnected)loadInfos()})
    infoObserver.observe(dialog,{attributes:true,attributeFilter:['open']})
    if(dialog.open)loadInfos()
  }else loadInfos()
  for(const input of [url,embedUrl])input.addEventListener('change',loadInfos)
  for(const toggle of [on,embeddings])toggle.addEventListener('change',loadInfos)
  learningContainer.append(learnSection)
  renderLearning(learningContainer,getTrainingFolders)
  test.onclick=async()=>{
    test.disabled=true;feedback.textContent='Verbindung wird getestet …'
    try{
      const probe={...config(),enabled:on.checked,url:url.value.trim(),model:model.value.trim(),draftModel:draftModel.value.trim(),embedModel:embedModel.value.trim()}
      const names=await native()<string[]>('ai_models',{url:probe.url})
      const chat=await activeModel(probe,'analyze'), writer=await activeModel(probe,'reply')
      // Das Entwurfsmodell bekommt hier keine Mail, nur denselben Lokalitätsnachweis wie vor jedem Entwurf.
      if(writer!==chat)try{await native()('ai_model_info',{url:probe.url,model:writer})}
      catch(error){throw new Error('Modell für Entwürfe „'+writer+'“: '+(error instanceof Error?error.message:String(error)))}
      const embed=names.some(n=>n===probe.embedModel||n.replace(/:latest$/,'')===probe.embedModel.replace(/:latest$/,''))
      const started=performance.now()
      await analyze(sampleMail,[],probe)
      const seconds=((performance.now()-started)/1000).toLocaleString('de-DE',{maximumFractionDigits:1})
      if(current(epoch))feedback.textContent='Outlook: verbunden · Hintergrundmodell: '+chat+' · Entwurfsmodell: '+(writer===chat?'wie Hintergrund':writer+' (lokal geprüft)')+' · Embedding-Modell '+probe.embedModel+': '+(embed?'vorhanden':'nicht gefunden')+' · Antwortzeit: '+seconds+' s'
    }catch(error){if(current(epoch))feedback.textContent='Verbindung fehlgeschlagen: '+(error instanceof Error?error.message:String(error))}
    finally{test.disabled=false}
  }
  check.onclick=async()=>{
    check.disabled=true;feedback.textContent='Lokaler Modellserver wird geprüft …'
    try{
      const names=await native()<string[]>('ai_models',{url:url.value})
      list.replaceChildren(...names.map(n=>new Option(n,n)))
      feedback.textContent=names.length?'Installierte Modelle: '+names.join(', '):'Keine lokalen Modelle installiert.'
    }catch(error){feedback.textContent=String(error)}
    finally{check.disabled=false}
  }
  save.onclick=()=>{
    if(!current(epoch))return
    try{
      for(const field of [url,embedUrl]){
      const address=new URL(field.value)
      if(address.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(address.hostname) || address.username || address.password || address.pathname!=='/' || address.search || address.hash) throw Error('Bitte eine lokale HTTP-Adresse ohne Pfad angeben.')
      }
      localStorage.setItem(settingsKey,JSON.stringify({enabled:on.checked,auto:auto.checked,autoLearn:autoLearn.checked,context:context.checked,url:url.value.trim(),model:model.value.trim(),draftModel:draftModel.value.trim(),embeddings:embeddings.checked,embedModel:embedModel.value.trim(),embedUrl:embedUrl.value.trim()}))
      feedback.textContent='KI-Einstellungen gespeichert.'
      void queueAnalyses()
    }catch(error){feedback.textContent=String(error)}
  }
}

/** Ergebnis eines Testlaufs: Auswertung, Lernbeispiele je Ordner und ein Hinweis zum Semantikvergleich. */
/** Ergebnis von `measureLearning`. `folders`: Lernordner der Messung (Einrichtung E2/E6), bei älteren Messungen fehlt die Liste. */
export type Measurement={date:string;report:EvaluationResult;samples:Record<string,number>;note:string;folders?:string[]}
/**
 * Testlauf auf den gespeicherten Lernbeispielen: je Ordner bleiben die zehn neuesten Mails zurück (`evaluateHoldout`).
 * Mit lokaler KI und Embeddings fließt der Vektorvergleich ein, sonst nur Bayes und Regeln. Speichert das Ergebnis für die Ablage-Auswertung.
 */
export async function measureLearning(folders?:Folder[],progress?:(message:string)=>void):Promise<Measurement>{
  const epoch=sourceEpoch
  requireLive(epoch)
  const cfg=config(),legacy=getLegacyConfig(),rows=history(trainingKey)
  const scope=folders?.map(f=>f.path)??[...new Set(rows.map(r=>r.folder))]
  const targets=scope.filter(allowed),valid=new Set(targets),{test}=splitHoldout(rows.filter(r=>valid.has(r.folder)))
  if(!test.length)throw new Error('Für den Testlauf braucht ein gewählter Lernordner mindestens 13 Beispiele (10 für den Test, mindestens 3 zum Lernen).')
  const heldByFolder=new Map<string,Set<string>>()
  for(const row of test){
    if(!row.id)continue
    const ids=heldByFolder.get(row.folder)??new Set<string>();ids.add(row.id);heldByFolder.set(row.folder,ids)
  }
  const centers=stored(centersKey) as Centers,options=JSON.stringify(embeddingOptions())
  const semanticFolders=Object.entries(centers).flatMap(([key,c])=>{
    if(!valid.has(key)||!c.index||c.memberIds?.length!==c.index.members.length||c.url!==cfg.embedUrl||c.model!==cfg.embedModel||c.options!==options)return []
    const ids=heldByFolder.get(key)
    const held=Object.fromEntries(c.memberIds.flatMap((id,i)=>ids?.has(id)?[[i,id]]:[]))
    return [{key,index:c.index,held}]
  })
  let semantic:SemanticEvaluation|undefined
  if(cfg.enabled&&cfg.embeddings&&semanticFolders.length){
    progress?.('Gespeicherte Vektoren werden mit den zurückgehaltenen Mails verglichen …')
    semantic=await native()<SemanticEvaluation>('ai_holdout',{folders:semanticFolders,weight:embeddingOptions().profileWeight,
      threshold:Number(legacy.embedding_threshold??0.78),margin:Number(legacy.embedding_min_margin??0.03)})
  }
  requireLive(epoch)
  const hidden=Array.isArray(legacy.hidden_sources)?legacy.hidden_sources.map(String):[]
  const report=evaluateHoldout(rows,targets,rules(),hidden,semantic)
  const note=cfg.enabled&&cfg.embeddings&&!semanticFolders.length?' Für den Semantikvergleich bitte die Lernordner aktualisieren.':''
  const date=new Date().toLocaleDateString('de')
  const stats=stored(statisticsKey)
  localStorage.setItem(statisticsKey,JSON.stringify({...stats,evaluation:{date,report}}))
  const samples:Record<string,number>=Object.fromEntries(targets.map(key=>[key,0]))
  for(const row of rows)if(valid.has(row.folder))samples[row.folder]++
  return {date,report,samples,note}
}
/** Ob die lokale KI eingeschaltet ist. Ohne sie lernt und misst das Board nur mit Bayes und Regeln. */
export function localAiEnabled(){return config().enabled}
export function renderLearningDashboard(container:HTMLElement){
  if(!liveSource){
    const note=document.createElement('p');note.textContent='Die Ablage-Auswertung verwendet die Lernordner deines geöffneten Outlook-Postfachs.'
    container.append(note);return
  }
  renderLearning(container,learningFolders,true)
}
function renderLearning(container:HTMLElement,getTrainingFolders?:()=>Folder[],expanded=false) {
  const epoch=sourceEpoch
  const details=document.createElement('details')
  const title=document.createElement('summary');title.textContent='Ablageregeln und Lernstatistik'
  const label=document.createElement('label')
  label.append('Feste Regeln (eine je Zeile: Absender oder Domain → Ordnerpfad)')
  const editor=document.createElement('textarea');editor.rows=4
  editor.placeholder='domain:lieferant.de → Einkauf'
  editor.value=rules().map(v=>String(object(v).match)+' → '+String(object(v).folder)).join('\n')
  label.append(editor)
  const button=(name:string)=>{const b=document.createElement('button');b.type='button';b.textContent=name;return b}
  const apply=button('Regeln speichern'),train=button('Aus Lernordnern lernen'),evaluate=button('Testlauf starten')
  const status=document.createElement('p');status.setAttribute('role','status')
  const metrics=document.createElement('div')
  const domainRules=document.createElement('div')
  details.append(title,label,apply,train,evaluate,status,metrics,domainRules)
  container.append(details)
  function refresh(){
    if(!current(epoch)){details.remove();return}
    const examples=history(trainingKey),recent=history()
    const trained=new Set(examples.map(r=>r.folder)).size
    metrics.replaceChildren()
    function line(s:string){const p=document.createElement('p');p.textContent=s;metrics.append(p)}
    line(examples.length+' Lernbeispiele aus '+trained+' Ordnern · '+recent.length+' bestätigte Ablagen.')
    const types=typeState()
    for(const [key,proposal] of types.proposals){
      if(proposal.keys.length<3||knownTypes().some(t=>fold(t)===key))continue
      const row=document.createElement('div')
      const accept=button('Art übernehmen'),discard=button('Art verwerfen')
      row.append(proposal.name+' · '+proposal.keys.length+' Mails ',accept,discard);metrics.append(row)
      accept.onclick=()=>{updateConfig({mail_types:[...knownTypes(),proposal.name]});types.proposals.delete(key);saveTypes(types);refresh()}
      discard.onclick=()=>{types.proposals.delete(key);types.discarded.push(key);saveTypes(types);refresh()}
    }
    const last=object(stored(statisticsKey).evaluation)
    if(last.report){
      line('Letzter Testlauf am '+last.date);renderEvaluation(metrics,last.report as EvaluationResult)
    }else if(last.text)line('Letzter Testlauf am '+last.date+' · '+last.text)
    for(const [name,n] of Object.entries(sourceStats()))line(name+': '+n.correct+' übernommen · '+n.wrong+' abweichend')
    try{
      const imported=getLegacyFile('vorschlag-statistik.json')
      if(imported){
        for(const [source,count] of Object.entries(object(JSON.parse(imported).sources))){
          const n=object(count);line('Python-Import · '+source+': '+Number(n.correct||0)+' richtig, '+Number(n.wrong||0)+' abweichend')
        }
      }
    }catch{ /* Missing legacy metrics do not affect native learning. */ }
    const domains=new Map<string,Map<string,number>>()
    for(const row of examples){
      const sender=row.features.find(t=>t.startsWith('e:'))?.slice(2)
      const domain=sender?.split('@')[1]
      if(!domain||['googlemail.com','gmail.com','web.de','gmx.de','outlook.com','hotmail.com','yahoo.com','icloud.com'].includes(domain))continue
      const counts=domains.get(domain)||new Map<string,number>()
      counts.set(row.folder,(counts.get(row.folder)||0)+1);domains.set(domain,counts)
    }
    domainRules.replaceChildren()
    for(const [domain,counts] of domains){
      const [folder,n]=[...counts].sort((a,b)=>b[1]-a[1])[0]
      const total=[...counts.values()].reduce((a,b)=>a+b,0)
      if(total<5||n/total<0.9||editor.value.toLowerCase().includes('domain:'+domain.toLowerCase()+' '))continue
      const add=button('Regel vorschlagen: '+domain+' → '+folder+' ('+n+'/'+total+')')
      add.onclick=()=>{editor.value+=(editor.value?'\n':'')+'domain:'+domain+' → '+folder;add.disabled=true;status.textContent='Regel prüfen und speichern.'}
      domainRules.append(add)
    }
  }
  details.ontoggle=()=>{if(details.open)refresh()}
  if(expanded){details.open=true;refresh()}
  apply.onclick=()=>{
    if(!current(epoch))return
    try {
      const items=editor.value.split(/\r?\n/).filter(row=>row.trim()).map((line,i)=>{
        const fields=line.split(/→|->/).map(s=>s.trim())
        if(fields.length!==2 || !fields[0] || !allowed(fields[1]))throw Error('Regel in Zeile '+(i+1)+' prüfen.')
        return {match:fields[0],folder:fields[1]}
      })
      localStorage.setItem('outlook-kanban-ai-rules-v1',JSON.stringify({items}))
      status.textContent=items.length+' Regeln gespeichert.';refresh()
    }catch(e){status.textContent=String(e)}
  }
  train.onclick=async()=>{
    if(!current(epoch))return
    train.disabled=true
    try{
      const r=await trainFromFolders(getTrainingFolders?.()||[],s=>{status.textContent=s})
      status.textContent=r.count+' Lernbeispiele. '+(r.failures.length?'Nicht gelesen: '+r.failures.join(' · '):'Lernen abgeschlossen.')
      refresh()
    }catch(error){status.textContent=String(error)}
    finally{train.disabled=false}
  }
  evaluate.onclick=async()=>{
    if(!current(epoch))return
    evaluate.disabled=true
    try{
      const {report,note}=await measureLearning(getTrainingFolders?.(),text=>{status.textContent=text})
      status.textContent='Testlauf abgeschlossen. '+report.combined.correct+' richtige Ablagen bei '+report.combined.shown+' Vorschlägen.'+note
      refresh()
    }catch(error){status.textContent=error instanceof Error?error.message:String(error)}
    finally{evaluate.disabled=false}
  }
}
