/** Pillen-Tabs unter dem Titel: Board, Kalender, Vorgänge und Routinen sind gleichrangige Ansichten. */
export type ViewName = 'board'|'calendar'|'cases'|'routines'

const views:[ViewName,string,string][] = [
  ['board','Board','board'],['calendar','Kalender','calendarView'],['cases','Vorgänge','casesView'],['routines','Routinen','routinesView'],
]

/** Legt für eine Planungsansicht den Bereich neben dem Board an. */
export function viewPanel(name:Exclude<ViewName,'board'>,label:string){
  const panel=document.createElement('section')
  panel.id=views.find(([key])=>key===name)![2]
  panel.className='plan-view'
  panel.setAttribute('role','tabpanel')
  panel.setAttribute('aria-labelledby','tab-'+name)
  panel.setAttribute('aria-label',label)
  panel.tabIndex=-1
  panel.hidden=true
  document.getElementById('board')?.after(panel)
  return panel
}
export function currentView():ViewName{
  const value=document.body.dataset.view
  return views.some(([key])=>key===value)?value as ViewName:'board'
}
/** Wechselt die Ansicht. Andere Module reagieren auf das Ereignis `mailboard:view`. */
export function showView(name:ViewName,focus=false){
  document.body.dataset.view=name
  for(const [key,,panelId] of views){
    const tab=document.getElementById('tab-'+key)
    tab?.setAttribute('aria-selected',String(key===name))
    if(tab)tab.tabIndex=key===name?0:-1
    if(key!=='board'){const panel=document.getElementById(panelId);if(panel)panel.hidden=key!==name}
  }
  document.dispatchEvent(new CustomEvent('mailboard:view',{detail:name}))
  if(focus)document.getElementById(name==='board'?'board':views.find(([key])=>key===name)![2])?.focus()
}

export function initTabs(){
  const list=document.getElementById('viewTabs')
  if(!list)return
  for(const [key,label,panel] of views){
    const tab=document.createElement('button')
    tab.type='button';tab.id='tab-'+key;tab.textContent=label
    tab.setAttribute('role','tab');tab.setAttribute('aria-controls',panel)
    tab.onclick=()=>showView(key)
    list.append(tab)
  }
  // Pfeiltasten wechseln zwischen den Tabs, wie bei einer Registerleiste üblich.
  list.addEventListener('keydown',event=>{
    const tabs=Array.from(list.querySelectorAll<HTMLButtonElement>('[role=tab]'))
    const index=tabs.indexOf(document.activeElement as HTMLButtonElement)
    if(index<0)return
    const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:
      event.key==='Home'?0:event.key==='End'?tabs.length-1:-1
    if(next<0)return
    event.preventDefault();tabs[next].focus();tabs[next].click()
  })
  document.addEventListener('board-commands',event=>{
    const entries=(event as CustomEvent<{label:string;run:()=>void}[]>).detail
    for(const [key,label] of views)if(key!==currentView())entries.push({label:'Ansicht · '+label,run:()=>showView(key,true)})
  })
  showView('board')
}
