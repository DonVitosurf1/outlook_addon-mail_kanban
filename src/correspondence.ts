import {getLegacyConfig} from './data-settings'
import type {LiveBoard} from './live'
import {detectReplies,unanswered,type Correspondence,type Envelope,type WaitingMail} from './waiting'
type Host={
  hasMailbox():boolean; rows():WaitingMail[]; folders():string[]; isLive():boolean; render():void; service?:LiveBoard
  refreshAfterWrite():Promise<void>|void; trackDemo?(mails:Envelope[]):Promise<void>|void
  demoOpen?(id:string):void
  resolveReplies?(ids:string[],status:string):Promise<void>; busy?():boolean; writeBatch?(action:()=>Promise<void>):Promise<void>
}

function node<K extends keyof HTMLElementTagNameMap>(tag:K,label=''){
  const n=document.createElement(tag);n.textContent=label;return n
}
function cmd(text:string,action:()=>void){
  const b=node('button',text);b.type='button';b.onclick=action;return b
}
function ignoredDates(key:string):Map<string,number>{
  try{const raw:unknown=JSON.parse(localStorage.getItem(key)||'[]')
    const now=Date.now(),cutoff=now-60*86400000
    if(Array.isArray(raw))return new Map(raw.filter((v):v is string=>typeof v==='string').map(id=>[id,now]))
    if(raw && typeof raw==='object')return new Map(Object.entries(raw).filter((entry):entry is [string,number]=>typeof entry[1]==='number'&&entry[1]>=cutoff))
  }catch{/* Older or unavailable local settings. */}
  return new Map()
}
export function demoSentRows():Envelope[]{
  const since=(days:number)=>{const d=new Date();d.setDate(d.getDate()-days);return d.toISOString()}
  return [
    {id:'SENT-DEMO1',subject:'Freigabe für Laborausstattung',recipients:'Einkauf',sender:'Ich',received:since(6),conversationId:'SENT-VORGANG-1',isSent:true,hasStatus:false},
    {id:'SENT-DEMO2',subject:'Rückfrage zum Servicevertrag',recipients:'Organisation',sender:'Ich',received:since(2),conversationId:'SENT-VORGANG-2',isSent:true,hasStatus:false},
  ]
}
function demoSet(rows:WaitingMail[]):Correspondence{
  const sent=demoSentRows()
  const data:WaitingMail[]=rows.map(m=>({...m,isSent:m.isSent??m.id.startsWith('DEMOSENT')}))
  return {sent:[...sent,...data.filter(m=>m.isSent)],incoming:data.filter(m=>!m.isSent)}
}
export function initCorrespondence(host:Host){
  let generation=0,cache:{key:string;at:number;data:Correspondence}|undefined
  let pending:{key:string;request:Promise<Correspondence>}|undefined
  const dialog=node('dialog');dialog.setAttribute('aria-label','Gesendet ohne Antwort')
  const list=node('div'),message=node('p');message.setAttribute('role','status')
  const menu=cmd('Gesendet ohne Antwort',()=>{void show()});menu.title='Gesendet ohne Antwort (Strg+G)'
  menu.id='sentUnanswered';menu.setAttribute('aria-keyshortcuts','Control+G')
  // Eintrag der Seitenleisten-Ansichten (nach „Wiedervorlage“); ohne Postfach nicht vorhanden, damit die Ansichten offline verborgen bleiben.
  const syncMenu=()=>{
    const views=document.getElementById('focusViews')
    if(host.hasMailbox()){if(views&&menu.parentElement!==views)views.append(menu)}else menu.remove()
  }
  const toolbar=node('div');toolbar.className='dialog-actions'
  let current:Envelope[]=[],chosen=new Set<string>(),locked=false,openedLive=false
  const source=()=>host.hasMailbox()?(host.isLive()?'outlook':'demo'):'offline'
  let knownSource=source(),sourceEpoch=0
  syncMenu()
  const days=()=>host.isLive()?Math.max(1, Math.min(36500, Number(getLegacyConfig().sent_days)||14)):14
  const key=()=>host.isLive()?'kanban-sent-ignore-live-v1':'kanban-sent-ignore-demo-v1'
  async function data(force:boolean):Promise<Correspondence>{
    if(!host.hasMailbox())return {sent:[],incoming:[]}
    if(!host.isLive())return demoSet(host.rows())
    if(!host.service)throw Error('Outlook ist nicht verbunden.')
    const source=host.rows(),folders=[...new Set(host.folders().filter(Boolean))].sort()
    const oldest=Math.min(Date.now(),...source.filter(m=>m.status==='Warten').map(m=>Date.parse(m.statusSince||m.received||'')).filter(Number.isFinite))
    const windowDays=Math.min(36500,Math.max(days(),Math.ceil((Date.now()-oldest)/86400000)+1))
    const params={days:windowDays,folders},cacheKey=JSON.stringify(params)
    if(!force&&cache?.key===cacheKey&&Date.now()-cache.at<30000)return cache.data
    if(pending?.key===cacheKey)return pending.request
    const request=host.service.json<Correspondence>('outlook_correspondence',params)
    pending={key:cacheKey,request}
    try{
      const result=await request
      if(!Array.isArray(result.sent)||!Array.isArray(result.incoming))throw Error('Unerwartete Antwort aus Outlook.')
      if(pending?.request===request)cache={key:cacheKey,at:Date.now(),data:result}
      return result
    }finally{if(pending?.request===request)pending=undefined}
  }
  const handled=new Set<string>()
  let timer:number|undefined
  function eligible(m:WaitingMail){return m.status==='Warten'&&!!m.replyEvidence}
  const replyKey=(m:WaitingMail)=>[host.isLive(),m.id,m.replyEvidence?.id].join('|')
  const replyStatus=(m:WaitingMail,rows:WaitingMail[])=>rows.some(other=>other.id===m.replyEvidence?.id)?'Erledigt':'Offen'
  function resolve(id:string){
    if(!host.hasMailbox())return
    const rows=host.rows(),m=rows.find(row=>row.id===id)
    if(!m||!eligible(m)||!host.resolveReplies)return
    handled.add(replyKey(m));void host.resolveReplies([m.id],replyStatus(m,rows))
  }
  function schedule(){
    if(timer!==undefined || !host.resolveReplies || !host.isLive() || getLegacyConfig().reply_to_offen!==true)return
    const epoch=sourceEpoch
    timer=window.setTimeout(async()=>{
      timer=undefined
      if(epoch!==sourceEpoch||!host.isLive()||getLegacyConfig().reply_to_offen!==true)return
      const rows=host.rows()
      const pending=rows.filter(row=>eligible(row)&&!handled.has(replyKey(row)))
      if(!pending.length)return
      if(host.busy?.()||document.querySelector('dialog[open]')){schedule();return}
      const status=replyStatus(pending[0],rows),group=pending.filter(row=>replyStatus(row,rows)===status)
      for(const row of group)handled.add(replyKey(row))
      try{await host.resolveReplies!(group.map(row=>row.id),status)}
      finally{if(group.length<pending.length)schedule()}
    },400)
  }
  function evidence(rows:WaitingMail[],incoming:Envelope[]){
    const matches=detectReplies(rows,incoming)
    for(const m of rows){m.replyEvidence=matches.get(m.id);m.hasReply=!!m.replyEvidence}
    if(matches.size)schedule()
  }
  function invalidate(){
    sourceEpoch++;generation++;cache=undefined;pending=undefined;handled.clear()
    if(timer!==undefined){window.clearTimeout(timer);timer=undefined}
    current=[];chosen.clear();list.replaceChildren();message.textContent='';locked=false
    if(dialog.open)dialog.close()
  }
  document.addEventListener('mailboard:source-changed',invalidate)
  async function refresh(){
    if(source()!==knownSource){invalidate();knownSource=source()}
    syncMenu()
    if(!host.hasMailbox())return
    const version=++generation,live=host.isLive(),rows=host.rows()
    if(dialog.open && openedLive!==live)dialog.close()
    // Replies in already loaded rows are useful even before the optional history query completes.
    evidence(rows,live?[]:demoSet(rows).incoming)
    if(!live || !rows.some(m=>m.status==='Warten')){host.render();return}
    try{
      const result=await data(false)
      if(version!==generation||rows!==host.rows()||!host.isLive())return
      evidence(rows,result.incoming);host.render()
    }catch{
      // The board remains usable. Explicit history requests show the underlying COM error.
      if(version===generation)host.render()
    }
  }
  function label(m:Envelope){return m.recipients||m.sender}
  const track=cmd('Auf „Warten“ setzen',()=>{void trackSelected()})
  const hide=cmd('Ausblenden',()=>{
    if(!host.hasMailbox()||openedLive!==host.isLive())return
    const keys=ignoredDates(key())
    for(const m of current)if(chosen.has(m.id))keys.set(m.conversationId||m.id,Date.now())
    try{localStorage.setItem(key(),JSON.stringify(Object.fromEntries(keys)))}
    catch{message.textContent='Ausblendung konnte nicht gespeichert werden.';return}
    current=current.filter(m=>!chosen.has(m.id));chosen.clear();renderList()
  })
  const open=cmd('Öffnen',()=>{void openSelected()})
  async function openEnvelope(m:Envelope){
    if(!host.hasMailbox())return
    if(host.isLive()&&host.service && m.folderId){
      await host.service.invoke('outlook_open',{id:m.id,folder:m.folderId})
    }else if(host.rows().some(row=>row.id===m.id))host.demoOpen?.(m.id)
    else throw Error('Dieser Demoeintrag enthält nur die Metadaten der gesendeten Mail.')
  }
  function updateButtons(){
    track.disabled=locked||!chosen.size||(!host.isLive()&&!host.trackDemo)
    hide.disabled=locked||!chosen.size
    open.disabled=locked||chosen.size!==1
    list.querySelectorAll('input').forEach(check=>{check.disabled=locked})
  }
  async function openSelected(){
    const m=current.find(row=>chosen.has(row.id))
    if(m)try{await openEnvelope(m)}catch(e){message.textContent=String(e)}
  }
  function renderList(){
    list.replaceChildren()
    for(const m of current){
      const labelNode=node('label')
      const check=node('input');check.type='checkbox';check.checked=chosen.has(m.id);check.disabled=locked
      check.onchange=()=>{if(check.checked)chosen.add(m.id);else chosen.delete(m.id);updateButtons()}
      labelNode.append(check,document.createTextNode(' '+(m.subject||'(ohne Betreff)')+' · An '+label(m)+' · '+(m.received||'').slice(0,10)))
      const line=node('p');line.append(labelNode);list.append(line)
    }
    if(!current.length)list.append(node('p','Keine offenen gesendeten Mails in diesem Zeitraum.'))
    updateButtons()
  }
  async function trackSelected(){
    if(!host.hasMailbox()||openedLive!==host.isLive()||locked)return
    const epoch=sourceEpoch
    locked=true;updateButtons()
    const selected=current.filter(m=>chosen.has(m.id)),ok=new Set<string>(),errors:string[]=[]
    try{
      if(host.isLive()&&host.service){
        const service=host.service,batch=service.begin()
        const write=async()=>{
          for(const m of selected){
            if(epoch!==sourceEpoch||!host.isLive())break
            try{
              if(!m.folderId)throw Error('Ordner fehlt')
              await service.status(batch,m.id,m.folderId,'Warten');ok.add(m.id)
            }catch(e){errors.push(m.subject+': '+String(e))}
          }
        }
        if(host.writeBatch)await host.writeBatch(write);else await write()
      }else if(host.trackDemo){await host.trackDemo(selected);selected.forEach(m=>ok.add(m.id))}
      if(epoch!==sourceEpoch)return
      current=current.filter(m=>!ok.has(m.id))
      ok.forEach(id=>chosen.delete(id));cache=undefined
      if(ok.size)await host.refreshAfterWrite()
    }catch(e){errors.push(String(e))}
    finally{
      if(epoch!==sourceEpoch)return
      locked=false;renderList()
      message.textContent=ok.size+' von '+selected.length+' auf „Warten“ gesetzt.'+(errors.length?' '+errors.join(' · '):'')
    }
  }
  async function show(){
    if(!host.hasMailbox()||dialog.open)return
    const epoch=sourceEpoch
    openedLive=host.isLive();dialog.showModal()
    message.textContent='Unterhaltungen der letzten '+days()+' Tage werden geprüft …'
    const live=host.isLive();chosen.clear();current=[];list.replaceChildren();locked=true;updateButtons()
    try{
      const result=await data(true)
      if(epoch!==sourceEpoch||host.isLive()!==live || !dialog.open)return
      const cutoff=new Date();cutoff.setDate(cutoff.getDate()-days());cutoff.setHours(0,0,0,0)
      current=unanswered(result,host.rows(),new Set(ignoredDates(key()).keys()),cutoff.getTime());message.textContent=current.length+' offene Unterhaltungen.'
      evidence(host.rows(),result.incoming);host.render()
      renderList()
    }catch(e){if(epoch===sourceEpoch)message.textContent='Gesendet konnte nicht geladen werden: '+String(e)}
    finally{if(epoch===sourceEpoch){locked=false;updateButtons()}}
  }
  toolbar.append(track,hide,open,cmd('Schließen',()=>dialog.close()))
  dialog.append(node('h2','Gesendet ohne Antwort'),message,list,toolbar)
  document.body.append(dialog)
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='g'&&!document.querySelector('dialog[open]')){
      e.preventDefault();void show()
    }
    if(dialog.open && e.key==='Delete'&&!hide.disabled){e.preventDefault();hide.click()}
  })
  document.addEventListener('kanban-show-reply',event=>{
    const id=(event as CustomEvent<string>).detail,m=host.rows().find(row=>row.id===id)
    if(m?.replyEvidence)void openEnvelope(m.replyEvidence).catch(e=>{const status=document.getElementById('message');if(status)status.textContent=String(e)})
  })
  document.addEventListener('kanban-resolve-reply',e=>resolve((e as CustomEvent<string>).detail))
  function detail(id:string,mount:HTMLElement){
    const m=host.rows().find(row=>row.id===id)
    mount.replaceChildren()
    if(!m?.replyEvidence)return
    mount.append(node('p','Antwort von '+m.replyEvidence.sender+' · '+(m.replyEvidence.received||'').slice(0,10)),
      cmd('Eingegangene Antwort öffnen',()=>document.dispatchEvent(new CustomEvent('kanban-show-reply',{detail:id}))))
    if(host.resolveReplies)mount.append(cmd('Warten abschließen · '+replyStatus(m,host.rows()),()=>resolve(id)))
  }
  return {refresh,show,detail}
}
