import type {Folder} from './live'
import {isSnoozed, type ViewMail} from './views-logic'
import {suggestFolder, trustedFolderBatch} from './ai'

export type CleanupOptions = {
  hasMailbox:()=>boolean
  getMails:()=>readonly ViewMail[]
  getFolders:()=>readonly Folder[]
  getSuggestionFolders?:()=>readonly Folder[]
  loadBacklog:()=>Promise<boolean>
  closeBacklog?:()=>Promise<void>|void
  onStatus:(ids:string[],status:string)=>Promise<void>|void
  onFolder:(ids:string[],folder:string)=>Promise<void>|void
  onUndo:()=>Promise<void>|void
}
const statuses=['Offen','In Bearbeitung','Warten','Erledigt']
function label<K extends keyof HTMLElementTagNameMap>(name:K,text='') {
  const node=document.createElement(name)
  node.textContent=text
  return node
}
function button(title:string,action:()=>void) {
  const node=label('button',title)
  node.type='button'
  node.onclick=action
  return node
}
export function initCleanup(api:CleanupOptions) {
  const dialog=label('dialog')
  dialog.setAttribute('aria-label','Posteingang aufräumen')
  const subject=label('h2'), sender=label('p'), content=label('article'), progress=label('small')
  subject.tabIndex=-1
  const statusLine=label('p')
  statusLine.setAttribute('role','status')
  const folders=label('select')
  folders.setAttribute('aria-label','Zielordner')
  const done=new Set<string>()
  let mail:ViewMail|undefined
  let loading=false
  let pending=false
  let sourceVersion=0,openedVersion=0
  let viewVersion=0
  const commands=label('div'), navigation=label('div')
  commands.className=navigation.className='cockpit-actions'
  const hints=button('Ablagevorschlag ermitteln',()=>void propose())
  const move=button('In Zielordner verschieben',()=>void act('folder',folders.value))
  const groups=label('div')
  const review=button('Sichere Sammelvorschläge prüfen',()=>void previewGroups())
  const close=button('Schließen',()=>dialog.close())
  const skip=button('Überspringen',()=>{if(mail){done.add(mail.id);render()}})
  const back=button('Zurück',()=>{const id=[...done].at(-1);if(id){done.delete(id);render()}})
  const undo=button('Letzte Board-Aktion zurücknehmen',()=>void act('undo',''))
  for(const state of statuses)commands.append(button(state,()=>void act('status',state)))
  navigation.append(back,skip,undo)
  dialog.append(close,progress,subject,sender,content,commands,folders,hints,move,navigation,review,groups,statusLine)
  document.body.append(dialog)
  function render() {
    viewVersion++
    const items=candidates()
    groups.replaceChildren()
    review.disabled=!items.length
    mail=items.find(m=>!done.has(m.id))
    progress.textContent=(items.filter(m=>!done.has(m.id)).length)+' noch durchzusehen'
    subject.textContent=mail?.subject||'Durchsicht beendet'
    sender.textContent=mail?.sender||''
    content.textContent=mail?.body||''
    statusLine.textContent=''
    hints.disabled=false
    commands.hidden=!mail
    folders.hidden=hints.hidden=move.hidden=!mail
    folders.replaceChildren(new Option('Zielordner wählen',''))
    for(const f of api.getFolders()){
      if (!f.isInbox && f.name!=='Posteingang')folders.add(new Option(f.path||f.name,f.id))
    }
    move.disabled=true
    folders.onchange=()=>{move.disabled=!folders.value}
    skip.disabled=!mail
    back.disabled=!done.size
    if(dialog.open)subject.focus()
  }
  function candidates() {
    const inboxNames=new Set(['Posteingang',...api.getFolders().filter(f=>f.isInbox).map(f=>f.name)])
    return api.getMails().filter(m=>m.status!=='Erledigt'&&!isSnoozed(m)&&inboxNames.has(m.folder))
      .sort((a,b)=>(a.received||'').localeCompare(b.received||''))
  }
  function targets(){
    return (api.getSuggestionFolders?.()??api.getFolders()).filter(f=>!f.isInbox && f.name!=='Posteingang' && !!f.path)
  }
  async function previewGroups() {
    const token=viewVersion
    groups.replaceChildren()
    review.disabled=true
    const choices=targets(), predict=trustedFolderBatch(choices.map(f=>f.path))
    const destination=new Map<string,ViewMail[]>()
    const items=candidates().filter(m=>!done.has(m.id))
    try {
      for(let i=0;i<items.length;i++){
        if(i%4===0){
          statusLine.textContent='Prüfe sichere Ablagevorschläge · '+i+' von '+items.length
          await new Promise(resolve=>window.setTimeout(resolve,0))
          if(token!==viewVersion || !dialog.open)return
        }
        const m=items[i], hint=predict(m)
        if(!hint)continue
        const group=destination.get(hint.folder)||[]
        group.push(m);destination.set(hint.folder,group)
      }
      statusLine.textContent=destination.size?'Ziele und Betreffzeilen prüfen und die gewünschte Gruppe ablegen.':'Keine sicheren Sammelvorschläge gefunden.'
      for(const [path,rows] of destination){
        const folder=choices.find(f=>f.path===path)
        if(!folder)continue
        const box=label('details'),list=label('ul')
        box.append(label('summary',rows.length+' nach „'+path+'“'))
        for(const m of rows)list.append(label('li',m.subject))
        box.append(list,button((rows.length===1?'Diese Mail':'Diese '+rows.length+' Mails')+' nach „'+path+'“ ablegen',async()=>{
          if(pending)return
          try{lock(true);await api.onFolder(rows.map(m=>m.id),folder.id)}
          catch(error){lock(false);statusLine.textContent=String(error);return}
          lock(false)
        }))
        groups.append(box)
      }
    }catch(error){if(token===viewVersion)statusLine.textContent=String(error)}
    finally{if(token===viewVersion)review.disabled=false}
  }
  function lock(on:boolean) {
    pending=on
    for(const b of dialog.querySelectorAll<HTMLButtonElement|HTMLSelectElement>('button, select'))
      b.disabled=on
    if(!on) render()
  }
  async function act(kind:'folder'|'status'|'undo',value:string) {
    if(!api.hasMailbox()||openedVersion!==sourceVersion||pending||(!mail && kind!=='undo'))return
    const current=mail
    const beforeFolder=mail?.folder
    let message=''
    try {
      lock(true)
      if(kind==='undo') {await api.onUndo();done.clear()}
      else if(current){
        if(kind==='folder')await api.onFolder([current.id],value)
        else await api.onStatus([current.id],value)
        const updated=api.getMails().find(m=>m.id===current.id)
        if (!updated || (kind==='status'&&updated.status===value) || (kind==='folder'&&updated.folder!==beforeFolder))done.add(current.id)
        else message='Die Mail bleibt zur Durchsicht geöffnet.'
      }
    } catch(error){message=String(error)}
    finally {lock(false);statusLine.textContent=message}
  }
  async function propose() {
    if(!mail||pending)return
    const token=viewVersion
    hints.disabled=true
    statusLine.textContent='Vorschlag wird ermittelt …'
    try {
      const permitted=new Set((api.getSuggestionFolders?.()??api.getFolders()).map(f=>f.id))
      const allowed=[...folders.options].filter(o=>permitted.has(o.value))
      const result=await suggestFolder(mail,allowed.map(o=>o.text))
      if(!dialog.open||token!==viewVersion)return
      folders.value=allowed.find(o=>o.text===result.folder)?.value||''
      move.disabled=!folders.value
      statusLine.textContent=result.reason
    } catch(error){if(token===viewVersion)statusLine.textContent=String(error)}
    finally {if(token===viewVersion)hints.disabled=false}
  }
  async function open() {
    if(!api.hasMailbox()||loading||pending)return
    const version=sourceVersion
    loading=true
    try{
      if(!await api.loadBacklog()||version!==sourceVersion||!api.hasMailbox())return
      openedVersion=sourceVersion
      done.clear()
      render()
      if(!dialog.open)dialog.showModal()
    }catch(error){const message=document.getElementById('message');if(message)message.textContent=String(error)}
    finally {loading=false}
  }
  document.addEventListener('mailboard:source-changed',()=>{
    sourceVersion++;viewVersion++;done.clear();mail=undefined
    subject.textContent=sender.textContent=content.textContent=progress.textContent=statusLine.textContent=''
    folders.replaceChildren();groups.replaceChildren()
    if(dialog.open)dialog.close()
  })
  dialog.addEventListener('cancel',event=>{if(pending)event.preventDefault()})
  dialog.addEventListener('close',()=>{
    viewVersion++;hints.disabled=false
    if(openedVersion!==sourceVersion||!api.hasMailbox())return
    Promise.resolve(api.closeBacklog?.()).catch(error=>{
      const message=document.getElementById('message');if(message)message.textContent=String(error)
    })
  })
  dialog.onkeydown=e=>{
    if(pending || e.target instanceof HTMLSelectElement)return
    if(e.key>='1'&&e.key<='4'&&!e.ctrlKey){e.preventDefault();void act('status',statuses[Number(e.key)-1])}
    if(e.key==='Backspace'){e.preventDefault();back.click()}
    if(e.key===' ' && e.target===dialog){e.preventDefault();skip.click()}
  }
  document.addEventListener('keydown',e=>{
    if(!e.defaultPrevented&&e.ctrlKey&&e.key.toLowerCase()==='r'&&!document.querySelector('dialog[open]')){e.preventDefault();void open()}
  })
  return open
}
