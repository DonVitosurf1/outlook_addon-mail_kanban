/**
 * E7 Posteingang abarbeiten: liest alle Posteingangsmails ohne Status seitenweise (`outlook_backlog` mit Grenze und Fortsetzungspunkt,
 * bis 2.000, `readBacklog`) und teilt sie ohne Modellaufruf ein (`classifyBacklog`):
 * - sicher (`trustedFolderBatch`): Stapel je Zielordner mit aufklappbarer Betreffliste, „Stapel ablegen“ über den Move-Weg des Boards
 *   (`host.moveMails`: Bestätigung, ein Rückgängig-Schritt je Stapel),
 * - unsicher (`likelyFolderBatch`): „Einzeln durchgehen“ öffnet „Posteingang aufräumen“ mit genau diesen Mails (`host.review`),
 * - ohne Ziel: Mails älter als die Altersgrenze (Monate, `SetupState.data.E7.months`, Standard 3) als Sammelangebot fürs Archiv,
 *   ein Rückgängig-Schritt. Ohne Archivordner gibt es einen Hinweis mit Sprung zu Schritt 1. Jüngere bleiben im Posteingang.
 * Gelesene Mails bleiben nur im Speicher dieser Sitzung. „Einrichtung abschließen“ markiert den Schritt als erledigt (vor dem ersten Lesen
 * mit Rückfrage).
 * Wird ein Stapel oder das Archivangebot zurückgenommen (Rückmeldung oder Strg+Z), zeigt die Ansicht einen Hinweis auf „Neu lesen“. Die Mails
 * haben nach der Rücknahme neue Outlook-IDs, deshalb liest der Schritt nicht selbst neu: das wären bis zu acht Outlook-Aufrufe direkt nach der
 * Rücknahme, auch wenn du gerade woanders arbeitest.
 */
import {likelyFolderBatch, trustedFolderBatch} from './ai'
import {BACKLOG_MAX, archiveMonths, classifyBacklog, readBacklog, splitByAge, type BacklogPage} from './backlog'
import type {Folder} from './live'
import {getArchiveScope} from './projects'
import {registerStep, type OffBoardMail, type StepContext} from './setup'
import type {SetupState} from './setup-logic'
import type {ViewMail} from './views-logic'

/** Karte aus `outlook_backlog`. */
type BacklogMail=OffBoardMail&ViewMail&{hasStatus?:boolean}
type Classes=ReturnType<typeof classifyBacklog<BacklogMail>>
/** Letzter Lesevorgang dieser Sitzung. `gone` sind abgelegte Mails, `stamp` die Lernordner der Einteilung. */
let read:{mails:BacklogMail[];inbox:string;stamp:string;classes:Classes;end:'complete'|'max'|'partial';gone:Set<string>;undone?:boolean}|undefined
/** Zuletzt gezeichnete Ansicht, für den Hinweis nach einer Rücknahme. */
let view:StepContext|undefined
const UNDONE='Zurückgenommen. Mit „Neu lesen“ siehst du die Mails wieder.'
let reading=false
type Section='safe'|'unsure'|'none'
let focusSection:Section|undefined
const opened=new Set<string>()
document.addEventListener('mailboard:source-changed',()=>{read=undefined;opened.clear()})

function make<K extends keyof HTMLElementTagNameMap>(tag:K,text=''){const node=document.createElement(tag);node.textContent=text;return node}
function button(label:string,run:()=>void,aria?:string){
  const node=make('button',label);node.type='button';node.onclick=run
  if(aria)node.setAttribute('aria-label',aria)
  return node
}
function errorText(e:unknown){return e instanceof Error?e.message:String(e)}
const mails=(n:number)=>n===1?'1 Mail':n.toLocaleString('de-DE')+' Mails'
const quoted=(text:string)=>'„'+text+'“'
const stampOf=(folders:Folder[])=>JSON.stringify(folders.map(f=>f.path).sort())
function monthsOf(state:SetupState){return archiveMonths((state.data.E7 as {months?:unknown}|undefined)?.months)}
function classify(list:BacklogMail[],folders:Folder[]){
  const paths=folders.map(f=>f.path)
  return classifyBacklog(list,trustedFolderBatch(paths),likelyFolderBatch(paths),paths)
}

registerStep('E7',ctx=>{
  view=ctx
  const service=ctx.host.service()
  if(!service){ctx.body.append(make('p','Bitte das Outlook-Postfach laden.'));return}
  const learners=ctx.host.learnerFolders()
  ctx.body.append(make('p','Das Board liest alle Posteingangsmails ohne Status, älteste zuerst, bis zu '+BACKLOG_MAX.toLocaleString('de-DE')+
    '. Es teilt sie ohne KI-Aufruf ein: sichere Vorschläge, unsichere Vorschläge und Mails ohne Ziel. Jede Änderung bestätigst du, Rückgängig nimmt sie zurück.'))
  if(!learners.length){
    const note=make('p','Ohne Lernordner gibt es keine Ablagevorschläge. Alle Mails zählen dann als „ohne Ziel“.');note.className='setup-note';ctx.body.append(note)
  }
  const start=button(read?'Neu lesen':'Posteingang lesen',()=>void load())
  start.className='primary';start.disabled=reading
  ctx.body.append(start)
  if(read&&read.stamp!==stampOf(learners)){read.classes=classify(read.mails,learners);read.stamp=stampOf(learners)}
  if(read)draw(read)
  const finish=button('Einrichtung abschließen',()=>void (async()=>{
    if(!read&&!await ctx.host.confirm('Posteingang noch nicht gelesen. Trotzdem abschließen?','Abschließen'))return
    if(ctx.active())ctx.done()
  })())
  const end=make('div');end.className='setup-inbox-end';end.append(finish)
  ctx.body.append(end)

  async function load(){
    if(reading)return
    reading=true;start.disabled=true
    try{
      const answer=await readBacklog((limit,cursor)=>service!.json<BacklogPage<BacklogMail>>('outlook_backlog',{limit,...(cursor?{cursor}:{})}),
        n=>ctx.status('Posteingang wird gelesen: '+mails(n)+' ohne Status …'),()=>ctx.host.mailbox()!=='outlook')
      if(!answer)return
      const list=answer.mails
      const inbox=ctx.host.folders().find(f=>f.isInbox)?.id??list[0]?.folderId??''
      const usable=list.filter(m=>m.id&&m.folderId)
      const folders=ctx.host.learnerFolders()
      ctx.status('Mails werden eingeteilt …')
      const classes=classify(usable,folders)
      read={mails:usable,inbox,stamp:stampOf(folders),classes,end:answer.end,gone:new Set()}
      opened.clear();focusSection='safe'
      const safe=[...classes.safe.values()].reduce((n,l)=>n+l.length,0)
      ctx.refresh(usable.length?mails(usable.length)+' gelesen: '+safe+' sicher, '+classes.unsure.length+' unsicher, '+classes.none.length+' ohne Ziel.'
        :'Im Posteingang liegen keine Mails ohne Status.')
    }catch(e){ctx.status(errorText(e))}
    finally{reading=false;start.disabled=false}
  }

  function draw(current:NonNullable<typeof read>){
    // Abgelegte, inzwischen verschobene oder mit Status versehene Mails fallen heraus.
    const alive=(m:BacklogMail)=>!current.gone.has(m.id)&&m.folderId===current.inbox&&m.hasStatus===false&&m.status!=='Erledigt'
    const safe=[...current.classes.safe].map(([path,list])=>[path,list.filter(alive)] as const).filter(([,list])=>list.length)
      .sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0],'de'))
    const unsure=current.classes.unsure.filter(alive),none=current.classes.none.filter(alive)
    const total=safe.reduce((n,[,l])=>n+l.length,0)+unsure.length+none.length
    const summary=make('p',total?mails(total)+' ohne Status im Posteingang.':'Keine Mails ohne Status mehr im Posteingang.')
    if(current.end==='max')summary.textContent+=' Gelesen wurden die ältesten '+BACKLOG_MAX.toLocaleString('de-DE')+'. Nach dem Abarbeiten liest „Neu lesen“ die nächsten.'
    // Seitengrenze erreicht (sehr viele Mails mit Status oder Erledigte): ehrlich sagen, dass nicht alles gelesen ist.
    if(current.end==='partial')summary.textContent+=' Nur teilweise gelesen: Im Posteingang liegen sehr viele Mails mit Status oder Erledigte. Gelesen wurden die ältesten '+
      mails(current.mails.length)+' ohne Status. Nach dem Abarbeiten liest „Neu lesen“ weitere.'
    ctx.body.append(summary)
    if(current.undone){const note=make('p',UNDONE);note.className='setup-note';ctx.body.append(note)}
    const sections:Record<Section,HTMLElement>={safe:make('section'),unsure:make('section'),none:make('section')}
    const heading=(section:Section,title:string)=>{
      const h=make('h4',title);h.tabIndex=-1;h.id='setup-inbox-'+section
      sections[section].className='setup-inbox';sections[section].setAttribute('aria-labelledby',h.id);sections[section].append(h)
    }

    heading('safe','Sichere Vorschläge')
    if(!safe.length)sections.safe.append(make('p','Keine sicheren Vorschläge.'))
    else{
      const list=make('ul');list.className='setup-stacks'
      for(const [path,items] of safe){
        const row=make('li'),details=make('details'),subjects=make('ul'),title=mails(items.length)+' nach '+quoted(path)
        details.open=opened.has(path);details.ontoggle=()=>{if(details.open)opened.add(path);else opened.delete(path)}
        for(const m of items)subjects.append(make('li',m.subject||'(ohne Betreff)'))
        details.append(make('summary',title),subjects)
        row.append(details,button('Stapel ablegen',()=>void file(items,path),'Stapel ablegen: '+title))
        list.append(row)
      }
      sections.safe.append(list)
    }

    heading('unsure','Unsichere Vorschläge')
    sections.unsure.append(make('p',unsure.length?mails(unsure.length)+(unsure.length===1?' hat':' haben')+' einen Vorschlag ohne hohe Sicherheit. Du prüfst sie einzeln.':'Keine unsicheren Vorschläge.'))
    if(unsure.length)sections.unsure.append(button('Einzeln durchgehen',()=>ctx.host.review(unsure,()=>{
      focusSection='unsure'
      if(ctx.active())ctx.refresh()
    })))

    heading('none','Ohne Ziel')
    const field=make('label'),input=make('input')
    field.className='setup-months';input.type='number';input.min='1';input.max='120';input.step='1';input.value=String(monthsOf(ctx.state))
    field.append('Älter als ',input,' Monate')
    const offer=make('div')
    input.onchange=()=>{
      const months=archiveMonths(input.value)
      input.value=String(months)
      ctx.save(state=>{state.data.E7={...(state.data.E7 as object|undefined),months}})
      ctx.state.data.E7={months}
      fill(months)
    }
    function fill(months:number){
      const {old,young}=splitByAge(none,months)
      offer.replaceChildren(make('p',none.length?mails(none.length)+' ohne Ablagevorschlag. Älter als '+months+(months===1?' Monat: ':' Monate: ')+old.length+
        '. '+(young.length===1?'1 jüngere bleibt':young.length+' jüngere bleiben')+' im Posteingang.':'Keine Mails ohne Ziel.'))
      if(!old.length)return
      const path=getArchiveScope(),archive=path?ctx.host.folders().find(f=>f.path===path):undefined
      if(archive){offer.append(button(mails(old.length)+' ins Archiv verschieben',()=>void file(old,path,true),mails(old.length)+' ins Archiv '+quoted(path)+' verschieben'));return}
      const note=make('p',path?'Der Archivordner '+quoted(path)+' ist gerade nicht geladen. Bitte Outlook aktualisieren oder in Schritt 1 einen anderen wählen.'
        :'Es ist kein Archivordner gewählt. Lege ihn in Schritt 1 fest.')
      note.className='setup-note'
      offer.append(note,button('Zu Schritt 1: Ordner wählen',()=>ctx.go('E1')))
    }
    fill(monthsOf(ctx.state))
    sections.none.append(field,offer)
    ctx.body.append(sections.safe,sections.unsure,sections.none)
    if(focusSection){document.getElementById('setup-inbox-'+focusSection)?.focus();focusSection=undefined}
  }

  async function file(items:BacklogMail[],path:string,archive=false){
    const target=ctx.host.folders().find(f=>f.path===path)
    if(!target){ctx.status('Der Ordner '+quoted(path)+' ist nicht mehr geladen. Bitte Outlook aktualisieren.');return}
    const current=read,moved:string[]=[]
    const problem=await ctx.host.moveMails(items,target.id,id=>moved.push(id))
    if(!moved.length){if(problem)ctx.status('Nicht verschoben. '+problem);return}
    for(const id of moved)current?.gone.add(id)
    ctx.host.afterUndo(()=>{
      if(!current||read!==current)return
      current.undone=true
      if(view?.active())view.refresh(UNDONE)
    })
    if(!archive)opened.delete(path)
    focusSection=archive?'none':'safe'
    const text=(archive?mails(moved.length)+' ins Archiv '+quoted(path)+' verschoben.':mails(moved.length)+' nach '+quoted(path)+' abgelegt.')+(problem?' '+problem:'')
    if(ctx.active())ctx.refresh(text)
  }
})
