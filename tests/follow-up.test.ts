import {strict as assert} from 'node:assert'
import test from 'node:test'
import {suggestFollowUp, type FollowMail} from '../src/follow-up'

const today = '2026-11-24'
const mail = (extra: Partial<FollowMail> = {}): FollowMail => ({
  sender: 'Anna Weber <anna@labor.de>', subject: 'Rückfrage', ...extra,
})

test('eine künftige Frist in der Mail wird der Nachfasstermin', () => {
  const result = suggestFollowUp(mail({deadline: '2026-11-27'}), [], {today, defaultDays: 5})
  assert.deepEqual(result, {day: '2026-11-27', source: 'frist', days: 3})
  const past = suggestFollowUp(mail({deadline: '2026-11-01'}), [], {today, defaultDays: 5})
  assert.equal(past.source, 'standard')
  assert.equal(past.day, '2026-11-29')
})

test('zwei Antworten derselben Person ergeben den Median, eine Antwort bleibt beim Standard', () => {
  const history: FollowMail[] = [
    {isSent: true, recipients: 'anna@labor.de', conversationId: 'a', received: '2026-11-01T08:00:00Z'},
    {sender: 'Anna <anna@labor.de>', conversationId: 'a', received: '2026-11-05T08:00:00Z'},
    {isSent: true, recipients: 'anna@labor.de', conversationId: 'b', received: '2026-11-10T08:00:00Z'},
    {sender: 'anna@labor.de', conversationId: 'b', received: '2026-11-12T08:00:00Z'},
    {isSent: true, recipients: 'andere@labor.de', conversationId: 'c', received: '2026-11-01T08:00:00Z'},
    {sender: 'andere@labor.de', conversationId: 'c', received: '2026-11-20T08:00:00Z'},
  ]
  const typical = suggestFollowUp(mail(), history, {today, defaultDays: 5})
  assert.deepEqual(typical, {day: '2026-11-27', source: 'verlauf', days: 3})
  const thin = suggestFollowUp(mail(), history.slice(0, 2), {today, defaultDays: 5})
  assert.equal(thin.source, 'standard')
  assert.equal(thin.days, 5)
})

test('eine Antwort am selben Tag zählt als ein Tag, gesendete Mails nutzen den Empfänger', () => {
  const history: FollowMail[] = [
    {isSent: true, recipients: 'Einkauf <einkauf@labor.de>', conversationId: 'a', received: '2026-11-02T09:00:00Z'},
    {sender: 'einkauf@labor.de', conversationId: 'a', received: '2026-11-02T18:00:00Z'},
    {isSent: true, recipients: 'einkauf@labor.de', conversationId: 'b', received: '2026-11-08T09:00:00Z'},
    {sender: 'Einkauf <einkauf@labor.de>', conversationId: 'b', received: '2026-11-08T12:00:00Z'},
  ]
  const sent = mail({isSent: true, sender: 'Ich', recipients: 'Einkauf <einkauf@labor.de>'})
  assert.deepEqual(suggestFollowUp(sent, history, {today, defaultDays: 9}), {day: '2026-11-25', source: 'verlauf', days: 1})
})
