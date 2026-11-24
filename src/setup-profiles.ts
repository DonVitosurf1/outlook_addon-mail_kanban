/**
 * E5 Steckbriefe: „Steckbriefe entwerfen“ ruft für jeden Lernordner ohne Steckbrief nacheinander `draftProfile` auf (lokale KI).
 * Fortschritt „3 von 12“, „Abbrechen“ hält nach dem laufenden Entwurf an. Jeder Entwurf steht als Liste mit Textfeld,
 * „Übernehmen“ (`setProfile` mit dem Ordnerpfad als Schlüssel wie im Ordnerdialog) und „Verwerfen“. Gespeichert wird nur Übernommenes.
 * Entwürfe und Stand gelten für diese Sitzung und überstehen ein Neuzeichnen, nicht aber einen Wechsel des Postfachs. Neue Steckbriefe fließen beim Lernen in E6 in die Einbettungen.
 */
import {draftProfile} from './ai'
import {getLegacyConfig, getLegacyProfiles, setProfile} from './data-settings'
import {profileDocument} from './profile-file'
import {registerStep, type StepContext} from './setup'

type Item={id:string;key:string;text:string;state:'Entwurf'|'Übernommen'|'Verworfen'|'Fehler'}
const items=new Map<string,Item>()
const errors=new Map<string,string>()
let running=false,stop=false,progress='',epoch=0
let latest:StepContext|undefined
// Entwürfe gehören zum Postfach, aus dem sie stammen. Ein laufender Entwurf hält nach dem aktuellen Ordner an und verwirft ihn.
document.addEventListener('mailboard:source-changed',()=>{epoch++;stop=true;items.clear();errors.clear();progress=''})

function make<K extends keyof HTMLElementTagNameMap>(tag:K,text=''){const node=document.createElement(tag);node.textContent=text;return node}
function button(label:string,run:()=>void,aria?:string){
  const node=make('button',label);node.type='button';node.onclick=run
  if(aria)node.setAttribute('aria-label',aria)
  return node
}
const errorText=(e:unknown)=>e instanceof Error?e.message:String(e)
const hasProfile=(key:string)=>{const all=getLegacyProfiles();return !!(all[key]||all[key.replace(/^\//,'')])}
const area=()=>String(getLegacyConfig().projects_area||'01 Projekte').replace(/^\/+|\/+$/g,'')

registerStep('E5',ctx=>{
  latest=ctx
  const todo=ctx.host.learnerFolders().filter(f=>f.path&&!f.isInbox&&!hasProfile(f.path)&&!items.has(f.path))
  const open=[...items.values()].filter(i=>i.state!=='Übernommen'&&i.state!=='Verworfen')
  const intro=ctx.host.learnerFolders().length?todo.length+' Lernordner ohne Steckbrief.':'Wähle zuerst in Schritt 1 mindestens einen Lernordner.'
  ctx.body.append(make('p',intro))
  const start=button(running?'Entwurf läuft …':'Steckbriefe entwerfen',()=>void draftAll())
  start.className='primary';start.disabled=running||!ctx.ai||!todo.length
  const cancel=button('Abbrechen',()=>{stop=true;cancel.disabled=true;ctx.status('Wird nach dem laufenden Entwurf angehalten …')})
  cancel.hidden=!running
  ctx.body.append(start,cancel)
  if(progress)ctx.status(progress)

  async function redo(item:Item){
    if(running)return
    running=true
    const mine=epoch
    try{
      try{const text=await draftProfile(item.id,item.key);if(mine!==epoch)return;item.text=text;item.state='Entwurf';errors.delete(item.key)}
      catch(e){if(mine!==epoch)return;errors.set(item.key,errorText(e))}
    }finally{running=false}
    if(latest?.active())latest.refresh(item.state==='Entwurf'?'Entwurf für „'+item.key+'“ fertig.':'Erneut fehlgeschlagen: '+errors.get(item.key))
  }
  async function draftAll(){
    if(running)return
    running=true;stop=false;start.disabled=true;start.textContent='Entwurf läuft …';cancel.hidden=false
    const queue=[...todo],mine=epoch
    try{
      for(const [index,folder] of queue.entries()){
        if(stop)break
        progress=(index+1)+' von '+queue.length+' · '+folder.path
        if(latest?.active())latest.status('Entwurf '+progress+' …')
        try{const text=await draftProfile(folder.id,folder.path);if(mine!==epoch)break;items.set(folder.path,{id:folder.id,key:folder.path,text,state:'Entwurf'})}
        catch(e){if(mine!==epoch)break;items.set(folder.path,{id:folder.id,key:folder.path,text:'',state:'Fehler'});errors.set(folder.path,errorText(e))}
        if(!stop&&index<queue.length-1&&latest?.active())latest.refresh('Entwurf '+(index+1)+' von '+queue.length+' fertig.')
      }
    }finally{running=false;progress=''}
    if(mine!==epoch)return
    const left=queue.filter(f=>!items.has(f.path)).length
    if(latest?.active())latest.refresh(left?'Angehalten. '+left+' Ordner noch ohne Entwurf.':'Alle Entwürfe sind fertig. Prüfe sie unten.')
  }

  const list=make('ul');list.className='setup-profile-list';list.setAttribute('aria-label','Steckbrief-Entwürfe')
  for(const item of items.values()){
    const row=make('li');row.dataset.state=item.state
    const title=make('strong','„'+item.key+'“')
    const status=make('small',item.state==='Fehler'?'Fehler: '+(errors.get(item.key)||'')+' ':item.state)
    row.append(title,status)
    if(item.state==='Entwurf'||item.state==='Fehler'){
      const field=make('textarea');field.value=item.text;field.setAttribute('aria-label','Steckbrief-Entwurf: '+item.key)
      field.oninput=()=>{item.text=field.value}
      const actions=make('div');actions.className='setup-refine-actions'
      const accept=button('Übernehmen',()=>{
        if(!item.text.trim()){ctx.refresh('Der Entwurf für '+item.key+' ist leer.');return}
        setProfile(item.key,profileDocument(item.key,item.text,area()))
        item.state='Übernommen'
        ctx.refresh('Steckbrief für „'+item.key+'“ gespeichert.')
      },'Übernehmen: '+item.key)
      const drop=button('Verwerfen',()=>{item.state='Verworfen';ctx.refresh('Entwurf für „'+item.key+'“ verworfen.')},'Verwerfen: '+item.key)
      actions.append(accept,drop)
      if(item.state==='Fehler'){const again=button('Erneut entwerfen',()=>void redo(item),'Erneut entwerfen: '+item.key);again.disabled=running||!ctx.ai;actions.append(again)}
      row.append(field,actions)
    }
    list.append(row)
  }
  if(items.size)ctx.body.append(list)
  if(open.length)ctx.body.append(make('p',open.length+' Entwürfe warten auf deine Prüfung. Ohne Übernehmen wird nichts gespeichert.'))
  const finish=button('Schritt abschließen',()=>ctx.done());finish.className='primary'
  ctx.body.append(finish)
})

