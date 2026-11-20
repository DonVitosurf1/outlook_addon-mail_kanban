const areaHeadings=['Zweck','Passt hierher','Passt nicht hierher','Typische Absender','Stichworte']
const projectHeadings=['Zweck','Partner und Ansprechpartner','Nummern','Termine','Passt hierher','Passt nicht hierher','Stichworte']

export function profileName(folder:string) {
  return folder.toLowerCase().replace(/&/g,'und').replace(/ä/g,'ae').replace(/ö/g,'oe')
    .replace(/ü/g,'ue').replace(/ß/g,'ss').replace(/[^a-z0-9_]+/g,'-').replace(/^-|-$/g,'')+'.md'
}
export function profileDocument(folder:string,content:string,area:string,day=new Date().toLocaleDateString('sv-SE')) {
  const parts=folder.split('/').filter(Boolean)
  const root=area.split('/').filter(Boolean)
  const relative=parts.slice(root.length)
  const underArea=root.length>0 && root.every((part,i)=>part===parts[i])
  const project=underArea && (relative.length===1 || (relative.length===2&&relative[0]==='_Abgeschlossen'))
  const kind=project?'projekt':'bereich'
  let body=content.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').replace(/^---\n[\s\S]*?\n---(?:\n|$)/,'').trim()
  if(!body)body=(project?projectHeadings:areaHeadings).map(h=>'## '+h).join('\n\n')
  if(!/^##? /m.test(body))body='## Zweck\n'+body
  if(!/^# /m.test(body))body='# '+(parts.at(-1)||folder)+'\n\n'+body
  return ['---','folder: '+folder,'kind: '+kind,'updated: '+day,'---','',body,''].join('\n')
}
