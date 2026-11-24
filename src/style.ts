/** Gespeicherter Stilsteckbrief (C3). Kein automatisches Nachlernen. */
export const styleKey = 'mailboard-writing-style-v1'

export type StyleCard = {anrede:string; form:string; gruss:string; laenge:string; wendungen:string}
export type SentSample = {to:string; subject:string; text:string; received?:string}

export function styleText(card: StyleCard): string {
  const form = card.form==='Du' || card.form==='Sie' ? card.form : ''
  return ['Anrede: '+card.anrede, 'Ansprache: '+form, 'Grußformel: '+card.gruss, 'Länge: '+card.laenge, 'Wendungen: '+card.wendungen].join('\n')
}

export function formOf(text: string): ''|'Du'|'Sie' {
  const line = text.split('\n').find(row => row.startsWith('Ansprache:'))
  const value = line ? line.slice('Ansprache:'.length).trim() : ''
  return value==='Du' || value==='Sie' ? value : ''
}

function emailOf(value: string): string {
  const match = value.match(/[^\s<>]+@[^\s<>]+/)
  return (match ? match[0] : value).trim().toLocaleLowerCase('de')
}

function greetingForm(text: string): ''|'Du'|'Sie' {
  const head = text.slice(0, 400)
  if (/\b(Sehr geehrte|Guten Tag|Ihnen|Ihre)\b/.test(head) || /\bSie\b/.test(head)) return 'Sie'
  if (/\b(Hallo|Hi|dir|dein|deine|du)\b/i.test(head)) return 'Du'
  return ''
}

/** Neueste eigene Mail an diesen Empfänger bestimmt Du oder Sie. */
export function addressForm(recipient: string, samples: SentSample[]): ''|'Du'|'Sie' {
  const needle = emailOf(recipient)
  if (!needle || needle.indexOf('@')<0) return ''
  const mine = samples.filter(sample => sample.to.split(/[,;]/).some(part => emailOf(part)===needle))
  mine.sort((a, b) => (b.received||'').localeCompare(a.received||''))
  for (const sample of mine) {
    const form = greetingForm(sample.text)
    if (form) return form
  }
  return ''
}
