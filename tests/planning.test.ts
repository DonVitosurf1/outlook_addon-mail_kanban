import {strict as assert} from 'node:assert'
import test from 'node:test'
import {
  addDays, briefing, briefingText, calendarEntries, caseMails, caseNameProblem, caseNames, caseTag, describeRhythm, dueRoutines, focusTarget,
  hasFocus, inTriageStep, isFocusCard, isoWeek, isoWeekday, knownCases, lastOccurrence, newSince, normalizeCase, normalizeRoutine,
  plannedField, routineDue, weekDays, weekStart, withTag, type Case, type Routine,
} from '../src/planning-logic'
import type {ViewMail} from '../src/views-logic'

const today='2026-11-20' // Freitag
const mail:ViewMail={id:'A',subject:'Angebot',sender:'Labor',body:'',folder:'Posteingang',tags:[],attachments:[],status:'Offen'}

test('Kalendertage: Wochenbeginn, ISO-Wochentag und Kalenderwoche',()=>{
  assert.equal(isoWeekday(today),5)
  assert.equal(weekStart(today),'2026-11-16')
  assert.deepEqual(weekDays('2026-11-22'),['2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-21','2026-11-22'])
  assert.equal(addDays('2026-02-28',1),'2026-03-01')
  assert.equal(isoWeek(today),47)
  assert.equal(isoWeek('2027-01-01'),53)
})

test('Triage-Schritte filtern fällige und offene Karten, Wiedervorlagen bleiben draußen',()=>{
  const due={...mail,id:'D',status:'Warten',followUp:'2026-11-19'}
  const open={...mail,id:'O'}
  const sleeping={...mail,id:'S',snoozeUntil:'2026-11-25'}
  const sent={...mail,id:'G',isSent:true}
  const rows=[due,open,sleeping,sent]
  assert.deepEqual(rows.filter(m=>inTriageStep(m,0,today)).map(m=>m.id),['D'])
  assert.deepEqual(rows.filter(m=>inTriageStep(m,1,today)).map(m=>m.id),['O'])
  assert.deepEqual(rows.filter(m=>inTriageStep(m,2,today)).map(m=>m.id),['O'])
  // Eine Statusänderung nimmt die Karte aus dem Schritt.
  assert(!inTriageStep({...open,status:'In Bearbeitung'},1,today))
})

test('Neu seit letzter Triage nutzt den Zeitstempel, ohne ihn die letzten 24 Stunden',()=>{
  const now=Date.parse('2026-11-20T08:00:00')
  const rows=[{...mail,id:'1',received:'2026-11-20T07:00:00'},{...mail,id:'2',received:'2026-11-19T09:00:00'},
    {...mail,id:'3',received:'2026-11-18T09:00:00'},{...mail,id:'4',received:'2026-11-20T07:30:00',isSent:true}]
  assert.deepEqual(newSince(rows,undefined,now).map(m=>m.id),['1','2'])
  assert.deepEqual(newSince(rows,Date.parse('2026-11-20T06:00:00'),now).map(m=>m.id),['1'])
})

test('Fokus wird als Kategorie gesetzt und gelöst, Großschreibung spielt keine Rolle',()=>{
  assert.deepEqual(withTag(['Wichtig'],'Fokus',true),['Wichtig','Fokus'])
  assert.deepEqual(withTag(['fokus','Wichtig'],'Fokus',false),['Wichtig'])
  assert.deepEqual(withTag(['FOKUS'],'Fokus',true),['Fokus'])
  assert(hasFocus({tags:['fOkUs']}))
  assert.equal(focusTarget([{tags:['Fokus']},{tags:[]}]),true)
  assert.equal(focusTarget([{tags:['Fokus']},{tags:['Fokus']}]),false)
  assert(isFocusCard({...mail,tags:['Fokus']},today))
  assert(!isFocusCard({...mail,tags:['Fokus'],status:'Erledigt'},today))
  assert(!isFocusCard({...mail,tags:['Fokus'],snoozeUntil:'2026-11-23'},today))
})

const routine=(r:Partial<Routine>):Routine=>({id:'r',title:'Reisekosten',rhythm:'daily',created:'2026-11-01',...r})
test('Routinen: Rhythmen, verpasste Termine bleiben fällig, Anlagetag begrenzt',()=>{
  assert.equal(lastOccurrence(routine({rhythm:'weekdays'}),'2026-11-22'),'2026-11-20')
  assert.equal(lastOccurrence(routine({rhythm:'weekly',weekday:1}),today),'2026-11-16')
  assert.deepEqual(routineDue(routine({rhythm:'weekly',weekday:1}),today),{due:true,since:'2026-11-16'})
  assert.equal(routineDue(routine({rhythm:'weekly',weekday:1,lastDone:'2026-11-17'}),today).due,false)
  assert.equal(routineDue(routine({rhythm:'weekly',weekday:1,created:'2026-11-18'}),today).due,false)
  // Der 31. fällt im Februar auf den Monatsletzten.
  assert.equal(lastOccurrence(routine({rhythm:'monthly',monthDay:31}),'2027-02-28'),'2027-02-28')
  assert.equal(lastOccurrence(routine({rhythm:'monthly',monthDay:31,created:'2026-01-01'}),'2027-02-27'),'2027-01-31')
  assert.deepEqual(dueRoutines([routine({}),routine({id:'x',lastDone:today})],today).map(r=>r.routine.id),['r'])
  assert.equal(describeRhythm(routine({rhythm:'weekly',weekday:3})),'Jeden Mittwoch')
})

test('Routinen und Vorgänge aus dem Speicher werden geprüft und bereinigt',()=>{
  assert.equal(normalizeRoutine({id:'1',title:' ',rhythm:'daily',created:today}),undefined)
  assert.equal(normalizeRoutine({id:'1',title:'X',rhythm:'yearly',created:today}),undefined)
  assert.deepEqual(normalizeRoutine({id:'1',title:' X ',rhythm:'weekly',weekday:9,created:today,action:'hygiene',lastDone:'kaputt'}),
    {id:'1',title:'X',rhythm:'weekly',weekday:1,created:today,action:'hygiene'})
  assert.equal(normalizeCase({name:'A,B',created:today,items:[]}),undefined)
  assert.deepEqual(normalizeCase({name:'Umzug',created:today,items:[{id:'1',text:'Kisten',done:true,due:'2026-11-21'},{id:'2',text:''},null]}),
    {name:'Umzug',created:today,items:[{id:'1',text:'Kisten',done:true,due:'2026-11-21'}]})
})

test('Vorgänge: Namen, Zuordnung über Kategorien und nur in Outlook bekannte Vorgänge',()=>{
  const cases:Case[]=[{name:'Umzug Labor',created:today,items:[]}]
  assert.equal(caseNameProblem(''),'Bitte einen Namen eingeben.')
  assert.match(caseNameProblem('A;B'),/Semikolon/)
  assert.match(caseNameProblem('umzug labor',cases),/bereits/)
  assert.equal(caseNameProblem('Neubau',cases),'')
  const tagged={...mail,tags:[caseTag('Umzug Labor'),'Wichtig',caseTag('Messe')]}
  assert.deepEqual(caseNames(tagged),['Umzug Labor','Messe'])
  assert.deepEqual(caseMails([tagged,mail],'umzug labor').map(m=>m.id),['A'])
  const merged=knownCases([...cases,{name:'Alt',created:today,closed:today,items:[]}],[tagged],today)
  assert.deepEqual(merged.map(c=>c.name),['Messe','Umzug Labor','Alt'])
})

test('Wochenkalender: Fristen, Überfälliges, Routinen und Checklistenpunkte',()=>{
  const days=weekDays(today)
  const rows:ViewMail[]=[
    {...mail,id:'W',status:'Warten',followUp:'2026-11-18'},
    {...mail,id:'S',snoozeUntil:'2026-11-21'},
    {...mail,id:'K',deadline:'2026-11-20'},
    {...mail,id:'E',status:'Erledigt',deadline:'2026-11-20'},
    {...mail,id:'P',snoozeUntil:'2026-11-17'},
  ]
  const routines=[routine({id:'mo',title:'Wochenplanung',rhythm:'weekly',weekday:1}),routine({id:'fr',title:'Ablage',rhythm:'weekly',weekday:5})]
  const cases:Case[]=[{name:'Umzug',created:today,items:[{id:'1',text:'Kisten bestellen',done:false,due:'2026-11-19'},{id:'2',text:'Schlüssel',done:false,due:'2026-11-22'}]}]
  const {overdue,byDay}=calendarEntries(rows,routines,cases,days,today)
  assert.deepEqual(overdue.map(e=>[e.kind,e.day]),[['routine','2026-11-16'],['followUp','2026-11-18'],['checklist','2026-11-19']])
  assert.deepEqual(byDay.get('2026-11-20')!.map(e=>e.kind),['routine','deadline'])
  assert.deepEqual(byDay.get('2026-11-21')!.map(e=>e.mailId),['S'])
  assert.deepEqual(byDay.get('2026-11-16'),[])
  assert.deepEqual(byDay.get('2026-11-17'),[])
  assert.deepEqual(byDay.get('2026-11-22')!.map(e=>e.label),['Schlüssel'])
  assert.equal(plannedField({status:'Warten'}),'followUp')
  assert.equal(plannedField({status:'Offen'}),'snoozeUntil')
})

test('Briefing bündelt Zahlen, Neues, Fokus, Routinen und fällige Checklistenpunkte',()=>{
  const now=Date.parse('2026-11-20T08:00:00')
  const rows:ViewMail[]=[
    {...mail,id:'N',received:'2026-11-20T06:00:00',needsReply:true},
    {...mail,id:'F',tags:['Fokus'],received:'2026-11-10T06:00:00'},
    {...mail,id:'D',status:'Warten',followUp:'2026-11-19',received:'2026-11-10T06:00:00'},
  ]
  const result=briefing(rows,{today,now,since:Date.parse('2026-11-19T18:00:00'),routines:[routine({})],
    cases:[{name:'U',created:today,items:[{id:'1',text:'a',done:false,due:today},{id:'2',text:'b',done:true,due:today}]}]})
  assert.deepEqual(result.fresh.map(m=>m.id),['N'])
  assert.deepEqual(result.reply.map(m=>m.id),['N'])
  assert.deepEqual(result.focus.map(m=>m.id),['F'])
  assert.deepEqual(result.due.map(m=>m.id),['D'])
  assert.equal(result.routines.length,1)
  assert.deepEqual(result.checklist.map(c=>c.item.text),['a'])
})

test('Briefing-Text: ohne Analysen nur Satz 1, nur neue Mails',()=>{
  const fresh=[{...mail,id:'1',received:'2026-11-20T06:00:00'}]
  assert.equal(briefingText(briefing(fresh,{today,now:Date.parse('2026-11-20T08:00:00'),since:Date.parse('2026-11-19T18:00:00')}),{today,since:'seit Do 17:40'}),'1 neue Mail seit Do 17:40.')
  assert.equal(briefingText(briefing([],{today}),{today}),'Keine neuen Mails in den letzten 24 Stunden.')
})

test('Briefing-Text: Antwort nötig mit drei bzw. fünf Mails, Kürzung und Frist heute',()=>{
  const row=(i:number,x:object={})=>({...mail,id:String(i),subject:'M'+i,needsReply:true,...x}) as ViewMail
  const three=[row(1,{aiSummary:'Preis klären'}),row(2),row(3)]
  assert.equal(briefingText(briefing(three,{today}),{today}),'Keine neuen Mails in den letzten 24 Stunden. Antwort nötig: M1 (Preis klären), M2, M3.')
  const five=[1,2,3,4,5].map(i=>row(i))
  assert.match(briefingText(briefing(five,{today}),{today}),/Antwort nötig: M1, M2, M3 und 2 weitere\.$/)
  const long=[row(1,{aiSummary:'x'.repeat(100)})]
  assert.ok(briefingText(briefing(long,{today}),{today}).includes('('+'x'.repeat(59)+'…)'))
  const dl=[{...mail,id:'a',subject:'Bestellung',deadline:today},{...mail,id:'b',subject:'Alt',deadline:'2026-11-10'},{...mail,id:'c',subject:'Später',deadline:'2026-11-25'}]
  assert.equal(briefingText(briefing(dl,{today}),{today}),'Keine neuen Mails in den letzten 24 Stunden. Frist heute: Bestellung.')
})
