import assert from 'node:assert/strict'
import test from 'node:test'
import {mailAge} from '../src/card-content'
import {snapshot} from '../src/cockpit'
import type {ViewMail} from '../src/views-logic'

const mail:ViewMail = {id:'1',status:'Warten',subject:'Anfrage',sender:'Lieferant',body:'',folder:'Posteingang',tags:[],attachments:[]}
test('Heute und Warten-Hygiene berücksichtigen Fristen, Antwort und Wiedervorlage',()=>{
  const old={...mail,statusSince:'2026-11-02'}
  const undated={...mail,id:'2',statusSince:'2026-11-19'}
  const answered={...mail,id:'3',hasReply:true,followUp:'2026-11-18'}
  const snoozed={...mail,id:'4',snoozeUntil:'2026-11-23'}
  const finished={...mail,id:'5',status:'Erledigt',deadline:'2026-11-18'}
  const due={...mail,id:'6',followUp:'2026-11-20',deadline:'2026-11-20'}
  const report=snapshot([old,undated,answered,snoozed,finished,due],'2026-11-20')
  assert.deepEqual(report.due.map(m=>m.id),['1','3','6'])
  assert.deepEqual(report.late.map(m=>m.id),['1','6'])
  assert.deepEqual(report.undated.map(m=>m.id),['2'])
  assert.equal(report.snoozed,1)
  assert.equal(report.active.length,5)
})

test('Kartenalter verwendet lokale Kalendertage statt einer 24-Stunden-Differenz',()=>{
  const now=new Date(2026,10,20,0,5)
  assert.equal(mailAge('2026-11-19T23:59:00',now),'Gestern')
  assert.equal(mailAge('2026-11-20T00:02:00',now),'Heute')
  assert.equal(mailAge('kaputt',now),'')
})
