import type {ViewMail} from './views-logic'

function saved(key:string) {
  try{return localStorage.getItem('board.layout.'+key)||''}catch{return ''}
}
function store(key:string,value:string){
  try{localStorage.setItem('board.layout.'+key,value)}catch{/* Session fallback. */}
}
function action(label:string,fn:()=>void){
  const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=fn;return button
}

export class BoardLayout{
  private closed=new Set(saved('columns').split('|').filter(Boolean))
  private preview=document.createElement('aside')
  private title=document.createElement('h3')
  private from=document.createElement('p')
  private body=document.createElement('p')
  private shown=''
  private prior=new Map<string,string>()
  constructor(){
    this.preview.className='follow-preview';this.preview.hidden=true
    this.preview.setAttribute('aria-label','Kurzvorschau');this.preview.setAttribute('aria-live','polite')
    const close=action('Schließen',()=>this.hide())
    this.preview.append(this.title,this.from,this.body,close);document.body.append(this.preview)
    this.resizeControl()
    if(!saved('intro')){
      this.hint('Die Windows-App lädt beim Start dein klassisches Outlook-Profil. Status, Fristen und Notizen speichert sie dort an der Mail. Eine Ablage bestätigst du vor dem Verschieben. Outlook öffnet Antworten als Entwurf.', 'intro')
    }
  }
  private hint(text:string,key:string){
    const box=document.createElement('div');box.className='board-hint'
    const copy=document.createElement('p');copy.textContent=text
    box.append(copy,action('Verstanden',()=>{store(key,'1');box.remove()}))
    document.querySelector('.board-heading')?.before(box)
  }
  sync(rows:ViewMail[]){
    if(!saved('waiting-tip') && rows.some(row=>row.status==='Warten' && this.prior.has(row.id)&&this.prior.get(row.id)!=='Warten')){
      store('waiting-tip','1');this.hint('In „Warten“ setzt N einen Nachfasstermin und W eine Wiedervorlage. Strg+G zeigt gesendete Mails ohne Antwort.','waiting-tip')
    }
    this.prior=new Map(rows.map(m=>[m.id,m.status]))
    if(this.shown && !rows.some(m=>m.id===this.shown))this.hide()
  }
  get previewOpen(){return !this.preview.hidden}
  show(mail:ViewMail){
    this.shown=mail.id;this.preview.hidden=false
    this.title.textContent=mail.subject
    this.from.textContent=mail.isSent?'An '+(mail.recipients||mail.sender):mail.sender
    this.body.textContent=mail.body||'Kein Vorschautext vorhanden.'
  }
  hide(){this.shown='';this.preview.hidden=true}
  lane(lane:HTMLElement,heading:HTMLElement,status:string,groupCount:number,extraStyles:boolean){
    const collapsed=this.closed.has(status),board=document.getElementById('board')
    if(board){
      if(this.closed.size)board.style.gridTemplateColumns=['Offen','In Bearbeitung','Warten','Erledigt'].map(s=>this.closed.has(s)?'minmax(5.8rem,auto)':'minmax(11.4rem,1fr)').join(' ')
      else board.style.removeProperty('grid-template-columns')
      board.classList.toggle('grouped-board',extraStyles)
    }
    lane.dataset.status=status;lane.classList.toggle('folded',collapsed)
    if(extraStyles)lane.style.gridRow='1 / span '+Math.max(2,groupCount+1)
    const toggle=action('',()=>{
      if(this.closed.has(status))this.closed.delete(status);else this.closed.add(status)
      store('columns',[...this.closed].join('|'))
      this.redraw();Array.from(document.querySelectorAll<HTMLElement>('.lane')).find(l=>l.dataset.status===status)?.querySelector('button')?.focus()
    })
    toggle.className='column-toggle';toggle.setAttribute('aria-expanded',String(!collapsed))
    toggle.setAttribute('aria-label',status+(collapsed?' ausklappen':' einklappen'))
    toggle.append(...Array.from(heading.childNodes));heading.replaceChildren(toggle)
  }
  redraw:()=>void=()=>{}
  private resizeControl(){
    const sidebar=document.querySelector<HTMLElement>('.sidebar')
    if(!sidebar)return
    const handle=document.createElement('div')
    handle.className='sidebar-resizer';handle.tabIndex=0;handle.setAttribute('role','separator')
    handle.setAttribute('aria-label','Ordnerleiste anpassen');handle.setAttribute('aria-orientation','vertical')
    const bounds=()=>({min:120,max:Math.max(120,Math.min(520,window.innerWidth*.55))})
    const size=(width:number,persist:boolean)=>{
      const {min,max}=bounds(),px=Math.round(Math.max(min,Math.min(max,width)))
      document.body.style.gridTemplateColumns=px+'px minmax(0,1fr)'
      handle.setAttribute('aria-valuenow',String(px));handle.setAttribute('aria-valuemin',String(min));handle.setAttribute('aria-valuemax',String(Math.round(max)))
      if(persist)store('sidebar',String(px))
    }
    const remembered=Number(saved('sidebar'))
    if(remembered)size(remembered,false)
    else{handle.setAttribute('aria-valuenow',String(Math.round(sidebar.offsetWidth)));handle.setAttribute('aria-valuemin','120');handle.setAttribute('aria-valuemax',String(Math.round(bounds().max)))}
    handle.onpointerdown=e=>{if(e.button===0){e.preventDefault();handle.setPointerCapture(e.pointerId)}}
    handle.onpointermove=e=>{if(handle.hasPointerCapture(e.pointerId))size(e.clientX,false)}
    handle.onpointerup=e=>{if(handle.hasPointerCapture(e.pointerId)){handle.releasePointerCapture(e.pointerId);size(e.clientX,true)}}
    handle.onkeydown=e=>{
      if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
        size(sidebar.offsetWidth+(e.key==='ArrowLeft'?-12:12),true);e.preventDefault()
      }
    }
    window.addEventListener('resize',()=>{if(document.body.style.gridTemplateColumns)size(sidebar.offsetWidth,false)})
    sidebar.append(handle)
  }
}
