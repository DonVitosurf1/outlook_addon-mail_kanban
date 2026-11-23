/**
 * E6 Neu lernen und vergleichen: wiederholt das Lernen und Messen aus E2 mit den bereinigten Ordnern, den ausgeschlossenen
 * Ausreißern (E3) und den neuen Steckbriefen (E5). Das Ergebnis liegt unter `measurements.after`, der Ausgangswert bleibt unberührt.
 * Die Vergleichstabelle (`compareMeasurements`) zeigt je Quelle und je Ordner Ausgangswert, jetzt und die Differenz in Prozentpunkten.
 * Ordner mit schlechterer Trefferquote sind hervorgehoben (Farbe für „fällig“) und tragen zusätzlich den Text „schlechter“.
 */
import {measureLearning, trainFromFolders} from './ai'
import {registerStep} from './setup'
import {compareMeasurements, diffText, type CompareRow} from './setup-logic'

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

registerStep('E6',ctx=>{
  const folders=ctx.host.learnerFolders()
  const baseline=ctx.state.measurements.baseline,after=ctx.state.measurements.after
  ctx.body.append(make('p',baseline?'Ausgangswert vom '+baseline.date+'. Neu gelernt wird mit '+folders.length+' Lernordnern, ohne ausgeschlossene Mails und mit deinen übernommenen Steckbriefen.'
    :'Es gibt noch keinen Ausgangswert. Miss zuerst in Schritt 2.'))
  const start=make('button',after?'Erneut lernen und vergleichen':'Neu lernen und vergleichen');start.type='button';start.className='primary'
  start.disabled=!folders.length||!baseline
  start.onclick=async()=>{
    start.disabled=true
    try{
      const trained=await trainFromFolders(folders,text=>ctx.status(text))
      if(!ctx.active())return
      const measured=await measureLearning(folders,text=>ctx.status(text))
      if(!ctx.active())return
      ctx.save(state=>{state.measurements.after=measured})
      ctx.refresh(trained.failures.length?'Nicht gelesen: '+trained.failures.join(' · '):'Neu gelernt und gemessen.'+measured.note)
    }catch(e){ctx.status(errorText(e))}
    finally{start.disabled=false}
  }
  ctx.body.append(start)
  if(baseline&&after){
    const result=compareMeasurements(baseline,after),worse=result.folders.filter(r=>r.worse).length
    ctx.body.append(make('h4','Vergleich mit dem Ausgangswert vom '+baseline.date+' · jetzt '+after.date),
      make('p',worse?worse+(worse===1?' Ordner ist':' Ordner sind')+' schlechter geworden. Prüfe dort die Lernmails oder den Steckbrief.':'Kein Ordner ist schlechter geworden.'),
      table('Trefferquote je Quelle','Quelle',result.sources),table('Trefferquote je Ordner','Ordner',result.folders))
    if(after.note)ctx.body.append(make('p',after.note.trim()))
    const finish=make('button','Schritt abschließen');finish.type='button';finish.className='primary';finish.onclick=()=>ctx.done()
    ctx.body.append(finish)
  }
})
