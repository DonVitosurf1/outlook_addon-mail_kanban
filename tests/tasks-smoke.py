"""K1: Aufgaben aus der KI-Analyse als Pille, Übernahme in einen Vorgang, Checkliste im Tab Vorgänge, Eintrag im Kalender."""
import datetime as dt
import os
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


LIVE = """
localStorage.setItem('kanban-board-options-v1', JSON.stringify({poll_seconds:0}))
localStorage.setItem('outlook-kanban-ai-settings-v1',JSON.stringify({enabled:true,auto:true,model:'lokal'}))
const folders=[{id:'01',name:'Posteingang',path:'',isInbox:true}]
window.store=[
  {id:'a1',folderId:'01',folder:'Posteingang',status:'Offen',subject:'AW: Angebot Zentrifuge, Freigabe',sender:'Anna',body:'Bitte gib das Angebot frei und melde dich beim Techniker.',received:'2026-11-20T08:00:00',tags:[],attachments:[]},
]
window.tagCalls=[];window.analyzed=0
window.__TAURI__={core:{invoke:async(name,args={})=>{
  if(name==='outlook_batch'){window.batchActive=args.active;return}
  if(name==='outlook_categories')return '[]'
  if(name==='outlook_folders')return JSON.stringify(folders)
  if(name==='outlook_board')return JSON.stringify(window.store)
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='ai_models')return ['lokal']
  if(name==='ai_analyze'){window.analyzed++;return {zusammenfassung:'Freigabe nötig',antwort_noetig:true,frist:null,ordner:null,arten:[],
    aufgaben:[{text:'Angebot freigeben',frist:window.DUE},{text:'Techniker anrufen',frist:null}]}}
  if(name==='outlook_tags'){
    if(!window.batchActive)throw Error('Kategorien ohne Schreibstapel')
    if(window.failCase&&args.wanted.some(t=>t.startsWith('Vorgang:')))throw Error('Kategorie in Outlook gesperrt')
    const mail=window.store.find(m=>m.id===args.id)
    // window.already: Outlook hatte die Kategorien schon (Board-Ansicht veraltet), es entsteht kein Rückgängig-Schritt.
    const previous=window.already?[...args.wanted]:[...mail.tags];mail.tags=[...args.wanted]
    window.tagCalls.push([args.id,[...args.wanted]])
    return JSON.stringify({previous,tags:mail.tags})
  }
  throw Error('Unerwarteter Befehl: '+name)
}}}
"""


def open_tasks(page, base):
    page.goto(base)
    page.locator('#loadInbox').click()
    expect(page.locator('#mail-a1 .count-tasks')).to_have_text('2 Aufgaben')
    page.locator('#mail-a1').click()
    tasks = page.get_by_role('region', name='Aufgaben')
    tasks.get_by_role('button', name='Übernehmen').click()
    page.get_by_role('dialog').filter(has_text='anlegen und diese Mail zuordnen').get_by_role('button', name='Anlegen und zuordnen').click()
    expect(page.locator('.toast')).to_contain_text('2 Punkte in „Angebot Zentrifuge Freigabe“ übernommen.')
    return tasks


def check_undo(browser, base, due):
    """(a) Rückgängig stellt Kategorie, Punkte und Pille wieder her. (b) Nach einer anderen Änderung bleibt diese stehen."""
    for stale in (False, True):
        page = browser.new_page(viewport={'width': 1280, 'height': 900})
        page.add_init_script("localStorage.setItem('board.layout.intro','1')")
        page.add_init_script(f"window.DUE='{due}'")
        page.add_init_script(LIVE)
        tasks = open_tasks(page, base)
        if stale:
            # Ein veralteter Rückgängig-Knopf, obwohl danach etwas anderes geändert wurde.
            page.evaluate("window.keep=document.querySelector('.toast button')")
            page.keyboard.press('Escape')
            page.locator('#mail-a1').focus()
            page.keyboard.press('f')
            expect(page.locator('#focusViews button', has_text='Fokus')).to_have_text('Fokus · 1')
            page.evaluate('window.keep.click()')
            expect(page.locator('.toast')).to_contain_text('Die Zuordnung zum Vorgang bleibt, weil danach etwas anderes geändert wurde.')
            assert page.evaluate('store[0].tags') == ['Vorgang: Angebot Zentrifuge Freigabe', 'Fokus'], page.evaluate('store[0].tags')
            expect(page.locator('#mail-a1 .count-tasks')).to_have_text('2 Aufgaben')
        else:
            page.locator('.toast').get_by_role('button', name='Rückgängig').click()
            expect(page.locator('#mail-a1 .count-tasks')).to_have_text('2 Aufgaben')
            assert page.evaluate('store[0].tags') == []
            assert page.evaluate("localStorage.getItem('mailboard-tasks-taken-v1')") in (None, '{}')
        page.get_by_role('tab', name='Vorgänge').click()
        expect(page.locator('#casesView')).not_to_contain_text('Angebot freigeben')
        page.close()


def check_failed_assign(browser, base, due):
    """Scheitert die Kategorie für den neuen Vorgang, bleibt nichts übernommen und die frühere Änderung unberührt."""
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    page.add_init_script("localStorage.setItem('board.layout.intro','1')")
    page.add_init_script(f"window.DUE='{due}'")
    page.add_init_script(LIVE)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base)
    page.locator('#loadInbox').click()
    card = page.locator('#mail-a1')
    expect(card.locator('.count-tasks')).to_have_text('2 Aufgaben')
    # Frühere Änderung: Fokus setzen.
    card.focus()
    page.keyboard.press('f')
    expect(page.locator('#focusViews button', has_text='Fokus')).to_have_text('Fokus · 1')
    page.evaluate('window.failCase=true')
    card.click()
    page.get_by_role('region', name='Aufgaben').get_by_role('button', name='Übernehmen').click()
    page.get_by_role('dialog').filter(has_text='anlegen und diese Mail zuordnen').get_by_role('button', name='Anlegen und zuordnen').click()
    expect(page.locator('#message')).to_contain_text('Kategorie in Outlook gesperrt')
    expect(page.locator('.toast', has_text='übernommen')).to_have_count(0)
    assert page.evaluate('store[0].tags') == ['Fokus'], page.evaluate('store[0].tags')
    assert page.evaluate("localStorage.getItem('mailboard-tasks-taken-v1')") in (None, '{}')
    expect(card.locator('.count-tasks')).to_have_text('2 Aufgaben')
    page.get_by_role('tab', name='Vorgänge').click()
    expect(page.locator('#casesView')).not_to_contain_text('Angebot Zentrifuge Freigabe')
    # Der Fokus-Schritt ist weiter der letzte und lässt sich zurücknehmen.
    page.get_by_role('tab', name='Board').click()
    page.locator('#undo').click()
    expect(page.locator('.toast')).to_contain_text('Zurückgenommen')
    assert page.evaluate('store[0].tags') == [], page.evaluate('store[0].tags')
    assert not errors, errors
    page.close()


def run(browser, base, due):
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    page.add_init_script("localStorage.setItem('board.layout.intro','1')")
    page.add_init_script(f"window.DUE='{due}'")
    page.add_init_script(LIVE)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base)
    page.locator('#loadInbox').click()
    card = page.locator('#mail-a1')
    pill = card.locator('.count-tasks')
    expect(pill).to_have_text('2 Aufgaben')

    card.click()
    tasks = page.get_by_role('region', name='Aufgaben')
    expect(tasks).to_be_visible()
    expect(tasks.get_by_role('checkbox')).to_have_count(2)
    expect(tasks.get_by_role('checkbox').first).to_be_checked()
    expect(tasks).to_contain_text('Neuer Vorgang: Angebot Zentrifuge Freigabe')
    tasks.get_by_role('textbox', name='Text der Aufgabe').nth(1).fill('Techniker zurückrufen')
    tasks.get_by_role('button', name='Übernehmen').click()
    page.get_by_role('dialog', name='Vorgang „Angebot Zentrifuge Freigabe“ anlegen und diese Mail zuordnen? Dafür wird die Kategorie „Vorgang: Angebot Zentrifuge Freigabe“ in Outlook gesetzt.').get_by_role('button', name='Anlegen und zuordnen').click()
    expect(page.locator('.toast')).to_contain_text('2 Punkte in „Angebot Zentrifuge Freigabe“ übernommen.')
    assert page.evaluate('tagCalls') == [['a1', ['Vorgang: Angebot Zentrifuge Freigabe']]], page.evaluate('tagCalls')
    assert page.evaluate("Object.keys(JSON.parse(localStorage.getItem('mailboard-tasks-taken-v1'))).length") == 1
    expect(tasks).to_be_hidden()
    page.keyboard.press('Escape')
    expect(card.locator('.count-tasks')).to_have_count(0)

    page.get_by_role('tab', name='Vorgänge').click()
    cases = page.locator('#casesView')
    cases.get_by_role('button', name='Angebot Zentrifuge Freigabe · 1 Mails').click()
    expect(cases.get_by_text('Angebot freigeben')).to_be_visible()
    expect(cases.get_by_text('Techniker zurückrufen')).to_be_visible()
    page.get_by_role('tab', name='Kalender').click()
    expect(page.locator('#calendarView')).to_contain_text('Angebot freigeben')
    assert page.evaluate('analyzed') == 1
    assert not errors, errors
    page.close()

def check_already_assigned(browser, base, due):
    """Hatte Outlook die Kategorie schon, gibt es keinen eigenen Schritt: Rückgängig nimmt nur die Punkte zurück, nie die frühere Änderung."""
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    page.add_init_script("localStorage.setItem('board.layout.intro','1')")
    page.add_init_script(f"window.DUE='{due}'")
    page.add_init_script(LIVE)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base)
    page.locator('#loadInbox').click()
    card = page.locator('#mail-a1')
    expect(card.locator('.count-tasks')).to_have_text('2 Aufgaben')
    card.focus()
    page.keyboard.press('f')
    expect(page.locator('#focusViews button', has_text='Fokus')).to_have_text('Fokus · 1')
    page.evaluate('window.already=true')
    card.click()
    page.get_by_role('region', name='Aufgaben').get_by_role('button', name='Übernehmen').click()
    page.get_by_role('dialog').filter(has_text='anlegen und diese Mail zuordnen').get_by_role('button', name='Anlegen und zuordnen').click()
    expect(page.locator('.toast')).to_contain_text('2 Punkte in „Angebot Zentrifuge Freigabe“ übernommen.')
    page.get_by_role('tab', name='Vorgänge').click()
    expect(page.locator('#casesView')).to_contain_text('Angebot Zentrifuge Freigabe · 1 Mails · 0/2')
    page.get_by_role('tab', name='Board').click()
    page.locator('.toast').get_by_role('button', name='Rückgängig').click()
    expect(card.locator('.count-tasks')).to_have_text('2 Aufgaben')
    expect(page.locator('.toast', has_text='weil danach')).to_have_count(0)
    # Der Fokus-Schritt bleibt, die schon vorhandene Kategorie auch.
    assert page.evaluate('store[0].tags') == ['Fokus', 'Vorgang: Angebot Zentrifuge Freigabe'], page.evaluate('store[0].tags')
    page.get_by_role('tab', name='Vorgänge').click()
    expect(page.locator('#casesView')).not_to_contain_text('0/2')
    assert not errors, errors
    page.close()


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    due = dt.date.today().isoformat()
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=root / 'dist')) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path=os.getenv('CHROMIUM') or shutil.which('chromium'))
                run(browser, f'http://127.0.0.1:{server.server_port}/', due)
                check_undo(browser, f'http://127.0.0.1:{server.server_port}/', due)
                check_failed_assign(browser, f'http://127.0.0.1:{server.server_port}/', due)
                check_already_assigned(browser, f'http://127.0.0.1:{server.server_port}/', due)
                browser.close()
        finally:
            server.shutdown()
