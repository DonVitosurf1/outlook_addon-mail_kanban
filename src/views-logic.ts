/** Field names here are shared by demo and live Outlook rows. Dates are local calendar days. */
export type ViewMail = {
  id: string; sender: string; subject: string; body: string; folder: string; status: string
  tags: string[]; attachments: string[]; note?: string; folderId?:string; folderPath?:string
  conversationId?: string; received?: string; statusSince?: string; followUp?: string; snoozeUntil?: string
  deadline?: string; needsReply?: boolean; hasReply?: boolean; replyEvidence?:{id:string;sender:string;received?:string}; recipients?: string; isSent?:boolean
}
export type Focus = 'all' | 'today' | 'snoozed'
export type Split = '' | 'reply' | 'overdue' | 'vip' | 'undated'
export type Group = '' | 'folder' | 'tag'
export type Sort = 'recent' | 'oldest' | 'sender' | 'subject'

export function localDay(now = new Date()) {
  return [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-')
}
function day(value?: string) { return value?.slice(0,10) || '' }

export function workdaysSince(start: string, end: string) {
  const first = new Date(day(start)+'T00:00:00Z')
  const days = Math.floor((Date.parse(day(end)+'T00:00:00Z')-first.getTime())/86400000)
  if (!Number.isFinite(days) || days < 1) return 0
  let count = Math.floor(days/7)*5
  for(let i=1;i<=days%7;i++) {
    const weekday=(first.getUTCDay()+i)%7
    if(weekday>0 && weekday<6) count++
  }
  return count
}
export function dueReasons(mail: ViewMail, today = localDay(), overdueDays = 5): string[] {
  if(mail.status==='Erledigt' || isSnoozed(mail,today)) return []
  const reasons:string[]=[]
  if(day(mail.snoozeUntil)===today) reasons.push('Wiedervorlage')
  if(mail.status==='Warten') {
    if(mail.hasReply) reasons.push('Antwort ist da')
    else if (day(mail.followUp)) {
      if(day(mail.followUp)<=today) reasons.push('Nachfassen')
    } else if(overdueDays>0 && workdaysSince(mail.statusSince||mail.received||'',today)>=overdueDays) reasons.push('Überfällig')
  }
  if(day(mail.deadline) && day(mail.deadline)<=today) reasons.push('Frist')
  return reasons
}
export function isSnoozed(mail:ViewMail,today=localDay()) {return !mail.hasReply && day(mail.snoozeUntil)>today}
export function matchesFocus(mail:ViewMail,focus:Focus,today=localDay(),overdueDays=5) {
  if (focus==='snoozed') return isSnoozed(mail,today)
  if (focus==='today') return dueReasons(mail,today,overdueDays).length>0
  return !isSnoozed(mail,today)
}
export function matchesSplit(mail:ViewMail,split:Split,vips:string[],today=localDay(),overdueDays=5) {
  switch(split) {
    case 'reply':return mail.needsReply===true
    case 'undated':return mail.status==='Warten' && !mail.hasReply && !mail.followUp && !isSnoozed(mail,today)
    case 'overdue':return dueReasons(mail,today,overdueDays).some(r=>r==='Nachfassen'||r==='Überfällig')
    case 'vip': {
      const address=(mail.isSent?mail.recipients||'':mail.sender).toLocaleLowerCase('de')
      return vips.some(v=>v.trim() && address.includes(v.trim().toLocaleLowerCase('de')))
    }
    default:return true
  }
}
export function matchesQuery(mail:ViewMail, query:string) {
  const text=[mail.sender,mail.subject,mail.body,mail.folder,mail.folderPath||'',...mail.tags,...mail.attachments,mail.note||''].join(' ').toLocaleLowerCase('de')
  return query.trim().toLocaleLowerCase('de').split(/\s+/).every(word=>text.includes(word))
}
function waitingDue(mail:ViewMail, days:number){
  if(mail.followUp)return Date.parse(mail.followUp)
  const start = mail.statusSince || mail.received
  if(!start)return Infinity
  const d=new Date(start)
  if(Number.isNaN(d.getTime()))return Infinity
  let left=Math.max(0,Math.floor(days))
  const fullWeeks=Math.floor((left-1)/5)
  if(fullWeeks>0){d.setDate(d.getDate()+fullWeeks*7);left-=fullWeeks*5}
  while(left>0){d.setDate(d.getDate()+1);if(d.getDay()!==0 && d.getDay()!==6)left--}
  return d.getTime()
}
export function orderCards<T extends ViewMail>(mails:T[],sort:Sort,overdueDays=5) {
  // Each lane is sorted independently. A global comparison mixing due dates and names is not transitive.
  const lanes=new Map<string,T[]>()
  for(const mail of mails){
    if(!lanes.has(mail.status))lanes.set(mail.status,[])
    lanes.get(mail.status)!.push(mail)
  }
  const who=(m:ViewMail)=>m.isSent?m.recipients||m.sender:m.sender
  const subject=(m:ViewMail)=>m.subject.replace(/^(?:(?:aw|wg|re|fw|fwd):\s*)+/i,'')
  for(const rows of lanes.values()){
    rows.sort((a,b)=>{
      if(a.status==='Warten')return waitingDue(a,overdueDays)-waitingDue(b,overdueDays)
      const dateA=Date.parse(a.received||''),dateB=Date.parse(b.received||'')
      const dateOrder=Number.isFinite(dateA)&&Number.isFinite(dateB)?dateB-dateA:Number(Number.isFinite(dateB))-Number(Number.isFinite(dateA))
      if(sort==='sender'||sort==='subject'){
        const value=sort==='sender'?who:subject
        return value(a).localeCompare(value(b),'de',{sensitivity:'base'})||dateOrder
      }
      return sort==='oldest'&&Number.isFinite(dateA)&&Number.isFinite(dateB)?-dateOrder:dateOrder
    })
  }
  return [...lanes.values()].flat()
}
export function groupCards<T extends ViewMail>(mails:T[],by:Group) {
  const groups=new Map<string,{label:string;rows:T[]}>()
  for(const mail of mails) {
    const labels=by==='folder'?[mail.folderPath||mail.folder]:by==='tag'?(mail.tags.length?mail.tags:['']):['']
    const seen=new Set<string>()
    for (const label of labels) {
      const key=by==='folder'&&mail.folderId ? mail.folderId : label.toLocaleLowerCase('de')
      if(seen.has(key)) continue
      seen.add(key)
      if(!groups.has(key))groups.set(key,{label,rows:[]})
      groups.get(key)!.rows.push(mail)
    }
  }
  return [...groups.values()].sort((a,b)=>!a.label?1:!b.label?-1:a.label.localeCompare(b.label,'de'))
    .map(({label,rows}):[string,T[]]=>[label||(by==='tag'?'Ohne Kategorie':''),rows])
}

/** The newest message represents its conversation within one status column. */
export function collapseThreads<T extends ViewMail>(mails:T[],today=localDay()) {
  const conversations=new Map<string,{row:T;hidden:number}>()
  const single:T[]=[]
  for(const mail of mails){
    if(!mail.conversationId || isSnoozed(mail,today)){single.push(mail);continue}
    const key=JSON.stringify([mail.conversationId,mail.status])
    const group=conversations.get(key)
    if(!group){conversations.set(key,{row:mail,hidden:0});continue}
    group.hidden++
    if((mail.received||'')>(group.row.received||''))group.row=mail
  }
  const hidden=new Map<string,number>()
  for(const group of conversations.values()){
    single.push(group.row)
    if(group.hidden)hidden.set(group.row.id,group.hidden)
  }
  const ids=new Set(single.map(mail=>mail.id))
  return {rows:mails.filter(mail=>ids.has(mail.id)),hidden}
}

export class ArrivalMarks{
  fresh=new Set<string>()
  returned=new Set<string>()
  private resurfaced=new Set<string>()
  private hidden=new Set<string>()
  private snapshots=new Map<string,{ids:Set<string>;time:number;rows:WeakRef<ViewMail[]>}>()
  sync(scope:string,rows:ViewMail[],inbox:string,now=new Date()){
    const previous=this.snapshots.get(scope),today=localDay(now)
    if(previous?.rows.deref()!==rows){
      const ids=new Set(rows.map(m=>m.id))
      if(previous)for(const mail of rows){
        if(!previous.ids.has(mail.id)&&(mail.folderId||mail.folder)===inbox&&Date.parse(mail.received||'')>=previous.time-600000)this.fresh.add(mail.id)
      }
      this.snapshots.set(scope,{ids,time:now.getTime(),rows:new WeakRef(rows)})
    }
    for(const mail of rows){
      if(isSnoozed(mail,today)){
        this.hidden.add(mail.id);this.resurfaced.delete(mail.id);this.returned.delete(mail.id)
      }else{
        const previouslyHidden=this.hidden.delete(mail.id)
        if(mail.snoozeUntil && !this.resurfaced.has(mail.id) && (previouslyHidden || day(mail.snoozeUntil)===today)){
          this.returned.add(mail.id);this.resurfaced.add(mail.id)
        }
      }
    }
  }
  seen(id:string){this.returned.delete(id);this.fresh.delete(id)}
}
