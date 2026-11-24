import {localDraftModel} from './ai'
import {ask, getLegacyConfig, updateConfig} from './data-settings'
import type {Folder, LiveBoard} from './live'

type Child = Folder & {parentId:string}
type Proposal = {name:string;subjects:string[]}

export function cleanFolderName(input:string) {
  return Array.from(input.normalize('NFC').replace(/[\\/\p{Cc}]/gu,' ').replace(/\s+/gu,' ').trim())
    .slice(0,40).join('').trim()
}
const key = (s:string)=>s.normalize('NFKC').toLocaleLowerCase('de').replace(/ß/g,'ss')
/** Ob `name` unter den vorhandenen Namen schon vorkommt (ohne Groß- und Kleinschreibung, wie beim Anlegen). */
export function nameTaken(name:string, existing:string[]) {return existing.some(e=>key(e)===key(name))}
export function structureChoices(raw:Proposal[], existing:string[]) {
  const seen=new Set(existing.map(key))
  const result:Proposal[]=[]
  for(const item of raw) {
    const name=cleanFolderName(item.name)
    if(!name || seen.has(key(name)))continue
    seen.add(key(name))
    result.push({name,subjects:[...new Set(item.subjects.filter(Boolean))].slice(0,3)})
    if(result.length===4)break
  }
  if(result.length<2)throw new Error('Die lokale KI hat keine brauchbare Unterteilung mit mindestens zwei neuen Namen gefunden.')
  return result
}
export function selectedNames(input:string[],existing:string[],alreadyCreated:number) {
  const names=input.map(cleanFolderName), known=new Set(existing.map(key))
  for(const name of names) {
    if(!name)throw new Error('Für jeden markierten Vorschlag einen Namen eingeben.')
    if(known.has(key(name)))throw new Error('„'+name+'“ ist bereits vorhanden oder doppelt ausgewählt. Bitte den Namen ändern.')
    known.add(key(name))
  }
  if(!names.length || alreadyCreated+names.length<2)throw new Error('Bitte mindestens zwei neue Ordner auswählen.')
  return names
}

function addTargets(created:Folder[]) {
  const cfg=getLegacyConfig()
  const previous=cfg.suggestion_folders??cfg.project_folders
  const scope=Array.isArray(previous)?previous.filter((v):v is string=>typeof v==='string'):[]
  updateConfig({suggestion_folders:[...new Set([...scope,...created.map(f=>f.path)])]})
}
function button(text:string,run:()=>void) {
  const node=document.createElement('button')
  node.type='button';node.textContent=text;node.onclick=run
  return node
}

export function openStructure(service:Pick<LiveBoard,'json'|'invoke'|'writeBatch'>, source:Folder, finish:(created:Folder[])=>void|Promise<void>) {
  const dialog=document.createElement('dialog')
  dialog.className='structure-dialog'
  const title=document.createElement('h2')
  title.textContent='Unterteilung für „'+(source.path||source.name)+'“'
  dialog.setAttribute('aria-label',title.textContent)
  const list=document.createElement('div')
  const status=document.createElement('p')
  status.setAttribute('role','status')
  const created:Folder[]=[]
  const rows:{check:HTMLInputElement;name:HTMLInputElement;created:boolean}[]=[]
  let writing=false, existing:string[]=[]
  const children=async()=>(await service.json<Child[]>('outlook_folders'))
    .filter(f=>f.parentId===source.id).map(f=>f.name)
  const close=button('Schließen',()=>dialog.close())
  const apply=button('Auswahl anlegen …',async()=>{
    if(writing)return
    writing=true
    updateControls()
    try {
      existing=await children()
      const pending=rows.filter(r=>!r.created && r.check.checked)
      if(pending.length) {
        const names=selectedNames(pending.map(r=>r.name.value),existing,created.length)
        if(!await ask(dialog,'Unter „'+(source.path||source.name)+'“ diese Unterordner anlegen und als Vorschlagsziele speichern? '+names.join(' · ')))return
        await service.writeBatch(async()=>{
          for(const [i,name] of names.entries()) {
            status.textContent='Unterordner „'+name+'“ wird angelegt …'
            const folder=await service.json<Child>('project_create',{parent:source.id,name})
            created.push(folder)
            pending[i].created=true
            pending[i].name.value=folder.name
            addTargets(created)
          }
        })
      }
      if(created.length<2)throw new Error('Bitte mindestens zwei Unterordner anlegen.')
      addTargets(created)
      await finish(created)
      dialog.close()
    } catch(e) {
      status.textContent=(created.length?'Bereits angelegt: '+created.map(f=>f.name).join(', ')+'. ':'')+String(e)
    } finally {
      if(created.length)window.dispatchEvent(new Event('mailboard:foldersChanged'))
      writing=false;updateControls()
    }
  })
  function updateControls() {
    close.disabled=writing
    for(const row of rows) {
      row.check.disabled=writing||row.created
      row.name.disabled=writing||row.created||!row.check.checked
    }
    const pending=rows.filter(r=>!r.created&&r.check.checked)
    apply.disabled=writing||pending.length+created.length<2
    apply.textContent=pending.length?'Auswahl anlegen …':'Weiter zum Verteilen'
  }
  async function draft() {
    status.textContent='Beispielmails und bestehende Unterordner werden gelesen …'
    try {
      const model=await localDraftModel()
      if(!dialog.open)return
      const [mails,known]=await Promise.all([
        service.json<{subject:string;body:string}[]>('outlook_training',{folder:source.id,limit:40,days:0}),
        children(),
      ])
      existing=known
      if(!dialog.open)return
      if(!mails.length)throw new Error('Für diesen Ordner sind keine Beispielmails vorhanden.')
      status.textContent='Lokale KI entwirft Unterordner aus '+mails.length+' Beispielmails …'
      const raw=await service.invoke<Proposal[]>('ai_subfolders',{...model,area:source.path||source.name,
        examples:mails.slice(0,40).map(m=>({subject:m.subject.slice(0,450),body:m.body.slice(0,200)})),existing})
      if(!dialog.open)return
      for(const suggestion of structureChoices(raw,existing)) {
        const group=document.createElement('fieldset'),label=document.createElement('label')
        const check=document.createElement('input'),name=document.createElement('input')
        check.type='checkbox';check.checked=true
        label.append(check,' Vorschlag '+(rows.length+1)+' anlegen')
        name.value=suggestion.name;name.maxLength=40;name.setAttribute('aria-label','Name für Vorschlag '+(rows.length+1))
        const samples=document.createElement('p')
        samples.textContent=suggestion.subjects.join(' · ')
        group.append(label,name,samples);list.append(group)
        rows.push({check,name,created:false});check.onchange=updateControls
      }
      status.textContent='Namen und Auswahl prüfen. Angelegte Unterordner werden als Vorschlagsziele gespeichert.'
    } catch(e) { status.textContent=String(e) }
    updateControls()
  }
  dialog.oncancel=e=>{if(writing)e.preventDefault()}
  dialog.onclose=()=>dialog.remove()
  apply.disabled=true
  dialog.append(title,status,list,close,apply);document.body.append(dialog);dialog.showModal()
  void draft()
}
