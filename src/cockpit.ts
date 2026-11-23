import {dateTerms} from './date-terms'
import metadata from '../package.json'
import {renderLearningDashboard} from './ai'
import { getLegacyConfig } from './data-settings'
import { initCleanup, type CleanupOptions } from './cleanup'
import { dueRoutines, isFocusCard, snapshot, type Routine } from './planning-logic'
import { shortcuts, shortcutGroups } from './shortcuts'
import { dueReasons, localDay, type ViewMail } from './views-logic'
export { snapshot }

type Action = 'filed' | 'followed_up' | 'snoozed'
type Options = CleanupOptions & {
  getMails: () => readonly ViewMail[]
  isLive: () => boolean
  onPick: (id: string) => void
  openUnanswered?: () => Promise<void>|void
  startTriage: () => void
  triageActive: () => boolean
  routines: () => Routine[]
  openRoutines: () => void
  openCalendar: () => void
  openCases: () => void
}
export type Page = 'start' | 'week' | 'today' | 'hygiene' | 'help' | 'learning' | 'shortcuts'

const states = ['Offen', 'In Bearbeitung', 'Warten', 'Erledigt']
const help = [
  ['Wo finde ich meine echten Mails?', 'Unter Windows lädt das Board beim Start automatisch dein klassisches Outlook-Profil. Bei einem Verbindungsfehler kannst du Outlook öffnen und es erneut versuchen. Über Werkzeuge → Beispielpostfach öffnen kannst du mit Beispieldaten arbeiten.'],
  ['Welche Tastenkürzel gibt es?', 'Die Taste ? zeigt alle Tastenkürzel, gruppiert nach Karte, Board, Ansichten, Triage und Dialogen. Du erreichst die Übersicht auch über den Knopf „Tastenkürzel anzeigen“ in dieser Hilfe.'],
  ['Wie finde ich eine Mail?', 'Strg+F setzt den Fokus in die Suche. Mit dem Ordnerfilter schränkst du die Anzeige ein. Öffne die gewünschte Karte für die Maildetails.'],
  ['Was zeigt „Heute dran“?', 'Hier stehen fällige Wiedervorlagen, wartende Mails mit Antwort, heutige oder überfällige Nachfassfristen und fällige KI-Fristen. Eine Mail kann aus mehreren Gründen fällig sein.'],
  ['Wie funktioniert die Morgen-Triage?', 'Strg+T oder Start → „Morgen-Triage starten“ blendet über dem Board ein Banner mit Briefing ein. Das Board zeigt nacheinander „Heute dran“, „Offen durchgehen“ und „Rest parken“. Du arbeitest mit den gewohnten Kartenaktionen. Eine Karte verlässt den Schritt, sobald sich ihr Status, ihre Wiedervorlage oder ihr Ordner ändert. Beenden oder Abbrechen stellt deine vorherige Ansicht wieder her.'],
  ['Was zeigt das Briefing?', 'Zahlen zu fälligen, wartenden und zu beantwortenden Mails, die seit der letzten beendeten Triage eingegangenen Mails sowie fällige Routinen und Checklistenpunkte. Beim ersten Mal gelten die letzten 24 Stunden als neu.'],
  ['Was bewirkt die Taste F?', 'F nimmt die markierten Karten in den Fokus oder wieder heraus. Dafür setzt das Board die Outlook-Kategorie „Fokus“. Sie bleibt beim Verschieben erhalten und ist mit Strg+Z rücknehmbar. Die Seitenleiste zeigt unter „Ansichten“ in der Ansicht „Fokus“ alle nicht erledigten Fokuskarten.'],
  ['Welche Datumsarten gibt es?', 'Wiedervorlage: '+dateTerms.wiedervorlage+' Nachfassen: '+dateTerms.nachfassen+' Frist: '+dateTerms.frist+' KI-Frist: '+dateTerms.kiFrist],
  ['Wie funktionieren Routinen?', 'Im Tab „Routinen“ legst du wiederkehrende Aufgaben an: täglich, werktags, wöchentlich oder monatlich. Eine Routine kann eine Ansicht wie die Warten-Hygiene öffnen. Eine verpasste Routine bleibt fällig, bis du sie abhakst.'],
  ['Was zeigt der Wochenkalender?', 'Der Tab „Kalender“ zeigt Nachfasstermine, Wiedervorlagen, KI-Fristen, Routinen und Checklistenpunkte einer Woche, Überfälliges gesammelt vorn. Ziehst du eine Mail auf einen Tag, erhält eine wartende Mail dort ihren Nachfasstermin und jede andere eine Wiedervorlage.'],
  ['Was ist ein Vorgang?', 'Ein Vorgang bündelt zusammengehörige Mails über die Outlook-Kategorie „Vorgang: Name“ und führt eine lokale Checkliste mit optionalen Terminen. Zuordnen lässt sich über das Kontextmenü einer Karte, Strg+K oder den Tab „Vorgänge“.'],
  ['Wie lese ich eine Nachricht?', 'Öffne eine Karte und wähle „In Outlook öffnen“. Outlook zeigt dir das Original und die Anhänge. Die Anwendung sendet keine Mails.'],
  ['Wie lege ich eine Mail ab?', 'Prüfe den vorgeschlagenen Zielordner und bestätige die Ablage. Mit Strg+Z kannst du die letzte erfolgreiche Aktion in dieser Sitzung zurücknehmen. Nach jeder Änderung erscheint kurz eine Meldung mit dem Knopf „Rückgängig“.'],
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

export function recordWeekly(live:boolean, action:Action, delta=1, occurredAt=new Date()) {
  const {key,counts}=weeklyCounts(live)
  if(monday(occurredAt)!==counts.week)return
  counts[action]=Math.max(0,counts[action]+delta)
  try {localStorage.setItem(key,JSON.stringify(counts))} catch { /* optional */ }
}

export function initCockpit(options: Options) {
  let page: Page = 'start'
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
    page = !options.hasMailbox()&&next!=='help'&&next!=='shortcuts'?'start':next
    render()
    if (!dialog.open) dialog.showModal()
  }
  const go = (label:string, next:Page) => button(label, () => open(next))
  const startTriage = () => { dialog.close(); options.startTriage() }
  const link = (label:string, run:()=>void) => button(label, () => { dialog.close(); run() })
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
    body.append(input,found,button('Tastenkürzel anzeigen',()=>open('shortcuts')))
  }
  function renderShortcuts() {
    title.textContent = 'Tastenkürzel'
    body.append(element('p','Mit ? öffnest du diese Übersicht jederzeit außerhalb von Eingabefeldern.'))
    for (const group of shortcutGroups) {
      const table = element('table')
      table.className = 'shortcut-table'
      table.append(element('caption',group))
      const head = element('tr')
      for (const label of ['Taste','Wirkung']) { const th = element('th',label); th.scope = 'col'; head.append(th) }
      const thead = element('thead'); thead.append(head)
      const tbody = element('tbody')
      for (const entry of shortcuts.filter(item => item.group === group)) {
        const row = element('tr'), keys = element('td')
        entry.keys.split('+').forEach((part,i) => {
          if (i) keys.append('+')
          keys.append(element('kbd',part))
        })
        row.append(keys,element('td',entry.action))
        tbody.append(row)
      }
      table.append(thead,tbody)
      body.append(table)
    }
    body.append(go('Zur Hilfe','help'))
  }
  function render() {
    body.replaceChildren()
    if(page==='help'){renderHelp();return}
    if(page==='shortcuts'){renderShortcuts();return}
    if(!options.hasMailbox()){
      title.textContent='Start'
      body.append(element('p','Es ist kein Postfach geöffnet. Verbinde Outlook oder öffne die Beispieldaten zum Ausprobieren.'),go('Hilfe','help'))
      return
    }
    const day=localDay(), overdue=options.isLive()?Number(getLegacyConfig().overdue_days??5):5
    const reasons=(m:ViewMail)=>dueReasons(m,day,overdue)
    const s = snapshot(options.getMails(),day,overdue)
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
      body.append(element('p','Heute dran: '+s.due.length+' · Warten ohne Frist: '+waiting.filter(m=>!m.followUp).length+' · Nachfassen fällig: '+s.late.length+' · Antwort nötig: '+s.active.filter(m=>m.needsReply).length+' · Im Fokus: '+options.getMails().filter(m=>isFocusCard(m,day)).length))
      const {counts} = weeklyCounts(options.isLive())
      body.append(element('h3','Diese Woche'),element('p',
        'Abgelegt: '+counts.filed+' · Nachgefasst: '+counts.followed_up+' · Wiedervorlage gesetzt: '+counts.snoozed))
      body.append(actions(go('Heute dran · '+s.due.length,'today'),go('Warten-Hygiene','hygiene'),link('Wochenkalender',options.openCalendar)))
    } else {
      title.textContent = 'Start'
      body.append(element('h3','Heute'),element('p',s.due.length+' fällig · '+s.late.length+' wartend und fällig · '+s.snoozed+' auf Wiedervorlage'),
        actions(go('Heute dran','today'),button(options.triageActive()?'Morgen-Triage fortsetzen':'Morgen-Triage starten',startTriage)),
        actions(go('Warten-Hygiene','hygiene'),go('Wochenblick','week'),go('Ablage-Auswertung','learning'),button('Posteingang aufräumen',()=>{dialog.close();void openCleanup()}),go('Hilfe','help')))
      if(options.openUnanswered)body.append(button('Gesendet ohne Antwort',()=>{dialog.close();void options.openUnanswered!()}))
      const due=dueRoutines(options.routines(),day)
      body.append(element('h3','Planung'),element('p',due.length?'Fällige Routinen: '+due.map(r=>r.routine.title).join(', '):'Keine Routine fällig.'),
        actions(link('Wochenkalender',options.openCalendar),link('Routinen',options.openRoutines),link('Vorgänge',options.openCases)))
      const startup=element('input');startup.type='checkbox';startup.checked=preference(launchKey)
      startup.onchange=()=>remember(launchKey,startup.checked)
      const label=element('label');label.append(startup,' Diese Übersicht beim Start öffnen')
      body.append(label)
      if(!preference(versionKey)){
        const intro=element('section')
        intro.append(element('h3','Mail-Board '+metadata.version),element('p','Die Windows-App lädt dein klassisches Outlook-Profil beim Start. Wähle Werkzeuge → Beispielpostfach öffnen, um das Board mit Beispielen zu erkunden.'),
          button('Versionshinweis schließen',()=>{remember(versionKey,true);intro.remove()}))
        body.append(intro)
      }
      const tips = [
        ['Strg+R führt durch den Rückstand im Posteingang.', 'Rückstände'],
        ['Strg+T startet die Morgen-Triage direkt auf dem Board.', 'Morgen-Triage'],
        ['F nimmt markierte Karten in deinen Fokus.', 'Taste F'],
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
    if(!options.hasMailbox())return
    entries.push({label:'Wochenblick',run:()=>open('week')},{label:'Ablage-Auswertung',run:()=>open('learning')},
      {label:'Warten-Hygiene',run:()=>open('hygiene')},{label:'Posteingang aufräumen',run:()=>void openCleanup()})
  })
  document.addEventListener('mailboard:source-changed',()=>{
    page='start';body.replaceChildren()
    if(dialog.open)dialog.close()
  })
  document.getElementById('cockpit-start')?.addEventListener('click',()=>open('start'))
  document.getElementById('cockpit-help')?.addEventListener('click',()=>open('help'))
  document.addEventListener('keydown',event=>{
    if(event.key!=='?'||event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey)return
    if(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable=true]'))return
    const openDialog=document.querySelector('dialog[open]')
    if(openDialog&&!(openDialog===dialog&&page==='help'))return
    event.preventDefault()
    open('shortcuts')
  })
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
    refresh(){if(dialog.open && page!=='help' && page!=='shortcuts')render()},
    openStart:()=>open('start'),
    openHelp:()=>open('help'),
    openPage:(next:Page)=>open(next),
    openCleanup:()=>void openCleanup(),
    record(action:Action,delta=1) {
      recordWeekly(options.isLive(),action,delta)
    },
  }
}
