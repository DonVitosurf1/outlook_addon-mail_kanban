import demo from './demo.json'

/** Sechs Mails aus dem Beispielpostfach mit Sollwert „Antwort nötig“ (A2). Keine echten Mails. */
const EXPECTED: Record<string, boolean> = {
  DEMO0000: false,
  DEMO0001: true,
  DEMO0003: false,
  DEMO0004: true,
  DEMO0005: true,
  DEMO0006: false,
}

export type BenchMail = {subject:string; sender:string; body:string; reply:boolean}
export type BenchRow = {valid:boolean; hit:boolean; seconds:number}

export const BENCH: BenchMail[] = Object.entries(EXPECTED).map(([id, reply]) => {
  const mail = demo.find(row => row.id===id)
  if (!mail) throw new Error('Beispielmail fehlt: '+id)
  return {subject:mail.subject, sender:mail.sender, body:mail.body, reply}
})

export function benchGrade(rows: BenchRow[]): string {
  const total = rows.length
  const hits = rows.filter(row => row.hit).length
  const valid = rows.filter(row => row.valid).length
  const seconds = total ? rows.reduce((sum, row) => sum+row.seconds, 0)/total : 0
  const rate = total ? hits/total : 0
  const note = rate>=0.9 ? 'Sehr gut' : rate>=0.75 ? 'Gut' : rate>=0.5 ? 'Befriedigend' : 'Schwach'
  const tempo = seconds.toLocaleString('de-DE', {maximumFractionDigits:1})
  return note+' · '+hits+' von '+total+' Treffer · '+valid+' gültig · '+tempo+' s je Mail'
}
