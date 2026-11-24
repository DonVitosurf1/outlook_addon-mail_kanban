/**
 * Reine Logik für „Posteingang abarbeiten“ (E7, ohne DOM): seitenweises Lesen des Rückstands, Einteilen und Altersgrenze.
 * Die Oberfläche steht in `setup-inbox.ts`.
 */

/** Höchstens so viele Posteingangsmails ohne Status liest E7. */
export const BACKLOG_MAX=2000
/** Mails je Aufruf von `outlook_backlog`. */
export const BACKLOG_PAGE=250
/** Standard der Altersgrenze für das Archivangebot in Monaten. */
export const ARCHIVE_MONTHS=3

type Row={id:string;hasStatus?:boolean}
/** Eine Seite von `outlook_backlog` mit Grenze: Karten und Fortsetzungspunkt der nächsten Seite (`null` am Ende des Posteingangs). */
export type BacklogPage<T>={cards:T[];next:string|null}
/**
 * Liest den Rückstand seitenweise (älteste zuerst) über `fetch(limit, cursor)`, bis der Helfer kein `next` mehr liefert oder `max` Mails
 * ohne Status gelesen sind. Jede Seite setzt am Fortsetzungspunkt der vorigen fort, statt die vorigen Seiten erneut zu lesen.
 * Mails mit Status (das Board verfolgt sie schon) zählen nicht. Eine kurze oder leere Seite heißt nicht, dass nichts mehr kommt
 * (der Helfer prüft je Seite höchstens das Vierfache der Grenze, Erledigte und Unlesbare eingeschlossen). Insgesamt liest es höchstens
 * `5*max/page` Seiten. Doppelte IDs (gleich alte Mails nach einer Verschiebung) kommen nur einmal vor. `progress` meldet die Zahl der
 * bisher gelesenen Mails ohne Status. `stop` bricht nach jeder Seite ab, dann ist das Ergebnis `undefined`.
 * `end` sagt, warum das Lesen endete: `complete` (Ende des Posteingangs), `max` (Höchstzahl erreicht) oder `partial` (Seitengrenze
 * erreicht oder kein Fortschritt mehr, etwa bei sehr vielen Mails mit Status: nur teilweise gelesen).
 */
export async function readBacklog<T extends Row>(fetch:(limit:number,cursor?:string)=>Promise<BacklogPage<T>>,progress?:(count:number)=>void,
  stop?:()=>boolean,max=BACKLOG_MAX,page=BACKLOG_PAGE):Promise<{mails:T[];end:'complete'|'max'|'partial'}|undefined>{
  const seen=new Set<string>(),result:T[]=[]
  let cursor:string|undefined
  for(let pages=0;pages<Math.ceil(5*max/page);pages++){
    const answer=await fetch(page,cursor)
    if(stop?.())return
    if(!answer||!Array.isArray(answer.cards))throw new Error('Outlook lieferte keine Mailliste.')
    for(const row of answer.cards){
      if(seen.has(row.id))continue
      seen.add(row.id)
      if(row.hasStatus===false&&result.length<max)result.push(row)
    }
    progress?.(result.length)
    if(typeof answer.next!=='string'||!answer.next)return {mails:result,end:'complete'}
    if(result.length>=max)return {mails:result,end:'max'}
    // Ohne Fortschritt geht es nicht weiter.
    if(answer.next===cursor)break
    cursor=answer.next
  }
  return {mails:result,end:'partial'}
}

export type Hint={folder:string}
/**
 * Einteilung des Posteingangs:
 * - `safe`: Vorschlag mit hoher Sicherheit (`trusted`, wie `trustedFolderBatch`), gruppiert je Zielordner in Lesereihenfolge,
 * - `unsure`: nur ein Vorschlag ohne hohe Sicherheit (`likely`),
 * - `none`: kein Vorschlag.
 * Ziele, die nicht in `folders` stehen (etwa ein inzwischen abgewählter Lernordner), zählen nicht als Vorschlag.
 */
export function classifyBacklog<T>(mails:readonly T[],trusted:(mail:T)=>Hint|undefined,likely:(mail:T)=>Hint|undefined,folders:readonly string[]){
  const known=new Set(folders),safe=new Map<string,T[]>(),unsure:T[]=[],none:T[]=[]
  for(const mail of mails){
    const sure=trusted(mail)?.folder
    if(sure&&known.has(sure)){const group=safe.get(sure)??[];group.push(mail);safe.set(sure,group);continue}
    const guess=likely(mail)?.folder
    if(guess&&known.has(guess))unsure.push(mail)
    else none.push(mail)
  }
  return {safe,unsure,none}
}

/** Gültige Altersgrenze in ganzen Monaten (1 bis 120), sonst der Standard. */
export function archiveMonths(value:unknown){
  const n=Number(value)
  return Number.isInteger(n)&&n>=1&&n<=120?n:ARCHIVE_MONTHS
}
/** Stichtag: heute vor `months` Monaten, am Monatsende abgeschnitten (31. Mai minus 3 Monate ist der 28. oder 29. Februar). */
export function ageCutoff(months:number,now=new Date()){
  const day=now.getDate(),cutoff=new Date(now)
  cutoff.setDate(1)
  cutoff.setMonth(cutoff.getMonth()-months)
  const last=new Date(cutoff.getFullYear(),cutoff.getMonth()+1,0).getDate()
  cutoff.setDate(Math.min(day,last))
  return cutoff
}
/** Teilt Mails in ältere als die Grenze (`old`) und jüngere (`young`). Mails ohne lesbares Datum bleiben bei den jüngeren. */
export function splitByAge<T extends {received?:string}>(mails:readonly T[],months:number,now=new Date()){
  const limit=ageCutoff(months,now).getTime(),old:T[]=[],young:T[]=[]
  for(const mail of mails){
    const time=Date.parse(mail.received||'')
    if(Number.isFinite(time)&&time<limit)old.push(mail);else young.push(mail)
  }
  return {old,young}
}
