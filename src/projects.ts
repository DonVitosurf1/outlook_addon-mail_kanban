import {rememberUndo,forgetUndo} from './undo-limit'
import { getLegacyConfig, getLegacyProfiles, setProfile, rekeyProfile, updateConfig } from './data-settings'
import type {LiveBoard} from './live'
import {distribute} from './distribute'
import {ask} from './data-settings'
import {draftProfile} from './ai'
import {profileDocument,profileName} from './profile-file'
import {openStructure} from './structure'
let liveService:LiveBoard|undefined
let generation=0
const trigger=document.getElementById('projectTools') as HTMLButtonElement|null
export function bindProjectBoard(service:LiveBoard|undefined){
  if(service!==liveService){
    generation++
    for(const d of document.querySelectorAll<HTMLDialogElement>('.project-tools, .structure-dialog, .distribute-dialog')){
      for(const nested of d.querySelectorAll<HTMLDialogElement>('dialog[open]'))nested.close()
      d.close()
    }
  }
  liveService=service
  if(trigger){trigger.hidden=!service;trigger.disabled=!service}
}
type ProjectService=Pick<LiveBoard,'json'|'invoke'|'begin'|'writeBatch'|'move'>
function session():ProjectService{
  const version=generation
  const current=()=>{
    if(!liveService||version!==generation)throw new Error('Bitte zuerst das Outlook-Postfach laden und die Ordnerwerkzeuge erneut öffnen.')
    return liveService
  }
  return {
    json:(name,args)=>current().json(name,args),invoke:(name,args)=>current().invoke(name,args),
    begin:()=>current().begin(),writeBatch:action=>current().writeBatch(action),
    move:(...args)=>current().move(...args)
  }
}

type Folder = {id:string; parentId:string; name:string; path:string; isInbox?:boolean}
type Receipt = Folder & {previousName:string; previousParentId:string}
type Step = {stamp:number; receipt:Receipt; kind:'rename'|'move'; oldPath:string; boardKeys:string[]; learnKeys:string[]|null}
const history:Step[]=[]
const changed=()=>window.dispatchEvent(new Event('mailboard:foldersChanged'))
export function projectUndoLatest(){return history.at(-1)?.stamp??0}
export async function undoProjectIfLatest(mailStamp:number):Promise<boolean>{
  const step=history.at(-1)
  if(!step || step.stamp<mailStamp)return false
  const r=step.receipt
  const api=session()
  const before=await api.json<Folder[]>('outlook_folders')
  const current=before.find(f=>f.id===r.id)
  if(!current || current.path!==r.path || current.name!==r.name)
    throw new Error('Das geänderte Projekt ist unter der gespeicherten Outlook-ID und dem erwarteten Pfad nicht mehr eindeutig zuzuordnen. Bitte den aktuellen Ordner in Outlook prüfen.')
  if(step.kind==='move' && !before.some(f=>f.id===r.previousParentId))
    throw new Error('Der ursprüngliche Projektordner ist in Outlook nicht mehr verfügbar. Bitte den Zielordner prüfen.')
  const result=step.kind==='rename'
    ?await api.json<Receipt>('project_rename',{folder:r.id,name:r.previousName})
    :await api.json<Receipt>('project_move',{folder:r.id,source:r.parentId,target:r.previousParentId})
  history.pop()
  forgetUndo(step.stamp)
  await remapFolderHistory(api,before,r,result)
  try {
    const restored=result.path||step.oldPath
    rekeyConfig(r.path,restored)
    restoreMembership(restored,step.boardKeys,step.learnKeys)
  } finally {changed()}
  return true
}
async function remapFolderHistory(api:ProjectService,before:Folder[],from:Folder,to:Receipt){
  const ids=new Map([[from.id,to.id]])
  const children=before.filter(f=>f.path.startsWith(from.path+'/'))
  if(children.length){
    for(const child of children)ids.set(child.id,child.id)
    // A subtree stays together. Use paths relative to the known moved folder, never mail subjects.
    try{
      const after=await api.json<Folder[]>('outlook_folders')
      for(const child of children){
        const path=to.path+child.path.slice(from.path.length)
        const matches=after.filter(folder=>folder.path===path)
        if(matches.length===1)ids.set(child.id,matches[0].id)
      }
    }catch{ /* The operation succeeded. Keep receipts and still remap the confirmed root ID. */ }
  }
  for(const previous of history){
    const item=previous.receipt
    item.id=ids.get(item.id)??item.id
    item.parentId=ids.get(item.parentId)??item.parentId
    item.previousParentId=ids.get(item.previousParentId)??item.previousParentId
  }
  liveService?.remapFolders(ids)
}
function paths(value:unknown):string[]{
  return Array.isArray(value)?value.filter((v):v is string=>typeof v==='string'&&v.length>0):[]
}
export function getBoardScope(){return paths(getLegacyConfig().project_folders)}
export function getLearningScope(){const v=getLegacyConfig().suggestion_folders;return v==null?null:paths(v)}
export function getArchiveScope(){return String(getLegacyConfig().archive_folder||'')}
const within=(key:string,parent:string)=>key===parent||key.startsWith(parent+'/')
function restoreMembership(key:string,boardKeys:string[],learnKeys:string[]|null){
  const replace=(all:string[],selected:string[])=>[...new Set([...all.filter(p=>!within(p,key)),...selected])]
  const learning=getLearningScope()
  updateConfig({project_folders:replace(getBoardScope(),boardKeys),
    suggestion_folders:learning===null&&learnKeys===null?null:replace(learning??getBoardScope(),learnKeys??boardKeys)})
}
function rekeyConfig(from:string,to:string){
  if(!from||!to||from===to)return
  const remap=(p:string)=>p===from||p.startsWith(from+'/')?to+p.slice(from.length):p
  const scopes=getLearningScope()
  const cfg=getLegacyConfig()
  const descriptions=Object.fromEntries(Object.entries(cfg.folder_descriptions||{}).map(([key,value])=>[remap(key),value]))
  const remapRules=(rules:unknown)=>Array.isArray(rules)?rules.map(r=>r&&typeof r.folder==='string'?{...r,folder:remap(r.folder)}:r):[]
  updateConfig({project_folders:getBoardScope().map(remap),suggestion_folders:scopes&&scopes.map(remap),
    archive_folder:remap(getArchiveScope()),folder_descriptions:descriptions,filing_rules:remapRules(cfg.filing_rules)})
  const ruleKey='outlook-kanban-ai-rules-v1',saved=localStorage.getItem(ruleKey)
  if(saved){const data=JSON.parse(saved);localStorage.setItem(ruleKey,JSON.stringify({...data,items:remapRules(data.items)}))}
  rekeyProfile(from,to)
}
/**
 * Legt einen Ordner im Schreibstapel an und meldet die geänderte Ordnerliste (wie „Unterordner anlegen“).
 * Die Bestätigung mit Ziel holt der Aufrufer vorher ein. Angelegte Ordner werden nie gelöscht.
 */
export async function createFolder(parentId:string,name:string){
  const service=session()
  let created:Receipt|undefined
  await service.writeBatch(async()=>{created=await service.json<Receipt>('project_create',{parent:parentId,name})})
  changed()
  return created!
}
function button(label:string,handle:()=>void){
  const b=document.createElement('button');b.textContent=label;b.onclick=handle;return b
}
function message(text:string){const p=document.createElement('p');p.textContent=text;return p}
function label(text:string,input:HTMLElement){
  const l=document.createElement('label');l.textContent=text;l.append(input);return l
}
async function showTools(){
  if(!liveService)return
  const service=session()
  const request=service.json
  const d=document.createElement('dialog');d.className='project-tools'
  const heading=document.createElement('h2');heading.textContent='Ordner und Steckbriefe'
  const confirmAction=(question:string)=>ask(d,question)
  d.setAttribute('aria-label',heading.textContent)
  const folders=document.createElement('select')
  const name=document.createElement('input')
  const note=document.createElement('textarea');note.rows=8
  const status=message('Outlook-Ordner werden geladen …');status.setAttribute('role','status')
  const controls=document.createElement('fieldset')
  let all:Folder[]=[]
  const current=()=>all.find(f=>f.id===folders.value)
  const segments=(s:string)=>s.split('/').filter(Boolean)
  const area=String(getLegacyConfig().projects_area||'01 Projekte').replace(/^\/+|\/+$/g,'')
  const field=(title:string)=>{const b=document.createElement('input');b.type='checkbox';return {b,label:label(title,b)}}
  const board=field('Im Board anzeigen'),learn=field('Als Lern- und Vorschlagsziel verwenden'),archive=field('Als Erledigt-Archiv verwenden'),recursive=field('Auswahl auf Unterordner anwenden')
  const scopes=button('Ordnerauswahl speichern',()=>run(async()=>{
    const f=current()!
    const selected=all.filter(p=>p.path && (p.id===f.id || (recursive.b.checked && f.path && p.path.startsWith(f.path+'/')))).map(p=>p.path)
    if (!selected.length)throw new Error('Bitte einen Projektordner auswählen.')
    const replace=(old:string[],on:boolean)=>[...new Set([...old.filter(p=>!selected.includes(p)),...(on?selected:[])])]
    const old=getBoardScope()
    updateConfig({project_folders:replace(old,board.b.checked),suggestion_folders:replace(getLearningScope()??old,learn.b.checked),
      archive_folder:archive.b.checked?f.path:(getArchiveScope()===f.path?'':getArchiveScope())})
    fill();changed();status.textContent='Board-, Lern- und Archivziele gespeichert.'
  }))
  const relocate=button('Projekt abschließen',()=>run(async()=>{
    const f=current()!
    const parent=all.find(p=>p.id===f.parentId)
    const reopening=parent?.name==='_Abgeschlossen'
    const areaFolder=reopening?all.find(p=>p.id===parent.parentId):parent
    if(!areaFolder || segments(areaFolder.path).join('/')!==area)throw new Error('Bitte einen Projektordner auswählen.')
    if(!await confirmAction('Projekt „'+f.name+'“ samt allen enthaltenen Mails '+(reopening?'wieder öffnen?':'nach „_Abgeschlossen“ verschieben? Der Archivordner wird bei Bedarf angelegt.')))return
    await service.writeBatch(async()=>{
      let dest=areaFolder
      if(!reopening)dest=all.find(p=>p.parentId===areaFolder.id&&p.name==='_Abgeschlossen')||
        await request<Receipt>('project_create',{parent:areaFolder.id,name:'_Abgeschlossen'})
      const receipt=await request<Receipt>('project_move',{folder:f.id,source:f.parentId,target:dest.id})
      await remapFolderHistory(service,all,f,receipt)
      remember(receipt,f,'move',reopening?'reopen':'close')
      await reload(receipt.id)
    })
  }))
  function remember(receipt:Receipt,f:Folder,kind:Step['kind'],membership?:'close'|'reopen'){
    const projectKeys=(values:string[])=>values.filter(key=>within(key,f.path))
    const learning=getLearningScope()
    history.push({stamp:rememberUndo(()=>history.shift()),receipt,kind,oldPath:f.path,boardKeys:projectKeys(getBoardScope()),
      learnKeys:learning&&projectKeys(learning)})
    try {
      rekeyConfig(f.path,receipt.path)
      if(membership){
        const selected=membership==='reopen'?[receipt.path]:[]
        restoreMembership(receipt.path,selected,learning&&selected)
      }
    } finally {changed()}
  }
  function fill(){
    const f=current()
    if(!f)return
    const parent=all.find(x=>x.id===f.parentId)
    const grand=all.find(x=>x.id===parent?.parentId)
    const closed=parent?.name==='_Abgeschlossen' && grand && segments(grand.path).join('/')===area
    relocate.textContent=closed?'Projekt wieder öffnen':'Projekt abschließen'
    relocate.disabled=!closed && (f.name.startsWith('_')||!parent||segments(parent.path).join('/')!==area)
    board.b.checked=getBoardScope().includes(f.path)
    learn.b.checked=(getLearningScope()??getBoardScope()).includes(f.path)
    archive.b.checked=!!f.path&&getArchiveScope()===f.path
    recursive.b.checked=false
    const profiles=getLegacyProfiles()
    note.value=profiles[f.path]||profiles[f.path.replace(/^\//,'')]||''
    name.value=''
  }
  async function reload(id?:string){
    all=await request<Folder[]>('outlook_folders')
    folders.replaceChildren(...all.map(f=>new Option(f.path||f.name,f.id)))
    if(id && all.some(f=>f.id===id))folders.value=id
    controls.disabled=!all.length
    fill()
    status.textContent=all.length+' Ordner geladen.'
  }
  let busy=false
  async function run(task:()=>Promise<void>){
    if(busy||!d.open)return
    busy=true;controls.disabled=true
    try{await task()}catch(e){status.textContent=String(e)}finally{busy=false;controls.disabled=!all.length}
  }
  const create=button('Unterordner anlegen',()=>run(async()=>{
    const f=current()!, value=name.value.trim()
    if(!value)throw new Error('Bitte den Namen des neuen Ordners eingeben.')
    if(!await confirmAction('„'+value+'“ unter „'+(f.path||f.name)+'“ anlegen?'))return
    const created=await request<Receipt>('project_create',{parent:f.id,name:value})
    changed();await reload(created.id)
  }))
  const rename=button('Ordner umbenennen',()=>run(async()=>{
    const f=current()!,value=name.value.trim()
    if(!value||value===f.name)throw new Error('Bitte einen neuen Namen eingeben.')
    if(!await confirmAction('„'+(f.path||f.name)+'“ in „'+value+'“ umbenennen?'))return
    const receipt=await request<Receipt>('project_rename',{folder:f.id,name:value})
    await remapFolderHistory(service,all,f,receipt)
    remember(receipt,f,'rename');await reload(receipt.id)
  }))
  const profile=button('Steckbrief speichern',()=>run(async()=>{
    const f=current()!
    if(!f.path)throw new Error('Bitte einen Projekt- oder Bereichsordner auswählen.')
    if(!await confirmAction('Steckbrief für „'+f.path+'“ lokal speichern?'))return
    note.value=profileDocument(f.path,note.value,area)
    setProfile(f.path,note.value)
    status.textContent='Steckbrief gespeichert.'
  }))
  const importFile=document.createElement('input');importFile.type='file';importFile.accept='.md';importFile.hidden=true
  importFile.onchange=()=>void run(async()=>{
    const file=importFile.files?.[0];importFile.value=''
    if(!file)return
    if(file.size>128*1024)throw new Error('Die Markdown-Datei ist größer als 128 KB.')
    const text=await file.text(),f=current()
    if(!f?.path)return
    if(!await confirmAction('„'+file.name+'“ als Entwurf für „'+f.path+'“ öffnen?'))return
    note.value=profileDocument(f.path,text,area)
    status.textContent='Markdown geladen. Bitte prüfen und speichern.'
  })
  const exportFile=button('Markdown exportieren',()=>{
    const f=current()
    if(!f?.path)return
    const a=document.createElement('a')
    const url=URL.createObjectURL(new Blob([profileDocument(f.path,note.value,area)],{type:'text/markdown'}))
    a.href=url;a.download=profileName(f.path);d.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)
  })
  const draft=button('Steckbrief entwerfen',()=>run(async()=>{
    const f=current()!
    if(!f.path)throw new Error('Bitte einen Projekt- oder Bereichsordner auswählen.')
    if(note.value && !await confirmAction('Aktuellen Editorinhalt durch einen lokalen KI-Entwurf ersetzen?'))return
    status.textContent='Steckbrief wird lokal entworfen …'
    note.value=await draftProfile(f.id,f.path)
    status.textContent='Entwurf zum Bearbeiten. Mit „Steckbrief speichern“ übernehmen.'
  }))
  const structure=button('Unterteilung vorschlagen …',()=>{
    const f=current()
    if(f)openStructure(service,f,async(created)=>{
      await reload(f.id);changed()
      distribute(service,f,all,changed,created.map(x=>x.id))
    })
  })
  folders.onchange=fill
  controls.append(label('Ordner',folders),board.label,learn.label,archive.label,recursive.label,scopes,label('Neuer Name',name),create,rename,relocate,
    label('Steckbrief (Markdown)',note),importFile,button('Markdown laden',()=>importFile.click()),exportFile,draft,profile,structure,button('Mails in Zielordner verteilen …',()=>{if(current())distribute(service,current()!,all,changed)}),button('Letzte Projektänderung zurücknehmen',()=>run(async()=>{
      if(!await undoProjectIfLatest(0)){status.textContent='Keine Projektänderung zum Zurücknehmen.';return}
      await reload()
    })))
  d.append(heading,controls,status,button('Schließen',()=>d.close()))
  d.onclose=()=>d.remove();document.body.append(d);d.showModal();await run(()=>reload())
}
bindProjectBoard(undefined)
trigger?.addEventListener('click',()=>void showTools())
