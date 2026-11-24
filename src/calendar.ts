/** Wochenkalender für Fristen: Nachfassen, Wiedervorlage, KI-Fristen, Routinen und Checklistenpunkte von Vorgängen. */
import {addDays, calendarEntries, entryKinds, isoWeek, plannedField, routineDue, weekDays, type CalendarEntry, type Case, type Routine} from './planning-logic'
import {currentView, showView, viewPanel} from './tabs'
import {localDay, type ViewMail} from './views-logic'

type Options = {
  getMails():readonly ViewMail[]
  routines():Routine[]
  cases():Case[]
  onPick(id:string):void
  canPlan():boolean
  plan(id:string,field:'followUp'|'snoozeUntil',day:string):Promise<void>|void
  markRoutine(id:string,day:string):void
  toggleItem(caseName:string,itemId:string):void
  openCase(name:string):void
}
const MIME='application/x-mailboard-calendar'

function make<K extends keyof HTMLElementTagNameMap>(tag:K,text=''){const node=document.createElement(tag);node.textContent=text;return node}
function button(label:string,run:()=>void){const node=make('button',label);node.type='button';node.onclick=run;return node}
function dayLabel(day:string,options:Intl.DateTimeFormatOptions){return new Date(day+'T00:00:00').toLocaleDateString('de-DE',options)}

export function initCalendar(options:Options){
  let anchor=localDay()
  const view=viewPanel('calendar','Wochenkalender');view.classList.add('calendar-view')
  const active=()=>currentView()==='calendar'
  const status=make('p');status.setAttribute('role','status')
  document.addEventListener('mailboard:planning',()=>{if(active())render()})
  document.addEventListener('mailboard:view',event=>{if((event as CustomEvent).detail==='calendar')render()})

  function open(day=localDay()){anchor=day;showView('calendar',true)}
  /** Nach Änderungen an Mails aktualisieren, solange niemand gerade zieht. */
  function refresh(){if(active()&&!view.querySelector('.over'))render()}

  function entryNode(entry:CalendarEntry,today:string,late:boolean){
    const item=make('li');item.className='calendar-entry kind-'+entry.kind+(entry.done?' done':'')
    const kind=entryKinds[entry.kind]+(late?' seit '+dayLabel(entry.day,{day:'2-digit',month:'2-digit'}):'')
    if(entry.mailId){
      const mail=options.getMails().find(m=>m.id===entry.mailId)
      const open=button(kind+' · '+entry.label,()=>options.onPick(entry.mailId!))
      open.title=mail?(mail.isSent?'An '+(mail.recipients||mail.sender):mail.sender):''
      if(entry.kind!=='deadline' && options.canPlan()){
        open.draggable=true
        open.ondragstart=e=>{e.dataTransfer?.setData(MIME,entry.mailId!);if(e.dataTransfer)e.dataTransfer.effectAllowed='move'}
      }
      item.append(open)
    }else if(entry.routineId){
      const box=make('input');box.type='checkbox';box.checked=!!entry.done
      const routine=options.routines().find(r=>r.id===entry.routineId)
      // Abhaken lässt sich nur der fällige Termin. Künftige Termine dienen der Übersicht.
      box.disabled=!!entry.done || !routine || routineDue(routine,today).since!==entry.day
      box.onchange=()=>{options.markRoutine(entry.routineId!,today);render()}
      const label=make('label');label.append(box,' '+kind+' · '+entry.label);item.append(label)
    }else if(entry.caseName && entry.itemId){
      const box=make('input');box.type='checkbox';box.checked=!!entry.done
      box.onchange=()=>{options.toggleItem(entry.caseName!,entry.itemId!);render()}
      const label=make('label');label.append(box,' '+kind+' · '+entry.label)
      item.append(label,button('Vorgang '+entry.caseName,()=>options.openCase(entry.caseName!)))
    }
    return item
  }
  function column(title:string,entries:CalendarEntry[],today:string,day?:string){
    const box=make('section');box.className='calendar-day'
    if(day===today)box.classList.add('today')
    if(day && day<today)box.classList.add('past')
    const heading=make('h3',title);box.append(heading)
    box.setAttribute('aria-label',title+' · '+(entries.length===1?'1 Eintrag':entries.length+' Einträge'))
    const list=make('ul')
    for(const entry of entries)list.append(entryNode(entry,today,!day))
    if(!entries.length)list.append(make('li','–'))
    box.append(list)
    if(day && day>=today && options.canPlan()){
      box.ondragover=e=>{if(e.dataTransfer?.types.includes(MIME)){e.preventDefault();box.classList.add('over')}}
      box.ondragleave=()=>box.classList.remove('over')
      box.ondrop=async e=>{
        box.classList.remove('over')
        const id=e.dataTransfer?.getData(MIME),mail=options.getMails().find(m=>m.id===id)
        if(!mail)return
        e.preventDefault()
        const field=plannedField(mail)
        try{
          await options.plan(mail.id,field,day)
          status.textContent=(field==='followUp'?'Nachfassen':'Wiedervorlage')+' für „'+(mail.subject||'(ohne Betreff)')+'“ auf '+dayLabel(day,{weekday:'long',day:'2-digit',month:'2-digit'})+' gesetzt.'
        }catch(error){status.textContent='Planen fehlgeschlagen: '+String(error)}
        render()
      }
    }
    return box
  }
  function render(){
    const today=localDay(),days=weekDays(anchor)
    const {overdue,byDay}=calendarEntries(options.getMails(),options.routines(),options.cases(),days,today)
    const title=make('h2','Wochenkalender · KW '+isoWeek(days[0]));title.id='calendarTitle'
    const range=make('p',dayLabel(days[0],{day:'2-digit',month:'2-digit'})+' bis '+dayLabel(days[6],{day:'2-digit',month:'2-digit',year:'numeric'}))
    const nav=make('div');nav.className='cockpit-actions'
    nav.append(button('Vorige Woche',()=>{anchor=addDays(days[0],-7);render()}),button('Diese Woche',()=>{anchor=today;render()}),
      button('Nächste Woche',()=>{anchor=addDays(days[0],7);render()}))
    const hint=make('p',options.canPlan()?'Ziehe eine Mail auf einen Tag: Wartende Mails erhalten dort ihren Nachfasstermin, alle anderen eine Wiedervorlage.':'Zum Planen per Drag-and-drop die Felder in Outlook freigeben.')
    hint.className='calendar-hint'
    const grid=make('div');grid.className='calendar-grid'
    const late=overdue.length?column('Überfällig',overdue,today):undefined
    late?.classList.add('calendar-overdue')
    for(const day of days)grid.append(column(dayLabel(day,{weekday:'short',day:'2-digit',month:'2-digit'})+(day===today?' · heute':''),byDay.get(day)||[],today,day))
    view.replaceChildren(title,range,nav,hint,...(late?[late]:[]),grid,status)
  }
    return {open,refresh}
}
