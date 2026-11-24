import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { parse } from 'yaml'
import { capacitiesTokenKey } from './capacities'

export const LEGACY = 'kanban-import-v1'
export const PREVIOUS = 'kanban-before-restore-v1'
const MANIFEST = 'tauri-board-v1.json'
const LIMIT = 16 * 1024 * 1024
const LEGACY_FILES = ['config.yaml','vorschlag-statistik.json','ki-cache.json','fenster.ini','art-vorschlaege.json']

export type Snapshot = Record<string,string>
/** Schlüssel, die dieses Board selbst schreibt. Eine Sicherung darf nichts anderes einpflanzen. */
export function knownSettingKey(key:string):boolean {
  return key.startsWith('kanban-') || key.startsWith('mailboard-') || key.startsWith('outlook-kanban-')
    || key.startsWith('board.layout.') || key.startsWith('board.views.')
}

export function isRecord(value:unknown): value is Record<string,unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function readLegacyConfig(files:Snapshot): Record<string,unknown> {
  const parsed: unknown = parse(files['config.yaml'] ?? '{}')
  if (!isRecord(parsed)) throw new Error('Die config.yaml enthält keine gültigen Einstellungen.')
  return parsed
}

export function parseBackup(data:Uint8Array): {values:Snapshot; legacy:boolean; count:number} {
  if (data.byteLength>LIMIT) throw new Error('Diese Sicherung ist zu groß (maximal 16 MB).')
  let size=0
  const files=unzipSync(data,{filter(entry){
    if (!(entry.name===MANIFEST || LEGACY_FILES.includes(entry.name) || /^knowledge\/[\w-]+\.md$/i.test(entry.name))) return false
    size+=entry.originalSize
    if (size>LIMIT) throw new Error('Die entpackte Sicherung ist zu groß.')
    return true
  }})
  if (files[MANIFEST]) {
    const manifest=JSON.parse(strFromU8(files[MANIFEST]))
    if (manifest.version!==1 || !isRecord(manifest.values) ||
        Object.entries(manifest.values).some(([key,v])=>key===PREVIOUS || typeof v!=='string' || key==='__proto__'))
      throw new Error('Unbekanntes Tauri-Sicherungsformat.')
    if (manifest.values[LEGACY]) {
      const files:unknown=JSON.parse(String(manifest.values[LEGACY]))
      if(!isRecord(files)||Object.values(files).some(v=>typeof v!=='string'))
        throw new Error('Die importierten Dateien in dieser Sicherung sind ungültig.')
      readLegacyConfig(files as Snapshot)
    }
    for(const key of ['kanban-board-options-v1','kanban-profile-edits-v1','outlook-kanban-ai-settings-v1']){
      if(key in manifest.values && !isRecord(JSON.parse(String(manifest.values[key]))))
        throw new Error('Ungültige lokale Einstellungen in der Sicherung.')
    }
    for(const key of ['kanban-snippets-v1','kanban-config-revisions-v1','mailboard-routines-v1','mailboard-cases-v1']){
      if(key in manifest.values && !Array.isArray(JSON.parse(String(manifest.values[key]))))
        throw new Error('Ungültige Einstellungsliste in der Sicherung.')
    }
    const values=Object.fromEntries(Object.entries(manifest.values).filter(([key])=>knownSettingKey(key))) as Snapshot
    if(!Object.keys(values).length) throw new Error('Die Sicherung enthält keine Mail-Board-Einstellungen.')
    return {values, legacy:false, count:Object.keys(values).length}
  }
  if (!files['config.yaml']) throw new Error('In dieser Sicherung fehlt die config.yaml.')
  const legacyFiles:Snapshot=Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,strFromU8(bytes)]))
  readLegacyConfig(legacyFiles)
  for(const [name,raw] of Object.entries(legacyFiles)) if(name.endsWith('.json')) JSON.parse(raw)
  return {values:{[LEGACY]:JSON.stringify(legacyFiles)},legacy:true,count:Object.keys(files).length}
}

export function snapshot(storage:Storage):Snapshot {
  const values:Snapshot=Object.create(null)
  for(let i=0;i<storage.length;i++){
    const key=storage.key(i)
    if(key && key!==PREVIOUS && key!==capacitiesTokenKey) values[key]=storage.getItem(key)!
  }
  return values
}
export function archive(values:Snapshot):Uint8Array<ArrayBuffer> {
  return new Uint8Array(zipSync({[MANIFEST]:strToU8(JSON.stringify({version:1,values}))}))
}

export function restore(storage:Storage, values:Snapshot, merge=false) {
  const before=snapshot(storage)
  const previous=storage.getItem(PREVIOUS)
  const apply=(next:Snapshot)=>{
    for(const k of Object.keys(snapshot(storage))) if(!Object.hasOwn(next,k)) storage.removeItem(k)
    for(const [key,value] of Object.entries(next)) storage.setItem(key,value)
  }
  try {
    storage.setItem(PREVIOUS,JSON.stringify(before))
    const incoming={...values}
    delete incoming[capacitiesTokenKey]
    apply(merge ? {...before,...incoming}:incoming)
  } catch(error) {
    storage.removeItem(PREVIOUS)
    apply(before)
    if(previous!==null) storage.setItem(PREVIOUS,previous)
    throw error
  }
}
