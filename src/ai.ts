import { getLegacyConfig, getLegacyProfiles, getLegacyFile, updateConfig } from './data-settings'
import type { Folder, Invoke } from './live'

export type AiMail = {subject:string; sender:string; body:string; senderEmail?:string; conversationId?:string; received?:string;id?:string;storeId?:string;folder?:string;folderPath?:string;tags?:string[];needsReply?:boolean;deadline?:string;aiSummary?:string;aiTypes?:string[]}
type Suggestion = {folder:string;reason:string}
type FolderInfo = {key:string;profile:string}
type Analysis = {zusammenfassung:string;antwort_noetig:boolean;frist:string|null;ordner:string|null;arten:string[]}
type Config = {enabled:boolean;auto:boolean;autoLearn:boolean;embeddings:boolean;url:string;embedUrl:string;model:string;embedModel:string}
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
  training=undefined;processing=false;retryAt=0;retryDelay=120000;lastTraining='';queueStatus=''
  recent=undefined;legacyCache=undefined;importedCache.clear()
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
    url:String(own.url||old.llm_url||'http://127.0.0.1:11434'),
    embedUrl:String(own.embedUrl||old.embedding_url||own.url||old.llm_url||'http://127.0.0.1:11434'),
    model:String(own.model??old.llm_model??''), embedModel:String(own.embedModel||old.embedding_model||'qwen3-embedding:0.6b'),
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
function features(m:AiMail):string[] {
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
type LearnRow = { folder:string; features:string[]; id?:string; received?:string }
const trainingKey='outlook-kanban-ai-training-v1'
const statisticsKey='outlook-kanban-ai-statistics-v1'
const sourceHints = new WeakMap<AiMail,Suggestion>()
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
export function rejectSuggestion(mail:AiMail, folder:string) {
  if(!liveSource)return
  const id=feedbackId(mail)
  if(!id||!allowed(folder)||rejected(mail).includes(folder))return
  const stats=stored(statisticsKey)
  const mapping=object(stats.rejected)
  delete mapping[id]
  mapping[id]=[...rejected(mail),folder]
  localStorage.setItem(statisticsKey,JSON.stringify({...stats,rejected:Object.fromEntries(Object.entries(mapping).slice(-500))}))
  const hint=sourceHints.get(mail)
  if(hint && hint.folder===folder){rate(hint.reason,false);sourceHints.delete(mail)}
}
export function recordFiling(mail:AiMail,folder:string) {
  if(!liveSource)return
  if(!allowed(folder))return
  const rows=history()
  rows.push({folder,features:features(mail),id:mail.id,received:mail.received})
  // Outlook has already committed the move when this callback runs.
  try{
    localStorage.setItem(feedbackKey,JSON.stringify({rows:rows.slice(-3000)}))
    const hint=sourceHints.get(mail)
    if(hint?.folder){rate(hint.reason,hint.folder===folder);sourceHints.delete(mail)}
  }catch{ /* Local statistics are best effort if WebView storage is full. */ }
}
const weight=(token:string)=>token.startsWith('c:')?4:token.startsWith('e:')?2:1
/** Multinomial Bayes over sender and subject, with the reference's minimum support and certainty. */
function classifier(rows:LearnRow[]) {
  const vocab=new Set<string>()
  const groups=new Map<string,{docs:number;total:number;counts:Map<string,number>}>()
  const conversations=new Map<string,Map<string,number>>()
  for(const row of rows){
    const group=groups.get(row.folder)??{docs:0,total:0,counts:new Map<string,number>()}
    group.docs++;groups.set(row.folder,group)
    for(const token of row.features){
      vocab.add(token)
      const w=weight(token);group.total+=w
      group.counts.set(token,(group.counts.get(token)||0)+w)
      if(token.startsWith('c:')){
        const votes=conversations.get(token)??new Map<string,number>()
        votes.set(row.folder,(votes.get(row.folder)||0)+1);conversations.set(token,votes)
      }
    }
  }
  return (feat:string[]):Suggestion|undefined=>{
    const conv=feat.find(t=>t.startsWith('c:'))
    const matches=[...(conversations.get(conv||'')||[])].sort((a,b)=>b[1]-a[1])
    if(matches.length && matches[0][1]>=3*(matches[1]?.[1]||0))return {folder:matches[0][0],reason:'Frühere Ablage dieser Unterhaltung'}
    const known=feat.filter(t=>vocab.has(t))
    if(!known.length||known.every(t=>t.startsWith('w:'))&&known.length<2)return
    const ranked=[...groups.entries()].filter(([,g])=>g.docs>=3).map(([folder,g])=>{
      const score=Math.log(g.docs)+known.reduce((n,t)=>n+weight(t)*Math.log(((g.counts.get(t)||0)+1)/(vocab.size+g.total)),0)
      return {folder,score}
    }).sort((a,b)=>b.score-a.score)
    if(!ranked.length)return
    const best=ranked[0],prob=1/ranked.reduce((n,r)=>n+Math.exp(r.score-best.score),0)
    if(prob>=0.85)return {folder:best.folder,reason:'Aus früheren Ablagen gelernt'}
  }
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
type EvaluationResult={tested:number;folders:number;combined:Tally;bayes:Tally;rule:Tally;sources:Partial<Record<Source,Tally>>;
  embedding:Tally|null;plain:Tally|null;semanticTested:number;missing:number}
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
    semanticTested:semantics?.tested??0,missing:semantics?.missing??0}
  for(const row of test){
    const bayes=predict(row.features)?.folder, sender=row.features.find(f=>f.startsWith('e:'))?.slice(2)||''
    count(result.bayes,bayes,row.folder)
    const rule=hidden.includes('Regel')?undefined:ruleForSender(sender,destinations,configuredRules)?.folder
    count(result.rule,rule,row.folder)
    const hit=row.id?evidence.get(JSON.stringify([row.folder,row.id])):undefined
    const sem=hit&&valid.has(hit.folder)?hit:undefined
    const final=rule?{folder:rule,source:'Regel' as const}:combineForecast(bayes,sem)
    if(!final||hidden.includes(final.source))continue
    count(result.combined,final.folder,row.folder)
    count(result.sources[final.source]??=tally(),final.folder,row.folder)
  }
  return result
}
function renderEvaluation(parent:HTMLElement,result:EvaluationResult){
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
  const selected=samples.slice(0,Math.min(300,Math.max(1,Number(getLegacyConfig().embedding_samples)||150)))
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
  const cfg=config(), model=await activeModel(cfg)
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
async function learnFolders(folders:Folder[],progress?:(message:string)=>void) {
  const epoch=sourceEpoch,invoke=native(), cfg=getLegacyConfig()
  const limit=300
  const days=Math.max(0,Math.min(3650,Number(cfg.learn_max_days??730)))
  const known=history(trainingKey)
  const rows:LearnRow[]=[], failures:string[]=[],semanticFailures:string[]=[]
  const ai=config(),centers:Centers=Object.create(null), oldCenters=stored(centersKey) as Centers
  const targets=folders.filter(f=>!f.isInbox && allowed(f.path))
  if(!targets.length)throw new Error('Bitte Outlook laden und mindestens einen Lernordner auswählen.')
  for(const [index,f] of targets.entries()){
    requireLive(epoch)
    progress?.('Lese '+f.path+' ('+(index+1)+'/'+targets.length+') …')
    try{
      const samples:AiMail[]=JSON.parse(await invoke<string>('outlook_training',{folder:f.id,limit,days}))
      if(ai.enabled&&ai.embeddings&&samples.length){
        try{centers[f.path]=await trainCenter(f.path,samples,ai)}
        catch(e){semanticFailures.push(f.path+': '+String(e));if(oldCenters[f.path])centers[f.path]=oldCenters[f.path]}
      }
      rows.push(...samples.map(m=>({folder:f.path,id:m.id,received:m.received,features:features(m)})))
    }catch(err){failures.push(f.path+': '+String(err));rows.push(...known.filter(r=>r.folder===f.path));if(oldCenters[f.path])centers[f.path]=oldCenters[f.path]}
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

async function activeModel(cfg:Config) {
  if(!cfg.enabled)throw new Error('Lokale KI ist ausgeschaltet.')
  const invoke=native()
  const model=cfg.model.trim() || (await invoke<string[]>('ai_models',{url:cfg.url})).find(s=>!s.toLowerCase().includes('embed'))
  if(!model)throw new Error('Bitte in den Einstellungen ein lokal installiertes Sprachmodell wählen.')
  return model
}
export async function localChatModel() {
  requireLive()
  const cfg=config()
  return {url:cfg.url,model:await activeModel(cfg)}
}
async function analyze(m:AiMail, folders:FolderInfo[],cfg:Config) {
  const invoke=native(), model=await activeModel(cfg)
  return invoke<Analysis>('ai_analyze',{url:cfg.url, model,mail:m,folders})
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
function signature(mail:AiMail){
  let hash=2166136261
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
  Object.assign(mail,{needsReply:result.antwort_noetig,deadline:result.frist||'',aiSummary:result.zusammenfassung,aiTypes:result.arten})
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
    return match&&!ignored.includes(match.folder)?match:undefined
  }
}
export function trustedFolder(mail:AiMail,folders:string[]){
  return trustedFolderBatch(folders)(mail)
}
export async function suggestFolder(mail:AiMail, folders:string[]):Promise<Suggestion> {
  const epoch=sourceEpoch
  if(!liveSource){
    const match=lexical(mail,folders.filter(allowed).map(key=>({key,profile:''})))
    return match?{folder:match.folder,reason:'Begriff aus dem Beispielordner'}:{folder:'',reason:'Kein eindeutiger Beispielordner gefunden.'}
  }
  const dismissed=rejected(mail)
  const targets=folderInfo(folders.filter(f=>!dismissed.includes(f)))
  const hint=await chooseFolder(mail,targets)
  requireLive(epoch)
  if(hint.folder)sourceHints.set(mail,hint)
  return hint
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
            const choice=(await analyze(mail,two,cfg)).ordner
            if(two.some(f=>f.key===choice))return {folder:choice!,reason:'KI-Stichwahl · '+detail}
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
      if(insight.ordner && targets.some(f=>f.key===insight.ordner))return {folder:insight.ordner,reason:'Vorschlag der lokalen KI'}
    }catch(error){issues.push(String(error))}
  }
  if(local)return {...local,reason:local.reason+(issues.length?' · KI nicht verfügbar':'')}
  return {folder:'',reason:['Kein eindeutiger Ablagevorschlag.',...new Set(issues)].join(' ')}
}
export function renderAnalysis(container:HTMLElement, mail:AiMail, folders:string[],
    openDraft?:(text:string)=>Promise<void>, applyTags?:(tags:string[])=>Promise<void>) {
  container.replaceChildren()
  if(!liveSource)return
  const epoch=sourceEpoch, cfg=config()
  if(!cfg.enabled)return
  const button=document.createElement('button')
  button.type='button';button.textContent='Mit lokaler KI analysieren'
  const feedback=document.createElement('p')
  feedback.setAttribute('role','status')
  const types=document.createElement('div')
  const show=(result:Analysis)=>{
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
  container.append(button,feedback,types)
  const cached=lookupAnalysis(mail)
  if(cached)show(cached)
  button.onclick=async()=>{
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
  if(openDraft){
    const generate=document.createElement('button');generate.type='button';generate.textContent='KI-Antwort entwerfen'
    const draft=document.createElement('textarea');draft.hidden=true;draft.rows=6;draft.setAttribute('aria-label','KI-Antwort vor dem Öffnen bearbeiten')
    const open=document.createElement('button');open.type='button';open.hidden=true;open.textContent='Als Entwurf in Outlook öffnen'
    generate.onclick=async()=>{
      if(!current(epoch))return
      generate.disabled=true; feedback.textContent='Antwortvorschlag wird erstellt …'
      try{
        const key=mail.folderPath||mail.folder||''
        const profiles=getLegacyProfiles()
        draft.value=await native()<string>('ai_reply',{url:cfg.url,model:await activeModel(cfg),mail,profile:profiles[key]||profiles[key.replace(/^\//,'')]||''})
        draft.hidden=false;open.hidden=false;feedback.textContent='Antwortvorschlag prüfen und bei Bedarf bearbeiten.'
      }catch(error){feedback.textContent=String(error)}
      finally{generate.disabled=false}
    }
    open.onclick=async()=>{
      if(!current(epoch)||!draft.value.trim())return
      open.disabled=true
      try{await openDraft(draft.value)}catch(error){feedback.textContent=String(error)}
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
export function renderAiSettings(container:HTMLElement,getTrainingFolders?:()=>Folder[]) {
  learningFolders=getTrainingFolders
  const panel=document.createElement('div')
  container.replaceChildren(panel)
  refreshAiPanel=()=>{
    panel.replaceChildren()
    if(liveSource)renderLiveAiSettings(panel,getTrainingFolders)
  }
  refreshAiPanel()
}
function renderLiveAiSettings(container:HTMLElement,getTrainingFolders?:()=>Folder[]) {
  const epoch=sourceEpoch
  const cfg=config()
  const section=document.createElement('fieldset')
  section.className='ai-section'
  const legend=document.createElement('legend');legend.textContent='Lokale KI · Ollama oder llama.cpp'
  section.append(legend)
  const bool=(title:string,v:boolean)=>{
    const label=document.createElement('label'),input=document.createElement('input')
    input.type='checkbox';input.checked=v;label.append(input,' '+title);section.append(label);return input
  }
  const field=(title:string,v:string)=>{
    const label=document.createElement('label'),input=document.createElement('input')
    input.value=v;label.append(title,input);section.append(label);return input
  }
  const on=bool('Lokale KI verwenden',cfg.enabled)
  const url=field('Adresse des lokalen Modellservers',cfg.url)
  const model=field('Sprachmodell',cfg.model)
  model.placeholder='Automatisch auswählen'
  const autoLearn=bool('Lernordner stündlich aktualisieren',cfg.autoLearn)
  const trainingState=document.createElement('p');trainingState.id='aiTrainingState';trainingState.setAttribute('role','status')
  trainingState.textContent=lastTraining;section.append(trainingState)
  const auto=bool('Geladene Outlook-Mails im Hintergrund analysieren',cfg.auto)
  const queue=document.createElement('p');queue.id='aiQueueState';queue.setAttribute('role','status');queue.textContent=queueStatus;section.append(queue)
  const embeddings=bool('Ordner mit Embeddings vergleichen',cfg.embeddings)
  const embedModel=field('Embedding-Modell',cfg.embedModel)
  const embedUrl=field('Adresse des lokalen Embedding-Servers',cfg.embedUrl)
  const list=document.createElement('datalist')
  list.id='local-models-list';model.setAttribute('list',list.id);embedModel.setAttribute('list',list.id)
  const check=document.createElement('button');check.type='button';check.textContent='Lokale Modelle laden'
  const save=document.createElement('button');save.type='button';save.textContent='KI-Einstellungen speichern'
  const feedback=document.createElement('p');feedback.setAttribute('role','status')
  section.append(list,check,save,feedback);container.append(section)
  renderLearning(container,getTrainingFolders)
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
      localStorage.setItem(settingsKey,JSON.stringify({enabled:on.checked,auto:auto.checked,autoLearn:autoLearn.checked,url:url.value.trim(),model:model.value.trim(),embeddings:embeddings.checked,embedModel:embedModel.value.trim(),embedUrl:embedUrl.value.trim()}))
      feedback.textContent='KI-Einstellungen gespeichert.'
      void queueAnalyses()
    }catch(error){feedback.textContent=String(error)}
  }
}

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
      const cfg=config(),legacy=getLegacyConfig(),rows=history(trainingKey)
      const scope=getTrainingFolders?.()?.map(f=>f.path)??[...new Set(rows.map(r=>r.folder))]
      const targets=scope.filter(allowed),valid=new Set(targets),{test}=splitHoldout(rows.filter(r=>valid.has(r.folder)))
      if(!test.length){status.textContent='Für den Testlauf braucht ein gewählter Lernordner mindestens 13 Beispiele (10 für den Test, mindestens 3 zum Lernen).';return}
      const heldByFolder=new Map<string,Set<string>>()
      for(const row of test){
        if(!row.id)continue
        const ids=heldByFolder.get(row.folder)??new Set<string>();ids.add(row.id);heldByFolder.set(row.folder,ids)
      }
      const centers=stored(centersKey) as Centers,options=JSON.stringify(embeddingOptions())
      const folders=Object.entries(centers).flatMap(([key,c])=>{
        if(!valid.has(key)||!c.index||c.memberIds?.length!==c.index.members.length||c.url!==cfg.embedUrl||c.model!==cfg.embedModel||c.options!==options)return []
        const ids=heldByFolder.get(key)
        const held=Object.fromEntries(c.memberIds.flatMap((id,i)=>ids?.has(id)?[[i,id]]:[]))
        return [{key,index:c.index,held}]
      })
      let semantic:SemanticEvaluation|undefined
      if(cfg.enabled&&cfg.embeddings&&folders.length){
        status.textContent='Gespeicherte Vektoren werden mit den zurückgehaltenen Mails verglichen …'
        semantic=await native()<SemanticEvaluation>('ai_holdout',{folders,weight:embeddingOptions().profileWeight,
          threshold:Number(legacy.embedding_threshold??0.78),margin:Number(legacy.embedding_min_margin??0.03)})
      }
      const hidden=Array.isArray(legacy.hidden_sources)?legacy.hidden_sources.map(String):[]
      const report=evaluateHoldout(rows,targets,rules(),hidden,semantic)
      const additional=cfg.enabled&&cfg.embeddings&&!folders.length?' Für den Semantikvergleich bitte die Lernordner aktualisieren.':''
      status.textContent='Testlauf abgeschlossen. '+report.combined.correct+' richtige Ablagen bei '+report.combined.shown+' Vorschlägen.'+additional
      const stats=stored(statisticsKey)
      localStorage.setItem(statisticsKey,JSON.stringify({...stats,evaluation:{date:new Date().toLocaleDateString('de'),report}}))
      refresh()
    }catch(error){status.textContent=String(error)}
    finally{evaluate.disabled=false}
  }
}
