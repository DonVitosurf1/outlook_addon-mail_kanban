/** Wiederkehrende Routinen bearbeiten und abhaken. Die Daten liegen lokal, die Sicherung erfasst sie mit. */
import {describeRhythm, routineActions, routineDue, rhythms, weekdayNames, type Routine, type RoutineAction, type Rhythm} from './planning-logic'
import {loadRoutines, newId, saveRoutines} from './planning-store'
import {currentView, showView, viewPanel} from './tabs'
import {localDay} from './views-logic'

type Options = {run(action:RoutineAction):void}

function make<K extends keyof HTMLElementTagNameMap>(tag:K,text=''){const node=document.createElement(tag);node.textContent=text;return node}
function button(label:string,run:()=>void){const node=make('button',label);node.type='button';node.onclick=run;return node}
function labelled(text:string,field:HTMLElement){const label=make('label',text);label.append(field);return label}
function select(name:string,choices:readonly (readonly [string,string])[]){
  const node=make('select');node.setAttribute('aria-label',name)
  for(const [value,text] of choices)node.add(new Option(text,value))
  return node
}
function shortDay(day:string){return new Date(day+'T00:00:00').toLocaleDateString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit'})}

export function markRoutine(id:string,day=localDay()){
  const routines=loadRoutines(),routine=routines.find(r=>r.id===id)
  if(!routine)return
  routine.lastDone=day
  saveRoutines(routines)
}

export function initRoutines(options:Options){
  const view=viewPanel('routines','Routinen');view.classList.add('routines-view')
  document.addEventListener('mailboard:view',event=>{if((event as CustomEvent).detail==='routines')render()})
  document.addEventListener('mailboard:planning',()=>{
    // Abhaken im Briefing oder Kalender aktualisiert die Liste, ohne eine laufende Eingabe zu verwerfen.
    if(currentView()==='routines'&&!view.querySelector('.routine-form')?.contains(document.activeElement))render()
  })
  let editing:Routine|undefined

  function open(){showView('routines',true)}
  function form(){
    const box=make('form');box.className='routine-form'
    const current=editing
    const title=make('input');title.required=true;title.maxLength=120;title.value=current?.title||''
    const rhythm=select('Rhythmus',rhythms);rhythm.value=current?.rhythm||'weekly'
    const weekday=select('Wochentag',weekdayNames.map((n,i)=>[String(i+1),n] as const));weekday.value=String(current?.weekday||1)
    const monthDay=make('input');monthDay.type='number';monthDay.min='1';monthDay.max='31';monthDay.value=String(current?.monthDay||1)
    const action=select('Verknüpfte Ansicht',routineActions);action.value=current?.action||''
    const weekdayLabel=labelled('Wochentag',weekday),monthLabel=labelled('Tag im Monat (bei kürzeren Monaten der Monatsletzte)',monthDay)
    const sync=()=>{weekdayLabel.hidden=rhythm.value!=='weekly';monthLabel.hidden=rhythm.value!=='monthly'}
    rhythm.onchange=sync;sync()
    const error=make('p');error.setAttribute('role','alert')
    const save=make('button',current?'Routine speichern':'Routine anlegen');save.type='submit';save.className='primary'
    const actions=make('div');actions.className='dialog-actions'
    if(current)actions.append(button('Bearbeitung abbrechen',()=>{editing=undefined;render()}))
    actions.append(save)
    box.append(make('h3',current?'Routine bearbeiten':'Neue Routine'),labelled('Titel',title),labelled('Rhythmus',rhythm),weekdayLabel,monthLabel,
      labelled('Verknüpfte Ansicht',action),actions,error)
    box.onsubmit=event=>{
      event.preventDefault()
      if(!title.value.trim()){error.textContent='Bitte einen Titel eingeben.';return}
      if(rhythm.value==='monthly'&&!monthDay.checkValidity()){error.textContent='Bitte einen Tag zwischen 1 und 31 wählen.';return}
      const routines=loadRoutines()
      const base:Routine=current?{...current}:{id:newId(),title:'',rhythm:'daily',created:localDay()}
      const next:Routine={id:base.id,title:title.value.trim(),rhythm:rhythm.value as Rhythm,created:base.created,lastDone:base.lastDone}
      if(next.rhythm==='weekly')next.weekday=Number(weekday.value)
      if(next.rhythm==='monthly')next.monthDay=Number(monthDay.value)
      if(action.value)next.action=action.value as RoutineAction
      const index=routines.findIndex(r=>r.id===next.id)
      if(index>=0)routines[index]=next;else routines.push(next)
      if(!saveRoutines(routines)){error.textContent='Die Routine konnte nicht lokal gespeichert werden.';return}
      editing=undefined;render()
    }
    return box
  }
  function render(){
    const routines=loadRoutines(),today=localDay()
    const title=make('h2','Routinen');title.id='routinesTitle'
    const intro=make('p','Routinen erinnern an wiederkehrende Arbeit. Eine verpasste Routine bleibt fällig, bis du sie abhakst. Fällige Routinen stehen im Briefing der Morgen-Triage, in Start und im Wochenkalender.')
    const list=make('ul');list.className='planning-list'
    if(!routines.length)list.append(make('li','Noch keine Routinen angelegt.'))
    for(const routine of routines){
      const state=routineDue(routine,today)
      const item=make('li')
      const text=make('div')
      text.append(make('strong',routine.title),make('small',[describeRhythm(routine),
        state.due?(state.since===today?'heute fällig':'fällig seit '+shortDay(state.since)):routine.lastDone?'zuletzt erledigt '+shortDay(routine.lastDone):'noch nicht fällig',
        routine.action?'öffnet '+routineActions.find(([k])=>k===routine.action)?.[1]:''].filter(Boolean).join(' · ')))
      item.append(text)
      const tools=make('div');tools.className='planning-tools'
      if(state.due)tools.append(button('Erledigt',()=>{markRoutine(routine.id);render()}))
      if(routine.action)tools.append(button('Öffnen',()=>options.run(routine.action!)))
      tools.append(button('Bearbeiten',()=>{editing=routine;render();view.querySelector<HTMLInputElement>('.routine-form input')?.focus()}),
        button('Löschen',()=>{saveRoutines(loadRoutines().filter(r=>r.id!==routine.id));if(editing?.id===routine.id)editing=undefined;render()}))
      item.append(tools);list.append(item)
    }
    view.replaceChildren(title,intro,list,form())
  }
  // Der Werkzeuge-Eintrag erscheint auch in der Befehlspalette.
  return {open,due:()=>loadRoutines().filter(r=>routineDue(r).due)}
}
