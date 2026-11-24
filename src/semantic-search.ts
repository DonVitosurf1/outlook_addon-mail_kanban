/** Suche nach Bedeutung (K5): Umschalter im Suchfeld, Rangfolge über die lokalen Einbettungen, „Ähnliche Mails“ in den Maildetails. */
import {embeddingId, embeddingIndex, embeddingsEnabled, type AiMail} from './ai'
import {selectRelevant} from './views-logic'

type SearchMail = AiMail & {id:string}
type Options = {mails():readonly SearchMail[];render():void;input:HTMLInputElement;toggle:HTMLButtonElement}

export function initSemanticSearch(options:Options){
  const {input,toggle}=options
  let on=false, version=0, timer=0, scores:ReadonlyMap<string,number>|undefined, scoredQuery=''
  const idOf=new WeakMap<object,string>()
  const contentId=(m:SearchMail)=>{let id=idOf.get(m);if(!id){id=embeddingId(m);idOf.set(m,id)}return id}
  const query=()=>input.value.trim()
  const active=()=>on&&embeddingsEnabled()
  const searching=()=>active()&&!!query()
  const reset=()=>{version++;window.clearTimeout(timer);scores=undefined;scoredQuery=''}

  function setOn(value:boolean){
    if(on===value)return
    on=value;reset();sync()
    if(on&&query())schedule(0);else options.render()
  }
  function sync(){
    toggle.hidden=!embeddingsEnabled()
    toggle.setAttribute('aria-pressed',String(active()))
    toggle.classList.toggle('on',active())
  }
  function schedule(delay=300){
    window.clearTimeout(timer)
    timer=window.setTimeout(run,delay)
  }
  async function run(){
    if(!searching()){options.render();return}
    const text=query(), mine=++version
    const ids=[...new Set(embeddingIndex.ready(options.mails().map(contentId)))]
    try{
      const ranked=ids.length?await embeddingIndex.rank(text,ids):[]
      if(mine!==version||!searching()||query()!==text)return
      scores=selectRelevant(ranked);scoredQuery=text
    }catch{
      if(mine!==version)return
      scores=new Map();scoredQuery=text
    }
    options.render()
  }
  /** Mails mit Treffern (Wortsuche, solange noch kein Ergebnis zur Eingabe da ist). */
  function matches<T extends SearchMail>(mail:T,word:(mail:T)=>boolean){
    if(!searching()||!scores)return word(mail)
    return scores.has(contentId(mail))
  }
  /** id der Mail → Ähnlichkeit, nur während die Bedeutungssuche mit Ergebnis aktiv ist. */
  function relevance():ReadonlyMap<string,number>|undefined{
    if(!searching()||!scores)return
    return new Map(options.mails().flatMap(m=>{const s=scores!.get(contentId(m));return s===undefined?[]:[[m.id,s] as [string,number]]}))
  }
  /** Hinweis für die Zusammenfassung, solange nicht alle Mails eingebettet sind. */
  function hint(){
    if(!searching())return ''
    const ids=[...new Set(options.mails().map(contentId))]
    const ready=embeddingIndex.ready(ids).length
    return ready<ids.length?'Bedeutungssuche: '+ready+' von '+ids.length+' Mails vorbereitet.':''
  }
  toggle.onclick=()=>setOn(!on)
  input.addEventListener('input',()=>{
    if(!searching()||query()===scoredQuery)return
    schedule()
  })
  input.addEventListener('keydown',e=>{if(e.key==='Escape'&&on){on=false;reset();sync()}})
  const again=()=>{sync();if(searching()){scoredQuery='';schedule(0)}}
  document.addEventListener('mailboard:embedded',again)
  document.addEventListener('mailboard:embedding-progress',()=>{if(searching())schedule(1500)})
  document.addEventListener('mailboard:source-changed',()=>{on=false;reset();sync()})
  sync()
  return {active:searching,matches,relevance,hint,sync,pending:()=>searching()&&query()!==scoredQuery}
}

type SimilarOptions = {mails():readonly (SearchMail&{conversationId?:string})[];open(id:string):void}
/** „Ähnliche Mails“ in den Maildetails: die fünf ähnlichsten geladenen Mails aus anderen Unterhaltungen als Knöpfe. */
export function renderSimilar(host:HTMLElement,mail:SearchMail&{conversationId?:string},options:SimilarOptions){
  host.replaceChildren();host.hidden=true
  host.dataset.for=mail.id
  if(!embeddingsEnabled())return
  const all=options.mails()
  const own=embeddingId(mail)
  const others=all.filter(m=>m.id!==mail.id&&embeddingId(m)!==own&&!(mail.conversationId&&m.conversationId===mail.conversationId))
  const ids=embeddingIndex.ready(others.map(embeddingId))
  if(!ids.length||!embeddingIndex.ready([own]).length)return
  void embeddingIndex.similar(mail,[...new Set(ids)]).then(ranked=>{
    if(host.dataset.for!==mail.id)return
    const best=new Set(ranked.slice(0,5).map(r=>r.id))
    const picked=[...new Map(others.filter(m=>best.has(embeddingId(m))).map(m=>[embeddingId(m),m])).values()]
      .sort((a,b)=>ranked.findIndex(r=>r.id===embeddingId(a))-ranked.findIndex(r=>r.id===embeddingId(b))).slice(0,5)
    if(!picked.length)return
    const list=document.createElement('ul')
    for(const m of picked){
      const item=document.createElement('li'),button=document.createElement('button')
      button.type='button';button.textContent=m.subject||'(ohne Betreff)'
      button.title='Von '+m.sender;button.onclick=()=>options.open(m.id)
      item.append(button);list.append(item)
    }
    const heading=document.createElement('h3');heading.textContent='Ähnliche Mails'
    host.append(heading,list);host.hidden=false
  },()=>{/* Ohne Ranking gibt es keinen Abschnitt. */})
}
