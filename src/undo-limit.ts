export const undoLimit=10
const active=new Map<number,()=>void>()
let lastStamp=0

/** Outlook mail and folder operations share one chronological history. */
export function rememberUndo(discard:()=>void):number{
  lastStamp=Math.max(lastStamp+1,Date.now())
  active.set(lastStamp,discard)
  if(active.size>undoLimit){
    const oldest=active.entries().next().value!
    active.delete(oldest[0])
    oldest[1]()
  }
  return lastStamp
}
export function forgetUndo(stamp:number){active.delete(stamp)}
