/** Vorgang nach Capacities: eine Seite, je Checklistenpunkt eine Aufgabe. Mailtexte bleiben hier. */
export const capacitiesTokenKey='mailboard-capacities-token-v1'

export type CapacitiesMail={subject?:string;sender?:string;status?:string;isSent?:boolean;recipients?:string}
export type CapacitiesTaskPlan={itemId:string;title:string;done:boolean;due?:string;capacitiesId?:string}
export type CapacitiesFields={openId?:string;doneId?:string;dateId?:string}

const doneNames=['done','erledigt','abgeschlossen','completed','complete']
const openNames=['todo','to do','offen','open','not started','nicht begonnen','not-started']

function plain(text:string){return text.replace(/[\r\n]+/g,' ').trim()}

/** Markdown der Seite. Es fließen nur Name, Notiz, Punkte und Mailzeilen ein. */
export function capacitiesPageMarkdown(entry:{name:string;note?:string;items:readonly {text:string;done:boolean;due?:string}[]},mails:readonly CapacitiesMail[]){
  const lines=['# '+plain(entry.name),'']
  if(entry.note?.trim())lines.push('## Notiz','',plain(entry.note),'')
  lines.push('## Nächste Schritte','')
  if(!entry.items.length)lines.push('Keine Punkte.')
  for(const item of entry.items)lines.push('- ['+(item.done?'x':' ')+'] '+plain(item.text)+(item.due?' ('+item.due+')':''))
  lines.push('','## Mails','')
  if(!mails.length)lines.push('Keine zugeordnete Mail.')
  for(const mail of mails){
    const who=mail.isSent?'An '+(mail.recipients||mail.sender||''):(mail.sender||'')
    lines.push('- '+[plain(mail.subject||'(ohne Betreff)'),plain(who),plain(mail.status||'')].filter(Boolean).join(' · '))
  }
  return lines.join('\n').replace(/\n+$/,'')+'\n'
}

function optionId(options:readonly {id?:string;name?:string}[],names:readonly string[]){
  const wanted=new Set(names)
  return options.find(o=>wanted.has(String(o.id||'').toLowerCase())||wanted.has(String(o.name||'').toLowerCase()))?.id
}

const projectNames=['projekt','projekte','project','projects']

/** Typ für den Vorgang: „Projekt“ im Space, sonst eine normale Seite. */
export function capacitiesPageStructure(structures:unknown){
  const list=Array.isArray(structures)?structures:[]
  const hit=list.find(s=>{
    if(!s||typeof s!=='object')return false
    const entry=s as {id?:string;title?:string;pluralName?:string}
    const names=[entry.title,entry.pluralName].map(name=>String(name||'').trim().toLowerCase())
    return typeof entry.id==='string'&&names.some(name=>projectNames.includes(name))
  }) as {id:string}|undefined
  return hit?.id||'RootPage'
}

/** Status- und Datumsfeld der Aufgabenstruktur. Unbekannte Räume bleiben ohne Status. */
export function capacitiesFields(structures:unknown):CapacitiesFields{
  const list=Array.isArray(structures)?structures:[]
  const task=list.find(s=>!!s&&typeof s==='object'&&(s as {id?:string}).id==='RootTask') as {propertyDefinitions?:unknown[]}|undefined
  const defs=(Array.isArray(task?.propertyDefinitions)?task.propertyDefinitions:[]).filter((d):d is {id?:string;name?:string;type?:string;labelSet?:{id?:string;name?:string}[]}=>!!d&&typeof d==='object')
  const status=defs.find(d=>d.type==='label'&&(d.id==='status'||String(d.name||'').toLowerCase()==='status'))
  const date=defs.find(d=>d.type==='date'&&(d.id==='date'||/datum|date|frist|fällig|deadline/i.test(String(d.name||''))))??defs.find(d=>d.type==='date')
  const labels=status?.labelSet??[]
  return {openId:optionId(labels,openNames),doneId:optionId(labels,doneNames),dateId:typeof date?.id==='string'?date.id:undefined}
}

/** Bricht die Synchronisierung ab, behält aber eine schon angelegte Seite und fertige Aufgaben. */
export class CapacitiesSyncError extends Error{
  partial?:{pageId:string;createdPage:boolean;tasks:{itemId:string;capacitiesId:string}[]}
}

type FetchLike=(url:string,init?:RequestInit)=>Promise<Response>

/** Legt die Seite einmal an und schreibt Aufgaben. Eine vorhandene Seite bleibt stehen. */
export async function syncCaseToCapacities(token:string,input:{pageId?:string;markdown:string;tasks:readonly CapacitiesTaskPlan[]},fetchImpl:FetchLike=fetch){
  if(!token.trim())throw new Error('Bitte den Capacities-Token in den Einstellungen eintragen.')
  const headers={'Authorization':'Bearer '+token.trim(),'X-Capacities-Api-Version':'1.0.0','Content-Type':'application/json'}
  const call=async(path:string,method:string,body?:unknown)=>{
    const response=await fetchImpl('https://api.capacities.io'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)})
    const text=await response.text()
    let parsed:unknown
    if(text){try{parsed=JSON.parse(text)}catch{parsed=undefined}}
    if(!response.ok){
      const message=parsed&&typeof parsed==='object'&&typeof (parsed as {message?:unknown}).message==='string'?(parsed as {message:string}).message:'Capacities antwortet mit Status '+response.status+'.'
      throw new Error(message)
    }
    return parsed
  }
  const space=await call('/space/structures','GET')
  const structures=space&&typeof space==='object'?(space as {structures?:unknown}).structures:undefined
  const pageStructure=capacitiesPageStructure(structures)
  const fields=capacitiesFields(structures)
  const properties=(task:CapacitiesTaskPlan,clearDate:boolean)=>{
    const value:Record<string,unknown>={title:{type:'title',title:{value:task.title}}}
    const status=task.done?fields.doneId:fields.openId
    if(status)value.status={type:'label',label:[{id:status}]}
    if(fields.dateId&&(task.due||clearDate))value[fields.dateId]={type:'date',date:{dateResolution:'day',start:task.due?task.due+'T00:00:00.000Z':null}}
    return value
  }
  let pageId=input.pageId
  let createdPage=false
  if(!pageId){
    const created=await call('/object/markdown','POST',{structureId:pageStructure,markdown:input.markdown}) as {id?:string}
    if(!created?.id)throw new Error('Capacities hat keine Seitenkennung geliefert.')
    pageId=created.id
    createdPage=true
  }
  const tasks:{itemId:string;capacitiesId:string}[]=[]
  try{
    for(const task of input.tasks){
      if(task.capacitiesId){
        await call('/object','PATCH',{id:task.capacitiesId,properties:properties(task,true)})
        tasks.push({itemId:task.itemId,capacitiesId:task.capacitiesId})
      }else{
        const created=await call('/object','POST',{structureId:'RootTask',properties:properties(task,false)}) as {id?:string}
        if(!created?.id)throw new Error('Capacities hat keine Aufgabenkennung geliefert.')
        tasks.push({itemId:task.itemId,capacitiesId:created.id})
      }
    }
  }catch(error){
    const message=error instanceof Error?error.message:String(error)
    const wrapped=new CapacitiesSyncError(message)
    if(pageId)wrapped.partial={pageId,createdPage,tasks}
    throw wrapped
  }
  return {pageId,createdPage,pageStructure,tasks}
}

export function capacitiesToken(){
  try{return localStorage.getItem(capacitiesTokenKey)?.trim()||''}catch{return ''}
}
export function saveCapacitiesToken(value:string){
  try{if(value)localStorage.setItem(capacitiesTokenKey,value);else localStorage.removeItem(capacitiesTokenKey)}catch{/* ohne Speicher bleibt der Token leer */}
}
