/**
 * Einrichtungsassistent (E0): Ansicht „Einrichtung“ ohne eigenen Tab, mit Schrittleiste E1–E7, „Pausieren“ und „Weiter“.
 * Geöffnet über Werkzeuge → Einrichtung, Start und den Hinweis über dem Board (U3). Arbeitet nur mit dem Outlook-Postfach.
 *
 * Schritte registrieren (E3–E7 folgen in eigenen Modulen, die board.ts importiert):
 *
 *   registerStep('E3', async ctx => {
 *     const folders=ctx.host.learnerFolders()      // aktuelle Lernordner
 *     const list=document.createElement('ul')
 *     ctx.body.append(list)                        // leerer Inhaltsbereich unter Titel und Beschreibung
 *     if(!await ctx.host.confirm('„Rechnung 4711“ nach „Einkauf“ verschieben?','Verschieben'))return  // Bestätigung mit Zielliste
 *     await ctx.host.service()?.writeBatch(async()=>{ … })  // Postfachänderungen als Undo-Schritt im Schreibstapel
 *     if(!ctx.active())return                      // nach jedem await: Ansicht inzwischen neu gezeichnet?
 *     ctx.save(state=>{state.outliers['mail-id']={folder:folders[0].path,decision:'stay'}})
 *     ctx.done()                                   // Schritt erledigt, weiter zum nächsten offenen
 *   })
 *
 * Fehler aus `render` (auch asynchron geworfene) zeigt der Rahmen in der Statuszeile des Schritts.
 *
 * Die Render-Funktion läuft bei jedem Anzeigen des Schritts neu, auch nach Pausieren und Fortsetzen. Titel, Beschreibung,
 * KI-Hinweis (`stepInfo[id].needsAi` ohne lokale KI) und die Knöpfe „Überspringen“, „Pausieren“ und „Weiter“ stellt der Rahmen.
 * Ohne registrierte Funktion bleibt der Schritt ein Platzhalter. `ctx.ai` sagt, ob die lokale KI eingeschaltet ist.
 *
 * Gespeicherter Stand: localStorage `mailboard-setup-v1`, nur im Outlook-Modus, Form siehe `SetupState` in setup-logic.ts:
 *   {version:1, step:'E2', status:{E1:'done',E2:'open',…,E7:'open'}, measurements:{baseline?,after?}, outliers:{…}, confirmed:[…], outlierFolders:[…], data:{…}}
 * `measurements.*` hat die Form `Measurement` aus ai.ts ({date, report, samples, note}).
 */
import {createFolder, getArchiveScope, getBoardScope, getLearningScope} from './projects'
import {updateConfig} from './data-settings'
import {localAiEnabled, measureLearning, renderEvaluation, trainFromFolders, type AiMail, type Measurement} from './ai'
import type {Folder, LiveBoard} from './live'
import {currentView, showView, viewPanel} from './tabs'
import {showToast} from './toast'
import {SETUP_KEY, freshState, initialScopes, isComplete, nextOpen, parseState, progressText, shouldOfferSetup, stepIds, stepInfo,
  type SetupState, type StepId, type StepStatus} from './setup-logic'

export type {SetupState, StepId, StepStatus} from './setup-logic'
/** Ordner aus `outlook_folders`. `parentId` und `rootId` liefert der Outlook-Helfer mit, `count` nur, wenn bekannt. */
export type SetupFolder=Folder&{parentId?:string;rootId?:string;count?:number}
/** Zugriff auf das Board. Kommt aus board.ts. */
export type SetupHost={
  mailbox():'outlook'|'demo'|'offline'
  /** Alle geladenen Outlook-Ordner. */
  folders():SetupFolder[]
  /** Aktuelle Lernordner nach der gespeicherten Auswahl. */
  learnerFolders():Folder[]
  /** Schreibzugriff auf Outlook (writeBatch, move, Undo-Stapel). Nur im Outlook-Modus. */
  service():LiveBoard|undefined
  /** Bestätigung mit Zielliste vor jeder Postfachänderung. */
  confirm(question:string,label?:string):Promise<boolean>
  /**
   * Verschiebt Mails, die nicht auf dem Board stehen (z. B. Lernmails aus `trainingMails`), auf dem Move-Weg des Boards:
   * Bestätigung mit Ziel, Undo-Schritt im Schreibstapel, Rückmeldung mit Rückgängig, danach `recordFiling` (Lernbeispiel umhängen).
   * `target` ist die Outlook-Ordner-ID. `moved` läuft je erfolgreich verschobener Mail mit ihrer bisherigen ID.
   * Ohne Bestätigung passiert nichts. Liefert einen Fehlertext (beschäftigtes Board, fehlgeschlagene Verschiebungen), sonst ''.
   */
  moveMails(mails:OffBoardMail[],target:string,moved?:(id:string)=>void):Promise<string>
  /**
   * Führt eine Ordneränderung (Zusammenlegen, Umbenennen) aus, während das Board gesperrt ist, und lädt danach die Ordner neu.
   * Liefert einen Fehlertext (beschäftigtes Board, geworfener Fehler), sonst ''.
   */
  exclusive(action:()=>Promise<void>):Promise<string>
  /** Nimmt die letzte Änderung zurück wie Strg+Z, etwa aus der Rückmeldung. */
  undo():void
}
/** Mail außerhalb des Boards mit Outlook-ID und Quellordner-ID. */
export type OffBoardMail=AiMail&{id:string;folderId:string}
export type StepContext={
  id:StepId
  body:HTMLElement
  host:SetupHost
  ai:boolean
  /** Kopie des gespeicherten Stands beim Zeichnen. */
  state:SetupState
  /** Ändert den Stand und speichert ihn (nur im Outlook-Modus). */
  save(change:(state:SetupState)=>void):void
  /** Schritt als erledigt markieren und zum nächsten offenen Schritt gehen. */
  done():void
  skip():void
  /** Zeichnet die Ansicht beim aktuellen Schritt neu, etwa nach einer Messung, und zeigt `message` in der Statuszeile. */
  refresh(message?:string):void
  /** Statuszeile unter dem Schritt (role=status). */
  status(text:string):void
  /** Falsch, sobald die Ansicht neu gezeichnet oder verlassen wurde. */
  active():boolean
}
export type StepRender=(ctx:StepContext)=>void|Promise<void>
const renderers=new Map<StepId,StepRender>()
/** Hinterlegt den Inhalt eines Schritts. Ein späterer Aufruf für dieselbe ID ersetzt den vorigen. */
export function registerStep(id:StepId,render:StepRender){renderers.set(id,render)}

const LATER_KEY='mailboard-setup-later'
const stateNames:Record<StepStatus,string>={open:'offen',done:'erledigt',skipped:'übersprungen'}
function make<K extends keyof HTMLElementTagNameMap>(tag:K,text=''){const node=document.createElement(tag);node.textContent=text;return node}
function button(label:string,run:()=>void){const node=make('button',label);node.type='button';node.onclick=run;return node}
function errorText(e:unknown){return e instanceof Error?e.message:String(e)}

export function initSetup(host:SetupHost){
  const live=()=>host.mailbox()==='outlook'
  function load():SetupState{
    if(!live())return freshState()
    try{return parseState(JSON.parse(localStorage.getItem(SETUP_KEY)||'null'))}catch{return freshState()}
  }
  function store(state:SetupState){
    if(!live())return
    try{localStorage.setItem(SETUP_KEY,JSON.stringify(state))}catch{/* Ohne Speicher gilt der Stand nur bis zum Neuzeichnen. */}
  }
  const started=()=>{try{return live()&&localStorage.getItem(SETUP_KEY)!==null}catch{return false}}
  const later=()=>{try{return sessionStorage.getItem(LATER_KEY)==='1'}catch{return laterFallback}}
  let laterFallback=false

  const view=viewPanel('setup','Einrichtung');view.classList.add('setup-view')
  let token=0
  document.addEventListener('mailboard:view',event=>{if((event as CustomEvent).detail==='setup')render();else token++})
  document.addEventListener('mailboard:source-changed',()=>{if(currentView()==='setup')render()})

  function open(){showView('setup',true)}
  function go(state:SetupState,step:StepId){state.step=step;store(state);render();view.querySelector<HTMLElement>('.setup-step h3')?.focus()}
  function finish(state:SetupState,id:StepId,status:StepStatus){
    state.status[id]=status
    go(state,nextOpen(state,id)??id)
  }

  function render(){
    const mine=++token
    view.replaceChildren(make('h2','Einrichtung'))
    if(!live()){
      view.append(make('p','Die Einrichtung arbeitet mit deinem Outlook-Postfach.'))
      return
    }
    const state=load(),id=state.step,info=stepInfo[id],ai=localAiEnabled()
    view.append(make('p','In sieben Schritten zu sauberen Lernordnern, einem gemessenen Ausgangswert und einem abgearbeiteten Posteingang. Du kannst jederzeit pausieren.'))
    if(isComplete(state)){const done=make('p','Die Einrichtung ist abgeschlossen. Du kannst einzelne Schritte jederzeit erneut öffnen.');done.className='setup-complete';view.append(done)}
    const bar=make('ol');bar.className='setup-steps';bar.setAttribute('aria-label','Schritte der Einrichtung')
    for(const [index,step] of stepIds.entries()){
      const item=make('li'),status=state.status[step]
      const jump=button('',()=>go(load(),step))
      jump.append(make('span',String(index+1)),' '+stepInfo[step].title+' ')
      const badge=make('small',stateNames[status]);badge.className='setup-state'
      jump.append(badge);jump.dataset.status=status
      if(step===id)jump.setAttribute('aria-current','step')
      item.append(jump);bar.append(item)
    }
    const section=make('section');section.className='setup-step'
    const heading=make('h3','Schritt '+(stepIds.indexOf(id)+1)+' · '+info.title);heading.tabIndex=-1
    section.setAttribute('aria-label',heading.textContent||'')
    section.append(heading,make('p',info.text))
    if(info.needsAi&&!ai){
      const note=make('p','Dieser Schritt braucht die lokale KI. Ohne sie kannst du ihn überspringen.');note.className='setup-note';section.append(note)
    }
    const body=make('div');body.className='setup-body'
    const status=make('p');status.setAttribute('role','status');status.className='setup-status'
    section.append(body,status)
    const index=stepIds.indexOf(id)
    const actions=make('div');actions.className='setup-actions'
    actions.append(button('Überspringen',()=>finish(load(),id,'skipped')),
      button('Pausieren',()=>{token++;showView('board',true);showToast('Einrichtung pausiert. Über Werkzeuge → Einrichtung geht es weiter.')}),
      button('Weiter',()=>{const s=load();go(s,stepIds[index+1]??nextOpen(s,id)??id)}))
    actions.lastElementChild!.className='primary'
    view.append(bar,section,actions)
    const fill=renderers.get(id)
    if(!fill)return
    const context:StepContext={id,body,host,ai,state:structuredClone(state),
      save:change=>{const s=load();change(s);store(s)},
      done:()=>{if(mine===token)finish(load(),id,'done')},
      skip:()=>{if(mine===token)finish(load(),id,'skipped')},
      refresh:(message='')=>{if(mine===token){render();view.querySelector('.setup-status')!.textContent=message}},
      status:text=>{if(mine===token)status.textContent=text},
      active:()=>mine===token&&currentView()==='setup'&&live()}
    Promise.resolve().then(()=>fill(context)).catch(e=>context.status(errorText(e)))
  }

  // U3: Hinweis über dem Board nach dem Verbinden, solange keine Lernziele gesetzt sind.
  const hint=make('div');hint.className='setup-hint';hint.setAttribute('role','region');hint.setAttribute('aria-label','Nächster Schritt');hint.hidden=true
  const begin=button('Einrichtung starten',()=>open());begin.className='setup-go'
  hint.append(make('p','Outlook ist verbunden. Die Einrichtung führt dich durch Ordnerwahl, Lernen und Posteingang.'),begin,
    button('Später',()=>{
      try{sessionStorage.setItem(LATER_KEY,'1')}catch{laterFallback=true}
      hint.hidden=true;document.getElementById('board')?.focus()
    }))
  document.querySelector('.board-heading')?.before(hint)
  function refresh(){hint.hidden=!shouldOfferSetup({mailbox:host.mailbox(),learning:getLearningScope(),state:load(),later:later()})}

  return {
    open,
    refresh,
    /** Fortschritt für Start, leer, wenn nichts anzuzeigen ist. */
    progress(){
      if(!live())return ''
      const state=load()
      if(isComplete(state)||(!started()&&getLearningScope()?.length))return ''
      return progressText(state)
    },
  }
}

// E1 Ordner wählen: Tabelle aller Outlook-Ordner mit Board, Lernen und Archiv.
registerStep('E1',ctx=>{
  let folders=ctx.host.folders()
  if(!folders.length){ctx.body.append(make('p','Es sind noch keine Outlook-Ordner geladen. Bitte Outlook aktualisieren.'));return}
  const known=ctx.state.measurements.baseline?.samples||{}
  const chosen=initialScopes(folders,{board:getBoardScope(),learn:getLearningScope(),archive:getArchiveScope()})
  const board=new Set(chosen.board),learn=new Set(chosen.learn)
  let archive=chosen.archive
  const wrap=make('div');wrap.className='setup-table'
  const none=make('label'),noneRadio=make('input');none.className='setup-radio';noneRadio.type='radio';noneRadio.name='setup-archive'
  noneRadio.onchange=()=>{if(noneRadio.checked)archive=''}
  none.append(noneRadio,' Kein Archivordner')
  const create=button('Archivordner anlegen',()=>void createArchive())
  function draw(){
    const table=make('table'),caption=make('caption','Outlook-Ordner')
    const head=table.createTHead().insertRow()
    for(const name of ['Ordner','Mails','Board','Lernen','Archiv']){const th=make('th',name);th.scope='col';head.append(th)}
    const tbody=table.createTBody()
    for(const folder of folders){
      const row=tbody.insertRow(),inbox=!!folder.isInbox||!folder.path,name=inbox?'Posteingang':folder.path
      const title=make('th',name);title.scope='row';row.append(title)
      const count=folder.count??known[folder.path]
      const amount=row.insertCell();amount.textContent=count==null?'–':String(count)
      if(count!=null&&folder.count==null)amount.title='Lernbeispiele aus dem letzten Lernlauf'
      const box=(set:Set<string>,label:string)=>{
        const input=make('input');input.type='checkbox';input.setAttribute('aria-label',label+': '+name)
        input.checked=inbox?label==='Board':set.has(folder.path);input.disabled=inbox
        if(inbox)input.title='Der Posteingang steht immer auf dem Board.'
        input.onchange=()=>{if(input.checked)set.add(folder.path);else set.delete(folder.path)}
        row.insertCell().append(input)
      }
      box(board,'Board');box(learn,'Lernen')
      const radio=make('input');radio.type='radio';radio.name='setup-archive';radio.setAttribute('aria-label','Archiv: '+name)
      radio.disabled=inbox;radio.checked=!inbox&&archive===folder.path
      radio.onchange=()=>{if(radio.checked)archive=folder.path}
      row.insertCell().append(radio)
    }
    table.prepend(caption)
    noneRadio.checked=!archive
    create.hidden=folders.some(f=>/archiv/i.test(f.name))
    wrap.replaceChildren(table)
  }
  async function createArchive(){
    const root=folders.find(f=>f.isInbox)?.parentId??folders.find(f=>f.rootId)?.rootId
    if(!root){ctx.status('Der Postfachstamm ist unbekannt. Bitte Outlook aktualisieren.');return}
    if(!await ctx.host.confirm('Ordner „Archiv“ auf oberster Ebene deines Postfachs anlegen? Er wird als Archiv vorgeschlagen.','Anlegen'))return
    create.disabled=true
    try{
      const created=await createFolder(root,'Archiv')
      if(!ctx.active())return
      folders=[...folders,{...created,parentId:root}];archive=created.path;draw()
      ctx.status('Ordner „Archiv“ angelegt und als Archiv gewählt. Mit „Speichern und weiter“ übernehmen.')
      showToast('Ordner „Archiv“ angelegt')
    }catch(e){ctx.status(errorText(e))}
    finally{create.disabled=false}
  }
  const save=button('Speichern und weiter',()=>{
    try{
      updateConfig({project_folders:[...board],suggestion_folders:[...learn],archive_folder:archive})
      window.dispatchEvent(new Event('mailboard:foldersChanged'))
      ctx.done()
    }catch(e){ctx.status('Die Auswahl konnte nicht gespeichert werden: '+errorText(e))}
  })
  save.className='primary'
  draw()
  // Ein gespeichertes Archiv ohne geladenen Ordner bleibt beim Speichern erhalten. Der Hinweis macht das sichtbar.
  if(archive&&!folders.some(f=>f.path===archive)){
    const kept=make('p','Gespeichertes Archiv „'+archive+'“ ist gerade nicht in der Ordnerliste und bleibt erhalten. Wähle einen anderen Ordner, um es zu ersetzen.')
    kept.className='setup-note';ctx.body.append(kept)
  }
  ctx.body.append(make('p','Vorbelegt: Lernziele sind alle Ordner außer Posteingang, Gesendet, Outlook-Standardordnern und Ordnern mit „_“. Ihre Unterordner und das Archiv samt Unterordnern sind ebenfalls ausgenommen. Als Archiv ist der erste Ordner mit „Archiv“ im Namen gewählt.'),
    wrap,none,create,save)
})

// E2 Lernen und messen: Lernen aus den Lernordnern, danach Testlauf als Ausgangswert.
registerStep('E2',ctx=>{
  const folders=ctx.host.learnerFolders()
  ctx.body.append(make('p',folders.length?folders.length+' Lernordner: '+folders.map(f=>f.path).join(', '):'Wähle zuerst in Schritt 1 mindestens einen Lernordner.'))
  if(!ctx.ai){const note=make('p','Ohne lokale KI lernt und misst das Board nur mit Bayes und festen Regeln.');note.className='setup-note';ctx.body.append(note)}
  const start=button('Lernen und messen',async()=>{
    start.disabled=true
    try{
      const trained=await trainFromFolders(folders,text=>ctx.status(text))
      if(!ctx.active())return
      const measured=await measureLearning(folders,text=>ctx.status(text))
      if(!ctx.active())return
      ctx.save(state=>{state.measurements.baseline=measured;state.status.E2='done'})
      ctx.refresh(trained.failures.length?'Nicht gelesen: '+trained.failures.join(' · '):'Lernen und Messen abgeschlossen.'+measured.note)
    }catch(e){ctx.status(errorText(e))}
    finally{start.disabled=false}
  })
  start.className='primary';start.disabled=!folders.length
  ctx.body.append(start)
  const baseline=ctx.state.measurements.baseline
  if(baseline)renderMeasurement(ctx.body,baseline,'Ausgangswert vom '+baseline.date)
})

/** Trefferquote je Quelle (vorhandene Auswertung) und je Ordner. Ordner unter 10 Mails sind markiert. */
export function renderMeasurement(parent:HTMLElement,measurement:Measurement,heading:string){
  parent.append(make('h4',heading))
  renderEvaluation(parent,measurement.report)
  const table=make('table');table.className='ai-evaluation setup-folders'
  table.append(make('caption','Trefferquote je Ordner'))
  const head=table.createTHead().insertRow()
  for(const name of ['Ordner','Lernmails','Testmails','Vorschläge','Richtig','Trefferquote','Hinweis']){const th=make('th',name);th.scope='col';head.append(th)}
  const body=table.createTBody()
  for(const [folder,samples] of Object.entries(measurement.samples).sort(([a],[b])=>a.localeCompare(b,'de'))){
    const row=body.insertRow(),own=measurement.report.byFolder?.[folder]
    const title=make('th',folder);title.scope='row';row.append(title)
    const few=samples<10
    if(few)row.className='setup-few'
    for(const value of [String(samples),String(own?.tested??0),String(own?.shown??0),String(own?.correct??0),
      own?.shown?Math.round(100*own.correct/own.shown)+' %':'–',few?'Wenige Mails':own?'':'Zu wenige für den Test'])row.insertCell().textContent=value
  }
  parent.append(table)
  if(measurement.note)parent.append(make('p',measurement.note.trim()))
}
