import {categoryColor} from './category-colors'
import {dueReasons, localDay, matchesSplit, type ViewMail} from './views-logic'

type Mail = ViewMail & {aiSummary?:string;hasStatus?:boolean}
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
export function renderCardContent(card:HTMLElement, mail:Mail, config:Record<string,unknown>, hint?:string){
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
  if(matchesSplit(mail,'vip',vipList(config)))author.append(node('span','VIP','card-vip'))
  if(mail.attachments.length){
    const attachments=node('span',mail.attachments.length+' Anh.','card-attachments')
    attachments.title=mail.attachments.join('\n')
    attachments.setAttribute('aria-label',mail.attachments.length===1?'Ein Anhang':mail.attachments.length+' Anhänge')
    author.append(attachments)
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
  if(mail.needsReply && ['Offen','In Bearbeitung'].includes(mail.status))meta.push('Antwort nötig')
  meta.push(...scheduled)
  if(meta.length)card.append(node('em',meta.join(' · ')))

  if(mail.tags.length){
    const chips=node('span','','card-categories')
    for(const name of mail.tags.slice(0,3)){
      const chip=node('span',name,'card-chip')
      chip.title=name
      const color=categoryColor(name)
      if(color){chip.style.borderInlineStart='3px solid '+color}
      chips.append(chip)
    }
    if(mail.tags.length>3) {
      const extra=node('span','+'+(mail.tags.length-3),'card-chip')
      extra.title=mail.tags.slice(3).join(', ');extra.setAttribute('aria-label','Weitere Kategorien: '+extra.title)
      chips.append(extra)
    }
    card.append(chips)
  }
  if(hint){
    const suggestion=node('small','Ablagevorschlag · '+hint,'card-suggestion')
    suggestion.title='Vorgeschlagener Zielordner: '+hint
    card.append(suggestion)
  }
}
