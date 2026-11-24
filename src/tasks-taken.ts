/** Merkt je Mail-Signatur, welche vorgeschlagenen Aufgaben schon in einen Vorgang übernommen wurden. Nur Texte, keine Mailinhalte. */
export const TAKEN='mailboard-tasks-taken-v1'
export type Task = {text:string; frist:string|null}
const LIMIT=1000
function read():Record<string,string[]>{
  try{
    const raw=JSON.parse(localStorage.getItem(TAKEN)||'{}')
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return {}
    return Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,Array.isArray(v)?v.filter((t):t is string=>typeof t==='string'):[]]))
  }catch{return {}}
}
export function takenTasks(id:string){return id?read()[id]||[]:[]}
export function setTaken(id:string,texts:readonly string[]){
  if(!id)return
  const all=read()
  delete all[id]
  if(texts.length)all[id]=[...new Set(texts)]
  const keys=Object.keys(all)
  for(const k of keys.slice(0,Math.max(0,keys.length-LIMIT)))delete all[k]
  try{localStorage.setItem(TAKEN,JSON.stringify(all))}catch{ /* Der Merker ist nur eine Bequemlichkeit. */ }
}
/** Noch nicht übernommene Aufgaben. Ohne Feld (ältere Analyse) bleibt das Ergebnis `undefined`. */
export function openTasks(tasks:readonly Task[]|undefined,id:string){
  if(!Array.isArray(tasks))return undefined
  const taken=takenTasks(id)
  return tasks.filter(t=>!taken.includes(t.text))
}
