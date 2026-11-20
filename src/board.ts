import demo from './demo.json'

type Mail = typeof demo[number]
type Position = Pick<Mail,'status'|'folder'>
declare global { interface Window { __TAURI__?: {core:{invoke<T>(name:string, args?:Record<string,string>):Promise<T>}} } }
const states = ['Offen','In Bearbeitung','Warten','Erledigt']
const folders = [...new Set(['Posteingang','Organisation','Pipettenspitzen',...demo.map(m=>m.folder)])]
const storageKey = 'outlook-kanban-demo-positions-v1'
const el = <T extends HTMLElement>(id:string) => document.getElementById(id) as T
const search = el<HTMLInputElement>('search')
const dialog = el<HTMLDialogElement>('detail')
const undoButton = el<HTMLButtonElement>('undo')
const history: {mail:Mail, previous:Position}[] = []
let mails:Mail[] = []
let live = false
let scope = ''
let selected:Mail|undefined

function tag<K extends keyof HTMLElementTagNameMap>(name:K,text:string) {
  const node=document.createElement(name)
  node.textContent=text
  return node
}
function save() {
  try {
    const positions=Object.fromEntries(mails.map(({id,status,folder})=>[id,{status,folder}]))
    localStorage.setItem(storageKey,JSON.stringify(positions))
  } catch { el('message').textContent='Die Änderungen gelten nur für diese Sitzung.' }
}
function move(mail:Mail, next:Position) {
  if (live) return
  if (mail.status===next.status && mail.folder===next.folder) return
  history.push({mail,previous:{status:mail.status,folder:mail.folder}})
  Object.assign(mail,next)
  render()
  save()
}
function undo() {
  if (live) return
  const step=history.pop()
  if (!step) return
  Object.assign(step.mail,step.previous)
  render()
  if (dialog.open && selected) fillDetail(selected)
  save()
}
function dropZone(node:HTMLElement,action:(m:Mail)=>void) {
  const mime='application/x-mailboard-demo'
  node.ondragover=e=>{
    if(e.dataTransfer?.types.includes(mime)){e.preventDefault(); node.classList.add('over')}
  }
  node.ondragleave=()=>node.classList.remove('over')
  node.ondrop=e=>{
    node.classList.remove('over')
    const mail=mails.find(m=>m.id===e.dataTransfer?.getData(mime))
    if(mail){e.preventDefault();action(mail)}
  }
}
function fillDetail(mail:Mail) {
  el('openOriginal').hidden=!live
  el('openError').textContent=''
  el<HTMLSelectElement>('status').disabled=live
  el<HTMLSelectElement>('folder').disabled=live
  el('subject').textContent=mail.subject
  el('from').textContent=mail.sender
  el('body').textContent=mail.body
  el('attachments').textContent=mail.attachments.length?'Anhänge · '+mail.attachments.join(', '):''
  el<HTMLSelectElement>('status').value=mail.status
  el<HTMLSelectElement>('folder').value=mail.folder
}
function makeCard(mail:Mail) {
  const card=tag('button','')
  card.className='card'
  card.id='mail-'+mail.id
  card.draggable=!live
  card.ondragstart=e=>e.dataTransfer?.setData('application/x-mailboard-demo',mail.id)
  card.append(tag('small',mail.sender),tag('strong',mail.subject))
  const meta=[...mail.tags]
  if(mail.attachments.length) meta.push(mail.attachments.length+' Anh.')
  if(meta.length) card.append(tag('em',meta.join(' · ')))
  card.onclick=()=>{selected=mail;fillDetail(mail);dialog.showModal()}
  return card
}
function render() {
  const nav=el('folders')
  nav.replaceChildren()
  for (const name of (live ? ['Posteingang'] : ['',...folders])) {
    const btn=tag('button',name||'Alle Mails')
    btn.append(tag('b',String(mails.filter(m=>!name||m.folder===name).length)))
    btn.setAttribute('aria-pressed',String(scope===name))
    btn.onclick=()=>{scope=name;render();el('folders').querySelector<HTMLElement>('[aria-pressed=true]')?.focus()}
    if(name && !live) dropZone(btn,m=>move(m,{folder:name,status:m.status}))
    nav.append(btn)
  }
  const query=search.value.trim().toLocaleLowerCase('de')
  const visible=mails.filter(m=>(!scope||m.folder===scope) && [m.subject,m.sender,m.body,...m.tags,...m.attachments].join(' ').toLocaleLowerCase('de').includes(query))
  el('title').textContent=live?'Outlook · Posteingang':scope||'Alle Mails'
  el('summary').textContent=visible.length+' von '+mails.length+' Mails'
  const board=el('board')
  board.replaceChildren()
  for(const status of states) {
    const lane=tag('section','')
    lane.className='lane'
    const matches=visible.filter(m=>m.status===status)
    const heading=tag('h3','')
    heading.append(tag('span',status),tag('b',String(matches.length)))
    lane.append(heading,...matches.map(makeCard))
    if (!matches.length) {const empty=tag('p','Keine Mails');empty.className='empty';lane.append(empty)}
    if (!live) dropZone(lane,m=>move(m,{status,folder:m.folder}))
    board.append(lane)
  }
  undoButton.disabled=live||!history.length
}
async function start() {
  mails=window.__TAURI__?JSON.parse(await window.__TAURI__.core.invoke<string>('demo_board')):structuredClone(demo)
  try {
    const saved=JSON.parse(localStorage.getItem(storageKey)||'{}')
    for(const m of mails){
      const p=saved?.[m.id]
      if(p && states.includes(p.status)&&folders.includes(p.folder)) Object.assign(m,{status:p.status,folder:p.folder})
    }
  } catch {el('message').textContent='Das Demo-Postfach startet mit den Beispieldaten.'}
  for(const [id,values] of [['status',states],['folder',folders]] as const){
    const select=el<HTMLSelectElement>(id)
    for(const value of values) select.add(new Option(value,value))
    select.onchange=()=>{if(selected)move(selected,{status:selected.status,folder:selected.folder,[id]:select.value})}
  }
  dialog.onclose=()=>{if(selected)el('mail-'+selected.id)?.focus()}
  search.oninput=render
  const testButton=el<HTMLButtonElement>('openOutlookTest')
  const launch=window.__TAURI__ && (()=>window.__TAURI__!.core.invoke<void>('outlook_test'))
  if(launch) {
    testButton.hidden=false
    testButton.onclick=async()=>{
      testButton.disabled=true
      el('message').textContent='Outlook-Testfenster wird geöffnet …'
      try { await launch(); el('message').textContent='Outlook-Testfenster geschlossen.' }
      catch(error) { el('message').textContent='Outlook-Test konnte nicht starten: '+String(error) }
      finally { testButton.disabled=false }
    }
  }
  const demoMails=mails
  const inboxButton=el<HTMLButtonElement>('loadInbox')
  const back=el<HTMLButtonElement>('backDemo')
  const tauri=window.__TAURI__?.core
  const loadInbox=tauri && (()=>tauri.invoke<string>('outlook_inbox'))
  const openMail=tauri && ((id:string)=>tauri.invoke('outlook_open',{id}))
  function switchMode(rows:Mail[], outlook:boolean) {
    live=outlook
    mails=rows
    scope=outlook?'Posteingang':''
    selected=undefined
    search.value=''
    back.hidden=!outlook
    inboxButton.textContent=outlook?'Posteingang aktualisieren':'Outlook-Mails laden'
    document.querySelector<HTMLElement>('.foot')!.textContent=outlook?'Outlook · Leseansicht':'Lokales Demo-Postfach'
    render()
  }
  if(loadInbox && openMail) {
    inboxButton.hidden=false
    inboxButton.onclick=async()=>{
      inboxButton.disabled=back.disabled=true
      el('message').textContent='Posteingang wird gelesen …'
      try {
        const rows:Mail[]=JSON.parse(await loadInbox())
        if(!Array.isArray(rows)) throw new Error('Unerwartete Antwort von Outlook.')
        switchMode(rows,true)
        el('message').textContent=rows.length+' Outlook-Mails geladen. Ohne Statuskategorie erscheinen Mails unter „Offen“.'
      } catch(error) {el('message').textContent='Posteingang konnte nicht geladen werden: '+String(error)}
      finally {inboxButton.disabled=back.disabled=false}
    }
    back.onclick=()=>{switchMode(demoMails,false);el('message').textContent=''}
    el('openOriginal').onclick=async()=>{
      if(!live || !selected) return
      try {await openMail(selected.id)} catch(error) {el('openError').textContent=String(error)}
    }
  }
  undoButton.onclick=undo
  document.onkeydown=e=>{
    if(!(e.ctrlKey||e.metaKey)) return
    if(e.key.toLowerCase()==='f'&&!dialog.open){e.preventDefault();search.focus()}
    if(e.key.toLowerCase()==='z'&&document.activeElement!==search){e.preventDefault();undo()}
  }
  render()
}
start().catch(()=>{el('message').textContent='Das Demo-Postfach konnte nicht geladen werden.'})
