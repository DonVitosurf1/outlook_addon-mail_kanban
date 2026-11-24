import assert from 'node:assert/strict'
import test from 'node:test'
import { LIKELY_SHARE, likelyFolderBatch, recordFiling, rejectSuggestion, setAiLive, trustedFolderBatch } from '../src/ai'
import { ARCHIVE_MONTHS, BACKLOG_MAX, BACKLOG_PAGE, ageCutoff, archiveMonths, classifyBacklog, readBacklog, splitByAge } from '../src/backlog'
import { LEGACY } from '../src/backup'

type Row={id:string;subject:string;hasStatus?:boolean}
const hints:Record<string,{trusted?:string;likely?:string}>={
  a:{trusted:'Einkauf'},b:{trusted:'Labor',likely:'Einkauf'},c:{likely:'Labor'},d:{},e:{trusted:'Einkauf'},
  f:{trusted:'Abgewählt',likely:'Labor'},g:{trusted:'Abgewählt'},h:{likely:'Abgewählt'},
}
const rows=Object.keys(hints).map(id=>({id,subject:'Mail '+id}))
const trusted=(m:Row)=>hints[m.id].trusted?{folder:hints[m.id].trusted!}:undefined
const likely=(m:Row)=>hints[m.id].likely?{folder:hints[m.id].likely!}:undefined

test('Einteilen: sicher je Zielordner, sonst unsicher mit Vorschlag, sonst ohne Ziel',()=>{
  const result=classifyBacklog(rows,trusted,likely,['Einkauf','Labor'])
  assert.deepEqual([...result.safe].map(([f,list])=>[f,list.map(m=>m.id)]),[['Einkauf',['a','e']],['Labor',['b']]])
  // Ein sicherer Vorschlag für einen Ordner außerhalb der Ziele fällt auf den unsicheren zurück, ohne gültigen Vorschlag auf „ohne Ziel“.
  assert.deepEqual(result.unsure.map(m=>m.id),['c','f'])
  assert.deepEqual(result.none.map(m=>m.id),['d','g','h'])
  const empty=classifyBacklog([],trusted,likely,['Einkauf'])
  assert.equal(empty.safe.size+empty.unsure.length+empty.none.length,0)
})

test('Altersgrenze: Standard 3 Monate, ganze Monate von 1 bis 120',()=>{
  assert.equal(ARCHIVE_MONTHS,3)
  for(const value of [undefined,'',0,-1,1.5,121,'x',null])assert.equal(archiveMonths(value),3,String(value))
  assert.equal(archiveMonths(1),1);assert.equal(archiveMonths('6'),6);assert.equal(archiveMonths(120),120)
})

test('Altersgrenze: Stichtag am Monatsende abgeschnitten, ältere gehen ins Archivangebot',()=>{
  const now=new Date(2026,10,23,9,30)
  assert.equal(ageCutoff(3,now).toDateString(),new Date(2026,7,23,9,30).toDateString())
  assert.equal(ageCutoff(3,new Date(2026,4,31)).getDate(),28)
  assert.equal(ageCutoff(12,new Date(2024,1,29)).toDateString(),new Date(2023,1,28).toDateString())
  assert.equal(ageCutoff(2,new Date(2026,0,15)).toDateString(),new Date(2025,10,15).toDateString())
  const at=(y:number,m:number,d:number)=>new Date(y,m,d,12).toISOString()
  const mails=[{id:'alt',received:at(2026,7,22)},{id:'grenze',received:new Date(2026,7,23,9,30).toISOString()},{id:'neu',received:at(2026,10,1)},
    {id:'ohne'},{id:'kaputt',received:'gestern'}]
  const {old,young}=splitByAge(mails,3,now)
  assert.deepEqual(old.map(m=>m.id),['alt'])
  assert.deepEqual(young.map(m=>m.id),['grenze','neu','ohne','kaputt'])
  assert.deepEqual(splitByAge(mails,1,now).old.map(m=>m.id),['alt','grenze'])
})

test('Seitenweises Lesen: bis zur leeren Seite, nur Mails ohne Status, ohne Doppelte, höchstens 2.000',async()=>{
  assert.equal(BACKLOG_MAX,2000);assert.ok(BACKLOG_PAGE<BACKLOG_MAX)
  const inbox:Row[]=Array.from({length:40},(_,i)=>({id:'m'+i,subject:'S'+i,hasStatus:i%10===9}))
  const calls:[number,number][]=[],seen:number[]=[]
  // Der Helfer darf weniger als die Grenze liefern (übersprungene Erledigte). Die zweite Seite wiederholt eine Mail.
  const fetch=async(limit:number,offset:number)=>{calls.push([limit,offset]);return offset===25?[inbox[24],...inbox.slice(25,40)]:inbox.slice(offset,offset+Math.min(limit,25))}
  const result=await readBacklog(fetch,n=>seen.push(n),undefined,2000,250)
  assert.deepEqual(calls,[[250,0],[250,25],[250,41]])
  assert.deepEqual(result!.map(r=>r.id),inbox.filter(r=>!r.hasStatus).map(r=>r.id))
  assert.deepEqual(seen,[23,36])
  const capped=await readBacklog(async(limit,offset)=>inbox.slice(offset,offset+limit),undefined,undefined,5,4)
  assert.deepEqual(capped!.map(r=>r.id),['m0','m1','m2','m3','m4'])
  let stopped=false
  assert.equal(await readBacklog(async()=>{stopped=true;return inbox},undefined,()=>stopped),undefined)
  await assert.rejects(readBacklog(async()=>null as unknown as Row[]),/keine Mailliste/)
  // Nur Mails mit Status: Lesen endet nach dem Fünffachen der Höchstzahl.
  let read=0
  assert.deepEqual(await readBacklog(async(limit,offset)=>{read=offset+limit;return Array.from({length:limit},(_,i)=>({id:'x'+(offset+i),subject:'',hasStatus:true}))},undefined,undefined,10,10),[])
  assert.equal(read,50)
})

function storage(){
  setAiLive(false);setAiLive(true)
  const map=new Map<string,string>([[LEGACY,'{}']])
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>map.set(key,value)}})
}
test('Vorschlag ohne hohe Sicherheit: Bayes-Favorit ab der Hälfte, sonst Ordnername, abgelehnte Ordner zählen nicht',()=>{
  storage()
  assert.equal(LIKELY_SHARE,0.5)
  const mail=(subject:string,sender:string)=>({subject,sender,body:'',senderEmail:sender.toLowerCase()+'@'+sender.toLowerCase()+'.test'})
  for(let i=0;i<3;i++){recordFiling(mail('Bestellung Kittel '+i,'Anna'),'Einkauf');recordFiling(mail('Probe Kittel '+i,'Bernd'),'Labor')}
  const sure=mail('Bestellung Kittel 9','Anna'),mixed=mail('Kittel Bestellung Probe','Clara'),named=mail('Neues aus dem Labor','Dora'),unknown=mail('Hallo','Emil')
  const folders=['Einkauf','Labor']
  assert.equal(trustedFolderBatch(folders)(sure)?.folder,'Einkauf')
  assert.equal(trustedFolderBatch(folders)(mixed),undefined)
  const likely=likelyFolderBatch(folders)
  assert.equal(likely(sure)?.folder,'Einkauf')
  assert.ok(['Einkauf','Labor'].includes(likely(mixed)?.folder??''))
  assert.equal(likely(named)?.folder,'Labor')
  assert.equal(likely(unknown),undefined)
  rejectSuggestion({...named,id:'n1'},'Labor')
  assert.equal(likelyFolderBatch(folders)({...named,id:'n1'}),undefined)
  setAiLive(false)
  assert.equal(likely(sure),undefined)
  assert.equal(likelyFolderBatch(folders)(sure),undefined)
})
