// Kurze Einführung: drei Schritte als schwebende Hinweisblase an Board, Karte und Tab-Leiste.
type Step={target:()=>HTMLElement|null;text:string}
const steps:Step[]=[
  {target:()=>document.getElementById('board'),text:'Jede Spalte ist ein Status. Zieh Karten zwischen Spalten oder drücke 1–4.'},
  {target:()=>document.querySelector<HTMLElement>('#board .card')||document.getElementById('board'),text:'Klick öffnet die Mail, Rechtsklick zeigt alle Aktionen. F setzt den Tagesfokus.'},
  {target:()=>document.getElementById('viewTabs'),text:'Kalender, Vorgänge und Routinen findest du hier. Strg+T startet die Morgen-Triage.'},
]
const keyOf=(source:string)=>'board.layout.intro-'+source
function read(key:string){try{return localStorage.getItem(key)||''}catch{return ''}}
function write(key:string){try{localStorage.setItem(key,'1')}catch{/* Nur diese Sitzung. */}}

let active:{close:()=>void}|undefined
let current=''  // Postfach des Boards, zuletzt von maybeIntro gemeldet

export function introActive(){return !!active}
/** Startet die Einführung einmal je Postfach. Der alte Schlüssel `board.layout.intro` gilt für beide als gesehen. */
export function maybeIntro(source:'outlook'|'demo'|'offline'){
  if(source!==current)active?.close()
  current=source
  if(source==='offline')return
  if(read('board.layout.intro')||read(keyOf(source)))return
  setTimeout(()=>{if(current===source&&!active&&!read(keyOf(source)))showIntro()},0)
}
export function showIntro(){
  active?.close()
  const owner=current  // Beim Öffnen festgehalten: nur dieses Postfach wird gemerkt.
  const pop=document.createElement('div');pop.className='intro-pop'
  pop.setAttribute('role','dialog');pop.setAttribute('aria-modal','false');pop.setAttribute('aria-label','Kurze Einführung');pop.tabIndex=-1
  const count=document.createElement('p');count.className='intro-step'
  const text=document.createElement('p');text.className='intro-text';text.id='intro-text'
  pop.setAttribute('aria-describedby','intro-text')
  const skip=document.createElement('button');skip.type='button';skip.textContent='Überspringen'
  const next=document.createElement('button');next.type='button'
  const row=document.createElement('div');row.className='intro-actions';row.append(skip,next)
  const arrow=document.createElement('span');arrow.className='intro-arrow';arrow.setAttribute('aria-hidden','true')
  pop.append(arrow,count,text,row)
  const returnTo=document.activeElement instanceof HTMLElement?document.activeElement:null
  let index=0
  const place=()=>{
    const target=steps[index].target()
    if(!target){pop.style.top='1rem';pop.style.left='1rem';arrow.hidden=true;return}
    const r=target.getBoundingClientRect(),w=pop.offsetWidth,h=pop.offsetHeight,vw=innerWidth,vh=innerHeight
    const left=Math.max(8,Math.min(vw-w-8,r.left+Math.min(24,r.width/4)))
    let top:number,dir='up'
    if(r.height>vh*.5){top=Math.max(8,r.top)+16;dir='none'}
    else if(r.bottom+h+14<=vh){top=r.bottom+10}
    else{top=Math.max(8,r.top-h-10);dir='down'}
    pop.style.left=left+'px';pop.style.top=Math.max(8,Math.min(vh-h-8,top))+'px'
    arrow.hidden=dir==='none';arrow.dataset.dir=dir
    arrow.style.left=Math.max(12,Math.min(w-24,r.left+Math.min(24,r.width/4)+12-left))+'px'
  }
  const draw=()=>{
    const last=index===steps.length-1
    count.textContent='Schritt '+(index+1)+' von '+steps.length
    text.textContent=steps[index].text;next.textContent=last?'Fertig':'Weiter'
    steps[index].target()?.scrollIntoView?.({block:'nearest'})
    place()
  }
  const close=()=>{
    document.removeEventListener('keydown',onEscape,true);removeEventListener('resize',place)
    pop.remove();active=undefined
    const back=returnTo?.isConnected&&returnTo.getClientRects().length?returnTo:document.querySelector<HTMLElement>('#board .card')
    back?.focus()
  }
  const finish=()=>{if(owner&&owner!=='offline')write(keyOf(owner));close()}
  // Escape schließt nur die Einführung, nicht zusätzlich Vorschau, Auswahl oder Filter des Boards. Ein offener Dialog geht vor.
  const onEscape=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]')){e.preventDefault();e.stopPropagation();finish()}}
  skip.onclick=finish
  next.onclick=()=>{if(index>=steps.length-1){finish();return}index++;draw();next.focus()}
  // Tasten in der Blase lösen keine Kartenaktionen aus. Kürzel mit Strg (Befehl suchen, Rückgängig) gelten weiter.
  pop.addEventListener('keydown',e=>{if(e.key!=='Escape'&&!e.ctrlKey&&!e.metaKey)e.stopPropagation()})
  document.addEventListener('keydown',onEscape,true);addEventListener('resize',place)
  document.body.append(pop);draw();next.focus()
  active={close}
}
