/** Capacities: ein Vorgang wird zum Projekt, eine bewusst übernommene Mail zur Notiz. */
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
const noteNames=['notiz','notizen','note','notes']
const personNames=['person','personen','people','persons']
const atomNames=['atomare notiz','atomare notizen','atomic note','atomic notes']

function structureId(structures:unknown,names:readonly string[]){
  const list=Array.isArray(structures)?structures:[]
  const wanted=new Set(names)
  const hit=list.find(s=>{
    if(!s||typeof s!=='object')return false
    const entry=s as {id?:string;title?:string;pluralName?:string}
    const labels=[entry.title,entry.pluralName].map(name=>String(name||'').trim().toLowerCase())
    return typeof entry.id==='string'&&labels.some(name=>wanted.has(name))
  }) as {id:string}|undefined
  return hit?.id
}

/** Typ für den Vorgang: „Projekt“ im Space, sonst eine normale Seite. */
export function capacitiesPageStructure(structures:unknown){
  return structureId(structures,projectNames)||'RootPage'
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

/** Bricht die Synchronisierung ab, behält aber eine schon angelegte Seite, Notiz oder fertige Aufgaben. */
export class CapacitiesSyncError extends Error{
  partial?:{pageId:string;createdPage:boolean;tasks:{itemId:string;capacitiesId:string}[]}
  kept?:{noteId:string;personId?:string}
}

type FetchLike=(url:string,init?:RequestInit)=>Promise<Response>

function api(token:string,fetchImpl:FetchLike){
  const headers={'Authorization':'Bearer '+token.trim(),'X-Capacities-Api-Version':'1.0.0','Content-Type':'application/json'}
  return async(path:string,method:string,body?:unknown)=>{
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
}

function structuresOf(space:unknown){
  return space&&typeof space==='object'?(space as {structures?:unknown}).structures:undefined
}

/** Legt die Seite einmal an und schreibt Aufgaben. Eine vorhandene Seite bleibt stehen. */
export async function syncCaseToCapacities(token:string,input:{pageId?:string;markdown:string;tasks:readonly CapacitiesTaskPlan[]},fetchImpl:FetchLike=fetch){
  if(!token.trim())throw new Error('Bitte den Capacities-Token in den Einstellungen eintragen.')
  const call=api(token,fetchImpl)
  const space=await call('/space/structures','GET')
  const structures=structuresOf(space)
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

export function capacitiesPersonName(sender:string){
  const named=sender.trim().match(/^(.*?)</)
  return (named?named[1]:sender).replace(/["']/g,'').trim()
}

export function capacitiesPersonAddress(sender:string){
  return sender.match(/<([^>\s]+@[^>\s]+)>/)?.[1]||sender.match(/[^\s<>]+@[^\s<>]+/)?.[0]||''
}

/** Notiz einer einzelnen Mail. Der Mailtext gehört hierher, weil der Klick ihn ausdrücklich übernimmt. */
export function capacitiesNoteMarkdown(mail:{subject?:string;sender?:string;recipients?:string;isSent?:boolean;status?:string;received?:string;body?:string;note?:string;attachments?:readonly string[]}){
  const title=plain(mail.subject||'(ohne Betreff)')
  const who=mail.isSent?'An '+plain(mail.recipients||mail.sender||''):capacitiesPersonName(mail.sender||'')
  const day=(mail.received||'').slice(0,10)
  const lines=['# '+title,'',[plain(who),/^\d{4}-\d{2}-\d{2}$/.test(day)?day:'',plain(mail.status||'')].filter(Boolean).join(' · '),'']
  if(mail.note?.trim())lines.push('## Notiz auf der Karte','',mail.note.trim(),'')
  lines.push('## Mail','',(mail.body||'').trim(),'')
  if(mail.attachments?.length){
    lines.push('## Anhänge','')
    for(const name of mail.attachments)lines.push('- '+plain(name))
  }
  return lines.join('\n').replace(/\n+$/,'')+'\n'
}

/** Verweis am Projekt auf die Notiz. Der Mailtext bleibt draußen. */
export function capacitiesProjectBlock(subject:string,noteId:string){
  return {type:'TextBlock' as const,hierarchy:{key:'Base',val:0},tokens:[{type:'LinkToken' as const,text:plain(subject||'(ohne Betreff)'),entityId:noteId}]}
}

/** Nachtrag, wenn sich eine schon übernommene Mail ändert. */
export function capacitiesSupplement(mail:{body?:string;note?:string}){
  const lines=['## Nachtrag','']
  if(mail.note?.trim())lines.push(mail.note.trim(),'')
  lines.push((mail.body||'').trim())
  return lines.join('\n').replace(/\n+$/,'')+'\n'
}

export function capacitiesStamp(parts:readonly string[]){
  let hash=0
  for(const char of parts.join('\u001f'))hash=Math.imul(hash,31)+char.codePointAt(0)!|0
  return (hash>>>0).toString(16)
}

export function capacitiesWebLinks(text:string){
  const found=text.match(/https?:\/\/[^\s<>"']+/gi)||[]
  return [...new Set(found.map(url=>url.replace(/[)\].,;:]+$/,'')))]
}

/** Legt die Notiz einmal an, sucht die Person und hängt einen Verweis an das Projekt. */
export async function saveMailAsNote(token:string,input:{noteId?:string;markdown:string;title:string;personName?:string;personAddress?:string;projectId?:string;supplement?:string},fetchImpl:FetchLike=fetch){
  if(input.noteId){
    const supplement=input.supplement?.trim()
    if(!supplement)return {noteId:input.noteId,created:false,appended:false,personId:undefined as string|undefined}
    if(!token.trim())throw new Error('Bitte den Capacities-Token in den Einstellungen eintragen.')
    await api(token,fetchImpl)('/blocks/append','POST',{id:input.noteId,position:{type:'end'},markdown:input.supplement})
    return {noteId:input.noteId,created:false,appended:true,personId:undefined as string|undefined}
  }
  if(!token.trim())throw new Error('Bitte den Capacities-Token in den Einstellungen eintragen.')
  const call=api(token,fetchImpl)
  const structures=structuresOf(await call('/space/structures','GET'))
  const noteStructure=structureId(structures,noteNames)||'RootPage'
  const personStructure=structureId(structures,personNames)
  const created=await call('/object/markdown','POST',{structureId:noteStructure,markdown:input.markdown}) as {id?:string}
  if(!created?.id)throw new Error('Capacities hat keine Notizkennung geliefert.')
  const noteId=created.id
  let personId:string|undefined
  try{
    const name=input.personName?.trim()
    const address=input.personAddress?.trim()
    if(personStructure&&(name||address)){
      const wanted=new Set([name||'',address||''].map(value=>value.toLowerCase()).filter(Boolean))
      const look=async(query:string)=>{
        const found=await call('/objects/search','POST',{query,structureIds:[personStructure],limit:5}) as {results?:{id?:string;title?:string}[]}
        return (found?.results||[]).find(row=>wanted.has(String(row.title||'').trim().toLowerCase()))
      }
      const match=await look(name||address!)||(address&&address.toLowerCase()!==(name||'').toLowerCase()?await look(address):undefined)
      if(match?.id)personId=match.id
      else{
        const person=await call('/object','POST',{structureId:personStructure,properties:{title:{type:'title',title:{value:name||address}}}}) as {id?:string}
        if(person?.id)personId=person.id
      }
    }
    if(input.projectId)await call('/blocks/append','POST',{id:input.projectId,position:{type:'end'},blocks:[capacitiesProjectBlock(input.title,noteId)]})
  }catch(error){
    const wrapped=new CapacitiesSyncError(error instanceof Error?error.message:String(error))
    wrapped.kept={noteId,personId}
    throw wrapped
  }
  return {noteId,created:true,appended:false,personId}
}

/** Neue http-Links einer schon angelegten Notiz werden Weblinks. Bekannte Links bleiben. */
export async function saveMailLinks(token:string,input:{noteId:string;urls:readonly string[];known?:Readonly<Record<string,string>>},fetchImpl:FetchLike=fetch){
  if(!token.trim())throw new Error('Bitte den Capacities-Token in den Einstellungen eintragen.')
  const call=api(token,fetchImpl)
  const links={...input.known}
  const fresh:string[]=[]
  for(const url of input.urls){
    if(links[url])continue
    const created=await call('/object/url','POST',{url}) as {id?:string}
    if(!created?.id)throw new Error('Capacities hat keine Linkkennung geliefert.')
    links[url]=created.id
    fresh.push(url)
  }
  if(fresh.length)await call('/blocks/append','POST',{id:input.noteId,position:{type:'end'},markdown:fresh.map(url=>'- '+url).join('\n')+'\n'})
  return {links}
}

/** Ein markierter Satz wird eine atomare Notiz. Der übrige Mailtext geht nicht mit. */
export async function saveAtomicNote(token:string,input:{sentence:string;subject?:string;body?:string},fetchImpl:FetchLike=fetch){
  const sentence=input.sentence.trim()
  if(!sentence)throw new Error('Bitte zuerst einen Satz im Mailtext markieren.')
  if(!token.trim())throw new Error('Bitte den Capacities-Token in den Einstellungen eintragen.')
  const call=api(token,fetchImpl)
  const structure=structureId(structuresOf(await call('/space/structures','GET')),atomNames)
  if(!structure)throw new Error('In diesem Space gibt es keine atomare Notiz.')
  const markdown='# '+plain(sentence)+'\n\nAus: '+plain(input.subject||'(ohne Betreff)')+'\n\n'+sentence+'\n'
  const created=await call('/object/markdown','POST',{structureId:structure,markdown}) as {id?:string}
  if(!created?.id)throw new Error('Capacities hat keine Notizkennung geliefert.')
  return {id:created.id}
}

export const capacitiesMailKey='mailboard-capacities-mails-v1'
export type CapacitiesMailRecord={noteId?:string;personId?:string;stamp?:string;links?:Record<string,string>;atoms?:Record<string,string>}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function keepId(value:unknown){return typeof value==='string'&&uuid.test(value)?value:undefined}
function keepMap(value:unknown){
  if(!value||typeof value!=='object')return
  const out:Record<string,string>={}
  for(const [key,item] of Object.entries(value as Record<string,unknown>)){const id=keepId(item);if(id)out[key]=id}
  return Object.keys(out).length?out:undefined
}
function readMailRecords(){
  try{
    const raw=JSON.parse(localStorage.getItem(capacitiesMailKey)||'{}') as unknown
    return raw&&typeof raw==='object'?raw as Record<string,unknown>:{}
  }catch{return {}}
}
export function capacitiesMailRecord(id:string):CapacitiesMailRecord{
  const raw=readMailRecords()[id]
  if(!raw||typeof raw!=='object')return {}
  const row=raw as Record<string,unknown>
  const record:CapacitiesMailRecord={}
  const noteId=keepId(row.noteId),personId=keepId(row.personId)
  if(noteId)record.noteId=noteId
  if(personId)record.personId=personId
  if(typeof row.stamp==='string'&&/^[0-9a-f]{1,8}$/i.test(row.stamp))record.stamp=row.stamp.toLowerCase()
  const links=keepMap(row.links),atoms=keepMap(row.atoms)
  if(links)record.links=links
  if(atoms)record.atoms=atoms
  return record
}
export function saveCapacitiesMail(id:string,record:CapacitiesMailRecord){
  try{
    const all=readMailRecords()
    all[id]=record
    localStorage.setItem(capacitiesMailKey,JSON.stringify(all))
  }catch{/* ohne Speicher bleibt die Kennung nur für diesen Klick */}
}
