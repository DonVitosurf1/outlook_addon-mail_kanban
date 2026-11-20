/** Outlook's ConversationID is primary; the narrower fallback is useful for portal replies. */
export type Envelope={
  id:string; folderId?:string; storeId?:string; subject:string; sender:string; senderEmail?:string
  recipients?:string; recipientEmails?:string[]; received?:string; conversationId?:string
  isSent?:boolean; status?:string; statusSince?:string; hasStatus?:boolean
}
export type WaitingMail=Envelope & {hasReply?:boolean; replyEvidence?:Envelope}
export type Correspondence={sent:Envelope[];incoming:Envelope[]}

const prefix=/^\s*(?:(?:re|aw|wg|fw|fwd|antw|antwort|sv|vs|tr|rif|r)\s*(?:\[\d+\]|\(\d+\))?\s*:|\[[^\]]{0,30}\])\s*/i
export function normalizeSubject(subject:string) {
  let previous
  do{previous=subject;subject=subject.replace(prefix,'')}while(previous!==subject)
  return subject.trim().toLocaleLowerCase('de').replace(/\s+/g,' ')
}
function domain(address:string){
  const index=address.lastIndexOf('@')
  return index<0?'':address.slice(index+1).trim().replace(/>$/,'').toLowerCase()
}
function time(iso?:string){return iso?Date.parse(iso):NaN}
function index(map:Map<string,Envelope[]>,key:string,mail:Envelope){
  if(!map.has(key))map.set(key,[])
  map.get(key)!.push(mail)
}
export function detectReplies(rows:WaitingMail[],extra:Envelope[]) {
  const candidates=new Map<string,Envelope>()
  for(const mail of [...rows,...extra]){
    if(!mail.isSent && Number.isFinite(time(mail.received)) && !candidates.has(mail.id))candidates.set(mail.id,mail)
  }
  const conversations=new Map<string,Envelope[]>(),subjects=new Map<string,Envelope[]>()
  for(const mail of candidates.values()){
    if(mail.conversationId)index(conversations,mail.conversationId,mail)
    const subject=normalizeSubject(mail.subject)
    if(subject.length>=8)index(subjects,subject,mail)
  }
  const matches=new Map<string,Envelope>()
  for(const mail of rows){
    if(mail.status!=='Warten')continue
    const since=time(mail.statusSince||mail.received)
    if(!Number.isFinite(since))continue
    const domains=new Set((mail.isSent?mail.recipientEmails||[]:[mail.senderEmail||'']).map(domain).filter(Boolean))
    const possible=[...(conversations.get(mail.conversationId||'')||[])]
    if(domains.size) {
      for(const candidate of subjects.get(normalizeSubject(mail.subject))||[]){
        if(domains.has(domain(candidate.senderEmail||'')))possible.push(candidate)
      }
    }
    let newest=since
    for(const reply of possible){
      const timestamp=time(reply.received)
      if(reply.id!==mail.id && timestamp>newest){newest=timestamp;matches.set(mail.id,reply)}
    }
  }
  return matches
}
export function unanswered(data:Correspondence, tracked:WaitingMail[], ignored:Set<string>, cutoff:number) {
  const excluded=new Set(ignored)
  for(const row of tracked){
    if(row.status==='Warten'||(row.isSent && row.hasStatus!==false))excluded.add(row.conversationId||row.id)
  }
  for(const row of data.sent){
    if(row.hasStatus===true)excluded.add(row.conversationId||row.id)
  }
  const incoming=new Map<string,number>()
  for(const msg of data.incoming){
    if(!msg.isSent && msg.conversationId && Number.isFinite(time(msg.received))){
      incoming.set(msg.conversationId,Math.max(time(msg.received),incoming.get(msg.conversationId)||0))
    }
  }
  const latest=new Map<string,Envelope>()
  for(const msg of data.sent){
    const stamp=time(msg.received), key=msg.conversationId||msg.id
    if(!Number.isFinite(stamp)||stamp<cutoff||excluded.has(key)||(incoming.get(key)||0)>stamp)continue
    const previous=latest.get(key)
    if(!previous||stamp>time(previous.received))latest.set(key,msg)
  }
  return [...latest.values()].sort((a,b)=>time(a.received)-time(b.received))
}
