/** Beschriftung einer Änderung für Rückgängig-Tooltip und Rückmeldung (U7). */
export type ChangeInfo = {
  kind:'move'|'status'|'tags'|'note'|'followUp'|'snoozeUntil'
  value?:string|string[]
  /** Anzahl betroffener Mails. */
  count:number
  /** Name des Zielordners bei kind 'move'. */
  folder?:string
  /** Bei kind 'tags': hinzugefügte und entfernte Kategorien über alle Mails. */
  added?:string[]
  removed?:string[]
}
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase()
export function describeChange(info:ChangeInfo,focusTag='Fokus',casePrefix='Vorgang: '){
  const text=describeOne(info,focusTag,casePrefix)
  return info.count>1?text+' ('+info.count+' Mails)':text
}
function describeOne(info:ChangeInfo,focusTag:string,casePrefix:string){
  const value=typeof info.value==='string'?info.value:''
  switch(info.kind){
    case 'move':return 'Nach „'+(info.folder||'Ordner')+'“ verschoben'
    case 'status':return 'Status auf '+value+' gesetzt'
    case 'note':return 'Notiz geändert'
    case 'followUp':return value?'Nachfassen gesetzt':'Nachfassen entfernt'
    case 'snoozeUntil':return value?'Wiedervorlage gesetzt':'Wiedervorlage entfernt'
    default:{
      const changed=[...(info.added||[]),...(info.removed||[])]
      if(changed.length&&changed.every(t=>same(t,focusTag)))return 'Fokus geändert'
      const caseAdded=(info.added||[]).some(t=>t.toLowerCase().startsWith(casePrefix.toLowerCase()))
      const caseRemoved=(info.removed||[]).some(t=>t.toLowerCase().startsWith(casePrefix.toLowerCase()))
      if(caseAdded&&changed.every(t=>t.toLowerCase().startsWith(casePrefix.toLowerCase())))return 'Vorgang zugeordnet'
      if(caseRemoved&&!caseAdded&&changed.every(t=>t.toLowerCase().startsWith(casePrefix.toLowerCase())))return 'Vorgangszuordnung gelöst'
      return 'Kategorien geändert'
    }
  }
}
/** Tooltip des Rückgängig-Knopfs; ohne bekannte Beschriftung der bisherige Text. */
export function undoTooltip(label?:string){
  return label?'Rückgängig: '+label+' (Strg+Z)':'Letzte Änderung zurücknehmen (Strg+Z)'
}
