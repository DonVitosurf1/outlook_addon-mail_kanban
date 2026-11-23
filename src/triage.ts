/** Morgen-Triage direkt auf dem Board: Ein Banner führt durch drei Schritte, das Board zeigt nur die Karten des Schritts. */
import {briefing, inTriageStep, triageSteps, type Case, type Routine} from './planning-logic'
import {lastTriage, rememberTriage} from './planning-store'
import type {ViewState} from './views'
import {showView} from './tabs'
import {localDay, type ViewMail} from './views-logic'

type Options = {
  getMails():readonly ViewMail[]
  isLive():boolean
  hasMailbox():boolean
  overdueDays():number
  views:{setExtraFilter(filter:((mail:ViewMail)=>boolean)|undefined):void; captureView():ViewState; restoreView(state:ViewState):void; reset():void}
  /** Bereitet das Board vor, etwa Ordnerauswahl im Demo-Postfach, und liefert die Rücknahme. */
  enter():()=>void
  render():void
  onPick(id:string):void
  routines():Routine[]
  markRoutine(id:string):void
  runRoutine(routine:Routine):void
  cases():Case[]
  toggleItem(caseName:string,itemId:string):void
}

function make<K extends keyof HTMLElementTagNameMap>(tag:K,text=''){const node=document.createElement(tag);node.textContent=text;return node}
function button(label:string,run:()=>void){const node=make('button',label);node.type='button';node.onclick=run;return node}
function when(stamp:number|undefined){
  if(!stamp)return 'Neu in den letzten 24 Stunden'
  return 'Neu seit der letzten Triage ('+new Date(stamp).toLocaleString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+')'
}

export function initTriage(options:Options){
  let active=false, step=0, briefingOpen=true
  let saved:ViewState|undefined, undoScope:(()=>void)|undefined
  const banner=make('section');banner.id='triage';banner.className='triage-banner';banner.hidden=true
  banner.setAttribute('aria-label','Morgen-Triage')
  document.getElementById('board')?.before(banner)
  // Der gelbe Hauptbutton im Kopf startet die Triage oder führt zu ihr zurück.
  const trigger=document.getElementById('triageStart') as HTMLButtonElement|null
  if(trigger)trigger.onclick=()=>start()
  function syncTrigger(){
    if(!trigger)return
    trigger.hidden=!options.hasMailbox()
    trigger.textContent=active?'Zur Triage':'Morgen-Triage starten'
    trigger.setAttribute('aria-pressed',String(active))
  }

  const predicate=()=>{
    const today=localDay(),overdue=options.overdueDays(),current=step
    return (mail:ViewMail)=>inTriageStep(mail,current,today,overdue)
  }
  function go(next:number){
    step=next;briefingOpen=step===0
    options.views.setExtraFilter(predicate())
    options.render()
    banner.querySelector<HTMLElement>('h2')?.focus()
  }
  function start(){
    showView('board')
    if(active){banner.querySelector<HTMLElement>('h2')?.focus();return}
    if(!options.hasMailbox()){
      const message=document.getElementById('message')
      if(message)message.textContent='Für die Morgen-Triage zuerst Outlook verbinden oder das Beispielpostfach öffnen.'
      return
    }
    saved=options.views.captureView()
    undoScope=options.enter()
    const search=document.getElementById('search') as HTMLInputElement|null
    if(search)search.value=''
    options.views.reset()
    active=true;banner.hidden=false
    go(0)
  }
  function stop(completed:boolean){
    if(!active)return
    if(completed)rememberTriage(options.isLive())
    active=false;banner.hidden=true;banner.replaceChildren()
    options.views.setExtraFilter(undefined)
    if(saved)options.views.restoreView(saved)
    undoScope?.();saved=undefined;undoScope=undefined
    options.render()
    document.getElementById('board')?.focus()
  }

  function renderBriefing(){
    const mails=options.getMails(),since=lastTriage(options.isLive())
    const b=briefing(mails,{overdueDays:options.overdueDays(),since,routines:options.routines(),cases:options.cases()})
    const details=make('details');details.className='triage-briefing';details.open=briefingOpen
    details.ontoggle=()=>{briefingOpen=details.open}
    const body=make('div');body.className='triage-briefing-body'
    details.append(make('summary','Briefing'),body)
    body.append(make('p',[b.due.length+' heute dran',b.late.length+' Nachfassen fällig',b.undated.length+' Warten ohne Frist',
      b.reply.length+' Antwort nötig',b.focus.length+' im Fokus',b.snoozed+' auf Wiedervorlage'].join(' · ')))
    const column=(title:string)=>{const box=make('div');box.className='triage-column';box.append(make('h3',title));body.append(box);return box}
    const fresh=column(when(since)+' · '+b.fresh.length)
    if(!b.fresh.length)fresh.append(make('p','Keine neuen Mails.'))
    const list=make('ul')
    for(const mail of b.fresh.slice(0,8)){
      const item=make('li');item.append(button([mail.subject||'(ohne Betreff)',mail.sender].join(' · '),()=>options.onPick(mail.id)));list.append(item)
    }
    if(b.fresh.length>8)list.append(make('li','und '+(b.fresh.length-8)+' weitere'))
    if(b.fresh.length)fresh.append(list)
    if(b.routines.length||b.checklist.length){
      const today=column('Heute anstehend')
      const tasks=make('ul')
      for(const {routine,since:day} of b.routines){
        const item=make('li');item.append(make('span',routine.title+(day<localDay()?' · seit '+new Date(day+'T00:00:00').toLocaleDateString('de-DE'):'')))
        if(routine.action)item.append(button('Öffnen',()=>options.runRoutine(routine)))
        item.append(button('Erledigt',()=>{options.markRoutine(routine.id);refresh()}))
        tasks.append(item)
      }
      for(const {case:name,item:entry} of b.checklist){
        const item=make('li');item.append(make('span',name+' · '+entry.text))
        item.append(button('Abhaken',()=>{options.toggleItem(name,entry.id);refresh()}))
        tasks.append(item)
      }
      today.append(tasks)
    }
    return details
  }

  function refresh(){
    syncTrigger()
    if(!active)return
    const focused=banner.contains(document.activeElement)?(document.activeElement as HTMLElement).textContent:''
    const info=triageSteps[step]
    const count=options.getMails().filter(predicate()).length
    const head=make('div');head.className='triage-head'
    const title=make('h2',info.title);title.tabIndex=-1
    const counter=make('p',count===0?'Nichts zu tun in diesem Schritt':count===1?'1 Karte in diesem Schritt':count+' Karten in diesem Schritt');counter.setAttribute('aria-live','polite')
    head.append(make('p','Morgen-Triage · Schritt '+(step+1)+' von '+triageSteps.length),title,counter)
    const actions=make('div');actions.className='triage-actions'
    if(step>0)actions.append(button('Vorheriger Schritt',()=>go(step-1)))
    const next=step===triageSteps.length-1?button('Triage beenden',()=>stop(true)):button('Nächster Schritt',()=>go(step+1))
    next.className='primary'
    actions.append(next,button('Triage abbrechen',()=>stop(false)))
    banner.replaceChildren(head,make('p',info.hint),renderBriefing(),actions)
    if(focused)Array.from(banner.querySelectorAll<HTMLElement>('button,summary')).find(n=>n.textContent===focused)?.focus()
  }

  // Beim Wechsel zwischen Outlook, Beispielpostfach und Offline beginnt die Triage neu.
  document.addEventListener('mailboard:source-changed',()=>stop(false))
  document.addEventListener('keydown',event=>{
    if(event.defaultPrevented||!(event.ctrlKey||event.metaKey)||event.altKey||event.key.toLowerCase()!=='t'||document.querySelector('dialog[open]'))return
    event.preventDefault();start()
  })
  document.addEventListener('board-commands',event=>{
    const entries=(event as CustomEvent<{label:string;run:()=>void}[]>).detail
    if(!options.hasMailbox())return
    if(!active)entries.push({label:'Morgen-Triage starten (Strg+T)',run:start})
    else entries.push({label:'Morgen-Triage: nächster Schritt',run:()=>step<triageSteps.length-1?go(step+1):stop(true)},
      {label:'Morgen-Triage abbrechen',run:()=>stop(false)})
  })
  return {start,refresh,get active(){return active},finish:()=>stop(true),cancel:()=>stop(false)}
}
