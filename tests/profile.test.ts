import test from 'node:test'
import assert from 'node:assert/strict'
import {profileDocument,profileName} from '../src/profile-file'

test('Python-Slug, Projekttemplate und Markdown-Neuzuordnung nach Verschieben',()=>{
  assert.equal(profileName('/01 Projekte/Fuß & Geräte'),'01-projekte-fuss-und-geraete.md')
  const before=profileDocument('/01 Projekte/Labor','Offene Bestellungen','01 Projekte','2026-02-10')
  assert.match(before,/kind: projekt/)
  const after=profileDocument('/01 Projekte/_Abgeschlossen/Labor',before,'01 Projekte','2026-03-12')
  assert.match(after,/updated: 2026-03-12/)
  assert.match(after,/## Zweck\nOffene Bestellungen/)
  assert.equal(after.split('folder: ').length,2)
})
