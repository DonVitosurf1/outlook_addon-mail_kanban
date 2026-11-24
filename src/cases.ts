/** Vorgänge bündeln Mails über die Outlook-Kategorie „Vorgang: Name“. Checkliste und Notiz liegen lokal. */
import {ask} from './data-settings'
import {caseMails, caseNameProblem, caseProgress, caseTag, knownCases, type Case} from './planning-logic'
import {loadCases, newId, saveCases, updateCase} from './planning-store'
import {currentView, showView, viewPanel} from './tabs'
import {localDay, type ViewMail} from './views-logic'

type Options = {
  getMails():readonly ViewMail[]
  selection():string[]
  canAssign():boolean
  assign(ids:string[],name:string,on:boolean):Promise<void>|void
  onPick(id:string):void
  showOnBoard(name:string):void
  /** Nur mit echtem Postfach. Legt die Capacities-Seite an oder aktualisiert die Aufgaben. */
  canPublish?():boolean
  publish?(name:string):Promise<void>
}

function make<K extends keyof HTMLElementTagNameMap>(tag:K,text=''){const node=document.createElement(tag);node.textContent=text;return node}
function button(label:string,run:()=>void){const node=make('button',label);node.type='button';node.onclick=run;return node}
function labelled(text:string,field:HTMLElement){const label=make('label',text);label.append(field);return label}
const same=(a:string,b:string)=>a.localeCompare(b,'de',{sensitivity:'base'})===0

export function allCases(mails:readonly ViewMail[]){return knownCases(loadCases(),mails)}
/** Hakt einen Checklistenpunkt ab oder öffnet ihn wieder. */
export function toggleCaseItem(name:string,itemId:string){
  updateCase(name,c=>{const item=c.items.find(i=>i.id===itemId);if(item)item.done=!item.done;return c})
}

export function initCases(options:Options){
  let chosen=''
  const view=viewPanel('cases','Vorgänge');view.classList.add('cases-view')
  const active=()=>currentView()==='cases'
  // Ein Neuzeichnen während der Eingabe würde Text und Fokus verwerfen.
  const editing=()=>view.contains(document.activeElement)&&!!document.activeElement?.matches('input:not([type=checkbox]),textarea,select')
  const status=make('p');status.setAttribute('role','status')
  document.addEventListener('mailboard:planning',()=>{if(active()&&!editing())render()})
  document.addEventListener('mailboard:view',event=>{if((event as CustomEvent).detail==='cases')render()})

  function open(name=''){chosen=name;status.textContent='';if(active())render();else showView('cases',true)}
  async function assign(ids:string[],name:string,on:boolean){
    if(!options.canAssign()){status.textContent='Für Zuordnungen müssen Kategorien in Outlook schreibbar sein.';return}
    try{await options.assign(ids,name,on)}catch(error){status.textContent='Zuordnung fehlgeschlagen: '+String(error)}
    render()
  }
  function create(name:string,mails:readonly ViewMail[]){
    const problem=caseNameProblem(name,allCases(mails))
    if(problem)return problem
    saveCases([...loadCases(),{name:name.trim(),created:localDay(),items:[]}])
    return ''
  }
  function newCaseForm(){
    const form=make('form');form.className='case-new'
    const name=make('input');name.maxLength=60;name.placeholder='z. B. Umzug Labor 2.14'
    const selected=options.selection()
    const withSelection=make('input');withSelection.type='checkbox';withSelection.checked=selected.length>0
    const take=make('label');take.append(withSelection,' '+selected.length+' markierte Karten zuordnen');take.hidden=!selected.length
    const submit=make('button','Vorgang anlegen');submit.type='submit'
    const error=make('p');error.setAttribute('role','alert')
    form.append(make('h3','Neuer Vorgang'),labelled('Name',name),take,submit,error)
    form.onsubmit=async event=>{
      event.preventDefault()
      const problem=create(name.value,options.getMails())
      if(problem){error.textContent=problem;return}
      chosen=name.value.trim()
      if(withSelection.checked&&selected.length)await assign(selected,chosen,true)
      else render()
    }
    return form
  }
  function detail(c:Case,mails:readonly ViewMail[]){
    const box=make('section');box.className='case-detail';box.setAttribute('aria-label','Vorgang '+c.name)
    const linked=caseMails(mails,c.name),progress=caseProgress(c)
    const fallback=structuredClone(c)
    const update=(fn:(c:Case)=>Case|undefined)=>{updateCase(c.name,fn,fallback);render()}
    box.append(make('h3',c.name),make('p',['Angelegt '+new Date(c.created+'T00:00:00').toLocaleDateString('de-DE'),
      c.closed?'abgeschlossen '+new Date(c.closed+'T00:00:00').toLocaleDateString('de-DE'):'offen',
      progress.done+' von '+progress.total+' Punkten erledigt',linked.length===1?'1 Mail':linked.length+' Mails'].join(' · ')))
    const note=make('textarea');note.rows=2;note.value=c.note||''
    note.onchange=()=>updateCase(c.name,x=>({...x,note:note.value.trim()||undefined}),fallback)
    box.append(labelled('Notiz',note))

    box.append(make('h4','Checkliste'))
    const list=make('ul');list.className='checklist'
    if(!c.items.length)list.append(make('li','Noch keine Punkte.'))
    for(const item of c.items){
      const row=make('li')
      const done=make('input');done.type='checkbox';done.checked=item.done
      done.onchange=()=>update(x=>{const i=x.items.find(i=>i.id===item.id);if(i)i.done=done.checked;return x})
      const text=make('label');text.append(done,' '+item.text)
      const due=make('input');due.type='date';due.value=item.due||'';due.setAttribute('aria-label','Termin für „'+item.text+'“')
      due.onchange=()=>update(x=>{const i=x.items.find(i=>i.id===item.id);if(i){if(due.value)i.due=due.value;else delete i.due};return x})
      row.append(text,due,button('Entfernen',()=>update(x=>({...x,items:x.items.filter(i=>i.id!==item.id)}))))
      list.append(row)
    }
    const add=make('form');add.className='checklist-add'
    const text=make('input');text.maxLength=200;text.setAttribute('aria-label','Neuer Checklistenpunkt');text.placeholder='Neuer Punkt'
    const due=make('input');due.type='date';due.setAttribute('aria-label','Termin für den neuen Punkt')
    const submit=make('button','Punkt hinzufügen');submit.type='submit'
    add.append(text,due,submit)
    add.onsubmit=event=>{
      event.preventDefault()
      if(!text.value.trim())return
      const item={id:newId(),text:text.value.trim(),done:false,...(due.value?{due:due.value}:{})}
      update(x=>({...x,items:[...x.items,item]}))
      view.querySelector<HTMLInputElement>('.checklist-add input')?.focus()
    }
    box.append(list,add)

    box.append(make('h4','Mails'))
    const mailList=make('ul');mailList.className='planning-list'
    if(!linked.length)mailList.append(make('li','Keine geladene Mail gehört zu diesem Vorgang.'))
    for(const mail of linked){
      const row=make('li')
      row.append(button([mail.subject||'(ohne Betreff)',mail.isSent?'An '+(mail.recipients||mail.sender):mail.sender,mail.status].join(' · '),()=>options.onPick(mail.id)),
        button('Zuordnung lösen',()=>void assign([mail.id],c.name,false)))
      mailList.append(row)
    }
    box.append(mailList)

    const actions=make('div');actions.className='cockpit-actions'
    const selected=options.selection().filter(id=>!linked.some(m=>m.id===id))
    if(linked.length)actions.append(button('Auf dem Board zeigen',()=>{showView('board');options.showOnBoard(c.name)}))
    if(options.canPublish?.()&&options.publish){
      const label=c.capacitiesId?'Aufgaben in Capacities aktualisieren':'In Capacities anlegen'
      const publish=button('',()=>void options.publish!(c.name))
      publish.className='icon-button'
      publish.title=label
      publish.setAttribute('aria-label',label)
      if(c.capacitiesId)publish.setAttribute('aria-pressed','true')
      publish.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">'+(c.capacitiesId
        ?'<path d="M8 12.2 10.3 14.5 16 8.8"/><path d="M6.5 6.5h11v11h-11z"/>'
        :'<path d="M12 16V5"/><path d="M8 8.5 12 4.5l4 4"/><path d="M6 19.5h12"/>')+'</svg>'
      actions.append(publish)
    }
    if(selected.length)actions.append(button(selected.length+' markierte Karten zuordnen',()=>void assign(selected,c.name,true)))
    actions.append(c.closed?button('Wieder öffnen',()=>update(x=>{delete x.closed;return x})):button('Vorgang abschließen',()=>update(x=>({...x,closed:localDay()}))))
    actions.append(button('Vorgang löschen',async()=>{
      if(linked.length){status.textContent='Bitte zuerst die Zuordnung der '+linked.length+' Mails lösen.';return}
      if(!await ask(view,'Vorgang „'+c.name+'“ mit Checkliste und Notiz löschen?'))return
      saveCases(loadCases().filter(x=>!same(x.name,c.name)));chosen='';render()
    }))
    box.append(actions)
    return box
  }
  function render(){
    const mails=options.getMails(),cases=allCases(mails)
    const title=make('h2','Vorgänge');title.id='casesTitle'
    const current=cases.find(c=>same(c.name,chosen))
    const nav=make('nav');nav.className='case-list';nav.setAttribute('aria-label','Vorgänge')
    if(!cases.length)nav.append(make('p','Noch keine Vorgänge. Ein Vorgang bündelt Mails über die Kategorie „Vorgang: Name“ und führt eine Checkliste.'))
    for(const c of cases){
      const p=caseProgress(c),count=caseMails(mails,c.name).length
      const item=button(c.name+' · '+count+' Mails'+(p.total?' · '+p.done+'/'+p.total:'')+(c.closed?' · abgeschlossen':''),()=>{chosen=c.name;render()})
      item.setAttribute('aria-pressed',String(c===current))
      nav.append(item)
    }
    const layout=make('div');layout.className='case-layout'
    const side=make('div');side.append(nav,newCaseForm())
    layout.append(side,current?detail(current,mails):make('p','Wähle links einen Vorgang oder lege einen neuen an.'))
    view.replaceChildren(title,layout,status)
  }
  function openAssign(ids:string[]){
    if(!ids.length){document.getElementById('message')!.textContent='Bitte zuerst eine Karte markieren.';return}
    const mails=options.getMails(),cases=allCases(mails).filter(c=>!c.closed)
    const picker=make('dialog');picker.className='view-dialog';picker.setAttribute('aria-label','Vorgang zuordnen')
    const form=make('form')
    const choice=make('select');choice.setAttribute('aria-label','Vorhandener Vorgang')
    choice.add(new Option('Neuer Vorgang …',''))
    for(const c of cases)choice.add(new Option(c.name,c.name))
    if(cases.length)choice.selectedIndex=1
    const name=make('input');name.maxLength=60
    const nameLabel=labelled('Name des neuen Vorgangs',name)
    const sync=()=>{nameLabel.hidden=!!choice.value}
    choice.onchange=sync;sync()
    const error=make('p');error.setAttribute('role','alert')
    const actions=make('div');actions.className='dialog-actions'
    const save=make('button','Zuordnen');save.type='submit';save.className='primary'
    actions.append(button('Abbrechen',()=>picker.close()),save)
    form.append(make('p',ids.length===1?'1 markierte Mail':ids.length+' markierte Mails'),labelled('Vorgang',choice),nameLabel,actions,error)
    form.onsubmit=async event=>{
      event.preventDefault()
      let target=choice.value
      if(!target){
        const problem=create(name.value,mails)
        if(problem){error.textContent=problem;return}
        target=name.value.trim()
      }
      if(!options.canAssign()){error.textContent='Für Zuordnungen müssen Kategorien in Outlook schreibbar sein.';return}
      save.disabled=true
      try{await options.assign(ids,target,true);picker.close()}
      catch(e){error.textContent=String(e)}
      finally{save.disabled=false}
    }
    picker.append(make('h2','Vorgang zuordnen'),form)
    picker.addEventListener('close',()=>picker.remove(),{once:true})
    document.body.append(picker);picker.showModal()
    ;(choice.value?choice:name).focus()
  }
  /** Seitenleiste: offene Vorgänge mit Anzahl geladener Mails. */
  function refresh(){
    const section=document.getElementById('casesSection'),nav=document.getElementById('caseViews')
    if(!section||!nav)return
    const mails=options.getMails(),cases=allCases(mails).filter(c=>!c.closed)
    section.hidden=!cases.length
    const filtered=(document.querySelector('#viewControls select[aria-label="Kategorie"]') as HTMLSelectElement|null)?.value
    nav.replaceChildren(...cases.map(c=>{
      const count=caseMails(mails,c.name).length
      const item=button(c.name,()=>options.showOnBoard(c.name))
      item.title=count?'Mails des Vorgangs „'+c.name+'“ zeigen':'Keine geladene Mail gehört zu „'+c.name+'“'
      item.disabled=!count
      item.append(make('b',String(count)))
      item.setAttribute('aria-pressed',String(filtered===caseTag(c.name)))
      return item
    }))
    if(active()&&!editing())render()
  }
  document.addEventListener('mailboard:planning',refresh)
  document.addEventListener('board-commands',event=>{
    const entries=(event as CustomEvent<{label:string;run:()=>void}[]>).detail
    for(const c of allCases(options.getMails()).filter(c=>!c.closed))entries.push({label:'Vorgang öffnen · '+c.name,run:()=>open(c.name)})
  })
  return {open,openAssign,refresh}
}
