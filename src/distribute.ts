import {recordFiling, suggestFolder, type AiMail} from './ai'
import {ask,getLegacyConfig,readLimits} from './data-settings'
import {countsAsFiling, type LiveBoard, type Folder} from './live'
import {button} from './dom'

type Mail=AiMail & {id:string;folderId:string}
type Choice = {mail:Mail; target:HTMLSelectElement; check:HTMLInputElement}
export function distribute(service:Pick<LiveBoard,'json'|'begin'|'move'|'writeBatch'>,source:Folder,folders:Folder[],refresh:()=>void,preselected:string[]=[]) {
  const d=document.createElement('dialog'),title=document.createElement('h2')
  d.className='distribute-dialog'
  title.textContent='Mails aus „'+(source.path||source.name)+'“ verteilen';d.setAttribute('aria-label',title.textContent)
  const targets=folders.filter(f=>f.path && f.id!==source.id && !f.path.split('/').some(p=>p.startsWith('_')))
  const field=document.createElement('fieldset'),legend=document.createElement('legend')
  legend.textContent='Vorschlagsziele';field.append(legend)
  const options=targets.map(folder=>{
    const label=document.createElement('label'), check=document.createElement('input');check.type='checkbox';check.checked=preselected.includes(folder.id)
    label.append(check,' '+folder.path);field.append(label);return {folder,check}
  })
  const results=document.createElement('div'),text=document.createElement('p')
  text.setAttribute('role','status')
  let choices:Choice[]=[],version=0,applying=false
  const preview=button('Vorschläge ermitteln',async()=>{
    const allowed=options.filter(o=>o.check.checked).map(o=>o.folder)
    if(allowed.length<2){text.textContent='Bitte mindestens zwei Zielordner wählen.';return}
    const started=++version
    choices=[];results.replaceChildren();apply.disabled=true;preview.disabled=field.disabled=true
    try {
      const mails=await service.json<Mail[]>('outlook_folder',{folder:source.id,...readLimits()})
      for(const [i,mail] of mails.entries()) {
        if(started!==version)return
        text.textContent='Vorschlag '+(i+1)+' von '+mails.length
        const hint=await suggestFolder(mail,allowed.map(f=>f.path))
        if(started!==version)return
        const row=document.createElement('div'),label=document.createElement('label')
        const check=document.createElement('input');check.type='checkbox'
        label.append(check,' '+mail.subject)
        const target=document.createElement('select');target.setAttribute('aria-label','Ziel für '+mail.subject)
        target.replaceChildren(new Option('Ziel wählen',''),...allowed.map(f=>new Option(f.path,f.id)))
        target.value=allowed.find(f=>f.path===hint.folder)?.id||''
        const why=document.createElement('small');why.textContent=hint.reason
        row.append(label,target,why);results.append(row);choices.push({mail,target,check})
      }
      text.textContent=choices.length+' Mails geprüft. Bitte die gewünschten Verschiebungen markieren.'
      apply.disabled=!choices.length
    } catch(e){text.textContent=String(e)}
    finally{preview.disabled=field.disabled=false}
  })
  field.onchange=()=>{choices=[];results.replaceChildren();apply.disabled=true}
  const apply=button('Markierte Mails verschieben',async()=>{
    if(applying)return
    if(!document.querySelector<HTMLInputElement>('#allowMove')?.checked){text.textContent='Bitte zuerst „Echte Mails verschieben erlauben“ aktivieren.';return}
    const archive=String(getLegacyConfig().archive_folder||'')
    const plan:{choice:Choice;destination:Folder;filed:boolean}[]=[]
    const quantities=new Map<Folder,number>()
    for(const choice of choices.filter(c=>c.check.checked)) {
      const destination=targets.find(f=>f.id===choice.target.value)
      if(!destination){text.textContent='Bitte für jede markierte Mail ein Ziel auswählen.';return}
      plan.push({choice,destination,filed:countsAsFiling(destination,archive)})
      quantities.set(destination,(quantities.get(destination)??0)+1)
    }
    if(!plan.length){text.textContent='Bitte mindestens eine Mail markieren.';return}
    const summary=Array.from(quantities,([folder,n])=>n+(n===1?' Mail':' Mails')+' nach „'+folder.path+'“').join(', ')
    applying=true
    let confirmed=false, count=0
    const errors:string[]=[]
    try {
      confirmed=await ask(d,'Aus „'+(source.path||source.name)+'“ verschieben? '+summary)
      if(!confirmed)return
      field.disabled=preview.disabled=apply.disabled=close.disabled=true
      for(const row of choices){row.target.disabled=true;row.check.disabled=true}
      const batch=service.begin()
      await service.writeBatch(async()=>{
        for(const {choice,destination,filed} of plan){
          const {mail,check}=choice
          try {await service.move(batch,mail.id,source.id,destination.id,filed)}
          catch(error){errors.push(mail.subject+' – '+String(error));continue}
          count++;check.checked=false
          choices=choices.filter(r=>r!==choice);check.closest('div')?.remove()
          if(filed){
            try {recordFiling(mail,destination.path)}
            catch(error){errors.push(mail.subject+' – Lernbeispiel konnte nicht gespeichert werden: '+String(error))}
          }
        }
      })
    }catch(e){errors.push(String(e))}
    finally{
      applying=false
      if(confirmed){
        text.textContent=count+' von '+plan.length+' verschoben.'+(errors.length?' '+errors.join(' · '):'')
        field.disabled=preview.disabled=close.disabled=false;apply.disabled=!choices.length
        for(const row of choices){row.target.disabled=false;row.check.disabled=false}
        refresh()
      }else if(errors.length)text.textContent=errors.join(' · ')
    }
  })
  const close=button('Schließen',()=>d.close())
  apply.disabled=true;d.append(title,field,preview,results,text,apply,close)
  d.oncancel=e=>{if(applying)e.preventDefault()};d.onclose=()=>{version++;d.remove()}
  document.body.append(d);d.showModal()
}
