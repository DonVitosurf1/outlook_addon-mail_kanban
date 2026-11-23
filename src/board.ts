import {undoLimit} from './undo-limit'
import {describeChange, undoTooltip} from './change-label'
import {showToast, hideToast} from './toast'
import './shell'
import {renderCardContent, type CaseState} from './card-content'
import {colorSettings,applyLaneColor} from './category-colors'
import { useSampleSettings, ask, readLimits, textSnippets, getLegacyConfig, updateConfig } from './data-settings'
import { bindProjectBoard, projectUndoLatest, undoProjectIfLatest, getBoardScope, getLearningScope, getArchiveScope } from './projects'
import demo from './demo.json'
import { countsAsFiling, LiveBoard, UndoSkippable, type Folder, type Invoke } from './live'
import { setAiLive, suggestFolder, recordFiling, renderAiSettings, renderAnalysis, restoreAnalysis, rejectSuggestion, bindAiBoard, queueAnalyses, trustedFolderBatch } from './ai'
import { BoardViews, matchesQuery } from './views'
import { initCorrespondence, demoSentRows } from './correspondence'
import { initCockpit, recordWeekly } from './cockpit'
import { maybeIntro } from './intro'
import { initTriage } from './triage'
import { initRoutines, markRoutine } from './routines'
import { initCalendar } from './calendar'
import { renderMailTasks } from './mail-tasks'
import { allCases, initCases, toggleCaseItem } from './cases'
import { shortcutFor, type ShortcutAction } from './shortcuts'
import { caseProgress, caseTag, CASE_PREFIX, focusTarget, FOCUS_TAG, hasFocus, withTag, type RoutineAction } from './planning-logic'
import { loadRoutines, useSamplePlanning } from './planning-store'
import { initTabs } from './tabs'
import { initSetup, type OffBoardMail, type SetupFolder } from './setup'
import './setup-outliers'
import './setup-refine'
import './setup-profiles'
import './setup-compare'
import './setup-inbox'

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
const service=core && new LiveBoard((command,args)=>core.invoke(command,args),(delta,occurredAt)=>recordWeekly(true,'filed',delta,occurredAt))
function mayMove(){return getLegacyConfig().allow_move===true}
const storageKey='outlook-kanban-demo-positions-v1'
const demoUndo:{mails:Mail[],events:Counter[],label?:string}[]=[]
let demoMails:Mail[]=[]
let mails:Mail[]=[]
let folders:Folder[]=[]
type Mailbox='outlook'|'demo'|'offline'
let mailbox:Mailbox='offline'
const isLive=()=>mailbox==='outlook'
const hasMailbox=()=>mailbox!=='offline'
let busy=false
let connection:object|undefined
let scope=''
let selected:Mail|undefined
let syncColors:ReturnType<typeof colorSettings>
let correspondence:ReturnType<typeof initCorrespondence>
let cockpit:ReturnType<typeof initCockpit>
let views:BoardViews
let triage:ReturnType<typeof initTriage>|undefined
let cases:ReturnType<typeof initCases>|undefined
let calendarView:ReturnType<typeof initCalendar>|undefined
let setup:ReturnType<typeof initSetup>|undefined
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
  inboxButton.disabled=el<HTMLButtonElement>('connectOutlook').disabled=busy||!!connection
  back.disabled=busy
  undoButton.disabled=busy||!(isLive()?(service?.canUndo||projectUndoLatest()):demoUndo.length)
  undoButton.title=undoTooltip(latestUndoLabel())
  for(const id of ['folder','status','suggestFolder','applySuggestion','openOriginal'])
    el<HTMLButtonElement>(id).disabled=busy
}
/** Beschriftung des Schritts, den Rückgängig gerade zurücknimmt. Bei Projektänderungen unbekannt. */
function latestUndoLabel() {
  if(!hasMailbox())return undefined
  if(!isLive())return demoUndo.at(-1)?.label
  if(projectUndoLatest()>=(service?.latest||0))return undefined
  return service?.latestLabel
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
function changeDemo(action:()=>void,events:Counter[]=[],label?:string) {
  if(mailbox!=='demo')return
  const before=structuredClone(demoMails)
  action()
  demoUndo.push({mails:before,events,label})
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
function sourceUpdated(rows:Mail[],source:Mailbox,items:Folder[],key:string) {
  const outlook=source==='outlook'
  if(source!==mailbox)search.value=''
  if(source==='offline')hideToast()
  if(dialog.open)dialog.close()
  suggestionVersion++
  mailbox=source;mails=rows;folders=items;scope=key;selected=undefined
  useSampleSettings(source==='demo')
  useSamplePlanning(source==='demo')
  setAiLive(outlook,source)
  bindProjectBoard(outlook?service:undefined)
  if(outlook)hydrate(rows,items)
  views.resetSelection()
  back.hidden=source==='demo'
  inboxButton.textContent=outlook?'Aktualisieren':(source==='demo'?'Zu Outlook wechseln':'Erneut verbinden')
  el('connectOutlook').hidden=source!=='offline'||!service
  el('openSettings').hidden=el('dataSettings').hidden=source==='demo'
  document.querySelector<HTMLElement>('.foot')!.textContent=outlook?'Klassisches Outlook':source==='demo'?'Beispielpostfach':'Kein Postfach verbunden'
  fillOptions(el('folder'),folders.map(f=>({id:f.id,label:f.path||f.name})))
  render()
  if(outlook)void queueAnalyses()
  void syncColors?.(outlook)
  void correspondence?.refresh()
  maybeIntro(source)
}
function boardFolders(list:Folder[], paths:string[]) {
  const targets=new Set(paths.map(p=>p.toLocaleLowerCase('de')))
  return list.filter(f=>targets.has(f.path.toLocaleLowerCase('de')))
}
function learnerFolders() {
  if(!isLive())return mailbox==='demo'?demoFolders:[]
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
  sourceUpdated(rows,'outlook',folders,key)
}
async function connect(startOutlook=false) {
  if(!service||busy||connection)return
  const request={}
  const wasLive=isLive()
  const previousScope=wasLive?scope:''
  const load=async()=>{
    connection=request
    if(!wasLive)sourceUpdated([],'offline',[],'')
    controls()
    notify(startOutlook?'Outlook wird gestartet …':'Outlook-Postfach wird geladen …')
    try{
      if(startOutlook)await service.invoke('outlook_connect')
      if(connection!==request)return
      const list=await service.json<Folder[]>('outlook_folders')
      if(connection!==request)return
      const key=list.some(f=>f.id===previousScope)?previousScope:''
      const rows=await readRows(key,list)
      if(connection!==request)return
      sourceUpdated(rows,'outlook',list,key)
      notify(mails.length+' Mails geladen.')
    }catch(error){
      if(connection!==request)return
      sourceUpdated([],'offline',[],'')
      notify('Outlook konnte nicht geladen werden. '+errorText(error))
    }finally{
      if(connection===request)connection=undefined
      controls()
    }
  }
  if(wasLive)await exclusive(load)
  else await load()
}
function confirmMove(question:string,confirmLabel='Verschieben') {
  const prompt=el<HTMLDialogElement>('moveConfirm')
  el('moveQuestion').textContent=question
  el('moveConfirmOk').textContent=confirmLabel
  prompt.returnValue='cancel'
  return new Promise<boolean>(resolve=>{
    prompt.addEventListener('close',()=>{el('moveConfirmOk').textContent='Verschieben';resolve(prompt.returnValue==='confirm')},{once:true})
    prompt.showModal()
  })
}

function archiveFolder(needAllowed=true){
  const path=getArchiveScope()
  return isLive() && (!needAllowed || mayMove()) && path?folders.find(f=>f.path===path):undefined
}
function isInInbox(mail:Mail) {return folders.some(f=>f.isInbox && f.id===mail.folderId)}
function archiveCandidates(){
  const days=Number(getLegacyConfig().archive_after_days??7)
  if(!archiveFolder()||days<=0)return []
  const cutoff=Date.now()-days*86400000
  return mails.filter(m=>isInInbox(m)&&m.status==='Erledigt'&& Date.parse(m.statusSince||m.received||'')<=cutoff)
}
let mutationVersion=0
function needsStatus(mail:Mail,value:string){
  return mail.status!==value || mail.hasStatus===false
}
/**
 * `tagsFor` berechnet die Kategorien je Mail, etwa beim Umschalten des Fokus für eine gemischte Auswahl.
 * `offBoard` (nur Outlook): Mails, die nicht auf dem Board stehen, etwa Lernbeispiele aus der Ausreißerprüfung (E3).
 * Sie laufen mit derselben Bestätigung, demselben Undo-Schritt und derselben Rückmeldung. `moved` meldet jede verschobene Mail (bisherige ID),
 * `failed` zusätzlich zur Meldungszeile den Fehlertext.
 */
type Mutation={kind:'move'|'status'|'tags'|Field;value:string|string[];status?:string;tagsFor?:(mail:Mail)=>string[];offBoard?:Mail[];moved?:(id:string)=>void;failed?:(text:string)=>void}
const assignCase=(ids:string[],name:string,on:boolean)=>change(ids,{kind:'tags',value:[],tagsFor:m=>withTag(m.tags,caseTag(name),on)})
async function change(ids:string[],action:Mutation) {
  if(action.offBoard&&!isLive())return
  await exclusive(()=>reporting(action.failed,async()=>{
    const rows=action.offBoard?.filter(m=>ids.includes(m.id))??mails.filter(m=>ids.includes(m.id))
    const field=action.kind
    const value=action.value as string
    const wanted=(m:Mail)=>action.tagsFor?action.tagsFor(m):action.value as string[]
    const todo=rows.filter(m=>{
      if(field==='move')return (m.folderId||m.folder)!==value || (!!action.status && needsStatus(m,action.status))
      if(field==='status')return needsStatus(m,value)
      if(field==='tags')return JSON.stringify(m.tags)!==JSON.stringify(wanted(m))
      return m[field]!==value
    })
    if(!todo.length) return
    const added:string[]=[],removed:string[]=[]
    if(field==='tags')for(const m of todo){
      const next=wanted(m).map(t=>t.toLowerCase()),prev=m.tags.map(t=>t.toLowerCase())
      added.push(...wanted(m).filter(t=>!prev.includes(t.toLowerCase())))
      removed.push(...m.tags.filter(t=>!next.includes(t.toLowerCase())))
    }
    const dest=folders.find(f=>f.id===value)
    if(field==='move'&&!dest)throw new Error('Zielordner nicht verfügbar.')
    const moving=field==='move'?todo.filter(m=>(m.folderId||m.folder)!==value):[]
    const archive=field==='status' && value==='Erledigt'?archiveFolder(false):undefined
    const archiving=archive?todo.filter(isInInbox):[]
    const summary=describeChange({kind:field,value:action.value,count:todo.length,folder:field==='move'?(dest!.name):undefined,added,removed},FOCUS_TAG,CASE_PREFIX)
    const label=todo.length===1?'„'+todo[0].subject+'“':todo.length+' Mails'
    let question=''
    if(moving.length)question=label+' nach „'+(dest!.path||dest!.name)+'“ verschieben'+(action.status?' und auf „'+action.status+'“ setzen':'')+'?'
    if(archiving.length)question=label+' als erledigt markieren und '+archiving.length+' aus dem Posteingang nach „'+archive!.path+'“ archivieren?'
    const needsAllow=isLive() && !mayMove() && (moving.length>0 || archiving.length>0)
    if(needsAllow)question='Das Board darf noch keine Mails in Outlook verschieben. Jetzt erlauben und '+question
    if(isLive() && question && !await confirmMove(question,needsAllow?'Erlauben und verschieben':'Verschieben')) {
      if(selected)fillDetail(selected)
      return
    }
    if(needsAllow){
      updateConfig({allow_move:true})
      const toggle=document.querySelector<HTMLInputElement>('#allowMove')
      if(toggle)toggle.checked=true
      render()
    }
    if(!isLive()) {
      const events:Counter[]=field==='move'?moving.filter(()=>dest?.name!=='Posteingang').map(()=>'filed'):
        field==='followUp'&&value?todo.map(()=>'followed_up'):field==='snoozeUntil'&&value?todo.map(()=>'snoozed'):[]
      changeDemo(()=>{for(const m of todo) {
        if(field==='move'){m.folder=value;if(action.status)m.status=action.status}
        else if(field==='tags')m.tags=[...wanted(m)]
        else m[field]=value
      }},events,summary)
      showToast(summary,()=>void undo())
      if(selected)fillDetail(selected)
      return
    }
    mutationVersion++
    await service!.writeBatch(async()=>{
      const batch=service!.begin(summary)
      const errors:string[]=[]
      let succeeded=0
      for(const m of todo) {
        try {
          if(!m.folderId)throw new Error('Quellordner fehlt. Bitte Outlook aktualisieren.')
          if(field==='move') {
            let id=m.id
            if(m.folderId!==value){
              const countAsFiled=countsAsFiling(dest!,getArchiveScope())
              id=await service!.move(batch,m.id,m.folderId,value,countAsFiled)
              mails=mails.filter(x=>x!==m)
              if(countAsFiled){
                if(learnerFolders().some(f=>f.id===value)){
                  try {recordFiling(m,dest!.path||dest!.name)} catch { /* Outlook already saved the move. */ }
                }
              }
              action.moved?.(m.id)
            }
            if(action.status && needsStatus(m,action.status)){
              try {await service!.status(batch,id,value,action.status);m.status=action.status;m.hasStatus=true}
              catch(e){throw new Error((id===m.id?'':'Verschoben. ')+'Statusänderung fehlgeschlagen: '+errorText(e))}
            }
          } else if(field==='status') {
            await service!.status(batch,m.id,m.folderId,value)
            m.status=value;m.hasStatus=true
            if(archive && isInInbox(m)){
              try {await service!.move(batch,m.id,m.folderId,archive.id,false);mails=mails.filter(x=>x!==m)}
              catch(e){throw new Error('Status geändert. Archivieren fehlgeschlagen: '+errorText(e))}
            }
          } else if(field==='tags') {
            m.tags=await service!.tags(batch,m.id,m.folderId,m.tags,wanted(m))
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
      if(errors.length){const text=succeeded+' von '+todo.length+' geändert. '+errors.join(' · ');notify(text);action.failed?.(text)}
      else{notify('');showToast(summary,()=>void undo())}
    })
  }))
}
/** Gibt einen Fehler zusätzlich an `failed` weiter, bevor `exclusive` ihn in der Meldungszeile zeigt. */
function reporting(failed:((text:string)=>void)|undefined,action:()=>Promise<void>){
  return failed?action().catch(e=>{failed(errorText(e));throw e}):action()
}
async function undo() {
  if(!hasMailbox())return
  await exclusive(async()=>{
    const label=latestUndoLabel()
    const done=()=>showToast(label?'Zurückgenommen: '+label:'Änderung rückgängig gemacht.')
    if(isLive()) {
      // Ein Schritt, der nicht ganz zurückgeht, lässt sich überspringen, damit er den Stapel nicht blockiert.
      const offerSkip=async(error:unknown)=>{
        if(!(error instanceof UndoSkippable))throw error
        const skip=await ask(document.body,error.message+' Diesen Rückgängig-Schritt überspringen und den aktuellen Outlook-Wert behalten?', 'Schritt überspringen')
        if(skip)error.skip()
        notify(skip?'Rückgängig-Schritt übersprungen.':'Rücknahme abgebrochen. Der Schritt bleibt verfügbar.')
      }
      await service!.writeBatch(async()=>{
        try {if(await undoProjectIfLatest(service?.latest||0)){done();return}}
        catch(error){await offerSkip(error);return}
        if(!service?.canUndo)return
        try {await service.undo(step=>{
          if(step.kind==='field'&&step.value&&step.field==='followUp')cockpit.record('followed_up',-1)
          if(step.kind==='field'&&step.value&&step.field==='snoozeUntil')cockpit.record('snoozed',-1)})} catch(error){
          await offerSkip(error)
          return
        } finally {await refresh()}
        done()
      })
    } else {
      const old=demoUndo.pop()
      if(!old)return
      for(const event of old.events)cockpit.record(event,-1)
      demoMails=old.mails;sourceUpdated(demoMails,'demo',demoFolders,scope);saveDemo()
      done()
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
function toggleFocus(ids:string[]) {
  const rows=mails.filter(m=>ids.includes(m.id)),on=focusTarget(rows)
  return change(ids,{kind:'tags',value:[],tagsFor:m=>withTag(m.tags,FOCUS_TAG,on)})
}
const draftOnly='Entwürfe gibt es nur im Outlook-Postfach.'
function fillDetailBar(mail:Mail) {
  for(const b of document.querySelectorAll<HTMLButtonElement>('#detailBar [data-draft]')) {
    b.disabled=!isLive();b.title=isLive()?'':draftOnly
  }
  const follow=el('detailBar').querySelector<HTMLButtonElement>('[data-act=followUp]')!
  follow.hidden=mail.status!=='Warten'
  const focus=el('detailBar').querySelector<HTMLButtonElement>('[data-act=focus]')!
  focus.setAttribute('aria-pressed',String(hasFocus(mail)))
}
function initDetailBar() {
  const bar=el('detailBar')
  for(const b of bar.querySelectorAll<HTMLButtonElement>('button[data-key]')) {
    const keys=shortcutFor(b.dataset.key as ShortcutAction)
    if(!keys)continue
    b.setAttribute('aria-keyshortcuts',keys.replace('Umschalt','Shift'))
    const hint=tag('kbd',keys);b.append(' ',hint)
  }
  const edit=(field:'snoozeUntil'|'followUp'|'note',from?:HTMLElement)=>{if(selected)views.editDetailField(selected.id,field,from)}
  const act=(name:string,from?:HTMLElement)=>{
    if(!selected)return
    if(name==='focus')void toggleFocus([selected.id]).catch(e=>notify('Aktion fehlgeschlagen: '+errorText(e)))
    else if(name==='case')cases?.openAssign([selected.id])
    else edit(name as 'snoozeUntil'|'followUp'|'note',from)
  }
  for(const b of bar.querySelectorAll<HTMLButtonElement>('button[data-act]'))b.onclick=()=>act(b.dataset.act!,b)
  dialog.addEventListener('keydown',e=>{
    const t=e.target as HTMLElement
    if(e.ctrlKey||e.altKey||e.metaKey||e.defaultPrevented||!selected||t.closest('input,textarea,select,[contenteditable]'))return
    const key=e.key.toLowerCase()
    if(key==='r'){
      const b=bar.querySelector<HTMLButtonElement>('[data-draft='+(e.shiftKey?'reply-all':'reply')+']')
      if(b&&!b.disabled)b.click()
    }else{
      const name=({w:'snoozeUntil',n:'followUp',k:'note',f:'focus'} as Record<string,string>)[key]
      const b=name&&bar.querySelector<HTMLButtonElement>('[data-act='+name+']')
      if(!b||b.hidden||e.shiftKey)return
      act(name,b)
    }
    e.preventDefault()
  })
}
function showTasks(mail:Mail) {
  renderMailTasks(el('tasks'),mail,{cases:()=>allCases(mails),canAssign:hasMailbox,confirm:(question,label)=>ask(dialog,question,label),
    assign:async(m,name)=>{await assignCase([m.id],name,true)},undo:()=>void undo(),
    refresh:()=>{for(const m of mails)restoreAnalysis(m);if(selected)selected=mails.find(m=>m.id===selected!.id)||selected;window.dispatchEvent(new Event('kanban-analysis'))}})
}
window.addEventListener('kanban-analysis',()=>{if(selected&&dialog.open)showTasks(selected)})
function fillDetail(mail:Mail) {
  const version=++suggestionVersion
  correspondence?.detail(mail.id,el('detailActions'))
  el('openOriginal').hidden=!isLive()
  el('openError').textContent=''
  el('subject').textContent=mail.subject
  el('from').textContent=mail.sender
  el('body').textContent=mail.body
  el('attachments').textContent=mail.attachments.length?'Anhänge · '+mail.attachments.join(', '):''
  el<HTMLSelectElement>('status').value=mail.status
  el<HTMLSelectElement>('folder').value=mail.folderId||mail.folder
  el('replyActions').hidden=!isLive()
  fillDetailBar(mail)
  fillOptions(el('draftSnippet'),[{id:'',label:'Ohne Textbaustein'},...textSnippets('follow_up').map(s=>({id:s.body,label:s.label}))])
  el('rejectSuggestion')?.remove()
  const result=el('suggestionResult'), accept=el<HTMLButtonElement>('applySuggestion')
  result.textContent='';accept.hidden=true
  const choices=learnerFolders().filter(f=>f.id!==(mail.folderId||mail.folder)).map(f=>f.path)
  renderAnalysis(el('analysis'),mail,choices,isLive()?async(text:string)=>{await draft(mail,'reply',text)}:undefined,
    async(tags:string[])=>{await change([mail.id],{kind:'tags',value:tags})})
  showTasks(mail)
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
function makeCard(mail:Mail,config:Record<string,unknown>,hint?:string,caseStates:readonly CaseState[]=[]) {
  const card=tag('button','')
  card.className='card';card.id='mail-'+mail.id;card.draggable=true
  card.ondragstart=e=>e.dataTransfer?.setData('application/x-mailboard-item',mail.id)
  renderCardContent(card,mail,config,hint,caseStates)
  card.onclick=()=>pick(mail.id)
  views.bindCard(card,mail.id)
  return card
}
function render() {
  const restorePlace=views.rememberPlace()
  const archiveButton=el<HTMLButtonElement>('archiveDone')
  if(archiveButton){
    const candidates=archiveCandidates()
    archiveButton.hidden=!candidates.length
    archiveButton.textContent=candidates.length+' Erledigte ins Archiv'
    archiveButton.onclick=()=>{const f=archiveFolder();if(f)void change(candidates.map(m=>m.id),{kind:'move',value:f.id})}
  }
  const nav=el('folders')
  nav.replaceChildren()
  const choices=hasMailbox()?[{id:'',path:'Alle Mails',name:'Alle Mails'},...folders]:[]
  for(const f of choices) {
    const btn=tag('button',f.path||('name' in f?String(f.name):''))
    btn.title=btn.textContent||f.path
    if(!isLive() || !scope || scope===f.id)btn.append(tag('b',String(mails.filter(m=>!f.id||(isLive()?m.folderId:m.folder)===f.id).length)))
    btn.setAttribute('aria-pressed',String(scope===f.id))
    btn.onclick=()=>{
      if(isLive())void exclusive(()=>refresh(f.id))
      else {scope=f.id;views.resetSelection();render();nav.querySelector<HTMLElement>('[aria-pressed=true]')?.focus()}
    }
    if(f.id)dropZone(btn,ids=>void change(ids,{kind:'move',value:f.id}))
    nav.append(btn)
  }
  setup?.refresh()
  cockpit?.refresh()
  triage?.refresh()
  cases?.refresh()
  calendarView?.refresh()
  views.sync(mails)
  const visible=views.filter(mails.filter(m=>(isLive()||!scope||m.folder===scope)&&matchesQuery(m,search.value)))
  el('title').textContent=!hasMailbox()?'Outlook-Postfach':isLive()?'Outlook · '+(scope==='__backlog'?'Aufräumen':folders.find(f=>f.id===scope)?.name||'Alle Mails'):scope||'Alle Mails'
  el('summary').textContent=!hasMailbox()?'':visible.length+' von '+mails.length+' Mails'
  const board=el('board');board.replaceChildren()
  board.hidden=el('viewMenu').hidden=!hasMailbox()
  if(!hasMailbox()){controls();return}
  const config=getLegacyConfig()
  const suggest=config.suggestions===false?undefined:trustedFolderBatch(learnerFolders().map(f=>f.path))
  const caseStates:CaseState[]=allCases(mails).filter(c=>!c.closed).map(c=>({name:c.name,tag:caseTag(c.name),...caseProgress(c)}))
  const card=(m:Mail)=>makeCard(m,config,(isLive()?isInInbox(m):m.folder==='Posteingang')?suggest?.(m)?.folder:undefined,caseStates)
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
  restorePlace()
}
async function openOriginal(mail:Mail) {
  if(!isLive())return
  await exclusive(async()=>{await service!.invoke('outlook_open',{id:mail.id,folder:mail.folderId})})
}
async function draft(mail:Mail,mode:string,text:string) {
  if(!isLive()){notify('Für einen Outlook-Entwurf zuerst Outlook-Mails laden.');return}
  await exclusive(async()=>{await service!.invoke('outlook_draft',{id:mail.id,folder:mail.folderId,mode,text});notify('Entwurf in Outlook geöffnet.')})
}
async function reloadFolders() {
  reloadPending=false
  if(!isLive()||!service)return
  if(busy){reloadPending=true;return}
  await exclusive(async()=>{
    const list=await service.json<Folder[]>('outlook_folders')
    folders=list
    await refresh(list.some(f=>f.id===scope)?scope:'')
  })
}
async function start() {
  demoMails=structuredClone(demo);loadDemo()
  views=new BoardViews({render,open:pick,scopeIdentity:()=>mailbox+':'+scope,inboxId:()=>folders.find(f=>f.isInbox)?.id||'Posteingang',changeStatus:(ids,value)=>change(ids,{kind:'status',value}),
    moveToFolder:(ids,index)=>{const f=folders[index];return f?change(ids,{kind:'move',value:f.id}):Promise.resolve()},
    dropInFolder:(ids,folder,status)=>change(ids,{kind:'move',value:folder,status}),
    clearScope:()=>{if(!isLive())scope=''},hasScope:()=>!isLive() && !!scope,
    openOriginal:async id=>{if(!isLive()){pick(id);return}const mail=mails.find(m=>m.id===id);if(mail)await openOriginal(mail)},
    acceptSuggestion:async id=>{pick(id);await currentSuggestion?.(true)},
    reply:async(id,all)=>{const mail=mails.find(m=>m.id===id);if(mail)await draft(mail,all?'reply-all':'reply','')},
    setField:(id,field,value)=>change([id],{kind:field,value}),setTags:(id,_previous,value)=>change([id],{kind:'tags',value}),
    toggleFocus,
    assignCase:ids=>cases?.openAssign(ids)})
  let previousScope=''
  const overdueDays=()=>Number(getLegacyConfig().overdue_days??5)
  const assign=assignCase
  // Lokale Planungsdaten (Routinen, Vorgänge) ändern Banner, Seitenleiste und offene Dialoge.
  document.addEventListener('mailboard:planning',()=>render())
  const toggleItem=toggleCaseItem
  initTabs()
  setup=initSetup({mailbox:()=>mailbox,folders:()=>isLive()?folders as SetupFolder[]:[],learnerFolders,inbox:()=>isLive()?mails.filter(m=>m.id&&m.folderId&&isInInbox(m)) as OffBoardMail[]:[],service:()=>isLive()?service:undefined,
    confirm:(question,label)=>ask(document.body,question,label),
    moveMails:async(list,target,moved)=>{
      if(busy)return 'Das Board ist gerade beschäftigt. Bitte gleich noch einmal versuchen.'
      let problem=''
      await change(list.map(m=>m.id),{kind:'move',value:target,moved,failed:text=>{problem=text},
        offBoard:list.map(m=>({...m,folder:folders.find(f=>f.id===m.folderId)?.name??'',status:'Offen',tags:[],attachments:[]}))})
      return problem
    },
    exclusive:async action=>{
      if(busy)return 'Das Board ist gerade beschäftigt. Bitte gleich noch einmal versuchen.'
      let problem=''
      await exclusive(()=>action().catch(e=>{problem=errorText(e);throw e}))
      return problem
    },
    undo:()=>void undo(),
    review:(list,onClose)=>cockpit.openCleanup(list,onClose)})
  el('setupOpen').onclick=()=>setup?.open()
  const calendar=calendarView=initCalendar({getMails:()=>mails,routines:loadRoutines,cases:()=>allCases(mails),onPick:pick,canPlan:hasMailbox,
    plan:(id,field,day)=>change([id],{kind:field,value:day}),markRoutine,toggleItem,
    openCase:name=>cases?.open(name)})
  cases=initCases({getMails:()=>mails,selection:()=>views.selection(),canAssign:hasMailbox,assign,onPick:pick,showOnBoard:name=>views.showTag(caseTag(name))})
  const runRoutine=(action:RoutineAction)=>{
    switch(action){
      case 'triage':triage?.start();break
      case 'hygiene':cockpit.openPage('hygiene');break
      case 'week':cockpit.openPage('week');break
      case 'cleanup':cockpit.openCleanup();break
      case 'unanswered':void correspondence.show();break
      case 'calendar':calendar.open();break
      case 'cases':cases?.open();break
    }
  }
  const routines=initRoutines({run:runRoutine})
  triage=initTriage({getMails:()=>mails,isLive,hasMailbox,overdueDays,views,render,onPick:pick,
    enter:()=>{
      const source=mailbox,previous=scope
      if(source==='demo')scope=''
      return ()=>{if(source==='demo'&&mailbox==='demo')scope=previous}
    },
    routines:loadRoutines,markRoutine:id=>markRoutine(id),runRoutine:r=>runRoutine(r.action||''),
    cases:()=>allCases(mails),toggleItem})
  cockpit=initCockpit({getMails:()=>mails,isLive,hasMailbox,onPick:pick,
    startTriage:()=>triage?.start(),triageActive:()=>!!triage?.active,routines:loadRoutines,
    openCalendar:()=>calendar.open(),setupProgress:()=>setup?.progress()??'',openSetup:()=>setup?.open(),markRoutine:id=>markRoutine(id),showFocus:key=>views.showFocus(key),showOverdue:()=>views.showSplit('overdue'),
    // Vorgegebene Mailliste (E7): Mails außerhalb des Boards, Ordner der verschobenen Mails für die Durchsicht nachziehen.
    onStatus:(ids,status,rows)=>change(ids,{kind:'status',value:status,offBoard:rows as Mail[]|undefined}),
    onFolder:(ids,target,rows)=>change(ids,{kind:'move',value:target,offBoard:rows as Mail[]|undefined,
      moved:rows&&(id=>{const row=rows.find(m=>m.id===id);if(row){row.folderId=target;row.folder=folders.find(f=>f.id===target)?.name??row.folder}})}),
    getFolders:()=>folders,getSuggestionFolders:learnerFolders,onUndo:undo,
    closeBacklog:async()=>{
      if(!isLive()){scope=previousScope;render();return}
      if(scope==='__backlog')await exclusive(()=>refresh(previousScope))
    },
    loadBacklog:async()=>{
      if(!hasMailbox())return false
      if(scope!=='__backlog')previousScope=scope
      if(!isLive()){scope='';views.reset();render();return true}
      let loaded=false
      await exclusive(async()=>{await refresh('__backlog');loaded=true})
      return loaded
    }})
  correspondence=initCorrespondence({isLive,hasMailbox,rows:()=>mails,folders:()=>boardFolders(folders,getBoardScope()).map(f=>f.id),
    service,render,resolveReplies:(ids,value)=>change(ids,{kind:'status',value}),busy:()=>busy,
    writeBatch:async action=>{if(busy)throw new Error('Eine Outlook-Aktion läuft.');await exclusive(()=>service!.writeBatch(action))},refreshAfterWrite:async()=>{if(isLive())await refresh();else render()},demoOpen:pick,
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
  bindAiBoard(()=>isLive()?mails:[],()=>isLive()?learnerFolders().map(f=>f.path):[])
  const settings=el('aiSettings'),jump=tag('nav',''),parts:Record<string,HTMLElement>={}
  jump.className='settings-jump';jump.setAttribute('aria-label','Abschnitte der Einstellungen');jump.hidden=true
  for(const [key,title,hint] of [
    ['outlook','Outlook','Wie das Board mit deinem Postfach umgeht.'],['board','Board','Wie viele Mails das Board zeigt und wann es nachfragt.'],
    ['ki','Lokale KI','Sprachmodell und Embeddings laufen auf deinem Rechner. Mailinhalt geht an kein externes Modell.'],
    ['lernen','Lernen','Woraus das Board Ablagevorschläge lernt und wie gut sie treffen.'],['darstellung','Darstellung','Was auf den Karten zu sehen ist.']
  ] as const) {
    const part=document.createElement('section'),head=tag('h3',title),note=tag('p',hint),body=document.createElement('div')
    part.id='settings-'+key;part.className='settings-part';head.id='settings-'+key+'-title';head.tabIndex=-1;note.className='field-hint';part.setAttribute('aria-labelledby',head.id)
    part.append(head,note,body);settings.append(part);parts[key]=body
    const link=tag('button',title);link.type='button';link.onclick=()=>{head.scrollIntoView({block:'start'});head.focus()};jump.append(link)
  }
  settings.prepend(jump)
  const fitJump=()=>{const dialogBox=el<HTMLDialogElement>('settingsDialog');jump.hidden=false;jump.hidden=dialogBox.scrollHeight<=dialogBox.clientHeight+1}
  el('openSettings').addEventListener('click',()=>setTimeout(fitJump))
  window.addEventListener('resize',()=>{if(el<HTMLDialogElement>('settingsDialog').open)fitJump()})
  renderAiSettings(parts.ki,()=>isLive()?learnerFolders():[],parts.lernen)
  const prefix=tag('input','');prefix.value=String(getLegacyConfig().status_prefix||'Status: ')
  const setPrefix=async()=>{
    if(!prefix.value.trim() || prefix.value.length>128)throw new Error('Bitte ein gültiges Status-Präfix eingeben.')
    if(service)await service.invoke('outlook_prefix',{prefix:prefix.value})
    updateConfig({status_prefix:prefix.value})
  }
  prefix.onchange=()=>void exclusive(setPrefix)
  if(service && prefix.value!=='Status: '){try{await setPrefix()}catch(error){notify(errorText(error))}}
  const toggle=document.createElement('input');toggle.type='checkbox';toggle.id='allowMove'
  toggle.checked=mayMove()
  toggle.onchange=()=>{updateConfig({allow_move:toggle.checked});render()}
  const label=tag('label','');label.append(toggle,' Echte Mails verschieben erlauben')
  const labelPrefix=tag('label','Outlook-Statuspräfix');labelPrefix.append(prefix)
  parts.outlook.append(label,labelPrefix)
  for(const [key,caption,fallback,min,max,part] of [
    ['poll_seconds','Aktualisieren · Sekunden',30,0,86400,'outlook'],['inbox_days','Posteingang · Tage',60,0,36500,'board'],['done_days','Erledigt · Tage',14,0,36500,'board'],
    ['sent_days','Gesendet · Tage',14,0,36500,'board'],['overdue_days','Überfällig ab Werktagen',5,0,36500,'board'],['archive_after_days','Archivierung anbieten ab Tagen',7,0,36500,'board'],['max_items_per_folder','Limit pro Ordner',500,0,5000,'board'],
    ['preview_chars','Zeichen in der Kartenvorschau',160,0,1500,'darstellung']
  ] as const) {
    const input=document.createElement('input');input.type='number';input.min=String(min);input.max=String(max)
    input.value=String(getLegacyConfig()[key]??fallback)
    input.onchange=()=>{if(input.checkValidity() && Number.isInteger(input.valueAsNumber)){updateConfig({[key]:input.valueAsNumber});render()}}
    const l=tag('label',caption);l.append(input);parts[part].append(l)
  }
  for(const [key,caption,fallback,part] of [
    ['suggestions','Ablagevorschläge auf Karten anzeigen',true,'darstellung'],['compact_cards','Kompakte Karten',true,'darstellung'],['show_ai_summary','KI-Zusammenfassung auf Karten',true,'darstellung'],
    ['reply_to_offen','Bei erkannter Antwort die wartende Karte automatisch bearbeiten',false,'board']
  ] as const){
    const input=document.createElement('input');input.type='checkbox'
    input.checked=(getLegacyConfig()[key]??fallback)===true
    input.onchange=()=>{updateConfig({[key]:input.checked});render();void correspondence.refresh()}
    const label=tag('label','');label.append(input,' '+caption);parts[part].append(label)
  }
  const vipButton=tag('button','VIP-Liste bearbeiten …');vipButton.type='button';vipButton.id='editVip';vipButton.onclick=()=>views.editVip();parts.board.append(vipButton)
  syncColors=colorSettings(parts.outlook,service,()=>isLive(),render)
  initDetailBar()
  dialog.onclose=()=>{suggestionVersion++;if(selected)document.getElementById('mail-'+selected.id)?.focus()}
  search.oninput=render
  undoButton.onclick=()=>void undo()
  back.onclick=()=>{if(busy)return;connection=undefined;sourceUpdated(demoMails,'demo',demoFolders,'');notify('')}
  if(service) {
    inboxButton.hidden=false;inboxButton.onclick=()=>void connect()
    el('openOriginal').onclick=()=>{if(isLive()&&selected)void openOriginal(selected)}
    el('connectOutlook').onclick=()=>void connect(true)
    for(const button of document.querySelectorAll<HTMLButtonElement>('button[data-draft]'))
      button.onclick=()=>{if(selected)void draft(selected,button.dataset.draft!,el<HTMLSelectElement>('draftSnippet').value)}
    window.addEventListener('mailboard:foldersChanged',()=>void reloadFolders())
  }
  let nextPoll=0,polling=false,dragging=false
  document.addEventListener('dragstart',()=>{dragging=true})
  for(const event of ['dragend','drop'])document.addEventListener(event,()=>{dragging=false},true)
  window.setInterval(async()=>{
    const unavailable=()=>!isLive() || busy || dragging || document.hidden || !!document.querySelector('dialog[open]')
    if(polling || unavailable() || Date.now()<nextPoll)return
    const seconds=Number(getLegacyConfig().poll_seconds??30)
    if(seconds<=0)return
    nextPoll=Date.now()+Math.max(5,seconds)*1000
    const previous=mails,key=scope,items=folders,version=mutationVersion
    const stillCurrent=()=>!unavailable() && previous===mails && key===scope && items===folders && version===mutationVersion
    polling=true
    try{
      const rows=await readRows(key,items)
      // The user can keep navigating and working while COM reads. Prefer their new state.
      if(!stillCurrent())return
      if(!Array.isArray(rows))throw new Error('Outlook lieferte keine Mailliste.')
      hydrate(rows,items);mails=rows
      render();void queueAnalyses();void correspondence.refresh()
    }catch(error){
      if(stillCurrent()){
        const message=errorText(error)
        if(/Outlook ist geschlossen|Verbindung zu Outlook wurde unterbrochen/i.test(message))sourceUpdated([],'offline',[],'')
        notify(message)
      }
    }
    finally{polling=false}
  },5000)
  document.addEventListener('keydown',e=>{
    if(e.defaultPrevented||!(e.ctrlKey||e.metaKey))return
    if(e.key.toLowerCase()==='f'&&!document.querySelector('dialog[open]')){e.preventDefault();search.focus()}
    if(e.key.toLowerCase()==='z'&&!(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) && !el<HTMLDialogElement>('moveConfirm').open){e.preventDefault();void undo()}
  })
  sourceUpdated([],'offline',[],'')
  if(service)await connect()
  else notify('Für das Outlook-Postfach Mail-Board.exe unter Windows öffnen.')
}
start().catch(e=>notify('Das Board konnte nicht starten: '+errorText(e)))
