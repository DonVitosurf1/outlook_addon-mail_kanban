/** Fachlogik für Morgen-Triage, Fokus, Routinen, Wochenkalender und Vorgänge. Ohne DOM, damit sie in Node testbar bleibt. */
import {dueReasons, FOCUS_TAG, isSnoozed, localDay, type ViewMail} from './views-logic'

export {FOCUS_TAG}
export const CASE_PREFIX = 'Vorgang: '

// ---------- Kalendertage ----------
function utc(day:string){return Date.parse(day.slice(0,10)+'T00:00:00Z')}
export function addDays(day:string,days:number){
  const date=new Date(utc(day)+days*86400000)
  return date.toISOString().slice(0,10)
}
/** ISO-Wochentag: Montag 1 bis Sonntag 7. */
export function isoWeekday(day:string){return (new Date(utc(day)).getUTCDay()+6)%7+1}
export function weekStart(day:string){return addDays(day,1-isoWeekday(day))}
export function weekDays(day:string){
  const start=weekStart(day)
  return Array.from({length:7},(_,i)=>addDays(start,i))
}
export function isoWeek(day:string){
  const thursday=addDays(day,4-isoWeekday(day))
  const first=thursday.slice(0,4)+'-01-01'
  return Math.floor((utc(thursday)-utc(first))/86400000/7)+1
}
function lastDayOfMonth(day:string){
  const [y,m]=day.split('-').map(Number)
  return new Date(Date.UTC(y,m,0)).getUTCDate()
}
const isDay=(value:unknown):value is string=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(utc(value))

// ---------- Morgen-Triage ----------
export const triageSteps = [
  {title:'Heute dran', hint:'Prüfe Wiedervorlagen, eingegangene Antworten, Nachfassfristen und Fristen. Eine Karte verlässt diesen Schritt, sobald du Status, Wiedervorlage oder Ablage änderst.'},
  {title:'Offen durchgehen', hint:'Bearbeite offene Mails oder lege sie ab: 2 setzt „In Bearbeitung“, 4 „Erledigt“, Strg+Eingabe übernimmt einen Ablagevorschlag, F setzt den Tagesfokus.'},
  {title:'Rest parken', hint:'Für jede verbleibende offene Mail entscheiden: W für eine Wiedervorlage, 3 für „Warten“. Was offen bleiben soll, bleibt einfach stehen.'},
] as const

export function inTriageStep(mail:ViewMail,step:number,today=localDay(),overdueDays=5){
  if(isSnoozed(mail,today))return false
  if(step===0)return dueReasons(mail,today,overdueDays).length>0
  return mail.status==='Offen' && !mail.isSent
}
/** Ohne gespeicherten Abschluss gilt „neu“ für die letzten 24 Stunden. */
export function newSince<T extends ViewMail>(mails:readonly T[],since:number|undefined,now=Date.now()){
  const from=since && Number.isFinite(since)?since:now-86400000
  return mails.filter(m=>!m.isSent && Date.parse(m.received||'')>from)
    .sort((a,b)=>Date.parse(b.received||'')-Date.parse(a.received||''))
}

export function snapshot<T extends ViewMail>(mails:readonly T[], today = localDay(), overdueDays = 5) {
  const active = mails.filter(m => !isSnoozed(m,today))
  const due = active.filter(m => dueReasons(m,today,overdueDays).length > 0)
  const waiting = active.filter(m => m.status === 'Warten' && !m.hasReply)
  const late = waiting.filter(m => dueReasons(m,today,overdueDays).some(r => r === 'Nachfassen' || r === 'Überfällig'))
  const overdueIds = new Set(late.map(m => m.id))
  const undated = waiting.filter(m => !m.followUp && !overdueIds.has(m.id))
  return {active, due, late, undated, snoozed: mails.length-active.length}
}

// ---------- Tagesfokus ----------
const same=(a:string,b:string)=>a.localeCompare(b,'de',{sensitivity:'base'})===0
export function hasFocus(mail:Pick<ViewMail,'tags'>,tag=FOCUS_TAG){return mail.tags.some(t=>same(t,tag))}
export function isFocusCard(mail:ViewMail,today=localDay(),tag=FOCUS_TAG){
  return hasFocus(mail,tag) && mail.status!=='Erledigt' && !isSnoozed(mail,today)
}
export function withTag(tags:readonly string[],tag:string,on:boolean){
  const rest=tags.filter(t=>!same(t,tag))
  return on?[...rest,tag]:rest
}
/** Sind alle markierten Karten bereits im Fokus, nimmt F den Fokus weg. Sonst setzt F ihn für alle. */
export function focusTarget(mails:readonly Pick<ViewMail,'tags'>[],tag=FOCUS_TAG){return !mails.every(m=>hasFocus(m,tag))}

// ---------- Routinen ----------
export type Rhythm = 'daily'|'weekdays'|'weekly'|'monthly'
export type RoutineAction = ''|'triage'|'hygiene'|'week'|'cleanup'|'unanswered'|'calendar'|'cases'
export type Routine = {id:string; title:string; rhythm:Rhythm; weekday?:number; monthDay?:number; action?:RoutineAction; created:string; lastDone?:string}
export const rhythms:[Rhythm,string][] = [['daily','Täglich'],['weekdays','Werktags'],['weekly','Wöchentlich'],['monthly','Monatlich']]
export const weekdayNames = ['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag']
export const routineActions:[RoutineAction,string][] = [
  ['','Keine Verknüpfung'],['triage','Morgen-Triage'],['hygiene','Warten-Hygiene'],['week','Wochenblick'],
  ['cleanup','Posteingang aufräumen'],['unanswered','Gesendet ohne Antwort'],['calendar','Wochenkalender'],['cases','Vorgänge'],
]

export function occursOn(routine:Routine,day:string){
  switch(routine.rhythm){
    case 'daily':return true
    case 'weekdays':return isoWeekday(day)<=5
    case 'weekly':return isoWeekday(day)===(routine.weekday||1)
    case 'monthly':{
      const wanted=Math.min(Math.max(1,routine.monthDay||1),lastDayOfMonth(day))
      return Number(day.slice(8,10))===wanted
    }
  }
}
/** Letzter planmäßiger Termin bis einschließlich heute, frühestens am Anlagetag. */
export function lastOccurrence(routine:Routine,today=localDay()){
  const created=(routine.created||today).slice(0,10)
  for(let i=0;i<=62;i++){
    const day=addDays(today,-i)
    if(day<created)return ''
    if(occursOn(routine,day))return day
  }
  return ''
}
/** Eine verpasste Routine bleibt fällig, bis sie abgehakt ist. */
export function routineDue(routine:Routine,today=localDay()){
  const since=lastOccurrence(routine,today)
  return {due:!!since && since>(routine.lastDone||''), since}
}
export function dueRoutines(routines:readonly Routine[],today=localDay()){
  return routines.map(r=>({routine:r,...routineDue(r,today)})).filter(r=>r.due)
}
export function describeRhythm(routine:Routine){
  switch(routine.rhythm){
    case 'daily':return 'Täglich'
    case 'weekdays':return 'Werktags'
    case 'weekly':return 'Jeden '+weekdayNames[(routine.weekday||1)-1]
    case 'monthly':return 'Monatlich am '+(routine.monthDay||1)+'.'
  }
}
export function normalizeRoutine(value:unknown):Routine|undefined{
  if(!value || typeof value!=='object')return
  const r=value as Record<string,unknown>
  const rhythm=rhythms.some(([k])=>k===r.rhythm)?r.rhythm as Rhythm:undefined
  if(typeof r.id!=='string'||typeof r.title!=='string'||!r.title.trim()||!rhythm||!isDay(r.created))return
  const routine:Routine={id:r.id,title:r.title.trim(),rhythm,created:r.created}
  if(rhythm==='weekly')routine.weekday=Number.isInteger(r.weekday)&&Number(r.weekday)>=1&&Number(r.weekday)<=7?Number(r.weekday):1
  if(rhythm==='monthly')routine.monthDay=Number.isInteger(r.monthDay)&&Number(r.monthDay)>=1&&Number(r.monthDay)<=31?Number(r.monthDay):1
  if(routineActions.some(([k])=>k===r.action))routine.action=r.action as RoutineAction
  if(isDay(r.lastDone))routine.lastDone=r.lastDone
  return routine
}

// ---------- Vorgänge ----------
export type CaseItem = {id:string; text:string; done:boolean; due?:string}
export type Case = {name:string; created:string; closed?:string; note?:string; items:CaseItem[]}
export function caseTag(name:string){return CASE_PREFIX+name}
export function caseNames(mail:Pick<ViewMail,'tags'>){
  return mail.tags.filter(t=>t.startsWith(CASE_PREFIX)).map(t=>t.slice(CASE_PREFIX.length).trim()).filter(Boolean)
}
/** Outlook trennt Kategorien mit Komma oder Semikolon. Diese Zeichen darf ein Vorgangsname nicht enthalten. */
export function caseNameProblem(name:string,existing:readonly Case[]=[]){
  const value=name.trim()
  if(!value)return 'Bitte einen Namen eingeben.'
  if(/[,;]/.test(value))return 'Komma und Semikolon sind in Outlook-Kategorien nicht erlaubt.'
  if(value.length>60)return 'Der Name darf höchstens 60 Zeichen lang sein.'
  if(existing.some(c=>same(c.name,value)))return 'Einen Vorgang mit diesem Namen gibt es bereits.'
  return ''
}
/** Vorgangsname aus einem Betreff: Antwort-Präfixe weg, `,;` ersetzt, höchstens 60 Zeichen, bei Namensgleichheit „ (2)“ usw. */
export function caseNameFromSubject(subject:string,existing:readonly Case[]=[]){
  let base=subject.replace(/[,;]/g,' ').replace(/\s+/g,' ').trim()
  for(let m=/^(aw|wg|re|fwd|fw)\s*:\s*/i.exec(base);m;m=/^(aw|wg|re|fwd|fw)\s*:\s*/i.exec(base))base=base.slice(m[0].length)
  base=base.slice(0,60).trim()||'Neuer Vorgang'
  let name=base
  for(let n=2;caseNameProblem(name,existing);n++){
    const suffix=' ('+n+')'
    name=base.slice(0,60-suffix.length).trimEnd()+suffix
    if(n>999)break
  }
  return name
}
export function caseMails<T extends ViewMail>(mails:readonly T[],name:string){
  return mails.filter(m=>caseNames(m).some(n=>same(n,name)))
}
export function caseProgress(c:Case){return {done:c.items.filter(i=>i.done).length,total:c.items.length}}
/** Lokale Vorgänge plus solche, die nur über eine Outlook-Kategorie bekannt sind, etwa von einem anderen PC. */
export function knownCases(stored:readonly Case[],mails:readonly ViewMail[],today=localDay()){
  const result=[...stored]
  for(const name of new Set(mails.flatMap(caseNames))){
    if(!result.some(c=>same(c.name,name)))result.push({name,created:today,items:[]})
  }
  return result.sort((a,b)=>Number(!!a.closed)-Number(!!b.closed)||a.name.localeCompare(b.name,'de'))
}
export function normalizeCase(value:unknown):Case|undefined{
  if(!value || typeof value!=='object')return
  const c=value as Record<string,unknown>
  if(typeof c.name!=='string'||caseNameProblem(c.name)||!isDay(c.created)||!Array.isArray(c.items))return
  const items=c.items.flatMap(raw=>{
    if(!raw||typeof raw!=='object')return []
    const i=raw as Record<string,unknown>
    if(typeof i.id!=='string'||typeof i.text!=='string'||!i.text.trim())return []
    const item:CaseItem={id:i.id,text:i.text.trim(),done:i.done===true}
    if(isDay(i.due))item.due=i.due
    return [item]
  })
  const result:Case={name:c.name.trim(),created:c.created,items}
  if(isDay(c.closed))result.closed=c.closed
  if(typeof c.note==='string'&&c.note.trim())result.note=c.note
  return result
}

// ---------- Wochenkalender ----------
export type EntryKind = 'followUp'|'snoozeUntil'|'deadline'|'routine'|'checklist'
export type CalendarEntry = {day:string; kind:EntryKind; label:string; mailId?:string; routineId?:string; caseName?:string; itemId?:string; done?:boolean}
export const entryKinds:Record<EntryKind,string> = {followUp:'Nachfassen',snoozeUntil:'Wiedervorlage',deadline:'Frist',routine:'Routine',checklist:'Checkliste'}

/** Datumsfeld, das ein Ablegen auf einem Kalendertag setzt: N bei wartenden Karten, sonst W. */
export function plannedField(mail:Pick<ViewMail,'status'>):'followUp'|'snoozeUntil'{return mail.status==='Warten'?'followUp':'snoozeUntil'}

export function calendarEntries(mails:readonly ViewMail[],routines:readonly Routine[],cases:readonly Case[],days:readonly string[],today=localDay()){
  const byDay=new Map<string,CalendarEntry[]>(days.map(d=>[d,[]]))
  const overdue:CalendarEntry[]=[]
  const place=(entry:CalendarEntry,late:boolean)=>{
    if(late)overdue.push(entry)
    else byDay.get(entry.day)?.push(entry)
  }
  for(const mail of mails){
    if(mail.status==='Erledigt')continue
    const label=mail.subject||'(ohne Betreff)'
    const follow=mail.followUp?.slice(0,10)
    if(follow && mail.status==='Warten' && !mail.hasReply)place({day:follow,kind:'followUp',label,mailId:mail.id},follow<today)
    const snooze=mail.snoozeUntil?.slice(0,10)
    if(snooze && snooze>=today)place({day:snooze,kind:'snoozeUntil',label,mailId:mail.id},false)
    const deadline=mail.deadline?.slice(0,10)
    if(deadline)place({day:deadline,kind:'deadline',label,mailId:mail.id},deadline<today)
  }
  for(const routine of routines){
    const state=routineDue(routine,today)
    if(state.due && state.since<today)overdue.push({day:state.since,kind:'routine',label:routine.title,routineId:routine.id})
    for(const day of days){
      if(day<(routine.created||'')||!occursOn(routine,day))continue
      // Vergangene, nicht abgehakte Termine stehen nur einmal unter „Überfällig“.
      if(day<today && (routine.lastDone||'')<day)continue
      byDay.get(day)!.push({day,kind:'routine',label:routine.title,routineId:routine.id,done:(routine.lastDone||'')>=day})
    }
  }
  for(const c of cases){
    if(c.closed)continue
    for(const item of c.items){
      if(!item.due)continue
      place({day:item.due,kind:'checklist',label:item.text,caseName:c.name,itemId:item.id,done:item.done},item.due<today && !item.done)
    }
  }
  const order=(a:CalendarEntry,b:CalendarEntry)=>a.day.localeCompare(b.day)||a.label.localeCompare(b.label,'de')
  overdue.sort(order)
  for(const list of byDay.values())list.sort((a,b)=>Number(!!a.done)-Number(!!b.done)||a.label.localeCompare(b.label,'de'))
  return {overdue,byDay}
}

// ---------- Briefing ----------
export function briefing<T extends ViewMail>(mails:readonly T[],options:{today?:string;overdueDays?:number;since?:number;now?:number;routines?:readonly Routine[];cases?:readonly Case[]}={}){
  const today=options.today||localDay()
  const s=snapshot(mails,today,options.overdueDays??5)
  const items=(options.cases||[]).filter(c=>!c.closed).flatMap(c=>c.items.filter(i=>!i.done&&i.due&&i.due<=today).map(i=>({case:c.name,item:i})))
  return {
    ...s,
    reply:s.active.filter(m=>m.needsReply&&m.status!=='Erledigt'),
    fresh:newSince(mails,options.since,options.now),
    focus:mails.filter(m=>isFocusCard(m,today)),
    routines:dueRoutines(options.routines||[],today),
    checklist:items,
    openTasks:mails.reduce((sum,m)=>sum+((m as {aiTasks?:unknown[]}).aiTasks?.length||0),0),
  }
}

// ---------- Briefing-Text ----------
type TextMail=ViewMail&{aiSummary?:string}
const clip=(text:string,max:number)=>text.length>max?text.slice(0,max-1).trimEnd()+'…':text
export function briefingText(b:{fresh:readonly unknown[];reply:readonly TextMail[];due:readonly TextMail[];openTasks?:number},options:{since?:string;today?:string}={}){
  const today=options.today||localDay(),n=b.fresh.length
  const parts=[(n?n+(n===1?' neue Mail':' neue Mails'):'Keine neuen Mails')+' '+(options.since||'in den letzten 24 Stunden')+'.']
  if(b.reply.length){
    const names=b.reply.slice(0,3).map(m=>{const s=(m.aiSummary||'').trim(),t=m.subject||'(ohne Betreff)';return s?t+' ('+clip(s,60)+')':t})
    parts.push('Antwort nötig: '+names.join(', ')+(b.reply.length>3?' und '+(b.reply.length-3)+' weitere':'')+'.')
  }
  const dl=b.due.filter(m=>(m.deadline||'').slice(0,10)===today&&dueReasons(m,today).includes('Frist')).slice(0,3)
  if(dl.length)parts.push('Frist heute: '+dl.map(m=>m.subject||'(ohne Betreff)').join(', ')+'.')
  if(b.openTasks)parts.push(b.openTasks+(b.openTasks===1?' offene Aufgabe.':' offene Aufgaben.'))
  return parts.join(' ')
}
