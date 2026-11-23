/** Abschnitt „Aufgaben“ in den Maildetails: Vorschläge der lokalen KI prüfen und als Checklistenpunkte in einen Vorgang übernehmen. */
import {embeddingId} from './ai'
import {caseNameFromSubject, caseNameProblem, caseNames, caseTag, type Case} from './planning-logic'
import {newId, updateCase} from './planning-store'
import {setTaken, takenTasks, type Task} from './tasks-taken'
import {showToast} from './toast'
import {localDay} from './views-logic'

type TaskMail = {subject:string;tags:string[];id:string;aiTasks?:Task[];received?:string;sender:string;body:string}
type Options = {
  cases():readonly Case[]
  canAssign():boolean
  /** Setzt die Kategorie „Vorgang: Name“ an der Mail (Postfachänderung mit Rücknahme). */
  assign(mail:TaskMail,name:string):Promise<void>
  confirm(question:string,label:string):Promise<boolean>
  undo():void
  /** Wendet die Analyse-Ergebnisse (ohne übernommene Aufgaben) neu auf die geladenen Mails an und zeichnet Karten und Details neu. */
  refresh():void
}

function make<K extends keyof HTMLElementTagNameMap>(tag:K,text=''){const node=document.createElement(tag);node.textContent=text;return node}

export function renderMailTasks(host:HTMLElement,mail:TaskMail,options:Options){
  host.replaceChildren()
  const tasks=mail.aiTasks||[]
  host.hidden=!tasks.length
  if(!tasks.length)return
  const rows=tasks.map(task=>{
    const check=make('input');check.type='checkbox';check.checked=true
    const text=make('input');text.type='text';text.value=task.text;text.maxLength=120
    const due=make('input');due.type='date';due.value=task.frist||''
    check.setAttribute('aria-label','Aufgabe übernehmen: '+task.text)
    text.setAttribute('aria-label','Text der Aufgabe');due.setAttribute('aria-label','Datum der Aufgabe')
    return {task,check,text,due}
  })
  const list=make('ul')
  for(const row of rows){const item=make('li');item.append(row.check,row.text,row.due);list.append(item)}
  const own=caseNames(mail)
  const target=make('select');target.setAttribute('aria-label','Zielvorgang')
  const fresh=caseNameFromSubject(mail.subject,options.cases())
  for(const name of own)target.add(new Option(name,name))
  if(!own.length)target.add(new Option('Neuer Vorgang: '+fresh,''))
  const take=make('button','Übernehmen');take.type='button';take.className='primary'
  const status=make('p');status.setAttribute('role','status')
  const bar=make('div');bar.className='task-target'
  bar.append(own.length>1?target:make('span',own.length?'Vorgang: '+own[0]:'Neuer Vorgang: '+fresh),take)
  if(own.length>1)bar.prepend(make('span','Ziel'))
  host.append(make('h3','Aufgaben'),list,bar,status)
  take.onclick=async()=>{
    const chosen=rows.filter(r=>r.check.checked&&r.text.value.trim())
    if(!chosen.length){status.textContent='Bitte mindestens eine Aufgabe auswählen.';return}
    if(!options.canAssign()&&!own.length){status.textContent='Für einen neuen Vorgang müssen Kategorien in Outlook schreibbar sein.';return}
    const isNew=!own.length
    const name=isNew?fresh:(own.length>1?target.value:own[0])
    const problem=isNew?caseNameProblem(name,options.cases()):''
    if(problem){status.textContent=problem;return}
    take.disabled=true
    try{
      if(isNew){
        if(!await options.confirm('Vorgang „'+name+'“ anlegen und diese Mail zuordnen? Dafür wird die Kategorie „'+caseTag(name)+'“ in Outlook gesetzt.','Anlegen und zuordnen'))return
        await options.assign(mail,name)
      }
      const added=chosen.map(r=>({id:newId(),text:r.text.value.trim(),done:false,...(r.due.value?{due:r.due.value}:{})}))
      const ok=updateCase(name,c=>({...c,items:[...c.items,...added]}),{name,created:localDay(),items:[]})
      if(!ok){status.textContent='Die Punkte konnten nicht gespeichert werden.';return}
      const id=embeddingId(mail),before=takenTasks(id),originals=chosen.map(r=>r.task.text)
      setTaken(id,[...before,...originals])
      options.refresh()
      showToast(added.length+(added.length===1?' Punkt':' Punkte')+' in „'+name+'“ übernommen.',()=>{
        const ids=new Set(added.map(a=>a.id))
        updateCase(name,c=>({...c,items:c.items.filter(i=>!ids.has(i.id))}))
        setTaken(id,before)
        if(isNew)options.undo()
        options.refresh()
      })
    }catch(error){status.textContent=String(error)}
    finally{take.disabled=false}
  }
}
