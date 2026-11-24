import {strict as assert} from 'node:assert'
import test from 'node:test'
import {focusSuggestions, type FocusMail} from '../src/focus-suggest'
import {skipFocus, skippedFocus, useSamplePlanning} from '../src/planning-store'

const today = '2026-11-20'
const mail = (id: string, extra: Partial<FocusMail> = {}): FocusMail => ({
  id, subject: id, sender: 'Labor', body: '', folder: 'Posteingang', tags: [], attachments: [], status: 'Offen', ...extra,
})

test('bis zu drei Vorschläge: Frist heute vor Aufgabe, VIP und überfälligem Warten', () => {
  const rows = [
    mail('W', {status: 'Warten', statusSince: '2026-11-01', subject: 'Warten alt'}),
    mail('V', {sender: 'Chef', subject: 'VIP Mail'}),
    mail('A', {subject: 'Aufgabe', aiTasks: [{text: 'Angebot freigeben', frist: '2026-11-20'}]}),
    mail('F', {subject: 'Frist', deadline: '2026-11-20'}),
    mail('X', {subject: 'Später', deadline: '2026-11-25'}),
    mail('D', {status: 'Erledigt', deadline: '2026-11-20'}),
    mail('S', {deadline: '2026-11-20', snoozeUntil: '2026-11-25'}),
    mail('H', {deadline: '2026-11-20', tags: ['Fokus']}),
    mail('Z', {aiTasks: [{text: 'irgendwann', frist: '2026-12-01'}]}),
  ]
  const picked = focusSuggestions(rows, {today, vips: ['chef'], overdueDays: 5})
  assert.deepEqual(picked.map(item => item.id), ['F', 'A', 'V'])
  assert.deepEqual(picked.map(item => item.reason), ['frist', 'aufgabe', 'vip'])
})

test('abgewählte Vorschläge rücken den nächsten Grund nach, gleiche Gründe nach Betreff', () => {
  const rows = [
    mail('b', {deadline: today, subject: 'Beta'}),
    mail('a', {deadline: today, subject: 'Alpha'}),
    mail('old', {aiTasks: [{text: 'gestern', frist: '2026-11-19'}], subject: 'Alte Aufgabe'}),
  ]
  assert.deepEqual(focusSuggestions(rows, {today, dismissed: ['b']}).map(item => item.id), ['a', 'old'])
  assert.equal(focusSuggestions(rows, {today, dismissed: ['b']})[1].reason, 'aufgabe')
})

test('überfälliges Warten zählt verstrichene Nachfassfristen und Warten ohne Datum, nicht das Nachfassen von heute', () => {
  const rows = [
    mail('late', {status: 'Warten', followUp: '2026-11-19', subject: 'Zu spät'}),
    mail('due', {status: 'Warten', followUp: today, subject: 'Heute'}),
    mail('bare', {status: 'Warten', statusSince: '2026-11-13', subject: 'Ohne Datum'}),
    mail('fresh', {status: 'Warten', statusSince: '2026-11-19', subject: 'Frisch'}),
    mail('answered', {status: 'Warten', hasReply: true, statusSince: '2026-11-01', subject: 'Antwort da'}),
  ]
  assert.deepEqual(focusSuggestions(rows, {today, overdueDays: 5}).map(item => item.id), ['bare', 'late'])
  assert.deepEqual(focusSuggestions(rows, {today, overdueDays: 5}).map(item => item.reason), ['warten', 'warten'])
})

test('VIP gilt für den Absender und bei gesendeten Mails für den Empfänger', () => {
  const rows = [
    mail('in', {sender: 'Anna Weber <anna@labor.de>', subject: 'Eingang'}),
    mail('out', {isSent: true, sender: 'Ich', recipients: 'Anna Weber <anna@labor.de>', subject: 'Rückfrage'}),
    mail('other', {sender: 'Newsletter', subject: 'Rundbrief'}),
  ]
  assert.deepEqual(focusSuggestions(rows, {today, vips: ['anna@labor.de']}).map(item => item.id), ['in', 'out'])
})

test('Abwählen gilt nur für den heutigen Tag und im Beispielpostfach nur im Speicher', () => {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
  }})
  useSamplePlanning(false)
  skipFocus('A', today)
  assert.deepEqual([...skippedFocus(today)], ['A'])
  assert.deepEqual([...skippedFocus('2026-11-21')], [])
  useSamplePlanning(true)
  assert.deepEqual([...skippedFocus(today)], [])
  skipFocus('B', today)
  assert.deepEqual([...skippedFocus(today)], ['B'])
  assert.equal(store.has('mailboard-focus-skip-v1') ? JSON.parse(store.get('mailboard-focus-skip-v1')!).ids.includes('B') : false, false)
  useSamplePlanning(false)
})
