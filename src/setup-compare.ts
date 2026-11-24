/**
 * E6 Neu lernen und vergleichen: wiederholt das Lernen und Messen aus E2 mit den bereinigten Ordnern, den ausgeschlossenen
 * Ausreißern (E3) und den neuen Steckbriefen (E5). Das Ergebnis liegt unter `measurements.after`, der Ausgangswert bleibt unberührt.
 * Die Vergleichstabelle (`compareMeasurements`) zeigt je Quelle und je Ordner Ausgangswert, jetzt und die Differenz in Prozentpunkten.
 * Ordner mit schlechterer Trefferquote sind hervorgehoben (Farbe für „fällig“) und tragen zusätzlich den Text „schlechter“.
 * Verlässt du den Schritt vor Messende, läuft das Lernen weiter und das Ergebnis wird trotzdem gespeichert. Steht der Schritt dann
 * nicht mehr offen, meldet eine Rückmeldung das Ende. Beim erneuten Öffnen während des Laufs ist der Knopf gesperrt.
 */
import {measureLearning, trainFromFolders} from './ai'
import {currentLearningRun, learningRunNote, registerStep, setLearningRun, type StepContext} from './setup'
import {showToast} from './toast'
import {compareMeasurements, diffText, folderSetChange, measuredFolders, type CompareRow} from './setup-logic'

function make<K extends keyof HTMLElementTagNameMap>(tag:K,text=''){const node=document.createElement(tag);node.textContent=text;return node}
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e)
const percent=(n:number|null)=>n==null?'–':n+' %'

function table(caption:string,first:string,rows:CompareRow[]){
  const node=make('table');node.className='setup-compare'
  node.append(make('caption',caption))
  const head=node.createTHead().insertRow()
  for(const name of [first,'Ausgangswert','Jetzt','Differenz','Hinweis']){const th=make('th',name);th.scope='col';head.append(th)}
  const body=node.createTBody()
  for(const row of rows){
    const tr=body.insertRow(),title=make('th',row.name);title.scope='row';tr.append(title)
    if(row.worse)tr.className='setup-worse'
    for(const value of [percent(row.before),percent(row.after),diffText(row.diff),row.hint])tr.insertCell().textContent=value
  }
  return node
}

/** Zuletzt gezeichnete Ansicht von E6. `active()` ist nur wahr, solange sie angezeigt wird. */
let view:StepContext|undefined

registerStep('E6',ctx=>{
  view=ctx
  const folders=ctx.host.learnerFolders()
  const baseline=ctx.state.measurements.baseline,after=ctx.state.measurements.after
  ctx.body.append(make('p',baseline?'Ausgangswert vom '+baseline.date+'. Neu gelernt wird mit '+folders.length+' Lernordnern, ohne ausgeschlossene Mails und mit deinen übernommenen Steckbriefen.'
    :'Es gibt noch keinen Ausgangswert. Miss zuerst in Schritt 2.'))
  const start=make('button',after?'Erneut lernen und vergleichen':'Neu lernen und vergleichen');start.type='button';start.className='primary'
  const running=currentLearningRun()
  start.disabled=!!running||!folders.length||!baseline
  if(running==='E6'){start.textContent='Lernen und Messen läuft …';ctx.status('Neu lernen und vergleichen läuft noch. Das Ergebnis erscheint hier.')}
  else if(running==='E2')ctx.status(learningRunNote('E2'))
  start.onclick=async()=>{
    if(currentLearningRun())return
    setLearningRun('E6');start.disabled=true
    // Fortschritt in die gerade angezeigte Ansicht von E6, sonst nirgends.
    const report=(text:string)=>{if(view?.active())view.status(text)}
    try{
      const trained=await trainFromFolders(folders,report)
      const measured=await measureLearning(folders,report)
      ctx.save(state=>{state.measurements.after={...measured,folders:folders.map(f=>f.path)}})
      setLearningRun(undefined)
      const message=trained.failures.length?'Nicht gelesen: '+trained.failures.join(' · '):'Neu gelernt und gemessen.'+measured.note
      if(view?.active())view.refresh(message)
      else showToast('Neu lernen und vergleichen ist fertig. Das Ergebnis steht in Schritt 6 der Einrichtung.')
    }catch(e){
      setLearningRun(undefined)
      if(view?.active())view.refresh(errorText(e))
      else showToast('Neu lernen und vergleichen ist abgebrochen. '+errorText(e))
    }
  }
  ctx.body.append(start)
  if(baseline&&after){
    const result=compareMeasurements(baseline,after),worse=result.folders.filter(r=>r.worse).length
    ctx.body.append(make('h4','Vergleich mit dem Ausgangswert vom '+baseline.date+' · jetzt '+after.date),
      make('p',worse?worse+(worse===1?' Ordner ist':' Ordner sind')+' schlechter geworden. Prüfe dort die Lernmails oder den Steckbrief.':'Kein Ordner ist schlechter geworden.'),
      table('Trefferquote je Quelle','Quelle',result.sources),table('Trefferquote je Ordner','Ordner',result.folders))
    // Andere Lernordner als beim Ausgangswert oder seit dieser Messung: die Zahlen sind nur bedingt vergleichbar.
    const since=folderSetChange(measuredFolders(baseline),measuredFolders(after))
    const now=folderSetChange(measuredFolders(after),folders.map(f=>f.path).sort((a,b)=>a.localeCompare(b,'de')))
    for(const text of [since&&'Die Lernordner unterscheiden sich vom Ausgangswert ('+since+'). Die Werte sind nur bedingt vergleichbar.',
      now&&'Die Lernordner haben sich seit dieser Messung geändert ('+now+'). „Erneut lernen und vergleichen“ misst mit den aktuellen.']){
      if(!text)continue
      const note=make('p',text);note.className='setup-note';ctx.body.append(note)
    }
    if(after.note)ctx.body.append(make('p',after.note.trim()))
    const finish=make('button','Schritt abschließen');finish.type='button';finish.className='primary';finish.onclick=()=>ctx.done()
    ctx.body.append(finish)
  }
})
