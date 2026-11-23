import {categoryColor} from './category-colors'
import {dueReasons, FOCUS_TAG, localDay, matchesSplit, type ViewMail} from './views-logic'

type Mail = ViewMail & {aiSummary?:string;hasStatus?:boolean}
/** Fortschritt eines Vorgangs mit Checkliste, zu dem die Mail gehört. */
export type CaseState = {name:string;tag:string;done:number;total:number}
const same=(a:string,b:string)=>a.localeCompare(b,'de',{sensitivity:'base'})===0
/** Pille oben auf der Karte. Die Reihenfolge entspricht der Dringlichkeit. */
function flag(text:string,kind:string,title=''){
  const pill=node('span',text,'card-flag flag-'+kind)
  if(title)pill.title=title
  return pill
}
/** Fußzeile mit Kategorien links und Zählern rechts, wie Avatare und Zähler der Vorlage. */
function cardFoot(card:HTMLElement){
  let foot=card.querySelector<HTMLElement>(':scope > .card-foot')
  if(!foot){foot=node('span','','card-foot');card.append(foot)}
  return foot
}
/** Liefert den Bereich für Kennzeichen oben bzw. Zähler unten, legt ihn bei Bedarf an. */
export function cardRow(card:HTMLElement,kind:'flags'|'counters'){
  const parent=kind==='flags'?card:cardFoot(card)
  let row=parent.querySelector<HTMLElement>(':scope > .card-'+kind)
  if(!row){
    row=node('span','','card-'+kind)
    if(kind==='flags')card.prepend(row);else parent.append(row)
  }
  return row
}
export function counter(text:string,label:string,kind:string){
  const pill=node('span',text,'card-count count-'+kind)
  pill.setAttribute('aria-label',label);pill.title=label
  return pill
}
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text:string,style=''){
  const element=document.createElement(tag)
  element.textContent=text
  if(style)element.className=style
  return element
}
const clock = new Intl.DateTimeFormat('de-DE',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
const shortDate = new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit'})
const datedYear = new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'})
const dateAndTime = new Intl.DateTimeFormat('de-DE',{dateStyle:'long',timeStyle:'medium'})
function compactDate(date:Date,now:Date){
  return (date.getFullYear()===now.getFullYear()?shortDate:datedYear).format(date)
}
export function receivedLabel(timestamp:string,now=new Date()){
  const date=new Date(timestamp)
  if(!Number.isFinite(date.getTime()))return ''
  return localDay(now)===localDay(date)?clock.format(date):compactDate(date,now)
}
function calendarDate(iso:string,now:Date){
  // Follow-up, snooze and deadline store a calendar day, independently of the mail's time zone.
  const date=new Date(iso.slice(0,10)+'T12:00:00')
  return Number.isFinite(date.getTime())?compactDate(date,now):iso
}
export function cardDates(mail:Mail,overdueDays:number,now=new Date()){
  const today=localDay(now)
  const due=dueReasons(mail,today,overdueDays)
  const attention:string[]=[],scheduled:string[]=[]
  if(mail.replyEvidence)attention.push('Antwort von '+mail.replyEvidence.sender)
  else if(due.includes('Antwort ist da'))attention.push('Antwort eingegangen')
  if(mail.followUp){
    const date=calendarDate(mail.followUp,now)
    if(due.includes('Nachfassen'))attention.push(mail.followUp.slice(0,10)===today?'Heute nachfassen':'Nachfassen seit '+date+' fällig')
    else scheduled.push('Nachfassen am '+date)
  }else if(due.includes('Überfällig'))attention.push('Nachfassen überfällig')
  if(mail.snoozeUntil){
    if(due.includes('Wiedervorlage'))attention.push('Heute zur Wiedervorlage')
    else scheduled.push('Wiedervorlage am '+calendarDate(mail.snoozeUntil,now))
  }
  if(mail.deadline){
    const date=calendarDate(mail.deadline,now)
    if(due.includes('Frist'))attention.push(mail.deadline.slice(0,10)===today?'KI-Frist heute':'KI-Frist überschritten ('+date+')')
    else scheduled.push('KI-Frist am '+date)
  }
  return {attention,scheduled}
}
function vipList(config:Record<string,unknown>){
  if(Array.isArray(config.vip_senders))return config.vip_senders.filter((x):x is string=>typeof x==='string')
  try {return (localStorage.getItem('board.views.vip')||'').split('\n').filter(Boolean)}
  catch {return []}
}
export function renderCardContent(card:HTMLElement, mail:Mail, config:Record<string,unknown>, hint?:string, cases:readonly CaseState[]=[]){
  const subject=node('strong',mail.subject||'(ohne Betreff)','card-subject')
  subject.title=subject.textContent||''
  const author=node('small','','card-author')
  const who=mail.isSent?'An '+(mail.recipients||'(unbekannt)'):mail.sender||'(unbekannt)'
  const sender=node('span',who,'card-sender')
  sender.title=who
  author.append(sender)
  const now=new Date()
  const ageText=mail.received && receivedLabel(mail.received,now)
  if(mail.received && ageText){
    const age=node('time',ageText,'card-age')
    age.dateTime=mail.received
    age.title=dateAndTime.format(new Date(mail.received))
    age.setAttribute('aria-label',(mail.isSent?'Gesendet am ':'Empfangen am ')+age.title)
    const separator=node('span','–','card-separator');separator.setAttribute('aria-hidden','true')
    author.append(separator,age)
  }
  card.append(subject,author)
  if(mail.aiSummary && config.show_ai_summary!==false)card.append(node('small',mail.aiSummary))
  const preview=mail.body.slice(0,Number(config.preview_chars??160))
  if(config.compact_cards===false && preview)card.append(node('small',preview))
  else if(preview)card.title=preview

  const {attention,scheduled}=cardDates(mail,Number(config.overdue_days??5),now)
  if(attention.length)card.append(node('em',attention.join(' · '),'card-attention'))
  const meta=[]
  if(mail.hasStatus===false)meta.push('Ohne Status')
  meta.push(...scheduled)
  if(meta.length)card.append(node('em',meta.join(' · ')))

  // Kennzeichen als Pillen über dem Betreff, wie die Prioritäten der Vorlage.
  const flags:HTMLElement[]=[]
  if(attention.length)flags.push(flag('Fällig','due',attention.join(' · ')))
  if(mail.needsReply && ['Offen','In Bearbeitung'].includes(mail.status))flags.push(flag('Antwort nötig','reply'))
  if(mail.tags.some(t=>same(t,FOCUS_TAG)))flags.push(flag('Fokus','focus','Im Tagesfokus (F)'))
  if(matchesSplit(mail,'vip',vipList(config)))flags.push(flag('VIP','vip'))
  if(flags.length)cardRow(card,'flags').append(...flags)

  // Vorgänge mit Checkliste zeigen ihren Fortschritt statt eines Kategorie-Chips.
  const progress=cases.filter(c=>c.total>0 && mail.tags.some(t=>same(t,c.tag)))
  for(const c of progress){
    const box=node('span','','card-progress')
    const label=node('span','','card-progress-label')
    label.append(node('span',c.name),node('span',c.done+'/'+c.total))
    const bar=node('span','','card-progress-bar')
    const fill=node('span','');fill.style.width=Math.round(100*c.done/c.total)+'%';bar.append(fill)
    box.setAttribute('role','img');box.setAttribute('aria-label','Vorgang '+c.name+': '+c.done+' von '+c.total+' Punkten erledigt')
    box.append(label,bar);card.append(box)
  }
  if(hint){
    const suggestion=node('small','Ablagevorschlag · '+hint,'card-suggestion')
    suggestion.title='Vorgeschlagener Zielordner: '+hint
    card.append(suggestion)
  }
  const chipTags=mail.tags.filter(t=>!same(t,FOCUS_TAG) && !progress.some(c=>same(c.tag,t)))
  if(chipTags.length){
    const chips=node('span','','card-categories')
    for(const name of chipTags.slice(0,3)){
      const chip=node('span',name,'card-chip')
      chip.title=name
      const color=categoryColor(name)
      if(color){chip.style.borderInlineStart='3px solid '+color}
      chips.append(chip)
    }
    if(chipTags.length>3) {
      const extra=node('span','+'+(chipTags.length-3),'card-chip')
      extra.title=chipTags.slice(3).join(', ');extra.setAttribute('aria-label','Weitere Kategorien: '+extra.title)
      chips.append(extra)
    }
    cardFoot(card).prepend(chips)
  }
  if(mail.attachments.length){
    const label=mail.attachments.length===1?'Ein Anhang':mail.attachments.length+' Anhänge'
    const pill=counter(String(mail.attachments.length),label+': '+mail.attachments.join(', '),'attachments')
    cardRow(card,'counters').append(pill)
  }
}
