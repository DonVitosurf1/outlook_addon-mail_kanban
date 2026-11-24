/** Element mit Text. Eine Klasse wird nur gesetzt, wenn eine übergeben wird. */
export function element<K extends keyof HTMLElementTagNameMap>(tag:K, text='', className=''): HTMLElementTagNameMap[K] {
  const node=document.createElement(tag)
  node.textContent=text
  if(className) node.className=className
  return node
}

/** Knopf mit `type="button"`, damit er außerhalb eines Formulars nicht absendet. */
export function button(label:string, run:()=>void, aria=''): HTMLButtonElement {
  const node=element('button', label)
  node.type='button'
  node.onclick=run
  if(aria) node.setAttribute('aria-label', aria)
  return node
}
