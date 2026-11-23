/**
 * Reine Logik des Einrichtungsassistenten (ohne DOM): Schritte, gespeicherter Stand, Vorbelegung der Ordner, Hinweisbedingung.
 * Die Oberfläche steht in `setup.ts`.
 */
import type {Measurement} from './ai'

export type StepId='E1'|'E2'|'E3'|'E4'|'E5'|'E6'|'E7'
export type StepStatus='open'|'done'|'skipped'
/** Entscheidung zu einer Ausreißer-Mail (E3). `target` ist der Zielordnerpfad bei „verschieben“. */
export type OutlierDecision={folder:string;decision:'moved'|'stay'|'exclude';target?:string}
/**
 * Gespeicherter Stand unter `mailboard-setup-v1`, nur im Outlook-Modus:
 * - `step`: der zuletzt geöffnete Schritt, dort setzt „Einrichtung fortsetzen“ an,
 * - `status`: offen, erledigt oder übersprungen je Schritt,
 * - `measurements.baseline`: Ausgangswert aus E2, `measurements.after`: Messung nach dem neuen Lernen (E6),
 * - `outliers`: Entscheidungen aus E3, Schlüssel ist eine stabile Mailkennung (z. B. Lernbeispiel-ID).
 * - `data`: freier Platz je Schritt für spätere Schritte (z. B. Seitenstand beim Posteingang). Nur JSON-Werte.
 */
export type SetupState={
  version:1
  step:StepId
  status:Record<StepId,StepStatus>
  measurements:{baseline?:Measurement;after?:Measurement}
  outliers:Record<string,OutlierDecision>
  data:Partial<Record<StepId,unknown>>
}
export const SETUP_KEY='mailboard-setup-v1'
export const stepIds:readonly StepId[]=['E1','E2','E3','E4','E5','E6','E7']
/** Titel, Beschreibung und ob der Schritt die lokale KI braucht. Ohne KI lässt er sich mit Hinweis überspringen. */
export const stepInfo:Record<StepId,{title:string;text:string;needsAi:boolean}>={
  E1:{title:'Ordner wählen',text:'Lege fest, welche Ordner das Board zeigt, aus welchen es lernt und wohin Erledigtes archiviert wird.',needsAi:false},
  E2:{title:'Lernen und messen',text:'Das Board lernt aus deinen Lernordnern und misst, wie oft seine Ablagevorschläge stimmen. Das ist dein Ausgangswert.',needsAi:false},
  E3:{title:'Ausreißer prüfen',text:'Mails, die nicht zu ihrem Ordner passen, verschiebst du, bestätigst sie oder nimmst sie vom Lernen aus.',needsAi:true},
  E4:{title:'Struktur verfeinern',text:'Überfüllte Ordner unterteilen, ähnliche Ordner zusammenlegen und unklare Namen verbessern. Jede Änderung bestätigst du.',needsAi:true},
  E5:{title:'Steckbriefe',text:'Für Lernordner ohne Steckbrief entwirft die lokale KI einen Vorschlag. Du prüfst jeden.',needsAi:true},
  E6:{title:'Neu lernen und vergleichen',text:'Das Board lernt mit den bereinigten Ordnern neu und vergleicht die Trefferquote mit dem Ausgangswert.',needsAi:false},
  E7:{title:'Posteingang abarbeiten',text:'Sichere Vorschläge legst du stapelweise ab, unsichere prüfst du einzeln, alte Mails ohne Ziel gehen ins Archiv.',needsAi:false},
}

export function freshState():SetupState{
  return {version:1,step:'E1',status:Object.fromEntries(stepIds.map(id=>[id,'open'])) as Record<StepId,StepStatus>,measurements:{},outliers:{},data:{}}
}
const isObject=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x)
/** Liest einen gespeicherten Stand. Unbekannte oder beschädigte Felder fallen auf den Anfangsstand zurück. */
export function parseState(raw:unknown):SetupState{
  const state=freshState()
  if(!isObject(raw)||raw.version!==1)return state
  if(stepIds.includes(raw.step as StepId))state.step=raw.step as StepId
  if(isObject(raw.status))for(const id of stepIds){
    const value=raw.status[id]
    if(value==='done'||value==='skipped'||value==='open')state.status[id]=value
  }
  if(isObject(raw.measurements))for(const key of ['baseline','after'] as const){
    const m=raw.measurements[key]
    if(isObject(m)&&isObject(m.report)&&isObject(m.samples))state.measurements[key]=m as unknown as Measurement
  }
  if(isObject(raw.outliers))for(const [key,value] of Object.entries(raw.outliers)){
    if(isObject(value)&&typeof value.folder==='string'&&['moved','stay','exclude'].includes(String(value.decision)))
      state.outliers[key]=value as unknown as OutlierDecision
  }
  if(isObject(raw.data))for(const id of stepIds)if(id in raw.data)state.data[id]=raw.data[id]
  return state
}
export function finishedSteps(state:SetupState){return stepIds.filter(id=>state.status[id]!=='open').length}
export function isComplete(state:SetupState){return finishedSteps(state)===stepIds.length}
export function progressText(state:SetupState){return 'Einrichtung: '+finishedSteps(state)+' von '+stepIds.length+' Schritten'}
/** Nächster offener Schritt nach `from`, danach von vorn. `undefined`, wenn alle erledigt oder übersprungen sind. */
export function nextOpen(state:SetupState,from:StepId):StepId|undefined{
  const index=stepIds.indexOf(from)
  return [...stepIds.slice(index+1),...stepIds.slice(0,index+1)].find(id=>state.status[id]==='open')
}

type ScopeFolder={name:string;path:string;isInbox?:boolean}
export type Scopes={board:string[];learn:string[];archive:string}
const sent=/^(gesendet|sent\b)/i
// Outlook-Standardordner ohne Ablagebedeutung. Sie sind nie Lernziele.
const system=/^(entwürfe|gelöschte elemente|junk-e-mail|postausgang|drafts|deleted items|junk e-?mail|outbox)$/i
const hiddenPath=(path:string)=>path.split(/[\\/]/).some(part=>part.startsWith('_'))
/**
 * Vorbelegung für E1: Archiv ist der erste Ordner mit „Archiv“ im Namen. Lernziele sind alle Ordner außer Posteingang,
 * Gesendet, Outlook-Standardordnern, Ordnern mit `_` im Pfad und dem Archiv selbst. Das Board bekommt keine Vorbelegung.
 */
export function defaultScopes(folders:readonly ScopeFolder[]):Scopes{
  const usable=folders.filter(f=>!f.isInbox&&f.path)
  const archive=usable.find(f=>/archiv/i.test(f.name)&&!hiddenPath(f.path))?.path??''
  const learn=usable.filter(f=>!sent.test(f.name)&&!system.test(f.name)&&!hiddenPath(f.path)&&f.path!==archive).map(f=>f.path)
  return {board:[],learn,archive}
}
/**
 * Startauswahl in E1: gespeicherte Ziele, wo vorhanden, sonst die Vorbelegung. Leere Lernziele gelten als nicht gesetzt.
 * Gespeicherte Pfade ohne geladenen Ordner bleiben erhalten, damit Speichern nichts stillschweigend entfernt.
 */
export function initialScopes(folders:readonly ScopeFolder[],current:{board:string[];learn:string[]|null;archive:string}):Scopes{
  const fallback=defaultScopes(folders),known=new Set(folders.map(f=>f.path))
  return {board:[...current.board],learn:current.learn?.length?[...current.learn]:fallback.learn,
    archive:current.archive&&known.has(current.archive)?current.archive:fallback.archive}
}
/** U3: Hinweis „Einrichtung starten“ nur mit Outlook, ohne Lernziele, solange die Einrichtung offen ist und nicht vertagt wurde. */
export function shouldOfferSetup(input:{mailbox:'outlook'|'demo'|'offline';learning:string[]|null;state:SetupState;later:boolean}){
  return input.mailbox==='outlook'&&!input.learning?.length&&!isComplete(input.state)&&!input.later
}
