/** Abschnitt „Aufgaben“ in den Maildetails: Vorschläge der lokalen KI prüfen und als Checklistenpunkte in einen Vorgang übernehmen. */
import {embeddingId} from './ai'
import {caseNameFromSubject, caseNameProblem, caseNames, caseTag, type Case} from './planning-logic'
import {newId, updateCase} from './planning-store'
import {releaseTaken, setTaken, takenTasks, type Task} from './tasks-taken'
import {showToast} from './toast'
import {BUSY_UNDO} from './undo-ui'
import {localDay} from './views-logic'

type TaskMail = {subject:string;tags:string[];id:string;aiTasks?:Task[];received?:string;sender:string;body:string}
type Options = {
  cases():readonly Case[]
  canAssign():boolean
  /** Setzt die Kategorie „Vorgang: Name“ an der Mail (Postfachänderung mit Rücknahme). */
  /** `recorded`: eigener Rückgängig-Schritt, `unchanged`: Outlook hatte die Kategorie schon, `failed`: nicht gesetzt. */
  assign(mail:TaskMail,name:string):Promise<'recorded'|'unchanged'|'failed'>
  confirm(question:string,label:string):Promise<boolean>
  /** Kennung des letzten Rücknahme-Schritts. */
  marker():string
  /** Nimmt den letzten Schritt nur zurück, wenn er noch zur Kennung passt: `done`, sonst `stale` (später geändert) oder `busy` (Board beschäftigt). */
  undoIfLatest(marker:string):Promise<'done'|'stale'|'busy'>
  /** Ruft `run` auf, sobald der zuletzt aufgezeichnete Schritt zurückgenommen wird, ob über die Rückmeldung oder Strg+Z. */
  afterUndo(run:()=>void):void
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
      if(isNew&&!await options.confirm('Vorgang „'+name+'“ anlegen und diese Mail zuordnen? Dafür wird die Kategorie „'+caseTag(name)+'“ in Outlook gesetzt.','Anlegen und zuordnen'))return
      const added=chosen.map(r=>({id:newId(),text:r.text.value.trim(),done:false,...(r.due.value?{due:r.due.value}:{})}))
      const ids=new Set(added.map(a=>a.id))
      const dropItems=()=>isNew?updateCase(name,()=>undefined):updateCase(name,c=>({...c,items:c.items.filter(i=>!ids.has(i.id))}))
      // Erst lokal speichern: scheitert das, bleibt die Mail unverändert.
      if(!updateCase(name,c=>({...c,items:[...c.items,...added]}),{name,created:localDay(),items:[]})){status.textContent='Die Punkte konnten nicht gespeichert werden.';return}
      let marker=''
      if(isNew){
        // Nur ein eigener Rücknahme-Schritt bekommt eine Kennung. Hatte Outlook die Kategorie schon, nimmt Rückgängig
        // nur die Punkte zurück. Sonst gehörte die Kennung zu einer früheren, fremden Änderung.
        const previous=options.marker()
        let outcome:'recorded'|'unchanged'|'failed'
        try{outcome=await options.assign(mail,name)}
        catch(error){dropItems();throw error}
        const now=options.marker()
        if(outcome==='failed'||(outcome==='recorded'&&now===previous)){dropItems();status.textContent='Die Zuordnung zum Vorgang ist fehlgeschlagen. Die Punkte wurden nicht übernommen.';return}
        if(outcome==='recorded')marker=now
      }
      const id=embeddingId(mail),originals=chosen.map(r=>r.task.text)
      setTaken(id,[...takenTasks(id),...originals])
      // Punkte und Merker zurücknehmen. Ein neuer Vorgang verschwindet mit, wenn danach keine anderen Punkte hinzukamen.
      // Nur einmal: eine veraltete Rückmeldung und ein späteres Strg+Z auf denselben Schritt geben die Übernahme nicht doppelt frei.
      let released=false
      const release=(keepCase:boolean)=>{
        if(released)return
        released=true
        updateCase(name,c=>{const items=c.items.filter(i=>!ids.has(i.id));return isNew&&!keepCase&&!items.length?undefined:{...c,items}})
        releaseTaken(id,originals)
      }
      // Die Zuordnung zum neuen Vorgang ist ein eigener Rückgängig-Schritt: auch Strg+Z nimmt Punkte, Vorgang und Merker mit zurück.
      if(marker)options.afterUndo(()=>{release(false);options.refresh()})
      options.refresh()
      const revert=async()=>{
        let kept=false
        if(marker){
          let outcome:'done'|'stale'|'busy'
          try{outcome=await options.undoIfLatest(marker)}
          catch(error){status.textContent=error instanceof Error?error.message:String(error);outcome='stale'}
          if(outcome==='busy'){showToast(BUSY_UNDO,()=>void revert());return}
          // Zurückgenommen: das Aufräumen übernimmt `afterUndo`.
          if(outcome==='done')return
          kept=true
        }
        release(kept)
        options.refresh()
        if(kept)showToast('Die Zuordnung zum Vorgang bleibt, weil danach etwas anderes geändert wurde.')
      }
      showToast(added.length+(added.length===1?' Punkt':' Punkte')+' in „'+name+'“ übernommen.',()=>void revert())
    }catch(error){status.textContent=error instanceof Error?error.message:String(error)}
    finally{take.disabled=false}
  }
}
