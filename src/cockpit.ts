import { showIntro } from './intro'
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
  startTriage: () => void
  triageActive: () => boolean
  routines: () => Routine[]
  openCalendar: () => void
  /** Einrichtungsfortschritt wie „Einrichtung: 2 von 7 Schritten“, leer, wenn Start ihn nicht zeigen soll. */
  setupProgress: () => string
  openSetup: () => void
  markRoutine: (id: string) => void
  showFocus: (key: 'today' | 'focus') => void
  showOverdue: () => void
}
export type Page = 'start' | 'week' | 'today' | 'hygiene' | 'help' | 'learning' | 'shortcuts'

const states = ['Offen', 'In Bearbeitung', 'Warten', 'Erledigt']
const help = [
  ['Wo finde ich meine echten Mails?', 'Unter Windows lädt das Board beim Start automatisch dein klassisches Outlook-Profil. Bei einem Verbindungsfehler kannst du Outlook öffnen und es erneut versuchen. Über Werkzeuge → Beispielpostfach öffnen kannst du mit Beispieldaten arbeiten.'],
  ['Welche Tastenkürzel gibt es?', 'Die Taste ? zeigt alle Tastenkürzel, gruppiert nach Karte, Board, Ansichten, Triage und Dialogen. Du erreichst die Übersicht auch über den Knopf „Tastenkürzel anzeigen“ in dieser Hilfe.'],
  ['Wie finde ich eine Mail?', 'Strg+F setzt den Fokus in die Suche. Mit dem Ordnerfilter schränkst du die Anzeige ein. Öffne die gewünschte Karte für die Maildetails. Mit „≈ Bedeutung“ im Suchfeld suchst du nach dem Sinn statt nach Wörtern (nur mit Outlook und lokalen Embeddings). Escape schaltet zurück. In den Maildetails zeigt „Ähnliche Mails“ die fünf passendsten anderen Mails.'],
  ['Was zeigt „Heute dran“?', 'Hier stehen fällige Wiedervorlagen, wartende Mails mit Antwort, heutige oder überfällige Nachfassfristen und fällige KI-Fristen. Eine Mail kann aus mehreren Gründen fällig sein.'],
  ['Wie funktioniert die Morgen-Triage?', 'Strg+T oder Start → „Morgen-Triage starten“ blendet über dem Board ein Banner mit Briefing ein. Das Board zeigt nacheinander „Heute dran“, „Offen durchgehen“ und „Rest parken“. Du arbeitest mit den gewohnten Kartenaktionen. Eine Karte verlässt den Schritt, sobald sich ihr Status, ihre Wiedervorlage oder ihr Ordner ändert. Beenden oder Abbrechen stellt deine vorherige Ansicht wieder her. In „Heute dran“ schlägt das Board bis zu drei Mails für den Tagesfokus vor: Frist heute, Aufgabe mit Frist, VIP-Absender und überfälliges Warten. „In den Fokus“ übernimmt den Vorschlag, „Nicht vorschlagen“ blendet ihn für heute aus.'],
  ['Was zeigt das Briefing?', 'Zahlen zu fälligen, wartenden und zu beantwortenden Mails, die seit der letzten beendeten Triage eingegangenen Mails sowie fällige Routinen und Checklistenpunkte. Beim ersten Mal gelten die letzten 24 Stunden als neu.'],
  ['Was bewirkt die Taste F?', 'F nimmt die markierten Karten in den Fokus oder wieder heraus. Dafür setzt das Board die Outlook-Kategorie „Fokus“. Sie bleibt beim Verschieben erhalten und ist mit Strg+Z rücknehmbar. Die Seitenleiste zeigt unter „Ansichten“ in der Ansicht „Fokus“ alle nicht erledigten Fokuskarten.'],
  ['Welche Datumsarten gibt es?', 'Wiedervorlage: '+dateTerms.wiedervorlage+' Nachfassen: '+dateTerms.nachfassen+' Frist: '+dateTerms.frist+' KI-Frist: '+dateTerms.kiFrist],
  ['Wie funktionieren Routinen?', 'Im Tab „Routinen“ legst du wiederkehrende Aufgaben an: täglich, werktags, wöchentlich oder monatlich. Eine Routine kann eine Ansicht wie die Warten-Hygiene öffnen. Eine verpasste Routine bleibt fällig, bis du sie abhakst.'],
  ['Was zeigt der Wochenkalender?', 'Der Tab „Kalender“ zeigt Nachfasstermine, Wiedervorlagen, KI-Fristen, Routinen und Checklistenpunkte einer Woche, Überfälliges gesammelt vorn. Ziehst du eine Mail auf einen Tag, erhält eine wartende Mail dort ihren Nachfasstermin und jede andere eine Wiedervorlage.'],
  ['Was ist ein Vorgang?', 'Ein Vorgang bündelt zusammengehörige Mails über die Outlook-Kategorie „Vorgang: Name“ und führt eine lokale Checkliste mit optionalen Terminen. Zuordnen lässt sich über das Kontextmenü einer Karte, Strg+K oder den Tab „Vorgänge“.'],
  ['Woher kommt der Vorgangsvorschlag?', 'Mit eingeschalteten Embeddings vergleicht das Board Mails ohne Vorgang mit den Mails deiner offenen Vorgänge. Passt eine Mail deutlich zu einem Vorgang, zeigt die Karte „Vorgang Name?“. Ein Klick ordnet sie zu und lässt sich mit Rückgängig zurücknehmen, mit „×“ lehnst du den Vorschlag ab. Die Ablehnung gilt für diesen Mailinhalt und diesen Vorgang, auch nach dem Verschieben. Strg+K bietet „Vorgangsvorschlag übernehmen“ für die markierte Karte. Ähnlichkeit und Abstand stellst du unter Einstellungen, Lernen ein. Im Beispielpostfach und ohne Embeddings gibt es keine Vorschläge.'],
  ['Wie werden Aufgaben aus Mails übernommen?', 'Hat die lokale KI in einer Mail ausdrücklich verlangte Handlungen gefunden, zeigt die Karte „n Aufgaben“. In den Maildetails prüfst du Text und Datum, wählst die Punkte aus und übernimmst sie in den Vorgang der Mail. Gibt es noch keinen, legt das Board nach Rückfrage einen neuen Vorgang an und ordnet die Mail zu. Übernommene Aufgaben erscheinen in der Checkliste und im Kalender.'],
  ['Wie lese ich eine Nachricht?', 'Öffne eine Karte und wähle „In Outlook öffnen“. Outlook zeigt dir das Original und die Anhänge. Die Anwendung sendet keine Mails.'],
  ['Wie lege ich eine Mail ab?', 'Prüfe den vorgeschlagenen Zielordner und bestätige die Ablage. Mit Strg+Z kannst du die letzte erfolgreiche Aktion in dieser Sitzung zurücknehmen. Nach jeder Änderung erscheint kurz eine Meldung mit dem Knopf „Rückgängig“.'],
  ['Wie richte ich das Board ein?', 'Werkzeuge → Einrichtung führt mit deinem Outlook-Postfach durch sieben Schritte: Ordner wählen, Lernen und messen, Ausreißer prüfen, Struktur verfeinern, Steckbriefe, neu lernen und vergleichen, Posteingang abarbeiten. Pausieren bringt dich zurück zum Board. Der Fortschritt bleibt gespeichert, Start zeigt ihn an. Ohne lokale KI kannst du die Schritte 4 und 5 überspringen. In Schritt 4 geht ohne KI nur das Zusammenlegen nach der Messung. Bei den Ausreißern verschiebst du eine Mail mit Bestätigung und Rückgängig, lässt sie mit „Bleibt hier“ als richtig stehen oder nimmst sie mit „Nicht lernen“ dauerhaft vom Lernen aus. Ohne Embeddings prüft das Board die Ausreißer mit Bayes. Beim Verfeinern der Struktur unterteilst du überfüllte Ordner, legst ähnliche Ordner zusammen und benennst unklare Ordner um. Mit „Posteingang prüfen“ gruppiert das Board Mails ohne passenden Lernordner. Für jede Gruppe ab fünf Mails bekommst du einen Namensvorschlag, den du änderst, und wählst den Elternordner. „Anlegen und verteilen“ legt den Ordner an, nimmt ihn als Lernziel auf und verschiebt die Mails mit Bestätigung und Rückgängig. Beim Zusammenlegen wandern alle Mails in den anderen Ordner, der leere Ordner kommt nach „_Zusammengelegt“. Gelöscht wird nichts, Rückgängig stellt Ordner und Mails wieder her. Bei den Steckbriefen entwirft die lokale KI nacheinander einen Vorschlag für jeden Lernordner ohne Steckbrief. Du bearbeitest ihn, übernimmst ihn oder verwirfst ihn, gespeichert wird nur Übernommenes. „Neu lernen und vergleichen“ wiederholt die Messung und stellt sie dem Ausgangswert gegenüber. Ordner mit schlechterer Trefferquote sind markiert. Beim Abarbeiten des Posteingangs liest das Board bis zu 2.000 Mails ohne Status, älteste zuerst. Sichere Vorschläge legst du als Stapel je Zielordner ab, jeder Stapel ist ein Rückgängig-Schritt. Unsichere gehst du mit „Einzeln durchgehen“ im Aufräumen durch. Mails ohne Ziel, die älter als die eingestellte Grenze sind (Standard drei Monate), verschiebst du gesammelt ins Archiv. Ohne Archivordner führt dich der Schritt zur Ordnerwahl zurück. „Einrichtung abschließen“ beendet den letzten Schritt. Sind alle Schritte erledigt oder übersprungen, verschwindet der Fortschritt aus Start.'],
  ['Was passiert bei fehlender KI?', 'Die lokale KI ist optional. Du kannst dein Board auch bei ausgeschaltetem oder langsamem Modell weiter bedienen.'],
  ['Welches Modell macht was?', 'In den Einstellungen unter „Lokale KI“ wählst du zwei Sprachmodelle. Das Modell für Hintergrund analysiert Mails, entscheidet die KI-Stichwahl zwischen zwei Ordnern und findet Aufgaben. Das Modell für Entwürfe schreibt Antworten, Steckbriefe und Ordnernamen. Bleibt das Feld für Entwürfe leer, nutzt das Board für beides dasselbe Modell. Unter jedem Modell steht, was der lokale Modellserver meldet: Größe, Quantisierung, Kontextlänge und ob das Modell auf der GPU läuft oder noch nicht geladen ist. „Verbindung testen“ prüft, dass beide Modelle lokal laufen. Mailinhalte gehen nie an ein Modell, das extern ausgeführt wird.'],
  ['Was ist die KI-Stichwahl?', 'Liegen zwei Ordner beim Vergleich mit den Ordnerprofilen fast gleichauf, fragt das Board das Modell für Hintergrund kurz, welcher der beiden passt. Es bekommt nur Betreff, den Anfang der Mail und die Steckbriefe der beiden Ordner. Der Grund steht im Vorschlag hinter „KI-Stichwahl“. Nennt das Modell keinen der beiden, bleibt der gemessene Vorschlag stehen.'],
  ['Was bewirken „passt“ und „passt nicht“?', 'In den Maildetails bewertest du Zusammenfassung, „Antwort nötig“ und Frist der lokalen KI. Ein zweiter Klick nimmt deine Stimme zurück. Zusätzlich zählt das Board, ob du Ablage- und Vorgangsvorschläge übernimmst, welche erkannten Aufgaben du übernimmst und wie stark du einen Antwortentwurf vor dem Öffnen in Outlook änderst. Gespeichert werden nur Zahlen je Tag, Funktion und Modell, keine Mailinhalte, höchstens 90 Tage lang. Im Beispielpostfach wird nichts gespeichert. Daraus entsteht später eine Auswertung der KI-Qualität.'],
  ['Einführung erneut zeigen', 'Die kurze Einführung zeigt in drei Schritten das Board, die Karten und die Tab-Leiste. Sie startet mit dem Knopf „Einführung erneut zeigen“ unter den Hilfethemen und ist über Weiter, Überspringen oder Escape bedienbar.'],
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
    const again=button('Einführung erneut zeigen',()=>{dialog.close();showIntro()})
    body.append(input,found,button('Tastenkürzel anzeigen',()=>open('shortcuts')),again)
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
      const focusCount=options.getMails().filter(m=>isFocusCard(m,day)).length
      const show=(run:()=>void)=>()=>{dialog.close();run()}
      const stats=element('div');stats.className='cockpit-actions'
      stats.append(button(s.due.length+' fällig',show(()=>options.showFocus('today'))),
        button(focusCount+' im Fokus',show(()=>options.showFocus('focus'))),
        button(s.late.length+' wartend und fällig',show(options.showOverdue)))
      const triage=button(options.triageActive()?'Morgen-Triage fortsetzen':'Morgen-Triage starten',startTriage)
      triage.className='cockpit-primary'
      const setup=options.setupProgress()
      if(setup){
        const row=element('p',setup+' ');row.className='cockpit-setup'
        row.append(link('Einrichtung öffnen',options.openSetup))
        body.append(row)
      }
      body.append(element('h3','Heute'),stats,triage,element('h3','Routinen heute'))
      const due=dueRoutines(options.routines(),day)
      if(!due.length)body.append(element('p','Keine Routine fällig.'))
      for(const {routine} of due){
        const row=element('div');row.className='cockpit-actions'
        row.append(element('span',routine.title),button('Erledigt',()=>{options.markRoutine(routine.id);render()}))
        row.lastElementChild?.setAttribute('aria-label',routine.title+' erledigt')
        body.append(row)
      }
      const more=actions(go('Warten-Hygiene','hygiene'),go('Wochenblick','week'),go('Ablage-Auswertung','learning'),button('Posteingang aufräumen',()=>{dialog.close();void openCleanup()}))
      body.append(element('h3','Weitere Ansichten'),more)
      const startup=element('input');startup.type='checkbox';startup.checked=preference(launchKey)
      startup.onchange=()=>remember(launchKey,startup.checked)
      const label=element('label');label.append(startup,' Diese Übersicht beim Start öffnen')
      body.append(label)
      if(!preference(versionKey)){
        const intro=element('p');intro.className='cockpit-note'
        intro.append('Mail-Board '+metadata.version+' lädt dein klassisches Outlook-Profil beim Start. ',
          button('Ausblenden',()=>{remember(versionKey,true);intro.remove()}))
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
      const tipRow=element('p');tipRow.className='cockpit-note'
      tipRow.append('Tipp: '+tip+' ',button('Mehr in der Hilfe',()=>{helpTerm=term;open('help')}))
      body.append(tipRow)
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
    /** Ohne Liste der Rückstand des Boards, mit Liste genau diese Mails (E7). */
    openCleanup:(list?:ViewMail[],onClose?:()=>void)=>void openCleanup(list,onClose),
    record(action:Action,delta=1) {
      recordWeekly(options.isLive(),action,delta)
    },
  }
}
