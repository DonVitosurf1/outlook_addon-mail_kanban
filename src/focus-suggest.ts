/** Bis zu drei Tagesfokus-Vorschläge für Triage-Schritt 1. Reine Auswahl, ohne DOM. */
import {hasFocus} from './planning-logic'
import {dueReasons, isSnoozed, localDay, matchesSplit, type ViewMail} from './views-logic'

export type FocusReason = 'frist' | 'aufgabe' | 'vip' | 'warten'
export type FocusMail = ViewMail & {aiTasks?: readonly {text: string; frist: string | null}[]}
export type FocusPick = {id: string; reason: FocusReason}
export const focusReasonText: Record<FocusReason, string> = {
  frist: 'Frist heute',
  aufgabe: 'Aufgabe mit Frist',
  vip: 'VIP',
  warten: 'Warten überfällig',
}
const rank: Record<FocusReason, number> = {frist: 0, aufgabe: 1, vip: 2, warten: 3}
const day = (value?: string | null) => value?.slice(0, 10) || ''

function reasonOf(mail: FocusMail, today: string, overdueDays: number, vips: readonly string[]): FocusReason | undefined {
  if (mail.status === 'Erledigt' || isSnoozed(mail, today) || hasFocus(mail)) return
  if (day(mail.deadline) === today) return 'frist'
  if ((mail.aiTasks || []).some(task => { const due = day(task.frist); return !!due && due <= today })) return 'aufgabe'
  if (vips.some(token => token.trim()) && matchesSplit(mail, 'vip', [...vips], today, overdueDays)) return 'vip'
  if (mail.status !== 'Warten' || mail.hasReply) return
  const reasons = dueReasons(mail, today, overdueDays)
  if (reasons.includes('Überfällig') || (reasons.includes('Nachfassen') && day(mail.followUp) < today)) return 'warten'
}

export function focusSuggestions(mails: readonly FocusMail[], options: {today?: string; overdueDays?: number; vips?: readonly string[]; dismissed?: ReadonlySet<string> | readonly string[]; limit?: number} = {}): FocusPick[] {
  const today = options.today || localDay()
  const overdueDays = options.overdueDays ?? 5
  const vips = options.vips || []
  const skip = options.dismissed instanceof Set ? options.dismissed : new Set(options.dismissed || [])
  const limit = options.limit ?? 3
  return mails.flatMap(mail => {
    if (skip.has(mail.id)) return []
    const reason = reasonOf(mail, today, overdueDays, vips)
    return reason ? [{mail, reason}] : []
  }).sort((a, b) => rank[a.reason] - rank[b.reason]
    || (a.mail.subject || '').localeCompare(b.mail.subject || '', 'de')
    || a.mail.id.localeCompare(b.mail.id))
    .slice(0, Math.max(0, limit))
    .map(({mail, reason}) => ({id: mail.id, reason}))
}
