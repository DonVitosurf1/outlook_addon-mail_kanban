import {strict as assert} from 'node:assert'
import test from 'node:test'
import {dateHint, dateTerms} from '../src/date-terms'

test('Die vier Datumsarten haben ihre festen Erklärungen',()=>{
  assert.deepEqual(dateTerms,{
    wiedervorlage:'Die Karte ist bis zu diesem Tag geparkt und erscheint dann wieder.',
    nachfassen:'An diesem Tag beim Gegenüber nachhaken, wenn noch keine Antwort da ist.',
    frist:'Bis zu diesem Tag muss es erledigt sein.',
    kiFrist:'Von der lokalen KI in der Mail erkannte Frist.'
  })
})
test('Der Kartenhinweis erklärt nur die Datumsarten der Zeile',()=>{
  assert.equal(dateHint(['Heute nachfassen']),'Nachfassen: '+dateTerms.nachfassen)
  assert.equal(dateHint(['Wiedervorlage am 21.11.','KI-Frist am 25.11.']),'Wiedervorlage: '+dateTerms.wiedervorlage+'\nKI-Frist: '+dateTerms.kiFrist)
  assert.equal(dateHint(['Antwort eingegangen']),'')
})
