/** Nachfassdatum beim Setzen auf „Warten“: Frist, sonst übliche Antwortzeit, sonst der Standard. */
import {addDays} from './planning-logic'
import {localDay} from './views-logic'

export type FollowSource = 'frist' | 'verlauf' | 'standard'
export type FollowSuggestion = {day: string; source: FollowSource; days: number}
export type FollowMail = {
  sender?: string; recipients?: string; isSent?: boolean; received?: string; conversationId?: string; deadline?: string
}
export const followSourceText: Record<FollowSource, string> = {
  frist: 'Frist in der Mail',
  verlauf: 'übliche Antwortzeit',
  standard: 'Standard aus den Einstellungen',
}

function party(mail: FollowMail) {
  const raw = (mail.isSent ? mail.recipients : mail.sender) || ''
  const address = raw.match(/[^\s<>"]+@[^\s<>"]+/)
  return (address ? address[0] : raw).trim().toLocaleLowerCase('de')
}
function median(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}
/** Kalendertage zwischen einer gesendeten Mail und der nächsten Antwort derselben Person. */
function replyDays(who: string, history: readonly FollowMail[]) {
  if (who.length < 3) return []
  const groups = new Map<string, FollowMail[]>()
  for (const row of history) {
    if (!row.conversationId || party(row) !== who) continue
    const list = groups.get(row.conversationId) || []
    list.push(row)
    groups.set(row.conversationId, list)
  }
  const samples: number[] = []
  for (const rows of groups.values()) {
    for (const sent of rows.filter(row => row.isSent)) {
      const start = Date.parse(sent.received || '')
      if (!Number.isFinite(start)) continue
      const reply = rows.filter(row => !row.isSent).map(row => Date.parse(row.received || ''))
        .filter(stamp => Number.isFinite(stamp) && stamp >= start).sort((a, b) => a - b)[0]
      if (reply === undefined) continue
      const days = Math.round((reply - start) / 86400000)
      if (days >= 0 && days <= 120) samples.push(Math.max(1, days))
    }
  }
  return samples
}

export function suggestFollowUp(mail: FollowMail, history: readonly FollowMail[], options: {today?: string; defaultDays?: number} = {}): FollowSuggestion {
  const today = options.today || localDay()
  const deadline = (mail.deadline || '').slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(deadline) && deadline >= today) {
    const days = Math.round((Date.parse(deadline + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000)
    return {day: deadline, source: 'frist', days}
  }
  const samples = replyDays(party(mail), history)
  const fallback = Number.isInteger(options.defaultDays) && (options.defaultDays as number) >= 1 ? Math.min(options.defaultDays as number, 365) : 5
  const typical = samples.length >= 2
  const days = typical ? Math.min(60, Math.max(1, median(samples))) : fallback
  return {day: addDays(today, days), source: typical ? 'verlauf' : 'standard', days}
}
