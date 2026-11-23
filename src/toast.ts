let timer:number|undefined
let box:HTMLDivElement|undefined
export function hideToast(){
  clearTimeout(timer)
  box?.remove()
  box=undefined
  document.removeEventListener('keydown',onKey)
}
function onKey(e:KeyboardEvent){if(e.key==='Escape')hideToast()}
/** Kurze Rückmeldung unten mittig, 8 Sekunden lang; nimmt dem Fokus nichts weg. */
export function showToast(text:string,undo?:()=>void){
  hideToast()
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
  timer=window.setTimeout(hideToast,8000)
}
