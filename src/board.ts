import {undoLimit} from './undo-limit'
import './shell'
import {renderCardContent} from './card-content'
import {colorSettings,applyLaneColor} from './category-colors'
import { readLimits, textSnippets, getLegacyConfig, updateConfig } from './data-settings'
import { bindProjectBoard, projectUndoLatest, undoProjectIfLatest, getBoardScope, getLearningScope, getArchiveScope } from './projects'
import demo from './demo.json'
import { LiveBoard, type Folder, type Invoke } from './live'
import { suggestFolder, recordFiling, renderAiSettings, renderAnalysis, restoreAnalysis, rejectSuggestion, bindAiBoard, queueAnalyses, trustedFolderBatch } from './ai'
import { BoardViews, matchesQuery } from './views'
import { initCorrespondence, demoSentRows } from './correspondence'
import { initCockpit } from './cockpit'

type Counter='filed'|'followed_up'|'snoozed'
type Field = 'note'|'followUp'|'snoozeUntil'
type Mail = typeof demo[number] & {folderId?:string; folderPath?:string; hasStatus?:boolean; statusSince?:string; received?:string; note?:string; followUp?:string; snoozeUntil?:string; aiSummary?:string}
declare global { interface Window { __TAURI__?: {core:{invoke:Invoke}} } }
const states = ['Offen','In Bearbeitung','Warten','Erledigt']
const demoFolders:Folder[] = [...new Set(['Posteingang','Organisation','Pipettenspitzen',...demo.map(m=>m.folder)])].map(name=>({id:name,name,path:name}))
const el = <T extends HTMLElement>(id:string) => document.getElementById(id) as T
const search = el<HTMLInputElement>('search')
const dialog = el<HTMLDialogElement>('detail')
const undoButton = el<HTMLButtonElement>('undo')
const inboxButton=el<HTMLButtonElement>('loadInbox')
const back=el<HTMLButtonElement>('backDemo')
const core=window.__TAURI__?.core
const service=core && new LiveBoard((command,args)=>core.invoke(command,args))
function mayMove(){return getLegacyConfig().allow_move===true}
const storageKey='outlook-kanban-demo-positions-v1'
const demoUndo:{mails:Mail[],events:Counter[]}[]=[]
let demoMails:Mail[]=[]
let mails:Mail[]=[]
let folders=demoFolders
let live=false
let busy=false
let scope=''
let selected:Mail|undefined
let syncColors:ReturnType<typeof colorSettings>
let correspondence:ReturnType<typeof initCorrespondence>
let cockpit:ReturnType<typeof initCockpit>
let views:BoardViews
let suggestionVersion=0
let currentSuggestion:((apply:boolean)=>Promise<void>)|undefined
let reloadPending=false

function tag<K extends keyof HTMLElementTagNameMap>(name:K,text:string) {
  const node=document.createElement(name)
  node.textContent=text
  return node
}
function notify(text:string) {
  el('message').textContent=text
  if(dialog.open) el('openError').textContent=text
}
function errorText(e:unknown) {return e instanceof Error?e.message:String(e)}

async function exclusive(action:()=>Promise<void>) {
  if(busy) return
  busy=true
  try { controls(); await action() }
  catch(e) {notify(errorText(e))}
  finally {
    busy=false;controls()
    if(reloadPending) queueMicrotask(reloadFolders)
  }
}
function controls() {
  inboxButton.disabled=back.disabled=busy
  undoButton.disabled=busy||!(live?(service?.canUndo||projectUndoLatest()):demoUndo.length)
  for(const id of ['folder','status','suggestFolder','applySuggestion','openOriginal'])
    el<HTMLButtonElement>(id).disabled=busy
}
function saveDemo() {
  try {
    const entries=demoMails.map(m=>[m.id,{status:m.status,folder:m.folder,note:m.note,followUp:m.followUp,snoozeUntil:m.snoozeUntil,tags:m.tags}])
    localStorage.setItem(storageKey,JSON.stringify(Object.fromEntries(entries)))
  } catch {notify('Deine Änderungen gelten nur für diese Sitzung.')}
}
function loadDemo() {
  try {
    const saved=JSON.parse(localStorage.getItem(storageKey)||'{}')
    for(const row of demoSentRows()){
      if(saved?.[row.id])demoMails.push({...row,body:'',folder:'Gesendet',tags:[],attachments:[],status:'Warten'})
    }
    for(const m of demoMails) {
      const p=saved?.[m.id]
      if(!p||!states.includes(p.status)||!demoFolders.some(f=>f.name===p.folder)) continue
      m.status=p.status; m.folder=p.folder
      for(const field of ['note','followUp','snoozeUntil'] as const)
        if(typeof p[field]==='string') m[field]=p[field]
      if(Array.isArray(p.tags)&&p.tags.every((x:unknown)=>typeof x==='string')) m.tags=p.tags
    }
  } catch {notify('Das Demo-Postfach startet mit den Beispieldaten.')}
}
function changeDemo(action:()=>void,events:Counter[]=[]) {
  const before=structuredClone(demoMails)
  action()
  demoUndo.push({mails:before,events})
  if(demoUndo.length>undoLimit)demoUndo.shift()
  for(const event of events)cockpit.record(event)
  saveDemo()
  render()
}
function fillOptions(select:HTMLSelectElement,options:{id:string;label:string}[]) {
  select.replaceChildren(...options.map(o=>new Option(o.label,o.id)))
}
function hydrate(rows:Mail[],items:Folder[]){
  const paths=new Map(items.map(f=>[f.id,f.path||f.name]))
  for(const mail of rows){mail.folderPath=paths.get(mail.folderId||'')||mail.folder;restoreAnalysis(mail)}
}
function sourceUpdated(rows:Mail[],outlook:boolean,items:Folder[],key:string) {
  if(dialog.open)dialog.close()
  if(outlook)hydrate(rows,items)
  mails=rows;live=outlook;folders=items;scope=key
  selected=undefined;views.resetSelection()
  back.hidden=!outlook
  inboxButton.textContent=outlook?'Aktualisieren':'Outlook-Mails laden'
  document.querySelector<HTMLElement>('.foot')!.textContent=outlook?'Klassisches Outlook':'Lokales Demo-Postfach'
  fillOptions(el('folder'),folders.map(f=>({id:f.id,label:f.path||f.name})))
  render()
  if(outlook)void queueAnalyses()
  void syncColors?.(outlook)
  void correspondence?.refresh()
}
function boardFolders(list:Folder[], paths:string[]) {
  const targets=new Set(paths.map(p=>p.toLocaleLowerCase('de')))
  return list.filter(f=>targets.has(f.path.toLocaleLowerCase('de')))
}
function learnerFolders() {
  if(!live)return demoFolders
  return boardFolders(folders,getLearningScope()??getBoardScope())
}
function readRows(key:string,list:Folder[]) {
  if(key==='__backlog')return service!.json<Mail[]>('outlook_backlog')
  if(key)return service!.json<Mail[]>('outlook_folder',{folder:key,...readLimits()})
  return service!.json<Mail[]>('outlook_board',{folders:boardFolders(list,getBoardScope()).map(f=>f.id),...readLimits()})
}
async function refresh(key=scope) {
  if(!service)return
  const rows=await readRows(key,folders)
  if(!Array.isArray(rows))throw new Error('Outlook lieferte keine Mailliste.')
  sourceUpdated(rows,true,folders,key)
}
async function connect() {
  if(!service)return
  await exclusive(async()=>{
    notify('Outlook wird gelesen …')
    el('connectOutlook').hidden=false
    if(live) await refresh()
    else {
      const list=await service.json<Folder[]>('outlook_folders')
      const rows=await readRows('',list)
      search.value=''
      sourceUpdated(rows,true,list,'')
    }
    el('connectOutlook').hidden=true
    notify(mails.length+' Mails geladen.')
  })
}
function confirmMove(question:string) {
  const prompt=el<HTMLDialogElement>('moveConfirm')
  el('moveQuestion').textContent=question
  prompt.returnValue='cancel'
  return new Promise<boolean>(resolve=>{
    prompt.addEventListener('close',()=>resolve(prompt.returnValue==='confirm'),{once:true})
    prompt.showModal()
  })
}

function archiveFolder(){
  const path=getArchiveScope()
  return live && mayMove() && path?folders.find(f=>f.path===path):undefined
}
function isInInbox(mail:Mail) {return folders.some(f=>f.isInbox && f.id===mail.folderId)}
function archiveCandidates(){
  const days=Number(getLegacyConfig().archive_after_days??7)
  if(!archiveFolder()||days<=0)return []
  const cutoff=Date.now()-days*86400000
  return mails.filter(m=>isInInbox(m)&&m.status==='Erledigt'&& Date.parse(m.statusSince||m.received||'')<=cutoff)
}
type Mutation={kind:'move'|'status'|'tags'|Field;value:string|string[];status?:string}
async function change(ids:string[],action:Mutation) {
  await exclusive(async()=>{
    const rows=mails.filter(m=>ids.includes(m.id))
    const field=action.kind
    const value=action.value as string
    const todo=rows.filter(m=>field==='move'?((m.folderId||m.folder)!==value || (!!action.status && m.status!==action.status)):
      field==='tags'?JSON.stringify(m.tags)!==JSON.stringify(action.value):m[field]!==value || (field==='status' && m.hasStatus===false))
    if(!todo.length) return
    const dest=folders.find(f=>f.id===value)
    if(field==='move'&&!dest)throw new Error('Zielordner nicht verfügbar.')
    const moving=field==='move'?todo.filter(m=>(m.folderId||m.folder)!==value):[]
    const archive=field==='status' && value==='Erledigt'?archiveFolder():undefined
    const archiving=archive?todo.filter(isInInbox):[]
    if(live && moving.length && !mayMove()){
      if(selected)fillDetail(selected)
      throw new Error('Verschieben ist gesperrt. In den Einstellungen „Echte Mails verschieben erlauben“ aktivieren.')
    }
    const label=todo.length===1?'„'+todo[0].subject+'“':todo.length+' Mails'
    let question=''
    if(moving.length)question=label+' nach „'+(dest!.path||dest!.name)+'“ verschieben'+(action.status?' und auf „'+action.status+'“ setzen':'')+'?'
    if(archiving.length)question=label+' als erledigt markieren und '+archiving.length+' aus dem Posteingang nach „'+archive!.path+'“ archivieren?'
    if(live && question && !await confirmMove(question)) {
      if(selected)fillDetail(selected)
      return
    }
    if(!live) {
      const events:Counter[]=field==='move'?moving.filter(()=>dest?.name!=='Posteingang').map(()=>'filed'):
        field==='followUp'&&value?todo.map(()=>'followed_up'):field==='snoozeUntil'&&value?todo.map(()=>'snoozed'):[]
      changeDemo(()=>{for(const m of todo) {
        if(field==='move'){m.folder=value;if(action.status)m.status=action.status}
        else if(field==='tags')m.tags=[...action.value as string[]]
        else m[field]=value
      }},events)
      if(selected)fillDetail(selected)
      return
    }
    await service!.writeBatch(async()=>{
      const batch=service!.begin()
      const errors:string[]=[]
      let succeeded=0
      for(const m of todo) {
        try {
          if(!m.folderId)throw new Error('Quellordner fehlt. Bitte Outlook aktualisieren.')
          if(field==='move') {
            let id=m.id
            if(m.folderId!==value){
              const countAsFiled=dest!.path!==getArchiveScope() && !dest!.isInbox
              id=await service!.move(batch,m.id,m.folderId,value,countAsFiled)
              mails=mails.filter(x=>x!==m)
              if(countAsFiled){
                cockpit.record('filed')
                if(learnerFolders().some(f=>f.id===value)){
                  try {recordFiling(m,dest!.path||dest!.name)} catch { /* Outlook already saved the move. */ }
                }
              }
            }
            if(action.status && action.status!==m.status){
              try {await service!.status(batch,id,value,action.status);m.status=action.status}
              catch(e){throw new Error((id===m.id?'':'Verschoben. ')+'Statusänderung fehlgeschlagen: '+errorText(e))}
            }
          } else if(field==='status') {
            await service!.status(batch,m.id,m.folderId,value)
            m.status=value
            if(archive && isInInbox(m)){
              try {await service!.move(batch,m.id,m.folderId,archive.id,false);mails=mails.filter(x=>x!==m)}
              catch(e){throw new Error('Status geändert. Archivieren fehlgeschlagen: '+errorText(e))}
            }
          } else if(field==='tags') {
            m.tags=await service!.tags(batch,m.id,m.folderId,m.tags,action.value as string[])
          } else {
            await service!.field(batch,m.id,m.folderId,field,value)
            m[field]=value
          }
          if(field==='followUp'&&value)cockpit.record('followed_up')
          if(field==='snoozeUntil'&&value)cockpit.record('snoozed')
          succeeded++
        } catch(e) {errors.push(errorText(e))}
      }
      if(dialog.open)dialog.close()
      render()
      try {await refresh()} catch(e) {errors.push('Aktualisieren: '+errorText(e))}
      notify(succeeded+' von '+todo.length+' geändert.'+(errors.length?' '+errors.join(' · '):''))
    })
  })
}
async function undo() {
  await exclusive(async()=>{
    if(live) {
      await service!.writeBatch(async()=>{
        if(await undoProjectIfLatest(service?.latest||0))return
        if(!service?.canUndo)return
        try {await service.undo(step=>{if(step.kind==='move'&&step.filed)cockpit.record('filed',-1)
          if(step.kind==='field'&&step.value&&step.field==='followUp')cockpit.record('followed_up',-1)
          if(step.kind==='field'&&step.value&&step.field==='snoozeUntil')cockpit.record('snoozed',-1)})} finally {await refresh()}
        notify('Änderung rückgängig gemacht.')
      })
    } else {
      const old=demoUndo.pop()
      if(!old)return
      for(const event of old.events)cockpit.record(event,-1)
      demoMails=old.mails;sourceUpdated(demoMails,false,demoFolders,scope);saveDemo()
      notify('Änderung rückgängig gemacht.')
    }
  })
}
function dropZone(node:HTMLElement,action:(ids:string[])=>void) {
  const mime='application/x-mailboard-item'
  node.ondragover=e=>{if(!busy&&e.dataTransfer?.types.includes(mime)){e.preventDefault();node.classList.add('over')}}
  node.ondragleave=()=>node.classList.remove('over')
  node.ondrop=e=>{
    node.classList.remove('over')
    const mail=mails.find(m=>m.id===e.dataTransfer?.getData(mime))
    if(mail){e.preventDefault();action(views.selectedIds(mail.id))}
  }
}
function fillDetail(mail:Mail) {
  const version=++suggestionVersion
  correspondence?.detail(mail.id,el('detailActions'))
  el('openOriginal').hidden=!live
  el('openError').textContent=''
  el('subject').textContent=mail.subject
  el('from').textContent=mail.sender
  el('body').textContent=mail.body
  el('attachments').textContent=mail.attachments.length?'Anhänge · '+mail.attachments.join(', '):''
  el<HTMLSelectElement>('status').value=mail.status
  el<HTMLSelectElement>('folder').value=mail.folderId||mail.folder
  el('replyActions').hidden=!live
  fillOptions(el('draftSnippet'),[{id:'',label:'Ohne Textbaustein'},...textSnippets('follow_up').map(s=>({id:s.body,label:s.label}))])
  el('rejectSuggestion')?.remove()
  const result=el('suggestionResult'), accept=el<HTMLButtonElement>('applySuggestion')
  result.textContent='';accept.hidden=true
  const choices=learnerFolders().filter(f=>f.id!==(mail.folderId||mail.folder)).map(f=>f.path)
  renderAnalysis(el('analysis'),mail,choices,live?async(text:string)=>{await draft(mail,'reply',text)}:undefined,
    async(tags:string[])=>{await change([mail.id],{kind:'tags',value:tags})})
  const suggest=el<HTMLButtonElement>('suggestFolder')
  suggest.disabled=false
  currentSuggestion=async(apply:boolean)=>{
    suggest.disabled=true;accept.hidden=true;el('rejectSuggestion')?.remove()
    result.textContent='Ablagevorschlag wird ermittelt …'
    try {
      const hint=await suggestFolder(mail,choices)
      if(version!==suggestionVersion||!dialog.open)return
      const dest=folders.find(f=>f.path===hint.folder)
      result.textContent=hint.reason
      if(dest) {
        accept.hidden=false;accept.textContent='In „'+dest.path+'“ ablegen'
        const reject=tag('button','Unpassend');reject.id='rejectSuggestion'
        reject.onclick=()=>{rejectSuggestion(mail,dest.path);accept.hidden=true;reject.remove();result.textContent='Vorschlag verworfen.'}
        accept.after(reject)
        accept.onclick=()=>void change([mail.id],{kind:'move',value:dest.id})
        if(apply)await change([mail.id],{kind:'move',value:dest.id})
      }
    } catch(e) {if(version===suggestionVersion)result.textContent=errorText(e)}
    finally {if(version===suggestionVersion)suggest.disabled=false}
  }
  suggest.onclick=()=>void currentSuggestion?.(false)
}
function pick(id:string) {
  const m=mails.find(row=>row.id===id)
  if(!m)return
  selected=m;fillDetail(m)
  if(!dialog.open)dialog.showModal()
}
function makeCard(mail:Mail,config:Record<string,unknown>,hint?:string) {
  const card=tag('button','')
  card.className='card';card.id='mail-'+mail.id;card.draggable=true
  card.ondragstart=e=>e.dataTransfer?.setData('application/x-mailboard-item',mail.id)
  renderCardContent(card,mail,config,hint)
  card.onclick=()=>pick(mail.id)
  views.bindCard(card,mail.id)
  return card
}
function render() {
  const archiveButton=el<HTMLButtonElement>('archiveDone')
  if(archiveButton){
    const candidates=archiveCandidates()
    archiveButton.hidden=!candidates.length
    archiveButton.textContent=candidates.length+' Erledigte ins Archiv'
    archiveButton.onclick=()=>{const f=archiveFolder();if(f)void change(candidates.map(m=>m.id),{kind:'move',value:f.id})}
  }
  const nav=el('folders')
  nav.replaceChildren()
  const choices=[{id:'',path:'Alle Mails',name:'Alle Mails'},...folders]
  for(const f of choices) {
    const btn=tag('button',f.path||('name' in f?String(f.name):''))
    btn.title=btn.textContent||f.path
    if(!live || !scope || scope===f.id)btn.append(tag('b',String(mails.filter(m=>!f.id||(live?m.folderId:m.folder)===f.id).length)))
    btn.setAttribute('aria-pressed',String(scope===f.id))
    btn.onclick=()=>{
      if(live)void exclusive(()=>refresh(f.id))
      else {scope=f.id;views.resetSelection();render();nav.querySelector<HTMLElement>('[aria-pressed=true]')?.focus()}
    }
    if(f.id)dropZone(btn,ids=>void change(ids,{kind:'move',value:f.id}))
    nav.append(btn)
  }
  cockpit?.refresh()
  views.sync(mails)
  const visible=views.filter(mails.filter(m=>(live||!scope||m.folder===scope)&&matchesQuery(m,search.value)))
  el('title').textContent=live?'Outlook · '+(scope==='__backlog'?'Aufräumen':folders.find(f=>f.id===scope)?.name||'Alle Mails'):scope||'Alle Mails'
  el('summary').textContent=visible.length+' von '+mails.length+' Mails'
  const board=el('board');board.replaceChildren()
  const config=getLegacyConfig()
  const suggest=config.suggestions===false?undefined:trustedFolderBatch(learnerFolders().map(f=>f.path))
  const card=(m:Mail)=>makeCard(m,config,(live?isInInbox(m):m.folder==='Posteingang')?suggest?.(m)?.folder:undefined)
  for(const status of states) {
    const lane=tag('section','');lane.className='lane';applyLaneColor(lane,status)
    const matches=visible.filter(m=>m.status===status)
    const heading=tag('h3','');heading.append(tag('span',status),tag('b',String(matches.length)))
    lane.append(heading,...views.cards(matches,card,status))
    if(!matches.length){const empty=tag('p','Keine Mails');empty.className='empty';lane.append(empty)}
    views.bindLane(lane,heading,status)
    dropZone(lane,ids=>void change(ids,{kind:'status',value:status}))
    board.append(lane)
  }
  controls()
}
async function openOriginal(mail:Mail) {
  await exclusive(async()=>{await service!.invoke('outlook_open',{id:mail.id,folder:mail.folderId})})
}
async function draft(mail:Mail,mode:string,text:string) {
  if(!live){notify('Für einen Outlook-Entwurf zuerst Outlook-Mails laden.');return}
  await exclusive(async()=>{await service!.invoke('outlook_draft',{id:mail.id,folder:mail.folderId,mode,text});notify('Entwurf in Outlook geöffnet.')})
}
async function reloadFolders() {
  reloadPending=false
  if(!live||!service)return
  if(busy){reloadPending=true;return}
  await exclusive(async()=>{
    const list=await service.json<Folder[]>('outlook_folders')
    folders=list
    await refresh(list.some(f=>f.id===scope)?scope:'')
  })
}
async function start() {
  demoMails=structuredClone(demo);mails=demoMails;loadDemo()
  views=new BoardViews({render,open:pick,scopeIdentity:()=>(live?'live:':'demo:')+scope,inboxId:()=>folders.find(f=>f.isInbox)?.id||'Posteingang',changeStatus:(ids,value)=>change(ids,{kind:'status',value}),
    moveToFolder:(ids,index)=>{const f=folders[index];return f?change(ids,{kind:'move',value:f.id}):Promise.resolve()},
    dropInFolder:(ids,folder,status)=>change(ids,{kind:'move',value:folder,status}),
    clearScope:()=>{if(!live)scope=''},hasScope:()=>!live && !!scope,
    openOriginal:async id=>{if(!live){pick(id);return}const mail=mails.find(m=>m.id===id);if(mail)await openOriginal(mail)},
    acceptSuggestion:async id=>{pick(id);await currentSuggestion?.(true)},
    reply:async(id,all)=>{const mail=mails.find(m=>m.id===id);if(mail)await draft(mail,all?'reply-all':'reply','')},
    setField:(id,field,value)=>change([id],{kind:field,value}),setTags:(id,_previous,value)=>change([id],{kind:'tags',value})})
  let previousScope=''
  cockpit=initCockpit({getMails:()=>mails,isLive:()=>live,onPick:pick,openUnanswered:()=>correspondence.show(),
    onStatus:(ids:string[],status:string)=>change(ids,{kind:'status',value:status}),
    onFolder:(ids:string[],target:string)=>change(ids,{kind:'move',value:target}),
    getFolders:()=>folders,getSuggestionFolders:learnerFolders,onUndo:undo,
    closeBacklog:async()=>{
      if(!live){scope=previousScope;render();return}
      if(scope==='__backlog')await exclusive(()=>refresh(previousScope))
    },
    loadBacklog:async()=>{
      if(scope!=='__backlog')previousScope=scope
      if(!live){scope='';views.reset();render();return true}
      let loaded=false
      await exclusive(async()=>{await refresh('__backlog');loaded=true})
      return loaded
    }})
  if(service)bindProjectBoard(service)
  correspondence=initCorrespondence({isLive:()=>live,rows:()=>mails,folders:()=>boardFolders(folders,getBoardScope()).map(f=>f.id),
    service,render,resolveReplies:(ids,value)=>change(ids,{kind:'status',value}),busy:()=>busy,
    writeBatch:async action=>{if(busy)throw new Error('Eine Outlook-Aktion läuft.');await exclusive(()=>service!.writeBatch(action))},refreshAfterWrite:async()=>{if(live)await refresh();else render()},demoOpen:pick,
    trackDemo:rows=>{changeDemo(()=>{for(const row of rows) {
      const existing=demoMails.find(m=>m.id===row.id)
      if(existing)existing.status='Warten'
      else demoMails.push({...row,body:'',folder:'Gesendet',tags:[],attachments:[],status:'Warten'})
    }});void correspondence.refresh()}})
  fillOptions(el('status'),states.map(s=>({id:s,label:s})))
  for(const key of ['status','folder'] as const) {
    const element=el<HTMLSelectElement>(key)
    element.onchange=()=>{if(selected)void change([selected.id],{kind:key==='folder'?'move':'status',value:element.value})}
  }
  const archiveButton=tag('button','');archiveButton.id='archiveDone';archiveButton.hidden=true;el('workActions').append(archiveButton)
  bindAiBoard(()=>live?mails:[],()=>live?learnerFolders().map(f=>f.path):[])
  renderAiSettings(el('aiSettings'),()=>live?learnerFolders():[])
  syncColors=colorSettings(el('aiSettings'),service,()=>live,render)
  const prefix=tag('input','');prefix.value=String(getLegacyConfig().status_prefix||'Status: ')
  const setPrefix=async()=>{
    if(!prefix.value.trim() || prefix.value.length>128)throw new Error('Bitte ein gültiges Status-Präfix eingeben.')
    if(service)await service.invoke('outlook_prefix',{prefix:prefix.value})
    updateConfig({status_prefix:prefix.value})
  }
  prefix.onchange=()=>void exclusive(setPrefix)
  const labelPrefix=tag('label','Outlook-Statuspräfix');labelPrefix.append(prefix);el('aiSettings').append(labelPrefix)
  if(service && prefix.value!=='Status: '){try{await setPrefix()}catch(error){notify(errorText(error))}}
  const toggle=document.createElement('input');toggle.type='checkbox';toggle.id='allowMove'
  toggle.checked=mayMove()
  toggle.onchange=()=>{updateConfig({allow_move:toggle.checked});render()}
  const label=tag('label','');label.append(toggle,' Echte Mails verschieben erlauben')
  el('aiSettings').prepend(label)
  for(const [key,caption,fallback,min,max] of [
    ['preview_chars','Zeichen in der Kartenvorschau',160,0,1500],['inbox_days','Posteingang · Tage',60,0,36500],['done_days','Erledigt · Tage',14,0,36500],
    ['sent_days','Gesendet · Tage',14,0,36500],['overdue_days','Überfällig ab Werktagen',5,0,36500],['archive_after_days','Archivierung anbieten ab Tagen',7,0,36500],['max_items_per_folder','Limit pro Ordner',500,0,5000],['poll_seconds','Aktualisieren · Sekunden',30,0,86400]
  ] as const) {
    const input=document.createElement('input');input.type='number';input.min=String(min);input.max=String(max)
    input.value=String(getLegacyConfig()[key]??fallback)
    input.onchange=()=>{if(input.checkValidity() && Number.isInteger(input.valueAsNumber)){updateConfig({[key]:input.valueAsNumber});render()}}
    const l=tag('label',caption);l.append(input);el('aiSettings').append(l)
  }
  for(const [key,caption,fallback] of [
    ['suggestions','Ablagevorschläge auf Karten anzeigen',true],['compact_cards','Kompakte Karten',true],['show_ai_summary','KI-Zusammenfassung auf Karten',true],
    ['reply_to_offen','Bei erkannter Antwort die wartende Karte automatisch bearbeiten',false]
  ] as const){
    const input=document.createElement('input');input.type='checkbox'
    input.checked=(getLegacyConfig()[key]??fallback)===true
    input.onchange=()=>{updateConfig({[key]:input.checked});render();void correspondence.refresh()}
    const label=tag('label','');label.append(input,' '+caption);el('aiSettings').append(label)
  }
  dialog.onclose=()=>{suggestionVersion++;if(selected)document.getElementById('mail-'+selected.id)?.focus()}
  search.oninput=render
  undoButton.onclick=()=>void undo()
  back.onclick=()=>{search.value='';sourceUpdated(demoMails,false,demoFolders,'');notify('')}
  if(service) {
    inboxButton.hidden=false;inboxButton.onclick=()=>void connect()
    const testButton=el<HTMLButtonElement>('openOutlookTest')
    testButton.hidden=false
    testButton.onclick=()=>void exclusive(async()=>{await service.invoke('outlook_test');notify('Outlook-Testfenster geschlossen.')})
    el('openOriginal').onclick=()=>{if(live&&selected)void openOriginal(selected)}
    el('connectOutlook').onclick=async()=>{
      await exclusive(async()=>{await service.invoke('outlook_connect');notify('Outlook geöffnet.')})
      await connect()
    }
    for(const button of document.querySelectorAll<HTMLButtonElement>('button[data-draft]'))
      button.onclick=()=>{if(selected)void draft(selected,button.dataset.draft!,el<HTMLSelectElement>('draftSnippet').value)}
    window.addEventListener('mailboard:foldersChanged',()=>void reloadFolders())
  }
  let nextPoll=0
  window.setInterval(()=>{
    if(!live || busy || document.hidden || document.querySelector('dialog[open]') || Date.now()<nextPoll)return
    const seconds=Number(getLegacyConfig().poll_seconds??30)
    if(seconds<=0)return
    nextPoll=Date.now()+Math.max(5,seconds)*1000
    // Suppress a stale poll when the user changes folders or starts editing in the interim.
    if(document.activeElement?.closest('.card') || search===document.activeElement)return
    void exclusive(async()=>{
      const rows=await readRows(scope,folders)
      if(document.querySelector('dialog[open]'))return
      mails=rows
      hydrate(mails,folders);void queueAnalyses()
      render();void correspondence.refresh()
    })
  },5000)
  document.addEventListener('keydown',e=>{
    if(e.defaultPrevented||!(e.ctrlKey||e.metaKey))return
    if(e.key.toLowerCase()==='f'&&!document.querySelector('dialog[open]')){e.preventDefault();search.focus()}
    if(e.key.toLowerCase()==='z'&&!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) && !el<HTMLDialogElement>('moveConfirm').open){e.preventDefault();void undo()}
  })
  sourceUpdated(demoMails,false,demoFolders,'')
}
start().catch(e=>notify('Das Board konnte nicht starten: '+errorText(e)))
