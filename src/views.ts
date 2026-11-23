import {ArrivalMarks,collapseThreads, groupCards, localDay, matchesFocus, matchesSplit, orderCards} from './views-logic'
import {BoardLayout} from './views-layout'
import {cardRow, counter} from './card-content'
import {shortcutFor} from './shortcuts'
import type {ShortcutAction} from './shortcuts'
import {showView} from './tabs'
import {dateTerms} from './date-terms'
import {getLegacyConfig, textSnippets,updateConfig} from './data-settings'
import type {Focus, Group, Sort, Split, ViewMail} from './views-logic'
export {matchesQuery} from './views-logic'

type Field='snoozeUntil'|'followUp'|'note'
type AsyncAction=Promise<void>|void
type BoardActions={
  render():void
  open(id:string):void
  changeStatus(ids:string[],status:string):AsyncAction
  moveToFolder?(ids:string[],folderIndex:number):AsyncAction
  dropInFolder?(ids:string[],folder:string,status:string):AsyncAction
  scopeIdentity?():string
  inboxId?():string
  clearScope?():void
  hasScope?():boolean
  setField?(id:string,field:Field,value:string):AsyncAction
  canSetFields?():boolean
  setTags?(id:string,previous:string[],wanted:string[]):AsyncAction
  openOriginal?(id:string):AsyncAction
  acceptSuggestion?(id:string):AsyncAction
  reply?(id:string,all:boolean):AsyncAction
  toggleFocus?(ids:string[]):AsyncAction
  assignCase?(ids:string[]):void
  caseSuggestion?(id:string):{name:string;accept():void;dismiss():void}|undefined
}
/** Filter und Suche, die die Morgen-Triage beim Start merkt und beim Ende wiederherstellt. */
export type ViewState={search:string;focus:Focus;split:string;tag:string}
const statuses=['Offen','In Bearbeitung','Warten','Erledigt']
const fields:Record<Field,string>={followUp:'Nachfassen',snoozeUntil:'Wiedervorlage',note:'Notiz'}
function element<K extends keyof HTMLElementTagNameMap>(key:K,text=''){
  const node=document.createElement(key);node.textContent=text;return node
}
function button(label:string,fn:()=>void) {
  const b=element('button',label); b.type='button'; b.onclick=fn; return b
}
function options(select:HTMLSelectElement,choices:[string,string][]) {
  select.replaceChildren(...choices.map(([value,text])=>new Option(text,value)))
}
function selector(name:string,choices:[string,string][],change:()=>void) {
  const s=element('select');s.setAttribute('aria-label',name);s.title=name;options(s,choices)
  s.onchange=change
  return s
}
function announce(text:string){const output=document.getElementById('message');if(output)output.textContent=text}
function remembered(key:string){try{return localStorage.getItem('board.views.'+key)||''}catch{return ''}}
function remember(key:string,value:string){try{localStorage.setItem('board.views.'+key,value)}catch{announce('Die Ansicht gilt nur für diese Sitzung.')}}
function formDialog(title:string) {
  const dialog=element('dialog');dialog.className='view-dialog'
  const heading=element('h2',title);dialog.append(heading);dialog.setAttribute('aria-label',title)
  const form=element('form');dialog.append(form)
  const actions=element('div');actions.className='dialog-actions'
  const cancel=button('Abbrechen',()=>dialog.close())
  const save=element('button','Übernehmen');save.type='submit'
  actions.append(cancel,save)
  document.body.append(dialog)
  dialog.addEventListener('close',()=>dialog.remove(),{once:true})
  return {dialog,form,actions,save}
}

export class BoardViews {
  private all:ViewMail[]=[]
  private byId=new Map<string,ViewMail>()
  private selected=new Set<string>()
  private marks=new ArrivalMarks()
  private layout=new BoardLayout()
  private groups:[string,ViewMail[]][]=[]
  private categories:string[]=[]
  private anchor=''
  private threads=remembered('threads')!=='false'
  private hiddenThreads=new Map<string,number>()
  private collapsedGroups=new Set<string>()
  private focus:Focus='all'
  private focusButtons=new Map<Focus,HTMLButtonElement>()
  private split:HTMLSelectElement
  private tag:HTMLSelectElement
  private sort:HTMLSelectElement
  private group:HTMLSelectElement
  private counter=document.getElementById('selectionCount')!
  private vipTokens:string[]=[]
  private overdueDays=5
  private resetButton=button('Zurücksetzen',()=>this.clearFilters())
  private zoom=Number(remembered('zoom'))||100
  private extra:((mail:ViewMail)=>boolean)|undefined

  constructor(private api:BoardActions) {
    this.layout.redraw=()=>{this.resetSelection();this.api.render()}
    document.addEventListener('mailboard:categories',event=>{
      this.categories=((event as CustomEvent<{categories:{name:string}[]}>).detail.categories||[]).map(c=>c.name)
    })
    const legacy=getLegacyConfig()
    this.overdueDays=typeof legacy.overdue_days==='number'?legacy.overdue_days:5
    const vip=remembered('vip')
    this.vipTokens=Array.isArray(legacy.vip_senders)?legacy.vip_senders.filter((s):s is string=>typeof s==='string'):vip.split('\n').filter(Boolean)
    const refresh=()=>this.changed()
    this.split=selector('Benannte Sicht',[['','Alle Sichten'],['reply','Antwort nötig'],['overdue','Überfällig'],['vip','VIP'],['undated','Ohne Frist']],refresh)
    this.tag=selector('Kategorie',[['','Alle Kategorien']],refresh)
    this.sort=selector('Sortierung',[['recent','Neueste zuerst'],['oldest','Älteste zuerst'],['sender','Absender A–Z'],['subject','Betreff A–Z']],()=>{remember('sort',this.sort.value);refresh()})
    this.group=selector('Gruppierung',[['','Keine Gruppierung'],['folder','Nach Ordner'],['tag','Nach Kategorie']],()=>{remember('group',this.group.value);refresh()})
    for(const [name,select] of [['sort',this.sort],['group',this.group]] as const){
      const value=remembered(name);if(Array.from(select.options).some(o=>o.value===value))select.value=value
    }
    const edit=button('Kartenaktionen',()=>this.openMenu(edit,edit))
    edit.title='Status, Kategorie, Nachfassen, Wiedervorlage oder Notiz ändern'
    const controls=document.getElementById('viewControls')
    for(const select of [this.split,this.tag,this.sort,this.group]){
      const label=element('label',select.getAttribute('aria-label')||'')
      label.append(select)
      controls?.append(label)
    }
    controls?.append(edit,this.resetButton)
    const threadBox=element('input');threadBox.type='checkbox';threadBox.checked=this.threads
    threadBox.onchange=()=>{this.threads=threadBox.checked;remember('threads',String(this.threads));refresh()}
    const threadLabel=element('label');threadLabel.append(threadBox,' Unterhaltungen zusammenfassen')
    controls?.insertBefore(threadLabel,edit)
    window.addEventListener('kanban-analysis',()=>this.api.render())
    for(const [key,label] of [['all','Alle aktiven'],['today','Heute dran'],['focus','Fokus'],['snoozed','Wiedervorlage']] as const){
      const b=button(label,()=>{this.focus=key;this.api.clearScope?.();refresh()});b.dataset.label=label
      this.focusButtons.set(key,b)
      document.getElementById('focusViews')?.append(b)
    }
    this.applyZoom()
    document.addEventListener('keydown',e=>this.key(e))
    document.addEventListener('board-commands',event=>{
      const entries=(event as CustomEvent<{label:string;run:()=>void}[]>).detail
      for(const [label,offset] of [['Board vergrößern',10],['Board verkleinern',-10],['Zoom auf 100 %',0]] as const){
        entries.push({label,run:()=>this.changeZoom(offset)})
      }
      const ids=[...this.selected],first=this.byId.get(ids[0])
      if(!first)return
      for(const state of statuses)entries.push({label:'Status für Auswahl: '+state,run:()=>void this.perform(()=>this.api.changeStatus(ids,state))})
      if(this.api.toggleFocus)entries.push({label:'Fokus für Auswahl umschalten (F)',run:()=>void this.perform(()=>this.api.toggleFocus!(ids))})
      if(this.api.assignCase)entries.push({label:'Auswahl einem Vorgang zuordnen',run:()=>this.api.assignCase!(ids)})
      if(ids.length!==1)return
      if(this.api.acceptSuggestion)entries.push({label:'Ablagevorschlag prüfen',run:()=>void this.perform(()=>this.api.acceptSuggestion!(first.id))})
      if(this.api.reply)entries.push({label:'Antwortentwurf öffnen',run:()=>void this.perform(()=>this.api.reply!(first.id,false))})
      if(first.replyEvidence)entries.push({label:'Warten abschließen',run:()=>document.dispatchEvent(new CustomEvent('kanban-resolve-reply',{detail:first.id}))})
      if(first.replyEvidence)entries.push({label:'Eingegangene Antwort öffnen',run:()=>document.dispatchEvent(new CustomEvent('kanban-show-reply',{detail:first.id}))})
      if(this.fieldsEnabled()){
        for(const key of ['snoozeUntil','followUp','note'] as const)if(key!=='followUp'||first.status==='Warten')entries.push({label:fields[key],run:()=>this.editField(first,key)})
      }
    })
  }
  /** Board and folder buttons are recreated on refresh. Read focus immediately before replacement. */
  rememberPlace(){
    const board=document.getElementById('board')!
    const left=board.scrollLeft,top=board.scrollTop
    const sidebar=document.querySelector<HTMLElement>('.side-scroll'),sidebarTop=sidebar?.scrollTop||0
    const active=document.activeElement instanceof HTMLElement?document.activeElement:undefined
    const lane=active?.closest<HTMLElement>('.lane')?.dataset.status
    const group=active?.closest('.group-cell')?.querySelector<HTMLElement>('[data-group-key]')?.dataset.groupKey
    const mail=active?.dataset.viewId,groupButton=active?.dataset.groupKey
    const folder=active?.closest('#folders button') as HTMLButtonElement|null
    return ()=>{
      if(active && !active.isConnected && document.activeElement===document.body){
        let target:HTMLElement|undefined
        const column=Array.from(board.querySelectorAll<HTMLElement>('.lane')).find(node=>node.dataset.status===lane)
        if(mail){
          const cards=this.cardNodes().filter(node=>node.dataset.viewId===mail)
          target=cards.find(node=>node.closest('.group-cell')?.querySelector<HTMLElement>('[data-group-key]')?.dataset.groupKey===group)||cards[0]
        }
        if(groupButton)target=Array.from(column?.querySelectorAll<HTMLElement>('[data-group-key]')||[]).find(node=>node.dataset.groupKey===groupButton)
        if(!target && column)target=column.querySelector<HTMLElement>('.column-toggle')||undefined
        if(folder)target=Array.from(document.querySelectorAll<HTMLButtonElement>('#folders button')).find(node=>node.title===folder.title)
        target?.focus({preventScroll:true})
      }
      board.scrollLeft=left;board.scrollTop=top
      if(sidebar)sidebar.scrollTop=sidebarTop
    }
  }
  sync(mails:ViewMail[]) {
    this.marks.sync(this.api.scopeIdentity?.()||'board',mails,this.api.inboxId?.()||'Posteingang')
    const config=getLegacyConfig()
    this.overdueDays=Number(config.overdue_days??5)
    this.vipTokens=Array.isArray(config.vip_senders)?config.vip_senders.filter((s):s is string=>typeof s==='string'):remembered('vip').split('\n').filter(Boolean)
    this.layout.sync(mails);this.all=mails
    this.byId=new Map(mails.map(m=>[m.id,m]))
    for(const id of this.selected)if(!this.byId.has(id))this.selected.delete(id)
    const tags=[...new Set(mails.flatMap(m=>m.tags))].sort((a,b)=>a.localeCompare(b,'de'))
    if(tags.join('\u0001')!==Array.from(this.tag.options).slice(1).map(x=>x.value).join('\u0001')){
      const value=this.tag.value
      options(this.tag,[['','Alle Kategorien'],...tags.map(t=>[t,t] as [string,string])])
      if(tags.includes(value))this.tag.value=value
    }
    const today=localDay()
    for(const [focus,b] of this.focusButtons){
      b.textContent=b.dataset.label+' · '+mails.filter(m=>matchesFocus(m,focus,today,this.overdueDays)).length
      b.setAttribute('aria-pressed',String(this.focus===focus))
    }
    const search=document.getElementById('search') as HTMLInputElement|null
    const viewCount=[this.tag.value,this.split.value,this.group.value,this.sort.value!=='recent'].filter(Boolean).length
    document.getElementById('activeViewCount')!.textContent=viewCount?' · '+viewCount:''
    this.resetButton.disabled=!(search?.value || this.api.hasScope?.() || this.tag.value || this.split.value || this.focus!=='all')
    this.updateCounter()
  }
  filter<T extends ViewMail>(mails:T[]) {
    const today=localDay()
    const source=this.threads?collapseThreads(mails,today):{rows:mails,hidden:new Map<string,number>()}
    this.hiddenThreads=source.hidden
    const result=orderCards(source.rows.filter(m=> (!this.extra || this.extra(m)) && matchesFocus(m,this.focus,today,this.overdueDays) &&
      matchesSplit(m,this.split.value as Split,this.vipTokens,today,this.overdueDays) &&
      (!this.tag.value || m.tags.includes(this.tag.value))),this.sort.value as Sort,this.overdueDays)
    result.sort((a,b)=>Number(this.marks.returned.has(b.id))-Number(this.marks.returned.has(a.id)))
    this.groups=groupCards(result,this.group.value as Group)
    const ids=new Set(result.map(m=>m.id))
    for(const id of this.selected)if(!ids.has(id))this.selected.delete(id)
    this.updateCounter()
    return result
  }
  bindLane(lane:HTMLElement,heading:HTMLElement,status:string){this.layout.lane(lane,heading,status,this.groups.length,!!this.group.value && this.groups.length>0)}
  cards<T extends ViewMail>(mails:T[],make:(mail:T)=>HTMLElement,status:string) {
    const nodes:HTMLElement[]=[]
    const displayed=new Set<string>()
    const inLane=new Map(mails.map(m=>[m.id,m]))
    for(const [group,allRows] of this.groups){
      const rows=allRows.map(m=>inLane.get(m.id)).filter((row):row is T=>!!row)
      const cell=element('div');cell.className='group-cell'
      const append=(node:HTMLElement)=>group?cell.append(node):nodes.push(node)
      if(group)nodes.push(cell)
      if(this.group.value==='folder' && this.api.dropInFolder && allRows.length){
        const folder=allRows[0].folderId||allRows[0].folder
        cell.dataset.folder=folder;cell.dataset.status=status
        cell.ondragover=e=>{
          if(!e.dataTransfer?.types.includes('application/x-mailboard-item'))return
          e.preventDefault();e.stopPropagation();cell.classList.add('over')
        }
        cell.ondragleave=()=>cell.classList.remove('over')
        cell.ondrop=e=>{
          const id=e.dataTransfer?.getData('application/x-mailboard-item')
          if(!id || !this.byId.has(id))return
          e.preventDefault();e.stopPropagation();cell.classList.remove('over')
          void this.perform(()=>this.api.dropInFolder!(this.selectedIds(id),folder,status))
        }
      }
      if(group){
        const key=this.group.value+':'+(this.group.value==='folder'?allRows[0]?.folderId||group:group)
        const collapsed=this.collapsedGroups.has(key)
        const title=element('h4');title.className='group-label'
        const toggle=button(group+' · '+rows.length,()=>{
          if(collapsed)this.collapsedGroups.delete(key);else this.collapsedGroups.add(key)
          this.resetSelection();this.api.render()
          this.cardGroupButtons().find(b=>b.dataset.groupKey===key)?.focus()
        })
        toggle.dataset.groupKey=key
        toggle.setAttribute('aria-expanded',String(!collapsed))
        title.append(toggle);append(title)
        if(collapsed)continue
      }
      for(const row of rows){
        const card=make(row)
        if(displayed.has(row.id))card.removeAttribute('id')
        displayed.add(row.id);append(card)
      }
    }
    return nodes
  }
  bindCard(card:HTMLElement,id:string) {
    card.dataset.viewId=id
    const mail=this.byId.get(id)
    if(this.marks.returned.has(id)||this.marks.fresh.has(id)){
      const marker=element('b',this.marks.returned.has(id)?'Wieder da':'Neu')
      marker.className='arrival-mark';cardRow(card,'flags').prepend(marker)
    }
    if(mail) {
      if(mail.note){
        const note=element('em','Notiz · '+mail.note);note.className='card-note'
        const foot=card.querySelector(':scope > .card-foot')
        if(foot)foot.before(note);else card.append(note)
      }
      const hidden=this.hiddenThreads.get(mail.id)
      if(hidden)cardRow(card,'counters').append(counter('+'+hidden,hidden===1?'Eine weitere Mail der Unterhaltung':hidden+' weitere Mails der Unterhaltung','thread'))
    }
    card.setAttribute('aria-pressed',String(this.selected.has(id)))
    card.addEventListener('click',e=>{
      if(e.ctrlKey||e.metaKey||e.shiftKey){e.preventDefault();e.stopImmediatePropagation();this.pick(id,e.shiftKey,e.ctrlKey||e.metaKey)}
      else this.pick(id,false,false)
    },true)
    card.addEventListener('contextmenu',e=>{e.preventDefault();if(!this.selected.has(id))this.pick(id,false,false);this.openMenu(e.clientX||e.clientY?{x:e.clientX,y:e.clientY}:card,card)})
    card.addEventListener('dragstart',()=>{if(!this.selected.has(id))this.pick(id,false,false)},true)
  }
  selectedIds(fallbackId:string) {return this.selected.has(fallbackId)?[...this.selected]:[fallbackId]}
  /** Aktuell markierte Karten, etwa für die Zuordnung zu einem Vorgang. */
  selection(){return [...this.selected]}
  /** Zusätzlicher Filter, etwa für den aktuellen Triage-Schritt. */
  setExtraFilter(filter:((mail:ViewMail)=>boolean)|undefined){this.extra=filter;this.resetSelection()}
  captureView():ViewState{
    const search=document.getElementById('search') as HTMLInputElement|null
    return {search:search?.value||'',focus:this.focus,split:this.split.value,tag:this.tag.value}
  }
  restoreView(state:ViewState){
    const search=document.getElementById('search') as HTMLInputElement|null
    if(search)search.value=state.search
    this.focus=state.focus;this.split.value=state.split
    if(state.tag && !Array.from(this.tag.options).some(o=>o.value===state.tag))this.tag.add(new Option(state.tag,state.tag))
    this.tag.value=state.tag;this.resetSelection()
  }
  /** Zeigt nur Karten mit dieser Kategorie, etwa alle Mails eines Vorgangs. */
  showTag(tag:string){
    const search=document.getElementById('search') as HTMLInputElement|null
    if(search)search.value=''
    this.focus='all';this.split.value=''
    if(!Array.from(this.tag.options).some(o=>o.value===tag))this.tag.add(new Option(tag,tag))
    this.tag.value=tag;this.changed()
  }
  /** Zeigt eine Fokusansicht auf dem Board, etwa aus der Startseite. */
  showFocus(key:'today'|'focus'){this.showBoard(key,'')}
  /** Zeigt eine benannte Sicht (z. B. 'overdue') auf dem Board. */
  showSplit(value:string){this.showBoard('all',value)}
  private showBoard(focus:Focus,split:string){
    const search=document.getElementById('search') as HTMLInputElement|null
    if(search)search.value=''
    this.focus=focus;this.split.value=split;this.tag.value=''
    this.api.clearScope?.()
    showView('board');this.changed()
  }
  resetSelection(){this.layout.hide();this.selected.clear();this.anchor='';this.paint()}
  reset(){this.focus='all';this.split.value='';this.tag.value='';this.resetSelection()}
  private clearFilters(){
    const search=document.getElementById('search') as HTMLInputElement|null
    if(search)search.value=''
    this.reset();this.api.clearScope?.();this.api.render()
  }
  private changed(){this.resetSelection();this.api.render()}
  private cardGroupButtons(){return Array.from(document.querySelectorAll<HTMLButtonElement>('[data-group-key]'))}
  private cardNodes(){return Array.from(document.querySelectorAll<HTMLElement>('#board .lane:not(.folded) [data-view-id]'))}
  private updateCounter(){this.counter.textContent=this.selected.size?this.selected.size+' markiert':''}
  private paint(){
    for(const node of this.cardNodes())node.setAttribute('aria-pressed',String(this.selected.has(node.dataset.viewId!)))
    this.updateCounter()
  }
  private pick(id:string,range:boolean,toggle:boolean){
    this.marks.seen(id)
    for(const node of this.cardNodes())if(node.dataset.viewId===id)node.querySelector('.arrival-mark')?.remove()
    const mail=this.byId.get(id);if(mail && this.layout.previewOpen)this.layout.show(mail)
    if(range && this.anchor) {
      const ids=this.cardNodes().map(n=>n.dataset.viewId!)
      const a=ids.indexOf(this.anchor),b=ids.indexOf(id)
      if(a>=0 && b>=0){
        if(!toggle)this.selected.clear()
        for(const key of ids.slice(Math.min(a,b),Math.max(a,b)+1))this.selected.add(key)
      }else this.selected=new Set([id])
    }else{
      if(!toggle)this.selected.clear()
      if(toggle&&this.selected.has(id))this.selected.delete(id);else this.selected.add(id)
      this.anchor=id
    }
    this.paint()
  }
  private async perform(action:()=>AsyncAction){
    try{await action()}catch(error){announce('Aktion fehlgeschlagen: '+String(error))}
  }
  private menu?:HTMLElement
  private menuBack?:HTMLElement
  private closeMenu(restore=true){
    const menu=this.menu;if(!menu)return
    this.menu=undefined;menu.remove()
    document.removeEventListener('pointerdown',this.menuOutside,true)
    const back=this.menuBack;this.menuBack=undefined
    if(restore&&back){
      const card=back.dataset.viewId&&document.querySelector<HTMLElement>('[data-view-id="'+CSS.escape(back.dataset.viewId)+'"]')
      ;(card||back).focus()
    }
  }
  private menuOutside=(e:Event)=>{if(this.menu&&!this.menu.contains(e.target as Node))this.closeMenu(false)}
  /** Kontextmenü der markierten Karten; `at` ist die Mausposition oder der Anker (Karte, Knopf). */
  private openMenu(at:{x:number,y:number}|HTMLElement,backTo?:HTMLElement){
    this.closeMenu(false)
    const ids=[...this.selected],first=this.byId.get(ids[0])
    if(!first){announce('Bitte zuerst eine Karte markieren. Strg+Klick markiert mehrere.');return}
    type Entry={label:string,key?:ShortcutAction,run:()=>AsyncAction}
    const groups:[string,Entry[]][]=[['Status',[]],['Antworten',[]],['Planen',[]],['Ordnen',[]]]
    const add=(group:string,label:string,run:()=>AsyncAction,key?:ShortcutAction)=>groups.find(g=>g[0]===group)![1].push({label,key,run})
    const statusKeys:ShortcutAction[]=['status-open','status-progress','status-waiting','status-done']
    statuses.forEach((state,i)=>add('Status',state,()=>this.api.changeStatus(ids,state),statusKeys[i]))
    const one=ids.length===1
    if(one){
      add('Antworten','Details',()=>this.api.open(first.id),'details')
      if(this.api.openOriginal)add('Antworten','In Outlook öffnen',()=>this.api.openOriginal!(first.id),'open')
      if(this.api.reply){
        add('Antworten','Antworten',()=>this.api.reply!(first.id,false),'reply')
        add('Antworten','Allen antworten',()=>this.api.reply!(first.id,true),'reply-all')
      }
      if(first.replyEvidence){
        add('Antworten','Eingegangene Antwort öffnen',()=>{document.dispatchEvent(new CustomEvent('kanban-show-reply',{detail:first.id}))})
        add('Antworten','Warten abschließen',()=>{document.dispatchEvent(new CustomEvent('kanban-resolve-reply',{detail:first.id}))})
      }
      if(this.fieldsEnabled()){
        add('Planen',fields.snoozeUntil,()=>this.editField(first,'snoozeUntil'),'snooze')
        if(first.status==='Warten')add('Planen',fields.followUp,()=>this.editField(first,'followUp'),'follow-up')
        add('Planen',fields.note,()=>this.editField(first,'note'),'note')
      }
      if(this.api.setTags)add('Ordnen','Kategorien bearbeiten',()=>this.editField(first,'tags'))
    }
    if(this.api.toggleFocus)add('Planen','Fokus umschalten',()=>this.api.toggleFocus!(ids),'focus')
    if(this.api.assignCase)add('Ordnen','Vorgang zuordnen …',()=>this.api.assignCase!(ids))
    const caseHint=one?this.api.caseSuggestion?.(first.id):undefined
    if(caseHint){
      add('Ordnen','Vorgang '+caseHint.name+' zuordnen',caseHint.accept)
      add('Ordnen','Vorgangsvorschlag ablehnen',caseHint.dismiss)
    }
    if(one&&this.api.acceptSuggestion)add('Ordnen','Ablagevorschlag prüfen',()=>this.api.acceptSuggestion!(first.id),'accept-suggestion')
    const menu=element('div');menu.className='card-menu';menu.setAttribute('role','menu')
    const title=one?first.subject:ids.length+' markierte Mails'
    menu.setAttribute('aria-label',title);this.menuBack=backTo
    const head=element('p',title);head.className='card-menu-head';menu.append(head)
    const items:HTMLButtonElement[]=[]
    groups.forEach(([name,entries],index)=>{
      if(!entries.length)return
      const group=element('div');group.className='card-menu-group';group.setAttribute('role','group')
      const label=element('p',name);label.className='card-menu-label';label.id='card-menu-'+index;group.setAttribute('aria-labelledby',label.id)
      group.append(label)
      for(const entry of entries){
        const item=element('button');item.type='button';item.className='card-menu-item';item.tabIndex=-1;item.setAttribute('role','menuitem')
        item.append(element('span',entry.label))
        const hint=entry.key&&shortcutFor(entry.key)
        if(hint){const kbd=element('kbd',hint);item.append(kbd)}
        item.onclick=()=>{this.closeMenu(true);void this.perform(entry.run)}
        group.append(item);items.push(item)
      }
      menu.append(group)
    })
    menu.addEventListener('keydown',e=>{
      const at=items.indexOf(document.activeElement as HTMLButtonElement)
      let next=-1
      if(e.key==='ArrowDown')next=(at+1)%items.length
      else if(e.key==='ArrowUp')next=(at<=0?items.length:at)-1
      else if(e.key==='Home')next=0
      else if(e.key==='End')next=items.length-1
      else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.closeMenu();return}
      else if(e.key==='Tab'){e.preventDefault();this.closeMenu();return}
      else{e.stopPropagation();return}
      e.preventDefault();e.stopPropagation();items[next]?.focus()
    })
    document.body.append(menu);this.menu=menu
    document.addEventListener('pointerdown',this.menuOutside,true)
    const box=menu.getBoundingClientRect()
    let x:number,y:number
    if(at instanceof HTMLElement){const r=at.getBoundingClientRect();x=r.left+8;y=r.bottom}else{x=at.x;y=at.y}
    menu.style.left=Math.max(4,Math.min(x,window.innerWidth-box.width-4))+'px'
    menu.style.top=Math.max(4,Math.min(y,window.innerHeight-box.height-4))+'px'
    items[0]?.focus()
  }
  private fieldsEnabled(){return !!this.api.setField && (!this.api.canSetFields || this.api.canSetFields())}
  /** Bearbeitungsdialog für die Aktionsleiste der Maildetails; gibt `false` zurück, wenn die Aktion nicht möglich ist. */
  editDetailField(id:string,field:Field,returnTo?:HTMLElement):boolean{
    const mail=this.byId.get(id)
    if(!mail||!this.fieldsEnabled()||(field==='followUp'&&mail.status!=='Warten'))return false
    this.editField(mail,field,returnTo)
    return true
  }
  private editField(mail:ViewMail,field:Field|'tags',returnTo?:HTMLElement){
    const {dialog,form,actions,save}=formDialog(field==='tags'?'Kategorien bearbeiten':fields[field])
    const label=element('label',field==='tags'?'Eine Kategorie pro Zeile':field==='note'?'Notiz':'Datum')
    const isDate=field==='followUp'||field==='snoozeUntil'
    const input=isDate?element('input'):element('textarea')
    if(input instanceof HTMLInputElement)input.type='date'
    input.value=field==='tags'?mail.tags.join('\n'):isDate?(mail[field as Field]||'').slice(0,10):mail.note||''
    label.append(input);form.append(element('p',mail.subject),label)
    if(field==='followUp'||field==='snoozeUntil'){const hint=element('p',field==='followUp'?dateTerms.nachfassen:dateTerms.wiedervorlage);hint.className='field-hint';input.setAttribute('aria-describedby','dateHint');hint.id='dateHint';form.append(hint)}
    if(field==='tags'){
      const names=[...new Set([...this.categories,...this.all.flatMap(m=>m.tags)])].sort((a,b)=>a.localeCompare(b,'de'))
      if(names.length){
        const picker=selector('Kategorie aus Liste ergänzen',[['','Kategorie ergänzen …'],...names.map(name=>[name,name] as [string,string])],()=>{
          const values=input.value.split('\n').map(s=>s.trim()).filter(Boolean)
          if(picker.value&&!values.some(s=>s.toLowerCase()===picker.value.toLowerCase()))values.push(picker.value)
          input.value=values.join('\n');picker.value='';input.focus()
        })
        form.append(picker)
      }
    }
    if(field==='note'){
      const snippets=textSnippets('note')
      if(snippets.length){
        const picker=selector('Textbaustein einfügen',[['','Textbaustein einfügen …'],...snippets.map((s,i)=>[String(i),s.label] as [string,string])],()=>{
          if(!picker.value)return
          const text=snippets[Number(picker.value)].body
          input.setRangeText(text,input.selectionStart??input.value.length,input.selectionEnd??input.value.length,'end')
          picker.value='';input.focus()
        })
        form.append(picker)
      }
    }
    if(isDate){
      for(const [caption,offset] of [['Nächster Werktag',1],['In einer Woche',7]] as const){
        form.append(button(caption,()=>{
          const date=new Date();date.setDate(date.getDate()+offset)
          if(offset===1)while([0,6].includes(date.getDay()))date.setDate(date.getDate()+1)
          input.value=localDay(date)
        }))
      }
    }
    const err=element('p');err.setAttribute('role','alert')
    form.append(actions,err)
    form.onsubmit=async e=>{
      e.preventDefault();if(!form.reportValidity())return
      save.disabled=true
      try{
        if(field==='tags'){
          const values=[...new Set(input.value.split('\n').map(t=>t.trim()).filter(Boolean))]
          await this.api.setTags!(mail.id,mail.tags,values)
        }else await this.api.setField!(mail.id,field,input.value.trim())
        dialog.close()
      }catch(error){err.textContent=String(error)}finally{save.disabled=false}
    }
    if(returnTo)dialog.addEventListener('close',()=>returnTo.focus(),{once:true})
    dialog.showModal();input.focus()
  }
  editVip(){
    const {dialog,form,actions}=formDialog('VIP-Absender')
    const label=element('label','Ein Name oder eine Adresse pro Zeile')
    const input=element('textarea');input.value=this.vipTokens.join('\n');label.append(input)
    form.append(label,actions)
    form.onsubmit=e=>{e.preventDefault();this.vipTokens=input.value.split('\n').map(x=>x.trim()).filter(Boolean);updateConfig({vip_senders:this.vipTokens});dialog.close();this.changed()}
    dialog.showModal();input.focus()
  }
  private changeZoom(offset:number){this.zoom=offset?this.zoom+offset:100;this.applyZoom();remember('zoom',String(this.zoom))}
  private applyZoom(){
    if(!Number.isFinite(this.zoom))this.zoom=100
    this.zoom=Math.min(160,Math.max(80,this.zoom))
    const board=document.getElementById('board');if(board)board.style.zoom=String(this.zoom/100)
  }
  private key(e:KeyboardEvent){
    if(e.defaultPrevented||e.altKey||document.querySelector('dialog[open]'))return
    const input=e.target instanceof HTMLElement?e.target:null
    if(e.key==='Escape' && input?.id==='search'){
      e.preventDefault(); this.clearFilters(); return
    }
    if(input?.closest('input,textarea,select,[contenteditable=true]'))return
    const modifier=e.ctrlKey||e.metaKey
    if(modifier && ['+','=','-','0'].includes(e.key)){
      e.preventDefault();this.changeZoom(e.key==='0'?0:e.key==='-'?-10:10);return
    }
    if(e.key==='Escape'){
      if(this.layout.previewOpen)this.layout.hide();else if(this.selected.size)this.resetSelection();else this.clearFilters()
      e.preventDefault();return
    }
    const node=input?.closest<HTMLElement>('[data-view-id]')
    if(!modifier && e.shiftKey && e.key===' '){
      if(this.layout.previewOpen)this.layout.hide()
      else{
        const target=node||this.cardNodes().find(n=>this.selected.has(n.dataset.viewId!))||this.cardNodes()[0]
        const mail=this.byId.get(target?.dataset.viewId||'')
        if(target&&mail){this.pick(mail.id,false,false);target.focus();this.layout.show(mail)}
      }
      e.preventDefault();return
    }
    if(!node)return
    const id=node.dataset.viewId!, ids=this.selectedIds(id)
    if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){
      if(!this.selected.has(id))this.pick(id,false,false)
      this.openMenu(node,node);e.preventDefault();return
    }
    if(e.key.startsWith('Arrow')){
      const nodes=this.cardNodes(), lane=node.closest('.lane')
      if(!lane)return
      const column=nodes.filter(n=>n.closest('.lane')===lane)
      const index=column.indexOf(node)
      let next:HTMLElement|undefined
      if(e.key==='ArrowDown')next=column[index+1]
      if(e.key==='ArrowUp')next=column[index-1]
      if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
        const other=e.key==='ArrowLeft'?lane.previousElementSibling:lane.nextElementSibling
        const adjacent=nodes.filter(n=>n.closest('.lane')===other)
        next=adjacent[Math.min(index,adjacent.length-1)]
      }
      if(next){this.pick(next.dataset.viewId!,e.shiftKey,false);next.focus()}
    }else if(!modifier && /^[1-4]$/.test(e.key)){
      void this.perform(()=>this.api.changeStatus(ids,statuses[Number(e.key)-1]))
    }else if(modifier && /^[1-9]$/.test(e.key) && this.api.moveToFolder){
      void this.perform(()=>this.api.moveToFolder!(ids,Number(e.key)-1))
    }else if(modifier && e.key==='Enter' && this.api.acceptSuggestion){
      void this.perform(()=>this.api.acceptSuggestion!(id))
    }else if(!modifier && e.key==='Enter' && this.api.openOriginal){
      void this.perform(()=>this.api.openOriginal!(id))
    }else if(!modifier && e.key===' '){
      this.pick(id,false,false);this.api.open(id)
    }else if(!modifier && e.key.toLowerCase()==='r' && this.api.reply){
      void this.perform(()=>this.api.reply!(id,e.shiftKey))
    }else if(!modifier && e.key.toLowerCase()==='f' && this.api.toggleFocus){
      void this.perform(()=>this.api.toggleFocus!(ids))
    }else if(!modifier && ['n','w','k'].includes(e.key.toLowerCase())&&this.fieldsEnabled()){
      const mail=this.byId.get(id)
      const field=({n:'followUp',w:'snoozeUntil',k:'note'} as const)[e.key.toLowerCase() as 'n'|'w'|'k']
      if(mail && (field!=='followUp'||mail.status==='Warten'))this.editField(mail,field)
    }else return
    e.preventDefault()
  }
}
