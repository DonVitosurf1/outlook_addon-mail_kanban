import assert from 'node:assert/strict'
import test from 'node:test'
import {detectReplies,normalizeSubject,unanswered,type Envelope} from '../src/waiting'
const wait:Envelope={id:'w',subject:'Rückfrage Liefertermin Filterspitzen',status:'Warten',statusSince:'2026-11-16T10:00:00+01:00',sender:'Ich',isSent:true,conversationId:'A',recipientEmails:['vertrieb@beispiel.de']}
const incoming:Envelope={id:'r',subject:'AW: WG: [EXTERN] Rückfrage Liefertermin Filterspitzen',sender:'Labor',senderEmail:'info@beispiel.de',received:'2026-11-16T10:30:00+01:00',conversationId:'B'}
test('Portalantwort mit neuer ConversationID benötigt Betreff und passende Domain',()=>{
 assert.equal(normalizeSubject('RE[2]: WG: [Extern] Muster  erhalten?'),'muster erhalten?')
 assert.equal(detectReplies([wait],[incoming]).get('w')?.id,'r')
 for(const bad of [{senderEmail:'x@anders.de'},{received:'2026-11-16T08:00:00Z'},{isSent:true}]){
   assert.equal(detectReplies([wait],[{...incoming,...bad}]).size,0)
 }
 assert.equal(detectReplies([{...wait,subject:'Frage'}],[{...incoming,subject:'Re: Frage'}]).size,0)
})
test('Jüngste eingegangene Antwort in derselben Unterhaltung gewinnt unabhängig vom Betreff',()=>{
 const second={...incoming,conversationId:'A',senderEmail:'',subject:'Geändert',id:'s',received:'2026-11-16T10:00:00Z'}
 assert.equal(detectReplies([wait],[second,incoming]).get('w')?.id,'s')
})
test('Gesendet ohne Antwort meldet nur jüngste, unverfolgte, nicht ausgeblendete Unterhaltungen',()=>{
 const sent={...wait,hasStatus:false,received:'2026-11-16T10:00:00+01:00'}
 const newer={...sent,id:'neu',received:'2026-11-16T14:00:00+01:00'}
 const tracked={...sent,id:'t',conversationId:'T',hasStatus:true}
 const one={...sent,id:'eins',conversationId:''}
 const mails={sent:[sent,tracked,newer,one],incoming:[{...incoming,conversationId:'A'}]}
 assert.deepEqual(unanswered(mails,[],new Set(['eins']),0).map(m=>m.id),['neu'])
 assert.equal(unanswered(mails,[],new Set(),Date.parse('2026-11-18')).length,0)
})
