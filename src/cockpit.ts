import metadata from '../package.json'
import {renderLearningDashboard} from './ai'
import { getLegacyConfig } from './data-settings'
import { initCleanup, type CleanupOptions } from './cleanup'
import { dueReasons, isSnoozed, localDay, type ViewMail } from './views-logic'

type Action = 'filed' | 'followed_up' | 'snoozed'
type Options = CleanupOptions & {
  getMails: () => readonly ViewMail[]
  isLive: () => boolean
  onPick: (id: string) => void
  openUnanswered?: () => Promise<void>|void
}
type Page = 'start' | 'week' | 'today' | 'hygiene' | 'ritual' | 'help' | 'learning'

const states = ['Offen', 'In Bearbeitung', 'Warten', 'Erledigt']
const steps = ['Heute dran', 'Offen durchgehen', 'Rest parken']
const help = [
  ['Wo finde ich meine echten Mails?', 'Mit „Outlook-Mails laden“ liest das Board Mails des klassischen Outlook-Profils. Die Demodaten lassen sich unabhängig vom Postfach ausprobieren.'],
  ['Wie finde ich eine Mail?', 'Strg+F setzt den Fokus in die Suche. Mit dem Ordnerfilter schränkst du die Anzeige ein. Öffne die gewünschte Karte für die Maildetails.'],
  ['Was zeigt „Heute dran“?', 'Hier stehen fällige Wiedervorlagen, wartende Mails mit Antwort, heutige oder überfällige Nachfassfristen und fällige KI-Fristen. Eine Mail kann aus mehreren Gründen fällig sein.'],
  ['Wie funktioniert die Morgen-Triage?', 'Prüfe zuerst „Heute dran“, sichte dann die offenen Mails und entscheide zum Schluss, was noch warten darf. Jede Änderung löst du selbst aus.'],
  ['Wie lese ich eine Nachricht?', 'Öffne eine Karte und wähle „In Outlook öffnen“. Outlook zeigt dir das Original und die Anhänge. Die Anwendung sendet keine Mails.'],
  ['Wie lege ich eine Mail ab?', 'Prüfe den vorgeschlagenen Zielordner und bestätige die Ablage. Mit Strg+Z kannst du die letzte erfolgreiche Aktion in dieser Sitzung zurücknehmen.'],
  ['Was passiert bei fehlender KI?', 'Die lokale KI ist optional. Du kannst dein Board auch bei ausgeschaltetem oder langsamem Modell weiter bedienen.'],
  ['Warum fehlen Zahlen im Wochenblick?', 'Der Wochenblick zählt die aktuell geladenen Karten. Die Aktivitätszahlen sammeln erfolgreich im Board ausgeführte Aktionen der laufenden Woche lokal.'],
]

function element<K extends keyof HTMLElementTagNameMap>(name: K, text = '') {
  const node = document.createElement(name)
  node.textContent = text
  return node
}
function button(title: string, onClick: () => void) {
  const node = element('button', title)
  node.type = 'button'
  node.onclick = onClick
  return node
}
function actions(...buttons: HTMLButtonElement[]) {
  const row = element('div')
  row.className = 'cockpit-actions'
  row.append(...buttons)
  return row
}
function monday(now = new Date()) {
  const day = new Date(now)
  day.setDate(day.getDate() - (day.getDay() + 6) % 7)
  return localDay(day)
}
function weeklyCounts(live: boolean) {
  const key = 'outlook-kanban-activity-' + (live ? 'live' : 'demo')
  const counts = {week: monday(), filed: 0, followed_up: 0, snoozed: 0}
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null')
    if (saved?.week === counts.week) {
      for (const name of ['filed','followed_up','snoozed'] as const) {
        if (Number.isSafeInteger(saved[name]) && saved[name] >= 0) counts[name] = saved[name]
      }
    }
  } catch { /* Ein gesperrter Browserspeicher hindert das Board nicht am Start. */ }
  return {key, counts}
}

export function snapshot(mails: readonly ViewMail[], today = localDay(), overdueDays = 5) {
  const active = mails.filter(m => !isSnoozed(m,today))
  const due = active.filter(m => dueReasons(m,today,overdueDays).length > 0)
  const waiting = active.filter(m => m.status === 'Warten' && !m.hasReply)
  const late = waiting.filter(m => dueReasons(m,today,overdueDays).some(r => r === 'Nachfassen' || r === 'Überfällig'))
  const overdueIds = new Set(late.map(m => m.id))
  const undated = waiting.filter(m => !m.followUp && !overdueIds.has(m.id))
  return {active, due, late, undated, snoozed: mails.length-active.length}
}

export function initCockpit(options: Options) {
  let page: Page = 'start'
  let step = 0
  let ritual = false
  let helpTerm = ''
  const openCleanup = initCleanup(options)
  const versionKey = 'mailboard-intro-'+metadata.version
  const preference=(key:string)=>{try{return localStorage.getItem(key)==='yes'}catch{return false}}
  const remember=(key:string,on:boolean)=>{try{localStorage.setItem(key,on?'yes':'no')}catch{/* optional */}}
  const launchKey='mailboard-open-start'
  const dialog = element('dialog')
  dialog.id = 'cockpit-dialog'
  dialog.setAttribute('aria-labelledby','cockpit-title')
  const close = button('Schließen', () => dialog.close())
  close.className = 'close'
  const title = element('h2')
  title.id = 'cockpit-title'
  const body = element('div')
  dialog.append(close, title, body)
  document.body.append(dialog)
  const open = (next: Page) => {
    page = next
    render()
    if (!dialog.open) dialog.showModal()
  }
  const go = (label:string, next:Page) => button(label, () => open(next))
  const startRitual = () => {
    if (!ritual) step = 0
    ritual = true
    open('ritual')
  }
  function mailList(rows: readonly ViewMail[], describe?: (mail:ViewMail) => string) {
    const list = element('div')
    list.className = 'cockpit-list'
    if (!rows.length) list.append(element('p','Hier ist aktuell nichts zu bearbeiten.'))
    for (const mail of rows) {
      const reason = describe?.(mail)
      const item = button([mail.subject || '(ohne Betreff)',mail.sender,reason].filter(Boolean).join(' · '), () => {
        dialog.close()
        options.onPick(mail.id)
      })
      list.append(item)
    }
    return list
  }
  function renderHelp() {
    title.textContent = 'Hilfe zum Mail-Board'
    const input = element('input')
    input.type = 'search'
    input.value = helpTerm
    helpTerm = ''
    input.setAttribute('aria-label','Hilfethemen durchsuchen')
    input.placeholder = 'Hilfethema suchen'
    const found = element('div')
    const filter = () => {
      found.replaceChildren()
      const query = input.value.trim().toLocaleLowerCase('de')
      for (const [heading,text] of help) {
        if (!(heading+' '+text).toLocaleLowerCase('de').includes(query)) continue
        const topic = element('details')
        topic.open = !!query
        topic.append(element('summary',heading),element('p',text))
        found.append(topic)
      }
      if (!found.childElementCount) found.append(element('p','Kein passendes Hilfethema gefunden.'))
    }
    input.oninput = filter
    filter()
    body.append(input,found)
  }
  function render() {
    body.replaceChildren()
    const day=localDay(), overdue=Number(getLegacyConfig().overdue_days??5)
    const reasons=(m:ViewMail)=>dueReasons(m,day,overdue)
    const s = snapshot(options.getMails(),day,overdue)
    if (page === 'help') { renderHelp(); return }
    if (page === 'today') {
      title.textContent = 'Heute dran'
      body.append(mailList(s.due, m => reasons(m).join(', ')))
    } else if (page === 'hygiene') {
      title.textContent = 'Warten-Hygiene'
      body.append(element('h3','Fällig · '+s.late.length),mailList(s.late),
        element('h3','Ohne Nachfassfrist · '+s.undated.length),mailList(s.undated))
    } else if (page === 'learning') {
      title.textContent='Ablage-Auswertung'
      renderLearningDashboard(body)
    } else if (page === 'week') {
      title.textContent = 'Wochenblick'
      const list = element('ul')
      for (const name of states) list.append(element('li',name+' · '+s.active.filter(m=>m.status===name).length))
      body.append(element('h3','Aktuell geladene Karten'),list,element('p','Auf Wiedervorlage: '+s.snoozed))
      const waiting=s.active.filter(m=>m.status==='Warten'&&!m.hasReply)
      body.append(element('p','Heute dran: '+s.due.length+' · Warten ohne Frist: '+waiting.filter(m=>!m.followUp).length+' · Nachfassen fällig: '+s.late.length+' · Antwort nötig: '+s.active.filter(m=>m.needsReply).length))
      const {counts} = weeklyCounts(options.isLive())
      body.append(element('h3','Diese Woche'),element('p',
        'Abgelegt: '+counts.filed+' · Nachgefasst: '+counts.followed_up+' · Wiedervorlage gesetzt: '+counts.snoozed))
      body.append(actions(go('Heute dran · '+s.due.length,'today'),go('Warten-Hygiene','hygiene')))
    } else if (page === 'ritual') {
      title.textContent = steps[step]
      const rows = step === 0 ? s.due : s.active.filter(m => m.status==='Offen')
      body.append(element('p',`Morgen-Triage · Schritt ${step+1} von ${steps.length}`),
        element('p',['Prüfe Termine, Antworten und Nachfassfristen.','Wähle offene Mails zum Bearbeiten oder Ablegen.','Öffne verbleibende Karten, um bei Bedarf eine Wiedervorlage oder einen Wartestatus zu setzen.'][step]),
        mailList(rows,step === 0 ? m=>reasons(m).join(', ') : undefined))
      const advance = button(step === 2 ? 'Triage beenden' : 'Nächster Schritt', () => {
        if(step===2){ ritual=false; dialog.close() } else {step++;render()}
      })
      body.append(actions(advance,button('Triage abbrechen',()=>{ritual=false;dialog.close()})))
      return
    } else {
      title.textContent = 'Start'
      body.append(element('h3','Heute'),element('p',s.due.length+' fällig · '+s.late.length+' wartend und fällig · '+s.snoozed+' auf Wiedervorlage'),
        actions(go('Heute dran','today'),button(ritual?'Morgen-Triage fortsetzen':'Morgen-Triage starten',startRitual)),
        actions(go('Warten-Hygiene','hygiene'),go('Wochenblick','week'),go('Ablage-Auswertung','learning'),button('Posteingang aufräumen',()=>{dialog.close();void openCleanup()}),go('Hilfe','help')))
      if(options.openUnanswered)body.append(button('Gesendet ohne Antwort',()=>{dialog.close();void options.openUnanswered!()}))
      const startup=element('input');startup.type='checkbox';startup.checked=preference(launchKey)
      startup.onchange=()=>remember(launchKey,startup.checked)
      const label=element('label');label.append(startup,' Diese Übersicht beim Start öffnen')
      body.append(label)
      if(!preference(versionKey)){
        const intro=element('section')
        intro.append(element('h3','Mail-Board '+metadata.version),element('p','Du startest im Demo-Postfach. Über „Outlook-Mails laden“ wechselst du zu deinem klassischen Outlook-Profil.'),
          button('Versionshinweis schließen',()=>{remember(versionKey,true);intro.remove()}))
        body.append(intro)
      }
      const tips = [
        ['Strg+R führt durch den Rückstand im Posteingang.', 'Rückstände'],
        ['Mit W parkst du eine Karte bis zu deinem gewählten Datum.', 'Termin'],
        ['Strg+K findet Boardbefehle per Tastatur.', 'Befehlspalette'],
        ['Fällige Nachfassfristen und Antworten findest du unter „Heute dran“.', 'Heute dran'],
      ]
      const today = new Date()
      const index = Math.floor(Date.UTC(today.getFullYear(),today.getMonth(),today.getDate()) / 86400000) % tips.length
      const [tip, term] = tips[index]
      body.append(element('p',tip),button('Tipp in der Hilfe öffnen',()=>{helpTerm=term;open('help')}))
      return
    }
    body.append(go('Zur Übersicht','start'))
  }
  document.addEventListener('board-commands', event=>{
    const entries=(event as CustomEvent<{label:string;run:()=>void}[]>).detail
    entries.push({label:'Morgen-Triage',run:startRitual},{label:'Wochenblick',run:()=>open('week')},{label:'Ablage-Auswertung',run:()=>open('learning')},
      {label:'Warten-Hygiene',run:()=>open('hygiene')},{label:'Posteingang aufräumen',run:()=>void openCleanup()})
  })
  document.getElementById('cockpit-start')?.addEventListener('click',()=>open('start'))
  document.getElementById('cockpit-help')?.addEventListener('click',()=>open('help'))
  document.addEventListener('keydown',event=>{
    if(event.key!=='F1')return
    event.preventDefault()
    const active=(event.target instanceof Element?event.target.closest('dialog[open]'):null)
    if(active && active!==dialog){
      helpTerm=active.id==='settingsDialog'?'lokale KI':active.id==='detail'?'Nachricht':
        active.classList.contains('data-settings')?'gesichert':active.classList.contains('project-tools')?'Projektordner':
        active.id==='palette'?'Befehlspalette':active.getAttribute('aria-label')==='Posteingang aufräumen'?'Rückstände':''
    }
    open('help')
  })
  if(preference(launchKey))queueMicrotask(()=>open('start'))
  return {
    refresh(){if(dialog.open && page!=='help')render()},
    openStart:()=>open('start'),
    openHelp:()=>open('help'),
    record(action:Action,delta=1) {
      const {key,counts} = weeklyCounts(options.isLive())
      counts[action]=Math.max(0,counts[action]+delta)
      try {localStorage.setItem(key,JSON.stringify(counts))} catch { /* optional */ }
    },
  }
}
