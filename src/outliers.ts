/**
 * Reine Logik der Ausreißerprüfung (E3), ohne DOM und ohne Outlook: Bayes-Variante, Kennzahl je Ordner, offene Fälle.
 * Die Embedding-Variante rechnet in Rust (`ai_outliers`), die Oberfläche steht in `setup-outliers.ts`.
 */
import {BAYES_MIN_DOCS, bayesModel, type LearnRow, type Outlier} from './ai'

export type {Outlier} from './ai'
/** Ab diesem Anteil verdächtiger Mails (strikt darüber) gilt ein Lernordner als Kandidat für E4. */
export const OUTLIER_SHARE=0.25
/** Vorsprung des fremden Profils bei Embeddings (Kosinus). */
export const EMBEDDING_MARGIN=0.05
/** Vorsprung der Bayes-Wahrscheinlichkeit des fremden Ordners vor dem eigenen. */
export const BAYES_MARGIN=0.5
/**
 * Mindestzahl an Lernmails, damit ein Ordner prüfbar ist: Ohne die geprüfte Mail braucht Bayes noch `BAYES_MIN_DOCS`
 * Beispiele im eigenen Ordner, Embeddings brauchen noch eine Mail für das eigene Profil (wie `Ollama::outliers`).
 */
export const minimumMails={Bayes:BAYES_MIN_DOCS+1,Embeddings:2} as const

/**
 * Bayes-Variante ohne Embeddings: Jede Mail wird beim Trainieren ausgelassen (Leave-one-out) und neu eingeordnet.
 * Verdächtig ist sie, wenn der Klassifikator wie bei der Ablage sicher einen anderen Ordner vorschlägt und dessen
 * Wahrscheinlichkeit um mindestens `margin` vor der des eigenen Ordners liegt. Zeilen ohne `id` werden übergangen, ebenso
 * Ordner, die ohne die Mail unter das Bayes-Minimum fallen: Ohne eigenen Vergleich wäre dort jede Mail verdächtig.
 * Sortiert nach Deutlichkeit (`other - own`), absteigend.
 */
export function bayesOutliers(rows:LearnRow[],margin:number):Outlier[]{
  const model=bayesModel(rows),docs=new Map<string,number>()
  for(const row of rows)docs.set(row.folder,(docs.get(row.folder)||0)+1)
  return rows.flatMap(row=>{
    if(!row.id||docs.get(row.folder)!<minimumMails.Bayes)return []
    const {best,probs}=model(row.features,row)
    if(!best||best.folder===row.folder)return []
    const other=probs.get(best.folder)??0,own=probs.get(row.folder)??0
    return other-own>=margin?[{id:row.id,folder:row.folder,suggested:best.folder,own,other}]:[]
  }).sort((a,b)=>clarity(b)-clarity(a))
}
/** Deutlichkeit eines Ausreißers: Vorsprung des fremden Ordners. */
export function clarity(o:Outlier){return o.other-o.own}

/** Lernordner mit vielen Ausreißern, gespeichert als Kandidat für E4 (`SetupState.outlierFolders`). */
export type OutlierFolder={folder:string;outliers:number;total:number}
/** Kennzahl je Ordner: Ordner mit mehr als 25 % verdächtigen Mails, der deutlichste Anteil zuerst. */
export function outlierFolders(totals:Record<string,number>,outliers:readonly Outlier[]):OutlierFolder[]{
  const counts=new Map<string,number>()
  for(const o of outliers)counts.set(o.folder,(counts.get(o.folder)||0)+1)
  return Object.entries(totals).flatMap(([folder,total])=>{
    const n=counts.get(folder)||0
    return total>0&&n/total>OUTLIER_SHARE?[{folder,outliers:n,total}]:[]
  }).sort((a,b)=>b.outliers/b.total-a.outliers/a.total||a.folder.localeCompare(b.folder,'de'))
}
/** Noch zu prüfende Ausreißer: ohne bestätigte („Bleibt hier“), ohne doppelte Mails je Ordner, deutlichste zuerst. */
export function openOutliers<T extends Outlier>(outliers:readonly T[],confirmed:Iterable<string>):T[]{
  const skip=new Set(confirmed),seen=new Set<string>()
  return outliers.filter(o=>{
    const key=JSON.stringify([o.folder,o.id])
    if(skip.has(o.id)||seen.has(key))return false
    seen.add(key);return true
  }).sort((a,b)=>clarity(b)-clarity(a))
}
