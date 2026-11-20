import {getLegacyConfig,updateConfig} from './data-settings'
import type {LiveBoard} from './live'

const colors=[
  ['none','Ohne Farbe','#696969'],['red','Rot','#ef4444'],['orange','Orange','#f59e0b'],['peach','Pfirsich','#fdba74'],
  ['yellow','Gelb','#eab308'],['green','Grün','#22c55e'],['teal','Türkis','#14b8a6'],['olive','Oliv','#84cc16'],
  ['blue','Blau','#3b82f6'],['purple','Lila','#a855f7'],['maroon','Weinrot','#be185d'],['steel','Stahlblau','#64748b'],
  ['darksteel','Dunkelstahlblau','#475569'],['gray','Grau','#9ca3af'],['darkgray','Dunkelgrau','#6b7280'],['black','Schwarz','#1f2937'],
  ['darkred','Dunkelrot','#b91c1c'],['darkorange','Dunkelorange','#c2410c'],['darkpeach','Dunkelpfirsich','#c2410c'],
  ['darkyellow','Dunkelgelb','#a16207'],['darkgreen','Dunkelgrün','#15803d'],['darkteal','Dunkeltürkis','#0f766e'],
  ['darkolive','Dunkeloliv','#4d7c0f'],['darkblue','Dunkelblau','#1e40af'],['darkpurple','Dunkellila','#6b21a8'],['darkmaroon','Dunkelweinrot','#831843']
]
const statuses=['Offen','In Bearbeitung','Warten','Erledigt']
const defaults=[8,2,4,5]
type Category={name:string;color:number}
function configured(){
  const value=getLegacyConfig().status_colors
  return typeof value==='object'&&value?value as Record<string,string>:{}
}
let categoryHex = new Map<string,string>()
export function categoryColor(name:string) {return categoryHex.get(name.toLocaleLowerCase('de'))}
function publish(categories:Category[]){
  categoryHex=new Map(categories.filter(c=>c.color>0 && !!colors[c.color]).map(c=>[c.name.toLocaleLowerCase('de'),colors[c.color][2]]))
  document.dispatchEvent(new CustomEvent('mailboard:categories',{detail:{categories}}))
}
export function applyLaneColor(lane:HTMLElement,status:string){
  const color=colors.find(c=>c[0]===configured()[status])
  if(!color)return
  lane.style.setProperty('--accent','color-mix(in srgb, '+color[2]+' 62%, #111)')
  lane.style.setProperty('--tint','color-mix(in srgb, '+color[2]+' 18%, white)')
}
export function colorSettings(mount:HTMLElement,board:LiveBoard|undefined,isLive:()=>boolean,render:()=>void){
  const section=document.createElement('details'),title=document.createElement('summary')
  title.textContent='Farben und Outlook-Kategorien';section.append(title)
  const inputs=statuses.map((status,i)=>{
    const label=document.createElement('label'), select=document.createElement('select')
    select.append(...colors.map(([key,name])=>new Option(name,key)))
    select.value=configured()[status]||colors[defaults[i]][0]
    select.onchange=()=>{updateConfig({status_colors:{...configured(),[status]:select.value}});render()}
    label.append(status,select);section.append(label);return select
  })
  const sync=document.createElement('button'),info=document.createElement('output')
  sync.textContent='Vier Statusfarben in Outlook setzen'
  sync.onclick=async()=>{
    if(!board||!isLive()){info.textContent='Zuerst Outlook-Mails laden.';return}
    sync.disabled=true
    try{
      const ids=inputs.map(s=>colors.findIndex(c=>c[0]===s.value))
      publish(await board.json<Category[]>('outlook_sync_colors',{colors:ids}));render()
      info.textContent='Statusfarben in Outlook gespeichert.'
    }catch(e){info.textContent=String(e)}
    finally{sync.disabled=false}
  }
  section.append(sync,info);mount.append(section)
  let request=0,loaded=false
  return async(outlook:boolean)=>{
    if(!outlook){request++;loaded=false;publish([]);return}
    if(!board||loaded)return
    const version=++request;loaded=true
    try{
      const categories=await board.json<Category[]>('outlook_categories')
      if(version===request){publish(categories);render()}
    }catch{if(version===request)loaded=false}
  }
}
