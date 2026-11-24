/** Lokale Ablage für Routinen, Vorgänge und den letzten Triage-Abschluss. Die ZIP-Sicherung erfasst alle Schlüssel automatisch. */
import {normalizeCase, normalizeRoutine, type Case, type Routine} from './planning-logic'

export const ROUTINES = 'mailboard-routines-v1'
export const CASES = 'mailboard-cases-v1'
export const TRIAGE = 'mailboard-triage-last-v1'

// Das Beispielpostfach arbeitet wie die übrigen Einstellungen nur im Speicher. So erscheinen dort keine
// echten Routinen oder Vorgänge, und Beispieldaten gelangen nicht in das echte Profil.
let sample:Map<string,string>|undefined
export function useSamplePlanning(enabled:boolean){
  if(enabled===!!sample)return
  sample=enabled?new Map():undefined
}
function read(key:string):unknown{
  try{return JSON.parse((sample?sample.get(key):localStorage.getItem(key))||'null')}catch{return null}
}
function write(key:string,value:unknown){
  try{
    if(sample)sample.set(key,JSON.stringify(value))
    else localStorage.setItem(key,JSON.stringify(value))
    return true
  }catch{return false}
}
function changed(){if(typeof document!=='undefined')document.dispatchEvent(new CustomEvent('mailboard:planning'))}

export function loadRoutines():Routine[]{
  const raw=read(ROUTINES)
  return Array.isArray(raw)?raw.flatMap(r=>normalizeRoutine(r)??[]):[]
}
export function saveRoutines(routines:Routine[]){const ok=write(ROUTINES,routines);changed();return ok}

export function loadCases():Case[]{
  const raw=read(CASES)
  return Array.isArray(raw)?raw.flatMap(c=>normalizeCase(c)??[]):[]
}
export function saveCases(cases:Case[]){const ok=write(CASES,cases);changed();return ok}
/** Ändert einen Vorgang oder legt ihn an, falls er bislang nur über eine Outlook-Kategorie bekannt war. */
export function updateCase(name:string,update:(c:Case)=>Case|undefined,fallback?:Case){
  const cases=loadCases()
  const index=cases.findIndex(c=>c.name.localeCompare(name,'de',{sensitivity:'base'})===0)
  const current=index>=0?cases[index]:fallback
  if(!current)return false
  const next=update(structuredClone(current))
  if(index>=0){if(next)cases[index]=next;else cases.splice(index,1)}
  else if(next)cases.push(next)
  return saveCases(cases)
}

export function lastTriage(live:boolean):number|undefined{
  const raw=read(TRIAGE) as Record<string,unknown>|null
  const value=raw?.[live?'live':'demo']
  return typeof value==='number'&&Number.isFinite(value)?value:undefined
}
export function rememberTriage(live:boolean,at=Date.now()){
  const raw=read(TRIAGE)
  const base=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{}
  write(TRIAGE,{...base,[live?'live':'demo']:at})
}

export function newId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8)}

const FOCUS_SKIP = 'mailboard-focus-skip-v1'
const SKIP_LIMIT = 200
/** Abgewählte Fokusvorschläge gelten nur für diesen Kalendertag. Im Beispielpostfach nur im Speicher. */
export function skippedFocus(today: string): Set<string> {
  const raw = read(FOCUS_SKIP) as {day?: unknown; ids?: unknown} | null
  if (!raw || typeof raw !== 'object' || raw.day !== today || !Array.isArray(raw.ids)) return new Set()
  return new Set(raw.ids.filter((id): id is string => typeof id === 'string' && !!id))
}
export function skipFocus(id: string, today: string) {
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return
  const ids = [...skippedFocus(today)]
  if (!ids.includes(id)) ids.push(id)
  write(FOCUS_SKIP, {day: today, ids: ids.slice(-SKIP_LIMIT)})
}
