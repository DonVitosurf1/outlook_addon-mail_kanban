/** K4 Vorgang-Vorschlag: Mails ohne Vorgang, die inhaltlich zu einem offenen Vorgang passen. Rechnet über den Embedding-Index, nur im Speicher. */
import {embeddingId, embeddingIndex, embeddingModelName, embeddingsEnabled, type GroupMatch} from './ai'
import {countFeedback, FEEDBACK_FUNCTIONS} from './ai-feedback'
import {localDay} from './views-logic'
import {getLegacyConfig} from './data-settings'
import {caseMails, caseNames, type Case} from './planning-logic'
import type {ViewMail} from './views-logic'

const storeKey='mailboard-case-dismissed-v1'
type SuggestMail=ViewMail
export type CaseSuggestion={name:string;accept():void;dismiss():void}
const eps=1e-9
export const defaultThreshold=0.8, defaultMargin=0.03
/** Schlüssel einer Ablehnung: Inhalts-Signatur der Mail und Vorgangsname, damit sie auch nach einer neuen EntryID gilt. */
export const dismissKey=(id:string,name:string)=>id+'|'+name.trim().toLocaleLowerCase('de')
/** Schwelle (0,5 bis 0,99) und Abstand (0 bis 0,5) aus den Einstellungen, ungültige Werte fallen auf den Standard zurück. */
export function caseLimits(config:Record<string,unknown>=getLegacyConfig()){
  const read=(value:unknown,fallback:number,min:number,max:number)=>{const n=typeof value==='number'?value:Number.NaN;return Number.isFinite(n)&&n>=min&&n<=max?n:fallback}
  return {threshold:read(config.case_threshold,defaultThreshold,0.5,0.99),margin:read(config.case_margin,defaultMargin,0,0.5)}
}
/** Reine Auswahl: Treffer ab Schwelle und Abstand, ohne abgelehnte Paare. Ergebnis: Inhalts-Signatur der Mail zu Vorgangsname. */
export function caseSuggestions(matches:readonly GroupMatch[],dismissed:ReadonlySet<string>|readonly string[],threshold:number,margin:number){
  const skip=dismissed instanceof Set?dismissed:new Set(dismissed)
  const result=new Map<string,string>()
  for(const m of matches){
    if(m.score+eps>=threshold&&m.margin+eps>=margin&&!skip.has(dismissKey(m.id,m.best)))result.set(m.id,m.best)
  }
  return result
}
function loadDismissed(){
  try{const raw=JSON.parse(localStorage.getItem(storeKey)||'[]');return new Set<string>(Array.isArray(raw)?raw.filter((x):x is string=>typeof x==='string'):[])}
  catch{return new Set<string>()}
}
function saveDismissed(keys:Set<string>){try{localStorage.setItem(storeKey,JSON.stringify([...keys].slice(-2000)))}catch{/* Ohne Speicher gilt die Ablehnung nur bis zum Neuladen. */}}

type Options = {
  mails():readonly SuggestMail[]
  cases():readonly Case[]
  selection():string[]
  /** Setzt die Kategorie „Vorgang: Name“ als ein Undo-Schritt: `recorded` mit eigenem Schritt, `unchanged` ohne, `failed` nicht gesetzt. */
  assign(id:string,name:string):Promise<'recorded'|'unchanged'|'failed'|void>
  /** Ruft `run` auf, sobald der zuletzt aufgezeichnete Schritt zurückgenommen wird. */
  afterUndo?(run:()=>void):void
  render():void
}

export function initCaseSuggest(options:Options){
  let current=new Map<string,string>(), lastKey='', version=0, failed=false
  const dismissed=loadDismissed(), idOf=new WeakMap<object,string>()
  const contentId=(mail:SuggestMail)=>{let id=idOf.get(mail);if(!id){id=embeddingId(mail);idOf.set(mail,id)}return id}
  const same=(a:Map<string,string>,b:Map<string,string>)=>a.size===b.size&&[...a].every(([k,v])=>b.get(k)===v)

  /** Rechnet bei geänderter Eingabe neu. Fehlende Embeddings bedeuten „kein Vorschlag“, nie einen Fehler. */
  function refresh(){
    if(!embeddingsEnabled()){version++;lastKey='';current=new Map();return}
    const mails=options.mails()
    const ready=new Set(embeddingIndex.ready(mails.map(contentId)))
    const groups=options.cases().filter(c=>!c.closed).flatMap(c=>{
      const ids=[...new Set(caseMails(mails,c.name).map(contentId).filter(id=>ready.has(id)))]
      return ids.length?[{name:c.name,ids}]:[]
    })
    const candidates=mails.filter(m=>!caseNames(m).length&&ready.has(contentId(m)))
    const {threshold,margin}=caseLimits()
    const key=JSON.stringify([groups,candidates.map(m=>m.id+'='+contentId(m)),threshold,margin,dismissed.size])
    if(key===lastKey)return
    lastKey=key;failed=false
    const mine=++version
    if(!groups.length||!candidates.length){current=new Map();return}
    const ids=[...new Set(candidates.map(contentId))]
    void embeddingIndex.groups(groups,ids).then(matches=>{
      if(mine!==version)return
      const picked=caseSuggestions(matches,dismissed,threshold,margin)
      const next=new Map(candidates.flatMap(m=>{const name=picked.get(contentId(m));return name?[[m.id,name] as [string,string]]:[]}))
      if(same(current,next))return
      current=next;options.render()
    },()=>{
      // Nach einem Fehler nicht bei jedem Neuzeichnen neu fragen: Der Schlüssel bleibt, erst neue Embeddings oder Planungsdaten versuchen es wieder.
      if(mine!==version)return
      failed=true
      if(current.size){current=new Map();options.render()}
    })
  }
  function suggestionFor(mail:SuggestMail):CaseSuggestion|undefined{
    const name=current.get(mail.id)
    if(!name)return
    return {name,
      // B1: angenommen zählt als Treffer, abgelehnt als Fehlgriff, je Embedding-Modell.
      accept:()=>void options.assign(mail.id,name).then(outcome=>{
        if(outcome==='failed')return
        const model=embeddingModelName(),day=localDay()
        countFeedback(FEEDBACK_FUNCTIONS.case,model,'ok',1,day)
        // Rückgängig nimmt auch den Treffer zurück. Ohne eigenen Schritt gibt es nichts zurückzunehmen.
        if(outcome==='recorded')options.afterUndo?.(()=>countFeedback(FEEDBACK_FUNCTIONS.case,model,'ok',-1,day))
      },()=>{/* change() meldet den Fehler selbst. */}),
      dismiss:()=>{countFeedback(FEEDBACK_FUNCTIONS.case,embeddingModelName(),'bad');dismissed.add(dismissKey(contentId(mail),name));saveDismissed(dismissed);current.delete(mail.id);lastKey='';options.render()}}
  }
  const retry=()=>{if(failed){failed=false;lastKey=''}refresh()}
  document.addEventListener('mailboard:embedded',retry)
  document.addEventListener('mailboard:planning',retry)
  document.addEventListener('mailboard:source-changed',()=>{version++;lastKey='';failed=false;current=new Map()})
  document.addEventListener('board-commands',event=>{
    const entries=(event as CustomEvent<{label:string;run:()=>void}[]>).detail
    const ids=options.selection()
    const mail=ids.length===1?options.mails().find(m=>m.id===ids[0]):undefined
    const suggestion=mail&&suggestionFor(mail)
    if(suggestion)entries.push({label:'Vorgangsvorschlag übernehmen: '+suggestion.name,run:suggestion.accept},{label:'Vorgangsvorschlag ablehnen',run:suggestion.dismiss})
  })
  return {refresh,suggestionFor}
}
