/** A1 Modellinfo: Angaben des lokalen Modellservers zu einem Modell als eine kurze Zeile für die Einstellungen. */

/** Antwort von `ai_model_info`. Fehlende Angaben fehlen auch hier. `gpu`: Anteil im Grafikspeicher (0 bis 1). */
export type ModelInfo={parameters?:number;quantization?:string;context?:number;loaded?:boolean;gpu?:number}

const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>0?value:undefined
const decimal=(value:number)=>value.toLocaleString('de-DE',{maximumFractionDigits:1})

/** Parameterzahl lesbar: 8.030.261.248 → „8 B“, 7,6 Mrd. → „7,6 B“, 137 Mio. → „137 M“. */
export function formatParameters(count:number){
  if(count>=1e9)return decimal(count/1e9)+' B'
  if(count>=1e6)return decimal(count/1e6)+' M'
  return Math.round(count).toLocaleString('de-DE')
}

/** Ladezustand: GPU, Anteil auf der GPU, CPU oder „noch nicht geladen“. Leer, wenn der Server nichts dazu meldet. */
function state(info:Record<string,unknown>){
  if(info.loaded===false)return 'noch nicht geladen'
  if(info.loaded!==true)return ''
  const share=typeof info.gpu==='number'&&Number.isFinite(info.gpu)?Math.min(1,Math.max(0,info.gpu)):undefined
  if(share===undefined)return 'geladen'
  if(share>=0.995)return 'GPU'
  if(share<=0.005)return 'CPU'
  return 'GPU '+Math.round(share*100)+' %'
}

/** Eine Zeile wie „8 B · Q4_K_M · 8.192 Token · GPU“. Unbekannte oder ungültige Felder werden weggelassen. */
export function formatModelInfo(raw:unknown){
  const info=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{}
  const parameters=number(info.parameters), context=number(info.context)
  const quantization=typeof info.quantization==='string'?info.quantization.trim().slice(0,40):''
  const parts=[parameters?formatParameters(parameters):'',quantization,context?Math.round(context).toLocaleString('de-DE')+' Token':'',state(info)].filter(Boolean)
  return parts.length?parts.join(' · '):'Keine Angaben vom Modellserver'
}
