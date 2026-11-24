import {strict as assert} from 'node:assert'
import {readFileSync} from 'node:fs'
import test from 'node:test'

// Farben der Kennzeichen, Einrichtung, Vorgang-Vorschläge, Rückmeldung und Menüs kommen aus den Tokens auf :root (DESIGN.md).
const css=readFileSync('board.css','utf8').replace(/\/\*[\s\S]*?\*\//g,'')
const literal=/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i
const tokenized=/\.(flag-|setup-|case-suggest|toast|card-menu|intro-pop|cockpit-setup|arrival-mark|card-attention|semantic|calendar-day\.today)/

test('Neue Regeln verwenden Farb-Tokens statt fester Werte',()=>{
  const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m=>({selector:m[1].trim(),body:m[2]}))
  const root=rules.find(r=>r.selector===':root')
  assert.ok(root&&root.body.includes('--flag-due:'),'Tokens auf :root')
  const offenders=rules.filter(r=>tokenized.test(r.selector)&&literal.test(r.body)).map(r=>r.selector)
  assert.deepEqual(offenders,[])
})
