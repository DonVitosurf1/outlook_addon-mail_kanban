// Native Dialoge verwalten Esc, Fokus und Rückgabe an den Auslöser.
const toolsMenu = document.querySelector<HTMLDetailsElement>('#moreTools')!
const toolsTrigger = toolsMenu.querySelector('summary')!
const settingsDialog = document.querySelector<HTMLDialogElement>('#settingsDialog')!
document.querySelector('#openSettings')!.addEventListener('click', () => settingsDialog.showModal())
toolsMenu.addEventListener('click', event => {
  if (toolsMenu.open && event.target instanceof Element && event.target.closest('button')) {
    toolsMenu.open = false
    toolsTrigger.focus()
  }
}, { capture: true })
document.addEventListener('pointerdown', event => {
  if (toolsMenu.open && event.target instanceof Node && !toolsMenu.contains(event.target)) toolsMenu.open = false
})
toolsMenu.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.stopPropagation()
    toolsMenu.open = false
    toolsTrigger.focus()
  }
})

type Command = { label: string; run(): void }
const palette = document.querySelector<HTMLDialogElement>('#palette')!
const filter = document.querySelector<HTMLInputElement>('#paletteFilter')!
const list = document.querySelector<HTMLElement>('#paletteList')!
const empty = document.querySelector<HTMLElement>('#paletteEmpty')!
let commands: Command[] = []
let matches: Command[] = []
let active = -1

function collectCommands() {
  const search = document.querySelector<HTMLInputElement>('#search')!
  const result: Command[] = [{ label: 'Mails durchsuchen', run: () => search.focus() }]
  const controls = document.querySelectorAll<HTMLButtonElement>(
    '#workActions button, #viewControls button, #cockpit-start, #focusViews button, #folders button',
  )
  for (const button of controls) {
    if (button.id === 'paletteTrigger' || button.disabled || button.closest('[hidden]')) continue
    const label = button.textContent?.trim()
    if (!label) continue
    const folder = button.closest('#folders')
    result.push({ label: folder ? 'Ordner öffnen · ' + (button.title || label) : label, run: () => button.click() })
  }
  const view = document.querySelector<HTMLSelectElement>('#viewControls select[aria-label="Benannte Sicht"]')
  if (view) {
    for (const option of view.options) {
      result.push({
        label: 'Sicht · ' + option.text,
        run: () => {
          view.value = option.value
          view.dispatchEvent(new Event('change', { bubbles: true }))
        },
      })
    }
  }
  document.dispatchEvent(new CustomEvent('board-commands', { detail: result }))
  return result
}

function highlight(index: number) {
  if (active >= 0) list.children[active]?.setAttribute('aria-selected', 'false')
  active = index
  if (index < 0 || !list.children[index]) {
    filter.removeAttribute('aria-activedescendant')
    return
  }
  const option = list.children[index]
  option.setAttribute('aria-selected', 'true')
  filter.setAttribute('aria-activedescendant', option.id)
  option.scrollIntoView({ block: 'nearest' })
}

function execute(index: number) {
  const command = matches[index]
  if (command) { palette.close(); command.run() }
}

function filterCommands() {
  const query = filter.value.trim().toLocaleLowerCase('de')
  matches = commands.filter(command => command.label.toLocaleLowerCase('de').includes(query))
  active = -1
  const rows = matches.map((command, index) => {
    const option = document.createElement('div')
    option.id = 'palette-option-' + index
    option.setAttribute('role', 'option')
    option.setAttribute('aria-selected', 'false')
    option.textContent = command.label
    option.addEventListener('mousedown', event => event.preventDefault())
    option.onclick = () => execute(index)
    return option
  })
  list.replaceChildren(...rows)
  empty.hidden = matches.length > 0
  highlight(matches.length ? 0 : -1)
}

function openPalette() {
  if (document.querySelector('dialog[open]')) return
  commands = collectCommands()
  filter.value = ''
  palette.showModal()
  filter.focus()
  filterCommands()
}
document.querySelector('#paletteTrigger')!.addEventListener('click', openPalette)
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k' &&
      !document.querySelector('dialog[open]')) {
    event.preventDefault()
    openPalette()
  }
})
filter.addEventListener('input', filterCommands)
filter.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    palette.close()
    return
  }
  if (!matches.length) return
  switch (event.key) {
    case 'ArrowDown': highlight(Math.min(matches.length - 1, active + 1)); break
    case 'ArrowUp': highlight(Math.max(0, active - 1)); break
    case 'Enter': execute(active); break
    default: return
  }
  event.preventDefault()
})
