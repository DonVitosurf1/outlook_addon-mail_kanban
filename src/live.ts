import {rememberUndo,forgetUndo} from './undo-limit'
export type Folder = {id:string; name:string; path:string; isInbox?:boolean}
export function countsAsFiling(folder:Folder, archivePath:string) {
  return !folder.isInbox && folder.path!==archivePath
}
type Receipt = {id:string;source:string;target:string}
type MoveStep = {kind:'move';id:string;source:string;target:string;filed:boolean;occurredAt:Date}
type StatusStep = {kind:'status';id:string;folder:string;previous:string;since?:string;value:string;expectedSince?:string}
type FieldStep = {kind:'field';id:string;folder:string;field:string;previous:string;value:string}
type TagsStep = {kind:'tags';id:string;folder:string;before:string[];after:string[]}
type Step = MoveStep | StatusStep | FieldStep | TagsStep
export type Invoke = <T>(name:string,args?:Record<string,unknown>)=>Promise<T>

export class UndoConflict extends Error {
  constructor(field:string,readonly skip:()=>boolean) {
    super(field+' wurde inzwischen in Outlook geändert. Der aktuelle Wert bleibt erhalten.')
    this.name='UndoConflict'
  }
}

export class LiveBoard {
  private batches:Step[][]=[]
  private times=new WeakMap<Step[],number>()
  private labels=new WeakMap<Step[],string>()
  get latest() {const batch=this.batches.at(-1);return batch?(this.times.get(batch)||0):0}
  /** Beschriftung des obersten Undo-Stapels, falls bekannt. */
  get latestLabel() {const batch=this.batches.at(-1);return batch?this.labels.get(batch):undefined}
  constructor(readonly invoke:Invoke, private readonly onFiled?:(delta:number, occurredAt:Date)=>void) {}

  async writeBatch(action:()=>Promise<void>) {
    await this.invoke('outlook_batch',{active:true})
    try { await action() }
    finally { await this.invoke('outlook_batch',{active:false}) }
  }
  async json<T>(command:string, args?:Record<string,unknown>):Promise<T> {
    try{return JSON.parse(await this.invoke<string>(command,args)) as T}
    catch(error){
      if(/Mail oder Ordner nicht mehr vorhanden|anderen Ordner/i.test(String(error)) &&
         this.batches.some(batch=>batch.some(s=>s.id===args?.id && this.relocatedSteps.has(s))))
        throw new Error('Nach der Projektänderung konnte Outlook die ursprüngliche Mail oder ihren Ordner nicht eindeutig zuordnen. Es wurde nichts geändert. Bitte das Original in Outlook prüfen.')
      throw error
    }
  }
  get canUndo() {return this.batches.length>0}
  begin(label?:string):Step[] {const batch:Step[]=[];if(label)this.labels.set(batch,label);return batch}
  private record(batch:Step[],step:Step){
    if(!batch.length){
      const stamp=rememberUndo(()=>{this.batches=this.batches.filter(b=>b!==batch)})
      this.times.set(batch,stamp)
      this.batches.push(batch)
    }
    batch.push(step)
  }
  async move(batch:Step[],id:string,source:string,target:string,filed=true) {
    const receipt=await this.json<Receipt>('outlook_move',{id,source,target})
    this.updateIdentity(id,receipt.id)
    const occurredAt=new Date()
    this.record(batch,{kind:'move',id:receipt.id,source,target,filed,occurredAt})
    if(filed)this.onFiled?.(1,occurredAt)
    return receipt.id
  }
  async status(batch:Step[],id:string,folder:string,status:string) {
    const {previous,previousSince,statusSince}=await this.json<{previous:string;previousSince?:string;statusSince?:string}>('outlook_status',{id,folder,status})
    if(previous!==status) this.record(batch,{kind:'status',id,folder,previous,since:previousSince,value:status,expectedSince:statusSince})
  }
  async field(batch:Step[],id:string,folder:string,field:string,value:string) {
    const changed=await this.json<{previous:string}>('outlook_field',{id,folder,field,value})
    if(changed.previous!==value) this.record(batch,{kind:'field',id,folder,field,previous:changed.previous,value})
  }
  async tags(batch:Step[],id:string,folder:string,previous:string[],wanted:string[]) {
    const result=await this.json<{previous:string[];tags:string[]}>('outlook_tags',{id,folder,previous,wanted})
    if(result.previous.length!==result.tags.length || result.previous.some(t=>!result.tags.includes(t)))
      this.record(batch,{kind:'tags',id,folder,before:result.previous,after:result.tags})
    return result.tags
  }
  private relocatedSteps=new WeakSet<Step>()
  remapFolders(ids:ReadonlyMap<string,string>){
    for(const batch of this.batches){
      for(const step of batch){
        if(step.kind==='move'){
          if(ids.has(step.source)||ids.has(step.target))this.relocatedSteps.add(step)
          step.source=ids.get(step.source)??step.source
          step.target=ids.get(step.target)??step.target
        }else if(ids.has(step.folder)){
          this.relocatedSteps.add(step)
          step.folder=ids.get(step.folder)!
        }
      }
    }
  }
  /** Neue Outlook-ID einer Mail, die außerhalb des Stapels verschoben wurde (Zusammenlegen in `projects.ts`). Ältere Schritte folgen ihr. */
  remapMail(oldId:string,newId:string){if(oldId!==newId)this.updateIdentity(oldId,newId)}
  private updateIdentity(oldId:string,newId:string) {
    for(const batch of this.batches)
      for(const step of batch) if(step.id===oldId) step.id=newId
  }
  private removeStep(batch:Step[],step:Step):boolean {
    if(batch.at(-1)!==step)return false
    batch.pop()
    if(!batch.length){
      this.batches=this.batches.filter(b=>b!==batch)
      forgetUndo(this.times.get(batch)!)
    }
    return true
  }
  async undo(afterStep?:(step:Step)=>void) {
    const batch=this.batches.at(-1)
    while(batch?.length && this.batches.at(-1)===batch) {
      const step=batch[batch.length-1]
      if(step.kind==='move') {
        const receipt=await this.json<Receipt>('outlook_undo',{id:step.id,source:step.target,target:step.source})
        this.updateIdentity(step.id,receipt.id)
      } else if(step.kind==='field') {
        const result=await this.json<{conflict?:boolean}>('outlook_field',{
          id:step.id,folder:step.folder,field:step.field,value:step.previous,expected:step.value})
        if(result.conflict){
          const label=step.field==='note'?'Die Notiz':step.field==='followUp'?'Die Nachfassfrist':'Die Wiedervorlage'
          throw new UndoConflict(label,()=>this.batches.at(-1)===batch && this.removeStep(batch,step))
        }
      } else if(step.kind==='tags') {
        await this.json('outlook_tags',{id:step.id,folder:step.folder,previous:step.after,wanted:step.before})
      } else {
        const result=await this.json<{conflict?:boolean}>('outlook_status',{
          id:step.id,folder:step.folder,status:step.previous,since:step.since,expected:step.value,expectedSince:step.expectedSince})
        if(result.conflict)throw new UndoConflict('Der Status',()=>this.batches.at(-1)===batch && this.removeStep(batch,step))
      }
      this.removeStep(batch,step)
      if(step.kind==='move'&&step.filed)this.onFiled?.(-1,step.occurredAt)
      afterStep?.(step)
    }
  }
}
