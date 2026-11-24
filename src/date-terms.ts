/** Einheitliche Erklärungen der Datumsarten für Karten, Felder und Hilfe. */
export const dateTerms={
  wiedervorlage:'Die Karte ist bis zu diesem Tag geparkt und erscheint dann wieder.',
  nachfassen:'An diesem Tag beim Gegenüber nachhaken, wenn noch keine Antwort da ist.',
  frist:'Bis zu diesem Tag muss es erledigt sein.',
  kiFrist:'Von der lokalen KI in der Mail erkannte Frist.'
}
/** Erklärung zu den Datumsarten, die in den Zeilentexten einer Karte vorkommen. */
export function dateHint(lines:readonly string[]){
  const text=lines.join(' ').toLowerCase()
  return [['Wiedervorlage',dateTerms.wiedervorlage],['Nachfassen',dateTerms.nachfassen],['KI-Frist',dateTerms.kiFrist]]
    .filter(([key])=>text.includes(key.toLowerCase())).map(([key,hint])=>key+': '+hint).join('\n')
}
