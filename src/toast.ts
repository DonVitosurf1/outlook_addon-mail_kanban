let timer:number|undefined
let box:HTMLDivElement|undefined
let returnTo:HTMLElement|undefined
export function hideToast(){
  clearTimeout(timer)
  const old=box,focused=!!old?.contains(document.activeElement)
  box=undefined
  old?.remove()
  document.removeEventListener('keydown',onKey)
  // Hatte die Meldung den Fokus, geht er dorthin zurück, wo er vorher war. Eine neu gezeichnete Karte wird über ihre ID gefunden.
  if(focused)(returnTo?.isConnected?returnTo:returnTo?.id?document.getElementById(returnTo.id):null)?.focus()
}
function onKey(e:KeyboardEvent){if(e.key==='Escape')hideToast()}
/** Kurze Rückmeldung unten mittig, 8 Sekunden lang (länger, solange sie den Fokus hat); nimmt dem Fokus nichts weg. */
export function showToast(text:string,undo?:()=>void){
  hideToast()
  returnTo=document.activeElement instanceof HTMLElement&&document.activeElement!==document.body?document.activeElement:undefined
  const live=document.createElement('div')
  live.className='toast';live.setAttribute('role','status');live.setAttribute('aria-live','polite')
  const message=document.createElement('span');message.textContent=text
  live.append(message)
  if(undo){
    const button=document.createElement('button')
    button.type='button';button.textContent='Rückgängig'
    button.onclick=()=>{hideToast();undo()}
    live.append(button)
  }
  const close=document.createElement('button')
  close.type='button';close.className='toast-close';close.textContent='×';close.setAttribute('aria-label','Meldung schließen')
  close.onclick=hideToast
  live.append(close)
  box=live
  document.body.append(live)
  document.addEventListener('keydown',onKey)
  // Solange der Fokus in der Meldung steht, verschwindet sie nicht. Danach bleibt sie noch einmal 8 Sekunden.
  const wait=()=>{clearTimeout(timer);timer=window.setTimeout(hideToast,8000)}
  live.addEventListener('focusin',()=>clearTimeout(timer))
  live.addEventListener('focusout',e=>{if(box===live&&!live.contains(e.relatedTarget as Node|null))wait()})
  wait()
}
