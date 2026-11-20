import { archive, isRecord, LEGACY, parseBackup, PREVIOUS, readLegacyConfig, restore, snapshot, type Snapshot } from './backup'

export function getLegacyFile(name:string):string|undefined {
  return importedFiles()[name]
}
let previousImport:string|null|undefined
let parsedFiles:Snapshot={}
function importedFiles():Snapshot {
  const raw=localStorage.getItem(LEGACY)
  if(previousImport!==raw){
    parsedFiles=raw?JSON.parse(raw):{}
    previousImport=raw
  }
  return parsedFiles
}
const OPTIONS='kanban-board-options-v1'
let cachedSource:Snapshot|undefined
let cachedOptions:string|null|undefined
let options:Record<string,unknown>={}
let cachedConfig:Record<string,unknown>={}
export function getLegacyConfig():Record<string,unknown> {
  const source=importedFiles()
  if(source!==cachedSource){
    cachedConfig=readLegacyConfig(source)
    cachedSource=source
  }
  const raw=localStorage.getItem(OPTIONS)
  if(raw!==cachedOptions){options=JSON.parse(raw||'{}');cachedOptions=raw}
  return {...cachedConfig,...options}
}
const REVISIONS='kanban-config-revisions-v1'
export function updateConfig(values:Record<string,unknown>){
  const previous=localStorage.getItem(OPTIONS)||'{}'
  const next=JSON.stringify({...JSON.parse(previous),...values})
  if(previous===next)return
  const revisions:string[]=JSON.parse(localStorage.getItem(REVISIONS)||'[]')
  localStorage.setItem(REVISIONS,JSON.stringify([previous,...revisions].slice(0,5)))
  localStorage.setItem(OPTIONS,next)
}
export function readLimits() {
  const cfg=getLegacyConfig()
  return {inboxDays:Number(cfg.inbox_days??60),doneDays:Number(cfg.done_days??14),limit:Number(cfg.max_items_per_folder??500)}
}

export function getLegacyProfiles():Record<string,string> {
  const entries=Object.entries(importedFiles()).flatMap(([name,body])=>{
    if(!name.startsWith('knowledge/'))return []
    const front=body.replace(/\r\n/g,'\n').match(/^---\n([\s\S]*?)\n---/)
    const folder=front?.[1].match(/^folder:\s*(.+)$/m)?.[1].trim()
    return folder?[[folder,body]]:[]
  })
  return {...Object.fromEntries(entries), ...profileEdits()}
}
const PROFILE_EDITS='kanban-profile-edits-v1'
function profileEdits():Record<string,string>{return JSON.parse(localStorage.getItem(PROFILE_EDITS)||'{}')}
export function setProfile(key:string,markdown:string){
  const edits=profileEdits()
  edits[key]=markdown.includes('## ')?markdown:'## Zweck\n'+markdown
  localStorage.setItem(PROFILE_EDITS,JSON.stringify(edits))
}
export function rekeyProfile(from:string,to:string){
  if(!from||!to||from===to)return
  const current=getLegacyProfiles(),edits=profileEdits()
  for(const [k,md] of Object.entries(current)){
    if(k===from||k.startsWith(from+'/')){
      const newKey=to+k.slice(from.length)
      edits[newKey]=md.replace(/^folder:.*$/m,()=> 'folder: '+newKey)
      edits[k]=''
    }
  }
  localStorage.setItem(PROFILE_EDITS,JSON.stringify(edits))
}
export type Snippet={label:string;body:string;kind:'note'|'follow_up'}
const SNIPPETS='kanban-snippets-v1'
const defaults:Snippet[]=[
  {label:'Kurze Nachfrage',kind:'follow_up',body:'Guten Tag,\n\nich wollte höflich nachfragen, ob es zu meiner Anfrage schon eine Rückmeldung gibt.\n\nVielen Dank und viele Grüße'},
  {label:'Unterlagen erbeten',kind:'follow_up',body:'Guten Tag,\n\nkönnten Sie mir bitte die offenen Unterlagen zukommen lassen?\n\nViele Grüße'},
  {label:'Statusbitte',kind:'follow_up',body:'Guten Tag,\n\nwie ist der aktuelle Stand?\n\nDanke für eine kurze Rückmeldung.'},
  {label:'Warten auf Angebot',kind:'note',body:'Warte auf Angebot / Preis.'},
  {label:'Intern klären',kind:'note',body:'Intern noch klären.'}
]
function allSnippets():Snippet[]{
  const custom=localStorage.getItem(SNIPPETS)
  const values:unknown=custom!==null?JSON.parse(custom):getLegacyConfig().text_snippets
  if(!Array.isArray(values))return defaults
  const valid=values.filter((s):s is Snippet=>isRecord(s)&&typeof s.label==='string' && typeof s.body==='string' && ['note','follow_up'].includes(String(s.kind)))
  return valid.length || custom!==null?valid:defaults
}
export function textSnippets(kind:Snippet['kind']) { return allSnippets().filter(s=>s.kind===kind) }

function make<K extends keyof HTMLElementTagNameMap>(tag:K,text=''){
  const n=document.createElement(tag);n.textContent=text;return n
}
function action(text:string,run:()=>void){
  const button=make('button',text);button.type='button';button.onclick=run;return button
}
function showSettings(){
  const dialog=make('dialog')
  dialog.className='data-settings'
  const title=make('h2','Daten und Textbausteine')
  title.id='data-title';dialog.setAttribute('aria-labelledby',title.id)
  const close=action('Schließen',()=>dialog.close())
  const status=make('p');status.setAttribute('role','status')
  const file=make('input'); file.type='file';file.accept='.zip'; file.hidden=true
  file.onchange=async()=>{
    const chosen=file.files?.[0];if(!chosen)return
    try {
      const backup=parseBackup(new Uint8Array(await chosen.arrayBuffer()))
      const prompt=backup.legacy ? 'Python-Sicherung übernehmen?' : 'Aktuelle Einstellungen aus dieser Sicherung wiederherstellen?'
      if(!await ask(dialog,prompt+' '+backup.count+' Einträge. Der vorherige Stand wird lokal gesichert.'))return
      restore(localStorage,backup.values,backup.legacy)
      location.reload()
    } catch(error){status.textContent='Import fehlgeschlagen: '+String(error)}
    finally{file.value=''}
  }
  function save(){
    const blob=new Blob([archive(snapshot(localStorage))],{type:'application/zip'})
    const link=make('a');link.href=URL.createObjectURL(blob);link.download='Mail-Board-'+new Date().toISOString().slice(0,10)+'.zip'
    dialog.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),60000)
  }
  const rollback=action('Stand vor Import wiederherstellen',async()=>{
    const prev=localStorage.getItem(PREVIOUS)
    if(prev && await ask(dialog,'Vorherige Einstellungen wiederherstellen?')) {
      try{restore(localStorage,JSON.parse(prev));location.reload()}catch(e){status.textContent=String(e)}
    }
  })
  rollback.disabled=!localStorage.getItem(PREVIOUS)
  const revisions:string[]=JSON.parse(localStorage.getItem(REVISIONS)||'[]')
  const saved=make('select')
  saved.setAttribute('aria-label','Gesicherter Einstellungsstand')
  revisions.forEach((_,i)=>saved.add(new Option((i+1)+'. vorheriger Stand',String(i))))
  const revert=action('Einstellungsstand übernehmen',async()=>{
    if(await ask(dialog,'Gewählten Stand der allgemeinen Einstellungen übernehmen?')){
      const old=localStorage.getItem(OPTIONS)||'{}'
      localStorage.setItem(OPTIONS,revisions[saved.selectedIndex])
      localStorage.setItem(REVISIONS,JSON.stringify([old,...revisions].slice(0,5)))
      location.reload()
    }
  })
  saved.hidden=revert.hidden=!revisions.length
  const list=make('select');list.setAttribute('aria-label','Textbaustein auswählen')
  const name=make('input');const body=make('textarea');body.rows=4
  const kind=make('select');kind.add(new Option('Notiz','note'));kind.add(new Option('Nachfassen','follow_up'))
  const snippets=allSnippets().map(x=>({...x}))
  function fields(){const row=snippets[list.selectedIndex];name.value=row?.label??'';body.value=row?.body??'';kind.value=row?.kind??'note'}
  function refresh(index:number){list.replaceChildren(...snippets.map(s=>new Option(s.label)),new Option('Neuer Textbaustein'));list.selectedIndex=Math.min(index,snippets.length);fields()}
  list.onchange=fields;refresh(0)
  function label(text:string,field:HTMLElement){const l=make('label',text);l.append(field);return l}
  const saveSnippet=action('Textbaustein speichern',()=>{
    if(!name.value.trim()||!body.value.trim()){status.textContent='Bitte Namen und Text eingeben.';return}
    const i=list.selectedIndex
    snippets[i]={label:name.value.trim(),body:body.value.trim(),kind:kind.value as Snippet['kind']}
    localStorage.setItem(SNIPPETS,JSON.stringify(snippets));refresh(i);status.textContent='Textbaustein gespeichert.'
  })
  const remove=action('Baustein löschen',async()=>{
    if(list.selectedIndex===snippets.length || !await ask(dialog,'Gewählten Textbaustein löschen?'))return
    snippets.splice(list.selectedIndex,1);localStorage.setItem(SNIPPETS,JSON.stringify(snippets));refresh(0)
  })
  dialog.append(title,make('h3','Sicherung'),action('ZIP sichern',save),action('ZIP importieren',()=>file.click()),rollback,file,saved,revert,
    make('h3','Textbausteine'),list,label('Name',name),label('Verwendung',kind),label('Text',body),saveSnippet,remove,status,close)
  dialog.addEventListener('close',()=>dialog.remove())
  document.body.append(dialog);dialog.showModal()
}
export function ask(parent:HTMLElement,question:string):Promise<boolean>{
  return new Promise(resolve=>{
    const d=make('dialog');d.setAttribute('aria-label',question)
    d.append(make('p',question),action('Abbrechen',()=>d.close()),action('Bestätigen',()=>d.close('ok')))
    d.onclose=()=>{const ok=d.returnValue==='ok';d.remove();resolve(ok)}
    parent.append(d);d.showModal()
  })
}
if(typeof document!=='undefined')document.addEventListener('click',event=>{if((event.target as HTMLElement).closest('#dataSettings'))showSettings()})
