/**
 * E4 Struktur verfeinern (Teil 1): drei Blöcke mit Vorschlägen für die Lernordner.
 * - Überfüllte Ordner (mehr als 150 Mails oder Kandidat aus E3): „Unterteilung vorschlagen“ öffnet `openStructure` (structure.ts)
 *   und danach das Verteilen (`distribute`, distribute.ts) mit den angelegten Unterordnern.
 * - Überschneidungen (ähnliche Ordnerprofile oder gegenseitige Verwechslung in der Messung aus E2): Zusammenlegen mit Bestätigung
 *   samt Mailanzahl, als ein Rückgängig-Schritt über `mergeFolders` (projects.ts). Die Richtung lässt sich umkehren.
 * - Unklare Namen: die lokale KI schlägt einen Namen vor (`suggestFolderName`), umbenannt wird mit `renameFolder` samt Rückgängig.
 * - Neue Ordner aus dem Posteingang (Teil 2): Posteingangsmails ohne Ablagevorschlag über der Schwelle werden gruppiert
 *   (`embeddingClusters`). Je Gruppe gibt es einen Namensvorschlag, den Elternordner und „Anlegen und verteilen“: Ordner anlegen
 *   (`createFolder`), als Lernziel eintragen und die Mails über den Move-Weg des Boards verschieben (mit Bestätigung und Undo).
 * Jeder Vorschlag wird einzeln übernommen oder verworfen. Verworfene stehen in `SetupState.data.E4.dismissed`.
 * Ohne lokale KI kommen Überschneidungen nur aus der Messung, Umbenennen und Unterteilen entfallen.
 */
import {CLUSTER_MIN, embeddingClusters, embeddingsEnabled, profileVectors, suggestClusterName, suggestFolder, suggestFolderName} from './ai'
import {getLegacyConfig, updateConfig} from './data-settings'
import {distribute} from './distribute'
import {createFolder, getBoardScope, getLearningScope, mergeFolders, renameFolder, type MergeResult} from './projects'
import {crowdedFolders, isUnclearName, mergePlan, overlaps, proposalKey, reversed, MERGED_FOLDER, type Overlap} from './refine'
import {registerStep, type OffBoardMail, type SetupFolder, type StepContext} from './setup'
import type {SetupState} from './setup-logic'
import {cleanFolderName, nameTaken, openStructure} from './structure'
import {showToast} from './toast'

type Section='crowded'|'merge'|'rename'|'inbox'
/** Umgekehrte Richtungen und vorgeschlagene Namen dieser Sitzung, damit sie ein Neuzeichnen überstehen. */
const flipped=new Set<string>()
const drafts=new Map<string,string>()
let latest:StepContext|undefined
let working=false
let focusSection:Section|undefined
/** Bis zu so viele Posteingangsmails werden auf einen Ablagevorschlag geprüft. */
const INBOX_LIMIT=200
const BOARD_BUSY='Das Board ist gerade beschäftigt.'
/** Gruppe aus dem Posteingang. `created` ist der schon angelegte Ordner, falls das Verschieben nicht zustande kam. */
type InboxGroup={mails:OffBoardMail[];name:string;parent:string;created?:{id:string;path:string}}
/** Gefundene Gruppen dieser Sitzung, damit sie ein Neuzeichnen überstehen. */
let inboxGroups:InboxGroup[]|undefined
let scanning=false
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))

function make<K extends keyof HTMLElementTagNameMap>(tag:K,text=''){const node=document.createElement(tag);node.textContent=text;return node}
function button(label:string,run:()=>void,aria?:string){
  const node=make('button',label);node.type='button';node.onclick=run
  if(aria)node.setAttribute('aria-label',aria)
  return node
}
function errorText(e:unknown){return e instanceof Error?e.message:String(e)}
const quoted=(path:string)=>'„'+path+'“'
const mails=(n:number|undefined)=>n==null?'':n===1?'1 Mail':n.toLocaleString('de-DE')+' Mails'
const decimal=(n:number)=>n.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})
function dismissedOf(state:SetupState):string[]{
  const data=state.data.E4 as {dismissed?:unknown}|undefined
  return Array.isArray(data?.dismissed)?data.dismissed.filter((k):k is string=>typeof k==='string'):[]
}
const changed=()=>window.dispatchEvent(new Event('mailboard:foldersChanged'))
// Rückgängig aus der Rückmeldung oder mit Strg+Z ändert die Ordner: die Vorschläge neu berechnen.
window.addEventListener('mailboard:foldersChanged',()=>{if(!working&&latest?.active())latest.refresh()})

registerStep('E4',async ctx=>{
  latest=ctx
  const service=ctx.host.service()
  if(!service){ctx.body.append(make('p','Bitte das Outlook-Postfach laden.'));return}
  const loading=make('p','Ordner werden gelesen …');ctx.body.append(loading)
  const all=await service.json<SetupFolder[]>('outlook_folders')
  if(!ctx.active())return
  loading.remove()
  const scope=new Set((getLearningScope()??getBoardScope()).map(p=>p.toLocaleLowerCase('de')))
  const learners=all.filter(f=>!f.isInbox&&f.path&&scope.has(f.path.toLocaleLowerCase('de')))
  if(!learners.length){ctx.body.append(make('p','Wähle zuerst in Schritt 1 mindestens einen Lernordner.'));return}
  const baseline=ctx.state.measurements.baseline
  const counts:Record<string,number|undefined>=Object.fromEntries(learners.map(f=>[f.path,f.count??baseline?.samples[f.path]]))
  const byPath=new Map(learners.map(f=>[f.path,f]))
  // Ohne Anzahl aus Outlook (älterer Outlook-Helfer) zählen nur die Lernmails der Messung: eine Untergrenze.
  const amount=(path:string,n:number|undefined)=>n==null?'':(byPath.get(path)?.count==null?'mindestens ':'')+mails(n)
  const dismissed=new Set(dismissedOf(ctx.state))
  const sections:Record<Section,HTMLElement>={crowded:make('section'),merge:make('section'),rename:make('section'),inbox:make('section')}

  function heading(section:Section,title:string){
    const h=make('h4',title);h.tabIndex=-1;h.id='setup-refine-'+section
    sections[section].className='setup-refine';sections[section].setAttribute('aria-labelledby',h.id)
    sections[section].append(h);return h
  }
  function note(parent:HTMLElement,text:string){const p=make('p',text);p.className='setup-note';parent.append(p)}
  function list(section:Section){const ul=make('ul');ul.className='setup-refine-list';sections[section].append(ul);return ul}
  function item(parent:HTMLElement,title:string,info:string){
    const li=make('li'),actions=make('div');actions.className='setup-refine-actions'
    li.append(make('strong',title));if(info)li.append(make('small',info))
    li.append(actions);parent.append(li);return actions
  }
  function dismiss(key:string,section:Section){
    ctx.save(state=>{state.data.E4={dismissed:[...new Set([...dismissedOf(state),key])]}})
    focusSection=section
    ctx.refresh('Vorschlag verworfen.')
  }
  const discard=(key:string,section:Section,title:string)=>button('Verwerfen',()=>dismiss(key,section),'Verwerfen: '+title)

  // Überfüllte Ordner: Unterteilung über den vorhandenen Ablauf, danach verteilen.
  heading('crowded','Überfüllte Ordner')
  const crowded=crowdedFolders(learners.map(f=>f.path),counts,ctx.state.outlierFolders).filter(c=>!dismissed.has(proposalKey('crowded',c.folder)))
  if(!ctx.ai)note(sections.crowded,'Unterteilen braucht die lokale KI.')
  if(!crowded.length)sections.crowded.append(make('p','Keine überfüllten Lernordner.'))
  else{
    const ul=list('crowded')
    for(const c of crowded){
      const folder=byPath.get(c.folder)!,title=quoted(c.folder)
      const info=[amount(c.folder,c.mails),c.outliers?Math.round(100*c.outliers.outliers/c.outliers.total)+' % Ausreißer':''].filter(Boolean).join(' · ')
      const actions=item(ul,title,info)
      const split=button('Unterteilung vorschlagen …',()=>openStructure(service,folder,async created=>{
        const fresh=await service.json<SetupFolder[]>('outlook_folders')
        distribute(service,folder,fresh,changed,created.map(f=>f.id))
      }),'Unterteilung vorschlagen: '+title)
      split.disabled=!ctx.ai
      actions.append(split,discard(proposalKey('crowded',c.folder),'crowded',title))
    }
  }

  // Überschneidungen: ähnliche Profile (nur mit KI) oder Verwechslungen in der Messung.
  heading('merge','Überschneidungen')
  const vectors=ctx.ai?profileVectors(learners.map(f=>f.path)):{}
  if(!ctx.ai)note(sections.merge,'Ohne lokale KI erkennt das Board Überschneidungen nur über die Messung aus Schritt 2.')
  if(!baseline)note(sections.merge,'Es gibt noch keine Messung aus Schritt 2. Verwechslungen fließen erst nach dem Messen ein.')
  else if(!baseline.report.confusion)note(sections.merge,'Die Messung aus Schritt 2 kennt noch keine Verwechslungen. Miss in Schritt 2 neu, damit sie einfließen.')
  const found=overlaps({folders:learners.map(f=>f.path),counts,vectors,report:baseline?.report}).filter(o=>!dismissed.has(o.key))
  if(!found.length)sections.merge.append(make('p','Keine Überschneidungen gefunden.'))
  else{
    const ul=list('merge')
    for(const base of found){
      const o=flipped.has(base.key)?reversed(base,counts):base
      const title=quoted(o.source)+' in '+quoted(o.target)+' zusammenlegen'+(o.mails==null?'':' ('+amount(o.source,o.mails)+')')
      const info=[o.similarity!==undefined?'Profile sehr ähnlich ('+decimal(o.similarity)+')':'',
        o.confusion!==undefined?'in der Messung zu '+Math.round(100*o.confusion)+' % verwechselt':''].filter(Boolean).join(' · ')
      const actions=item(ul,title,info)
      const go=button('Zusammenlegen …',()=>void merge(o),'Zusammenlegen: '+title);go.className='primary'
      actions.append(go,
        button('Richtung umkehren',()=>{if(flipped.has(o.key))flipped.delete(o.key);else flipped.add(o.key);focusSection='merge';ctx.refresh('Richtung umgekehrt.')},'Richtung umkehren: '+title),
        discard(o.key,'merge',title))
    }
  }

  // Unklare Namen: Vorschlag der lokalen KI, umbenannt mit Rückgängig.
  heading('rename','Unklare Namen')
  const unclear=learners.filter(f=>isUnclearName(f.name)&&!dismissed.has(proposalKey('rename',f.path)))
  if(!ctx.ai)note(sections.rename,'Ohne lokale KI entfällt das Umbenennen.')
  else if(!unclear.length)sections.rename.append(make('p','Keine unklaren Ordnernamen.'))
  else{
    const ul=list('rename')
    for(const folder of unclear){
      const title=quoted(folder.path),actions=item(ul,title,'')
      const label=make('label','Neuer Name '),input=make('input');input.maxLength=40;input.value=drafts.get(folder.id)??''
      input.setAttribute('aria-label','Neuer Name für '+title);label.append(input)
      input.oninput=()=>drafts.set(folder.id,input.value)
      const ask=button('Namen vorschlagen',()=>void propose(folder,input,ask),'Namen vorschlagen: '+title)
      const apply=button('Umbenennen …',()=>void rename(folder,input.value),'Umbenennen: '+title);apply.className='primary'
      actions.append(label,ask,apply,discard(proposalKey('rename',folder.path),'rename',title))
    }
  }

  // Neue Ordner aus dem Posteingang: Gruppen von Mails, für die kein Lernordner passt.
  heading('inbox','Neue Ordner aus dem Posteingang')
  const root=all.find(f=>f.isInbox)?.parentId??all.find(f=>f.rootId)?.rootId
  const usable=ctx.ai&&embeddingsEnabled()
  if(!usable)note(sections.inbox,'Das Gruppieren braucht die lokale KI mit Embeddings (Einstellungen).')
  else{
    note(sections.inbox,'Das Board sucht Posteingangsmails, für die kein Lernordner passt, und gruppiert ähnliche. Geprüft werden bis zu '+INBOX_LIMIT+' Mails.')
    const scan=button(inboxGroups?'Erneut prüfen':'Posteingang prüfen',()=>void scanInbox(scan));scan.disabled=scanning
    sections.inbox.append(scan)
    const present=new Map(ctx.host.inbox().map(m=>[m.id,m]))
    for(const g of inboxGroups??[])g.mails=g.mails.flatMap(m=>present.get(m.id)??[])
    const groups=(inboxGroups??[]).filter(g=>g.mails.length)
    if(inboxGroups&&!groups.length)sections.inbox.append(make('p','Keine Gruppen gefunden.'))
    if(groups.length){
      const ul=list('inbox')
      for(const [index,g] of groups.entries()){
        const title='Gruppe '+(index+1),actions=item(ul,title+' · '+mails(g.mails.length),g.mails.slice(0,3).map(m=>'„'+m.subject.slice(0,60)+'“').join(' · '))
        const name=make('input');name.maxLength=40;name.value=g.name;name.oninput=()=>{g.name=name.value}
        name.setAttribute('aria-label','Name des neuen Ordners für '+title)
        const nameLabel=make('label','Neuer Ordner ');nameLabel.append(name)
        const parent=make('select');parent.setAttribute('aria-label','Elternordner für '+title)
        const options=[...(root?[{id:root,path:'Oberste Ebene'}]:[]),...learners.map(f=>({id:f.id,path:f.path}))]
        parent.append(...options.map(o=>new Option(o.path,o.id)))
        parent.value=options.some(o=>o.id===g.parent)?g.parent:options[0].id;g.parent=parent.value
        parent.onchange=()=>{g.parent=parent.value}
        const parentLabel=make('label','Elternordner ');parentLabel.append(parent)
        const go=button('Anlegen und verteilen …',()=>void distributeGroup(g,title),'Anlegen und verteilen: '+title);go.className='primary'
        actions.append(nameLabel,parentLabel,go,button('Verwerfen',()=>{
          inboxGroups=inboxGroups!.filter(x=>x!==g);focusSection='inbox';ctx.refresh('Gruppe verworfen.')
        },'Verwerfen: '+title))
      }
    }
  }

  const finish=button('Schritt abschließen',()=>ctx.done());finish.className='primary'
  ctx.body.append(make('p','Jeder Vorschlag wird erst nach deiner Bestätigung ausgeführt und lässt sich mit Rückgängig zurücknehmen. Gelöscht wird nichts.'),
    sections.crowded,sections.merge,sections.rename,sections.inbox)
  if(dismissed.size)ctx.body.append(button('Verworfene wieder zeigen ('+dismissed.size+')',()=>{
    ctx.save(state=>{state.data.E4={dismissed:[]}});ctx.refresh('Verworfene Vorschläge werden wieder gezeigt.')
  }))
  ctx.body.append(finish)
  if(focusSection){document.getElementById('setup-refine-'+focusSection)?.focus();focusSection=undefined}

  const siblings=(folder:SetupFolder)=>all.filter(f=>f.parentId===folder.parentId&&f.id!==folder.id).map(f=>f.name)
  function checkedName(folder:SetupFolder,value:string){
    const name=cleanFolderName(value)
    if(!name)throw new Error('Bitte einen neuen Namen eingeben.')
    if(name===folder.name)throw new Error('Der Ordner heißt schon „'+name+'“.')
    if(name.startsWith('_'))throw new Error('Ordnernamen mit „_“ am Anfang sind für Ablageordner reserviert.')
    if(nameTaken(name,siblings(folder)))throw new Error('„'+name+'“ gibt es an dieser Stelle schon. Bitte einen anderen Namen wählen.')
    return name
  }
  async function propose(folder:SetupFolder,input:HTMLInputElement,trigger:HTMLButtonElement){
    trigger.disabled=true
    ctx.status('Die lokale KI schlägt einen Namen für '+quoted(folder.path)+' vor …')
    try{
      const raw=await suggestFolderName(folder)
      if(!ctx.active())return
      let name=''
      try{name=checkedName(folder,raw)}catch{ /* Vorschlag unbrauchbar, Meldung unten. */ }
      if(!name||isUnclearName(name)){ctx.status('Kein brauchbarer Vorschlag ('+quoted(cleanFolderName(raw)||raw)+'). Du kannst selbst einen Namen eingeben.');return}
      input.value=name;drafts.set(folder.id,name);input.focus()
      ctx.status('Vorschlag: '+quoted(name)+'. Mit „Umbenennen …“ übernehmen oder vorher anpassen.')
    }catch(e){ctx.status(errorText(e))}
    finally{trigger.disabled=false}
  }
  async function rename(folder:SetupFolder,value:string){
    let name:string
    try{name=checkedName(folder,value)}catch(e){ctx.status(errorText(e));return}
    if(!await ctx.host.confirm(quoted(folder.path)+' in '+quoted(name)+' umbenennen? Steckbrief, Lern- und Board-Ziele ziehen mit.','Umbenennen'))return
    working=true
    const problem=await ctx.host.exclusive(async()=>{await renameFolder(folder,name)}).finally(()=>{working=false})
    if(problem){ctx.status('Nicht umbenannt. '+problem);return}
    drafts.delete(folder.id)
    showToast(quoted(folder.name)+' in '+quoted(name)+' umbenannt',ctx.host.undo)
    focusSection='rename'
    ctx.refresh(quoted(folder.path)+' heißt jetzt '+quoted(name)+'.')
  }
  async function scanInbox(trigger:HTMLButtonElement){
    if(scanning)return
    scanning=true;trigger.disabled=true
    try{
      const paths=learners.map(f=>f.path),inbox=ctx.host.inbox().slice(0,INBOX_LIMIT),open:OffBoardMail[]=[]
      if(!inbox.length){inboxGroups=[];ctx.refresh('Im Posteingang liegen keine geladenen Mails.');return}
      for(const [i,mail] of inbox.entries()){
        ctx.status('Posteingang wird geprüft: '+(i+1)+' von '+inbox.length+' …')
        const hint=await suggestFolder(mail,paths)
        if(!ctx.active())return
        if(!hint.folder)open.push(mail)
      }
      ctx.status(open.length+' Mails ohne Ablagevorschlag werden gruppiert …')
      const found=open.length>=CLUSTER_MIN?await embeddingClusters(open):[]
      if(!ctx.active())return
      const result:InboxGroup[]=[]
      for(const [i,mails] of found.entries()){
        ctx.status('Namensvorschlag für Gruppe '+(i+1)+' von '+found.length+' …')
        let name=''
        try{name=cleanFolderName(await suggestClusterName(mails.map(m=>m.subject)))}catch{ /* Ohne Vorschlag gibst du den Namen selbst ein. */ }
        if(!ctx.active())return
        if(isUnclearName(name)||name.startsWith('_'))name=''
        result.push({mails,name,parent:root??learners[0].id})
      }
      inboxGroups=result;focusSection='inbox'
      ctx.refresh(result.length?result.length+(result.length===1?' Gruppe':' Gruppen')+' gefunden.':'Keine Gruppen gefunden.')
    }catch(e){ctx.status(errorText(e))}
    finally{scanning=false;trigger.disabled=false}
  }
  async function distributeGroup(g:InboxGroup,title:string){
    const parent=g.parent===root?{id:root,path:''}:learners.find(f=>f.id===g.parent)
    const name=cleanFolderName(g.name)
    if(!parent){ctx.status('Der Elternordner ist nicht mehr geladen. Bitte Outlook aktualisieren.');return}
    let created=g.created,saveProblem=''
    if(!created){
      if(!name){ctx.status('Bitte einen Namen für '+title+' eingeben.');return}
      if(name.startsWith('_')){ctx.status('Ordnernamen mit „_“ am Anfang sind für Ablageordner reserviert.');return}
      if(nameTaken(name,all.filter(f=>f.parentId===parent.id).map(f=>f.name))){ctx.status('„'+name+'“ gibt es an dieser Stelle schon. Bitte einen anderen Namen wählen.');return}
      const path=(parent.path?parent.path+'/':'')+name
      if(!await ctx.host.confirm('Ordner '+quoted(path)+' anlegen und '+mails(g.mails.length)+' aus dem Posteingang dorthin verschieben? Der Ordner wird Lernziel. Das Verschieben bestätigst du danach noch einmal. Gelöscht wird nichts.','Anlegen und verteilen'))return
      working=true
      const problem=await ctx.host.exclusive(async()=>{
        const receipt=await createFolder(parent.id,name)
        created={id:receipt.id,path:receipt.path}
      }).finally(()=>{working=false})
      const made=created as {id:string;path:string}|undefined
      if(!made){ctx.status('Nicht angelegt. '+problem);return}
      created=g.created=made
      try{updateConfig({suggestion_folders:[...new Set([...(getLearningScope()??getBoardScope()),made.path])]})}
      catch(e){saveProblem='Nicht als Lernziel gespeichert. '+errorText(e)}
      showToast('Ordner '+quoted(made.path)+' angelegt')
    }
    // Nach dem Anlegen lädt das Board die Ordner neu. Solange es beschäftigt ist, noch einmal versuchen.
    let moved=0,problem=BOARD_BUSY
    for(let i=0;i<50&&problem.startsWith(BOARD_BUSY);i++){
      if(i)await pause(100)
      problem=await ctx.host.moveMails(g.mails,created.id,()=>{moved++})
    }
    focusSection='inbox'
    if(moved===g.mails.length)inboxGroups=inboxGroups!.filter(x=>x!==g)
    const base=quoted(created.path)+' angelegt. '+(saveProblem?saveProblem+' ':'')
    ctx.refresh(moved?base+mails(moved)+' verschoben.'+(problem?' '+problem:''):base+'Es wurde keine Mail verschoben.'+(problem?' '+problem:' Mit „Anlegen und verteilen …“ kannst du es noch einmal versuchen.'))
  }
  async function merge(o:Overlap){
    const source=byPath.get(o.source),target=byPath.get(o.target)
    if(!source||!target){ctx.status('Die Ordner sind nicht mehr geladen. Bitte Outlook aktualisieren.');return}
    try{mergePlan(source,target,all)}catch(e){ctx.status(errorText(e));return}
    const allow=getLegacyConfig().allow_move!==true
    const exact=source.count!=null
    const what=(o.mails==null?'alle Mails':!exact?'alle Mails (mindestens '+mails(o.mails)+')':o.mails===1?'die eine Mail':'alle '+mails(o.mails))+' aus '+quoted(o.source)+' nach '+quoted(o.target)+' verschieben und den leeren Ordner nach „'+MERGED_FOLDER+'“ verschieben?'
    const question=(allow?'Das Board darf noch keine Mails in Outlook verschieben. Jetzt erlauben und '+what:what[0].toUpperCase()+what.slice(1))+
      ' Steckbrief, Lern- und Board-Ziele werden umgeschrieben. Gelöscht wird nichts, Rückgängig stellt beides wieder her.'
    if(!await ctx.host.confirm(question,allow?'Erlauben und zusammenlegen':'Zusammenlegen'))return
    if(allow){
      updateConfig({allow_move:true})
      const toggle=document.querySelector<HTMLInputElement>('#allowMove')
      if(toggle)toggle.checked=true
    }
    working=true
    let result:MergeResult|undefined
    const problem=await ctx.host.exclusive(async()=>{result=await mergeFolders(source,target,text=>ctx.status(text))}).finally(()=>{working=false})
    const done=result as MergeResult|undefined
    focusSection='merge'
    if(!done){ctx.status('Nicht zusammengelegt. '+problem);return}
    if(done.failed.length){
      if(done.moved)showToast(mails(done.moved)+' verschoben, Zusammenlegen unvollständig',ctx.host.undo)
      ctx.refresh((done.moved?mails(done.moved)+' verschoben, dann abgebrochen. Mit Rückgängig holst du sie zurück. ':'Nicht zusammengelegt. ')+done.failed.join(' · '))
      return
    }
    showToast(quoted(o.source)+' in '+quoted(o.target)+' zusammengelegt',ctx.host.undo)
    ctx.refresh(quoted(o.source)+' in '+quoted(o.target)+' zusammengelegt: '+(done.moved?mails(done.moved):'keine Mails')+' verschoben, der Ordner liegt jetzt unter '+quoted(done.archived??MERGED_FOLDER)+'.'+
      (done.left?' '+done.left+' weitere Elemente sind keine Mails und bleiben im Ordner.':''))
  }
})
