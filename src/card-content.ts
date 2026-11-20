import {categoryColor} from './category-colors'
import {localDay, matchesSplit, type ViewMail} from './views-logic'

type Mail = ViewMail & {aiSummary?:string;hasStatus?:boolean}
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text:string,style=''){
  const element=document.createElement(tag)
  element.textContent=text
  if(style)element.className=style
  return element
}
export function mailAge(timestamp:string, now=new Date()) {
  const date=new Date(timestamp)
  if(!Number.isFinite(date.getTime()))return ''
  const diff=Math.round((Date.parse(localDay(now))-Date.parse(localDay(date)))/86400000)
  if(diff===0)return 'Heute'
  if(diff===1)return 'Gestern'
  if(diff>1 && diff<14)return diff+' Tage'
  return date.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:now.getFullYear()===date.getFullYear()?undefined:'numeric'})
}
function vipList(config:Record<string,unknown>){
  if(Array.isArray(config.vip_senders))return config.vip_senders.filter((x):x is string=>typeof x==='string')
  try {return (localStorage.getItem('board.views.vip')||'').split('\n').filter(Boolean)}
  catch {return []}
}
export function renderCardContent(card:HTMLElement, mail:Mail, config:Record<string,unknown>, hint?:string){
  const top=node('small','','card-author')
  const who=mail.isSent?'An '+(mail.recipients||'(unbekannt)'):mail.sender||'(unbekannt)'
  const sender=node('span',who,'card-sender')
  sender.title=who
  top.append(sender)
  if(matchesSplit(mail,'vip',vipList(config)))top.append(node('span','VIP','card-vip'))
  if(mail.attachments.length){
    const attachments=node('span',mail.attachments.length+' Anh.','card-attachments')
    attachments.title=mail.attachments.join('\n')
    attachments.setAttribute('aria-label',mail.attachments.length===1?'Ein Anhang':mail.attachments.length+' Anhänge')
    top.append(attachments)
  }
  const ageText=mail.received&&mailAge(mail.received)
  if(mail.received&&ageText){
    const age=node('time',ageText,'card-age')
    age.dateTime=mail.received
    age.title=new Date(mail.received).toLocaleString('de-DE');top.append(age)
  }
  const subject=node('strong',mail.subject||'(ohne Betreff)')
  subject.title=subject.textContent||''
  card.append(top,subject)
  if(mail.aiSummary && config.show_ai_summary!==false)card.append(node('small',mail.aiSummary))
  const preview=mail.body.slice(0,Number(config.preview_chars??160))
  if(config.compact_cards===false && preview)card.append(node('small',preview))
  else if(preview)card.title=preview

  const meta=[]
  if(mail.hasStatus===false)meta.push('Ohne Status')
  if(mail.needsReply && ['Offen','In Bearbeitung'].includes(mail.status))meta.push('Antwort nötig')
  if(mail.followUp)meta.push('Nachfassen '+mail.followUp)
  if(mail.snoozeUntil)meta.push('Wiedervorlage '+mail.snoozeUntil)
  if(mail.deadline)meta.push('KI-Frist '+mail.deadline)
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
