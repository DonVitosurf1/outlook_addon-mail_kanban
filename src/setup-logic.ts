/**
 * Reine Logik des Einrichtungsassistenten (ohne DOM): Schritte, gespeicherter Stand, Vorbelegung der Ordner, Hinweisbedingung.
 * Die Oberfläche steht in `setup.ts`.
 */
import type {Measurement} from './ai'
import type {OutlierFolder} from './outliers'

export type StepId='E1'|'E2'|'E3'|'E4'|'E5'|'E6'|'E7'
export type StepStatus='open'|'done'|'skipped'
/** Entscheidung zu einer Ausreißer-Mail (E3). `target` ist der Zielordnerpfad bei „verschieben“. */
export type OutlierDecision={folder:string;decision:'moved'|'stay'|'exclude';target?:string}
/**
 * Gespeicherter Stand unter `mailboard-setup-v1`, nur im Outlook-Modus:
 * - `step`: der zuletzt geöffnete Schritt, dort setzt „Einrichtung fortsetzen“ an,
 * - `status`: offen, erledigt oder übersprungen je Schritt,
 * - `measurements.baseline`: Ausgangswert aus E2, `measurements.after`: Messung nach dem neuen Lernen (E6),
 *   `report.confusion` zählt Verwechslungen je Ordnerpaar (richtig → vorgeschlagen) für Überschneidungen in E4,
 * - `outliers`: Entscheidungen aus E3, Schlüssel ist die inhaltsbasierte Kennung `embeddingId(mail)` (bleibt beim Verschieben gleich).
 * - `confirmed`: Kennungen (`embeddingId`) der Mails mit „Bleibt hier“ aus E3. Sie gelten als sicher richtig und werden nie wieder gemeldet.
 * - `outlierFolders`: Lernordner mit mehr als 25 % Ausreißern beim letzten Prüflauf von E3 (`{folder, outliers, total}`),
 *   Kandidaten für Unterteilen oder Zusammenlegen in E4. Jeder Prüflauf ersetzt die Liste.
 * - `data`: freier Platz je Schritt für spätere Schritte (z. B. Seitenstand beim Posteingang). Nur JSON-Werte.
 *   E4 legt hier `{dismissed:string[]}` ab: verworfene Vorschläge (`refine.ts`, `proposalKey`).
 */
export type SetupState={
  version:1
  step:StepId
  status:Record<StepId,StepStatus>
  measurements:{baseline?:Measurement;after?:Measurement}
  outliers:Record<string,OutlierDecision>
  confirmed:string[]
  outlierFolders:OutlierFolder[]
  data:Partial<Record<StepId,unknown>>
}
export const SETUP_KEY='mailboard-setup-v1'
export const stepIds:readonly StepId[]=['E1','E2','E3','E4','E5','E6','E7']
/** Titel, Beschreibung und ob der Schritt die lokale KI braucht. Ohne KI lässt er sich mit Hinweis überspringen. */
export const stepInfo:Record<StepId,{title:string;text:string;needsAi:boolean}>={
  E1:{title:'Ordner wählen',text:'Lege fest, welche Ordner das Board zeigt, aus welchen es lernt und wohin Erledigtes archiviert wird.',needsAi:false},
  E2:{title:'Lernen und messen',text:'Das Board lernt aus deinen Lernordnern und misst, wie oft seine Ablagevorschläge stimmen. Das ist dein Ausgangswert.',needsAi:false},
  E3:{title:'Ausreißer prüfen',text:'Mails, die nicht zu ihrem Ordner passen, verschiebst du, bestätigst sie oder nimmst sie vom Lernen aus.',needsAi:false},
  E4:{title:'Struktur verfeinern',text:'Überfüllte Ordner unterteilen, ähnliche Ordner zusammenlegen und unklare Namen verbessern. Jede Änderung bestätigst du.',needsAi:true},
  E5:{title:'Steckbriefe',text:'Für Lernordner ohne Steckbrief entwirft die lokale KI einen Vorschlag. Du prüfst jeden.',needsAi:true},
  E6:{title:'Neu lernen und vergleichen',text:'Das Board lernt mit den bereinigten Ordnern neu und vergleicht die Trefferquote mit dem Ausgangswert.',needsAi:false},
  E7:{title:'Posteingang abarbeiten',text:'Sichere Vorschläge legst du stapelweise ab, unsichere prüfst du einzeln, alte Mails ohne Ziel gehen ins Archiv.',needsAi:false},
}

export function freshState():SetupState{
  return {version:1,step:'E1',status:Object.fromEntries(stepIds.map(id=>[id,'open'])) as Record<StepId,StepStatus>,measurements:{},outliers:{},confirmed:[],outlierFolders:[],data:{}}
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
    if(isObject(m)&&isObject(m.report)&&isObject(m.samples)){
      const report:Record<string,unknown>={...m.report}
      // Verwechslungen (E2, für E4): nur positive ganze Zahlen, Ordner auf sich selbst zählt nicht. Ältere Messungen haben keine.
      if('confusion' in report){
        const confusion=isObject(report.confusion)?Object.fromEntries(Object.entries(report.confusion).flatMap(([truth,guesses])=>{
          const valid=isObject(guesses)?Object.entries(guesses).filter(([guess,n])=>guess!==truth&&Number.isInteger(n)&&(n as number)>0):[]
          return valid.length?[[truth,Object.fromEntries(valid)]]:[]
        })):{}
        report.confusion=confusion
      }
      state.measurements[key]={...m,report} as unknown as Measurement
    }
  }
  if(isObject(raw.outliers))for(const [key,value] of Object.entries(raw.outliers)){
    if(isObject(value)&&typeof value.folder==='string'&&['moved','stay','exclude'].includes(String(value.decision)))
      state.outliers[key]=value as unknown as OutlierDecision
  }
  if(Array.isArray(raw.confirmed))state.confirmed=[...new Set(raw.confirmed.filter((id):id is string=>typeof id==='string'))]
  if(Array.isArray(raw.outlierFolders))state.outlierFolders=raw.outlierFolders.flatMap(f=>isObject(f)&&typeof f.folder==='string'&&
    Number.isInteger(f.outliers)&&Number.isInteger(f.total)&&(f.total as number)>0?[{folder:f.folder,outliers:f.outliers as number,total:f.total as number}]:[])
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
const parts=(path:string)=>path.split(/[\\/]/).filter(Boolean)
const hiddenPath=(path:string)=>parts(path).some(part=>part.startsWith('_'))
/** Gesendet oder Outlook-Standardordner irgendwo im Pfad, also auch deren Unterordner. */
const servicePath=(path:string)=>parts(path).some(part=>sent.test(part)||system.test(part))
const within=(path:string,parent:string)=>!!parent&&(path===parent||path.startsWith(parent+'/'))
/**
 * Vorbelegung für E1: Archiv ist der erste Ordner mit „Archiv“ im Namen. Lernziele sind alle Ordner außer Posteingang,
 * Gesendet, Outlook-Standardordnern, Ordnern mit `_` im Pfad und dem Archiv, jeweils samt Unterordnern.
 * Das Board bekommt keine Vorbelegung.
 */
export function defaultScopes(folders:readonly ScopeFolder[]):Scopes{
  const usable=folders.filter(f=>!f.isInbox&&f.path)
  const archive=usable.find(f=>/archiv/i.test(f.name)&&!hiddenPath(f.path)&&!servicePath(f.path))?.path??''
  const learn=usable.filter(f=>!servicePath(f.path)&&!hiddenPath(f.path)&&!within(f.path,archive)).map(f=>f.path)
  return {board:[],learn,archive}
}
/**
 * Startauswahl in E1: gespeicherte Ziele, wo vorhanden, sonst die Vorbelegung. Leere Lernziele gelten als nicht gesetzt.
 * Gespeicherte Pfade ohne geladenen Ordner bleiben erhalten, auch das Archiv, damit Speichern nichts stillschweigend entfernt.
 */
export function initialScopes(folders:readonly ScopeFolder[],current:{board:string[];learn:string[]|null;archive:string}):Scopes{
  const fallback=defaultScopes(folders)
  return {board:[...current.board],learn:current.learn?.length?[...current.learn]:fallback.learn,archive:current.archive||fallback.archive}
}
/** U3: Hinweis „Einrichtung starten“ nur mit Outlook, ohne Lernziele, solange die Einrichtung offen ist und nicht vertagt wurde. */
export function shouldOfferSetup(input:{mailbox:'outlook'|'demo'|'offline';learning:string[]|null;state:SetupState;later:boolean}){
  return input.mailbox==='outlook'&&!input.learning?.length&&!isComplete(input.state)&&!input.later
}

type Rate={shown:number;correct:number}
/** Trefferquote in ganzen Prozent, `null` ohne Vorschläge. */
export function ratePercent(tally?:Rate|null):number|null{return tally?.shown?Math.round(100*tally.correct/tally.shown):null}
/** Eine Zeile des Vergleichs. `diff` in Prozentpunkten (jetzt minus Ausgangswert), `worse` bei weniger Treffern als vorher. */
export type CompareRow={name:string;before:number|null;after:number|null;diff:number|null;worse:boolean}
function compareRow(name:string,before:Rate|null|undefined,after:Rate|null|undefined,tested=false):CompareRow{
  const a=ratePercent(before),b=ratePercent(after),diff=a==null||b==null?null:b-a
  // Wer vorher Vorschläge hatte und jetzt keine mehr (bei weiterhin getesteter Quelle), ist ebenfalls schlechter.
  return {name,before:a,after:b,diff,worse:diff!=null?diff<0:a!=null&&tested}
}
/**
 * E6: Vergleich zweier Messungen je Quelle (Gesamtergebnis, Regeln, Bayes, Embeddings, endgültige Quelle) und je Ordner.
 * Die Differenz rechnet mit den angezeigten, gerundeten Prozentwerten. Ohne Wert auf einer Seite bleibt sie leer. Ein Ordner ohne Vorschläge, der vorher welche hatte, gilt als schlechter.
 * Ordner aus beiden Messungen erscheinen, sortiert nach Name.
 */
export function compareMeasurements(before:Measurement,after:Measurement):{sources:CompareRow[];folders:CompareRow[]}{
  const a=before.report,b=after.report
  const sources=[compareRow('Gesamtergebnis',a.combined,b.combined),compareRow('Regeln einzeln',a.rule,b.rule),compareRow('Bayes einzeln',a.bayes,b.bayes),
    compareRow('Embeddings mit Steckbrief',a.embedding,b.embedding),compareRow('Embeddings ohne Steckbrief',a.plain,b.plain)]
  for(const name of [...new Set([...Object.keys(a.sources),...Object.keys(b.sources)])].sort())
    sources.push(compareRow('Endgültige Quelle · '+name,a.sources[name as keyof typeof a.sources],b.sources[name as keyof typeof b.sources]))
  const folders=[...new Set([...Object.keys(a.byFolder??{}),...Object.keys(b.byFolder??{})])].sort((x,y)=>x.localeCompare(y,'de'))
    .map(name=>compareRow(name,a.byFolder?.[name],b.byFolder?.[name],!!b.byFolder?.[name]?.tested))
  return {sources:sources.filter(r=>r.before!=null||r.after!=null),folders}
}
/** „+5 Pp.“, „−3 Pp.“, „±0 Pp.“ oder „–“ ohne Differenz. */
export function diffText(diff:number|null){return diff==null?'–':(diff>0?'+':diff<0?'−':'±')+Math.abs(diff)+' Pp.'}
