import {rememberUndo,forgetUndo} from './undo-limit'
export type Folder = {id:string; name:string; path:string; isInbox?:boolean}
type Receipt = {id:string;source:string;target:string}
type MoveStep = {kind:'move';id:string;source:string;target:string;filed:boolean}
type StatusStep = {kind:'status';id:string;folder:string;previous:string;since?:string}
type FieldStep = {kind:'field';id:string;folder:string;field:string;previous:string;value:string}
type TagsStep = {kind:'tags';id:string;folder:string;before:string[];after:string[]}
type Step = MoveStep | StatusStep | FieldStep | TagsStep
export type Invoke = <T>(name:string,args?:Record<string,unknown>)=>Promise<T>

export class LiveBoard {
  private batches:Step[][]=[]
  private times=new WeakMap<Step[],number>()
  get latest() {const batch=this.batches.at(-1);return batch?(this.times.get(batch)||0):0}
  constructor(readonly invoke:Invoke) {}

  async writeBatch(action:()=>Promise<void>) {
    await this.invoke('outlook_batch',{active:true})
    try { await action() }
    finally { await this.invoke('outlook_batch',{active:false}) }
  }
  async json<T>(command:string, args?:Record<string,unknown>):Promise<T> {
    return JSON.parse(await this.invoke<string>(command,args)) as T
  }
  get canUndo() {return this.batches.length>0}
  begin():Step[] {return []}
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
    this.record(batch,{kind:'move',id:receipt.id,source,target,filed})
    return receipt.id
  }
  async status(batch:Step[],id:string,folder:string,status:string) {
    const {previous,previousSince}=await this.json<{previous:string;previousSince?:string}>('outlook_status',{id,folder,status})
    if(previous!==status) this.record(batch,{kind:'status',id,folder,previous,since:previousSince})
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
  private updateIdentity(oldId:string,newId:string) {
    for(const batch of this.batches)
      for(const step of batch) if(step.id===oldId) step.id=newId
  }
  async undo(afterStep?:(step:Step)=>void) {
    const batch=this.batches.at(-1)
    while(batch?.length) {
      const step=batch[batch.length-1]
      if(step.kind==='move') {
        const receipt=await this.json<Receipt>('outlook_undo',{id:step.id,source:step.target,target:step.source})
        this.updateIdentity(step.id,receipt.id)
      } else if(step.kind==='field') {
        await this.json('outlook_field',{id:step.id,folder:step.folder,field:step.field,value:step.previous})
      } else if(step.kind==='tags') {
        await this.json('outlook_tags',{id:step.id,folder:step.folder,previous:step.after,wanted:step.before})
      } else {
        await this.json('outlook_status',{id:step.id,folder:step.folder,status:step.previous,since:step.since})
      }
      batch.pop()
      if(!batch.length){
        this.batches=this.batches.filter(b=>b!==batch)
        forgetUndo(this.times.get(batch)!)
      }
      afterStep?.(step)
    }
  }
}
