/**
 * E3 Ausreißer prüfen: je Lernordner die Lernmails, die besser zu einem anderen Lernordner passen.
 * Gelesen wird wie beim Lernen (`trainingMails`). Erkannt wird mit Embeddings (`ai_outliers`), ohne sie mit Bayes (Leave-one-out).
 * Je Mail und als Stapel je Ordner:
 * - „Verschieben nach X“: Move-Weg des Boards (`host.moveMails`) mit Bestätigung, Undo und `recordFiling`,
 * - „Bleibt hier“: Kennung in `SetupState.confirmed`, wird nie wieder gemeldet,
 * - „Nicht lernen“: `excludeFromLearning` (`mailboard-learn-excluded-v1`).
 * Ordner mit mehr als 25 % Ausreißern speichert der Prüflauf als Kandidaten für E4 in `SetupState.outlierFolders`.
 * Das Prüfergebnis selbst (Betreff, Absender) bleibt nur im Speicher dieser Sitzung.
 */
import {embeddingId, embeddingOutliers, embeddingsEnabled, excludeFromLearning, features, trainingMails} from './ai'
import type {Folder} from './live'
import {BAYES_MARGIN, EMBEDDING_MARGIN, bayesOutliers, openOutliers, outlierFolders, type Outlier, type OutlierFolder} from './outliers'
import {registerStep, type OffBoardMail, type StepContext} from './setup'

type Finding=Outlier&{mail:OffBoardMail}
type Scan={stamp:string;method:string;note:string;totals:Record<string,number>;findings:Finding[]}
/** Letzter Prüflauf dieser Sitzung. Entscheidungen nehmen Mails daraus heraus. */
let scan:Scan|undefined
const opened=new Set<string>()

function make<K extends keyof HTMLElementTagNameMap>(tag:K,text=''){const node=document.createElement(tag);node.textContent=text;return node}
function button(label:string,run:()=>void,aria?:string){
  const node=make('button',label);node.type='button';node.onclick=run
  if(aria)node.setAttribute('aria-label',aria)
  return node
}
function errorText(e:unknown){return e instanceof Error?e.message:String(e)}
const stampOf=(folders:Folder[])=>JSON.stringify(folders.map(f=>[f.id,f.path]).sort())
const keyOf=(folder:string,id:string)=>JSON.stringify([folder,id])
const number=(n:number)=>n.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})
const percent=(part:number,total:number)=>Math.round(100*part/total)+' %'
const quoted=(f:Finding)=>'„'+(f.mail.subject||'(ohne Betreff)')+'“'

async function check(ctx:StepContext,folders:Folder[]):Promise<Scan>{
  const read=await trainingMails(folders,text=>ctx.status(text))
  const groups=read.flatMap(r=>r.mails?[{folder:r.folder,mails:r.mails}]:[])
  const failures=read.flatMap(r=>r.mails?[]:[r.folder.path+': '+r.error])
  // Verschieben braucht die Outlook-ID der Mail und ihren Quellordner.
  const mails=new Map<string,OffBoardMail>()
  for(const g of groups)for(const m of g.mails)if(m.id)mails.set(keyOf(g.folder.path,embeddingId(m)),{...m,id:m.id,folderId:g.folder.id})
  let found:Outlier[]|undefined,method='Bayes',note=''
  if(embeddingsEnabled()){
    ctx.status('Vergleiche die Lernmails mit den Ordnerprofilen …')
    try{found=await embeddingOutliers(groups.map(g=>({key:g.folder.path,mails:g.mails})),EMBEDDING_MARGIN);method='Embeddings'}
    catch(e){note='Embeddings nicht verfügbar, geprüft wurde mit Bayes. '+errorText(e)}
  }
  // Kein Bayes-Ersatz für ein inzwischen gewechseltes Postfach.
  if(ctx.host.mailbox()!=='outlook')throw new Error('Für die Ausreißerprüfung bitte das Outlook-Postfach öffnen.')
  found??=bayesOutliers(groups.flatMap(g=>g.mails.map(m=>({folder:g.folder.path,id:embeddingId(m),features:features(m)}))),BAYES_MARGIN)
  const findings=found.flatMap(o=>{const mail=mails.get(keyOf(o.folder,o.id));return mail?[{...o,mail}]:[]})
  if(failures.length)note=(note?note+' ':'')+'Nicht gelesen: '+failures.join(' · ')
  return {stamp:stampOf(folders),method,note,totals:Object.fromEntries(groups.map(g=>[g.folder.path,g.mails.length])),findings}
}

registerStep('E3',ctx=>{
  if(ctx.host.mailbox()!=='outlook')scan=undefined
  const folders=ctx.host.learnerFolders()
  ctx.body.append(make('p','Das Board liest die Lernmails jedes Lernordners und meldet Mails, die deutlich besser zu einem anderen Lernordner passen.'))
  if(!folders.length){ctx.body.append(make('p','Wähle zuerst in Schritt 1 mindestens einen Lernordner.'));return}
  const embeddings=embeddingsEnabled()
  const method=make('p',embeddings?'Verglichen wird mit den Embeddings der lokalen KI: eigener Ordner ohne die Mail gegen den ähnlichsten anderen Ordner.'
    :'Ohne Embeddings prüft das Board mit Bayes nach Absender, Betreff und Unterhaltung.')
  if(!embeddings)method.className='setup-note'
  const current=scan?.stamp===stampOf(folders)?scan:undefined
  const start=button(current?'Neu prüfen':'Ausreißer suchen',async()=>{
    start.disabled=true
    try{
      const result=await check(ctx,folders)
      // Das Ergebnis bleibt auch erhalten, wenn die Ansicht inzwischen verlassen wurde (`trainingMails` bricht beim Postfachwechsel ab).
      scan=result
      ctx.save(state=>{
        state.outlierFolders=outlierFolders(result.totals,openOutliers(result.findings,state.confirmed))
        state.status.E3='done'
      })
      if(!ctx.active())return
      ctx.refresh('Prüfung abgeschlossen ('+result.method+').'+(result.note?' '+result.note:''))
    }catch(e){ctx.status(errorText(e))}
    finally{start.disabled=false}
  })
  start.className='primary'
  const list=make('div');list.className='setup-outliers'
  ctx.body.append(method,start,list)
  if(current)draw(current,ctx.state.outlierFolders)

  function draw(result:Scan,candidates:OutlierFolder[],focusFolder?:string){
    const open=openOutliers(result.findings,ctx.state.confirmed)
    const byFolder=new Map<string,Finding[]>()
    for(const f of open){const items=byFolder.get(f.folder)??[];items.push(f);byFolder.set(f.folder,items)}
    const many=new Map(candidates.map(c=>[c.folder,c]))
    list.replaceChildren(make('p',open.length?open.length+' verdächtige '+(open.length===1?'Mail':'Mails')+' in '+byFolder.size+' '+(byFolder.size===1?'Ordner':'Ordnern')+'. Die deutlichsten stehen oben.'
      :'Keine verdächtigen Mails offen.'))
    if(candidates.length){
      const note=make('p','Viele Ausreißer, Kandidaten für Schritt 4: '+candidates.map(c=>c.folder+' ('+percent(c.outliers,c.total)+')').join(', '))
      note.className='setup-note';list.append(note)
    }
    const order=[...byFolder.keys()].sort((a,b)=>byFolder.get(b)!.length/(result.totals[b]||1)-byFolder.get(a)!.length/(result.totals[a]||1)||a.localeCompare(b,'de'))
    if(!opened.size&&order[0])opened.add(order[0])
    for(const folder of order){
      const items=byFolder.get(folder)!,total=result.totals[folder]||items.length
      const details=make('details');details.className='setup-outlier-folder';details.open=opened.has(folder);details.dataset.folder=folder
      details.ontoggle=()=>{if(details.open)opened.add(folder);else opened.delete(folder)}
      const summary=make('summary',folder+' · '+items.length+' von '+total+' Lernmails verdächtig ('+percent(items.length,total)+')')
      if(many.has(folder)){details.classList.add('setup-many');summary.append(make('strong',' · viele Ausreißer, Kandidat für Schritt 4'))}
      const batch=make('div');batch.className='setup-outlier-batch';batch.setAttribute('role','group');batch.setAttribute('aria-label','Alle in '+folder)
      for(const target of [...new Set(items.map(i=>i.suggested))]){
        const group=items.filter(i=>i.suggested===target)
        batch.append(button('Alle '+group.length+' nach „'+target+'“ verschieben',()=>void move(group,target)))
      }
      batch.append(button('Alle bleiben hier',()=>stay(items)),button('Alle nicht lernen',()=>exclude(items)))
      const rows=make('ul');rows.className='setup-outlier-list'
      for(const item of items){
        const row=make('li'),title=quoted(item)
        const info=make('small',[item.mail.sender,item.mail.received?new Date(item.mail.received).toLocaleDateString('de-DE'):'',
          'passt zu „'+item.suggested+'“: '+number(item.other)+' statt '+number(item.own)].filter(Boolean).join(' · '))
        const actions=make('div');actions.className='setup-outlier-actions'
        actions.append(button('Verschieben nach „'+item.suggested+'“',()=>void move([item],item.suggested),'Verschieben nach „'+item.suggested+'“: '+title),
          button('Bleibt hier',()=>stay([item]),'Bleibt hier: '+title),
          button('Nicht lernen',()=>exclude([item]),'Nicht lernen: '+title))
        row.append(make('strong',title),info,actions)
        rows.append(row)
      }
      details.append(summary,batch,rows)
      list.append(details)
    }
    if(focusFolder!==undefined){
      const target=[...list.querySelectorAll<HTMLDetailsElement>('details')].find(d=>d.dataset.folder===focusFolder)
      ;(target?.querySelector<HTMLElement>('li button')??target?.querySelector('summary')??start).focus()
    }
  }
  function settle(items:Finding[],message:string){
    const done=new Set(items)
    if(scan)scan.findings=scan.findings.filter(f=>!done.has(f))
    if(!ctx.active()||!scan)return
    draw(scan,ctx.state.outlierFolders,items[0]?.folder)
    ctx.status(message)
  }
  const names=(items:Finding[])=>items.length===1?quoted(items[0]):items.length+' Mails'
  async function move(items:Finding[],path:string){
    const target=ctx.host.learnerFolders().find(f=>f.path===path)
    if(!target){ctx.status('Der Ordner „'+path+'“ ist nicht mehr geladen. Bitte Outlook aktualisieren.');return}
    const done=new Set<string>()
    await ctx.host.moveMails(items.map(i=>i.mail),target.id,id=>done.add(id))
    const moved=items.filter(i=>done.has(i.mail.id))
    if(!moved.length)return
    ctx.save(state=>{for(const i of moved)state.outliers[i.id]={folder:i.folder,decision:'moved',target:path}})
    settle(moved,names(moved)+' nach „'+path+'“ verschoben.')
  }
  function stay(items:Finding[]){
    ctx.save(state=>{
      state.confirmed=[...new Set([...state.confirmed,...items.map(i=>i.id)])]
      for(const i of items)state.outliers[i.id]={folder:i.folder,decision:'stay'}
    })
    ctx.state.confirmed.push(...items.map(i=>i.id))
    settle(items,names(items)+' '+(items.length===1?'bleibt':'bleiben')+' hier und '+(items.length===1?'wird':'werden')+' nicht mehr gemeldet.')
  }
  function exclude(items:Finding[]){
    excludeFromLearning(items.map(i=>i.mail))
    ctx.save(state=>{for(const i of items)state.outliers[i.id]={folder:i.folder,decision:'exclude'}})
    settle(items,names(items)+' '+(items.length===1?'wird':'werden')+' nicht mehr zum Lernen verwendet.')
  }
})
