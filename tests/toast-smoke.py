"""Rückmeldung mit Rückgängig (U7) im Beispielpostfach prüfen."""
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


def check(page, base):
    page.goto(base)
    page.locator('#moreTools summary').click()
    page.locator('#backDemo').click()
    undo = page.locator('#undo')
    expect(page.locator('.card').first).to_be_visible()
    assert 'Letzte Änderung zurücknehmen' in undo.get_attribute('title')
    card = page.locator('#mail-DEMO0008')
    status_before = card.evaluate("c => c.closest('.lane')?.querySelector('h2')?.textContent || ''")
    card.focus()
    page.keyboard.press('4')
    toast = page.get_by_role('status').filter(has_text='Status auf Erledigt gesetzt')
    expect(toast).to_be_visible()
    expect(toast.get_by_role('button', name='Rückgängig')).to_be_visible()
    # Der Fokus bleibt auf der Karte, der Tooltip nennt die Aktion.
    assert page.evaluate("document.activeElement.id") != ''
    assert page.evaluate("!document.activeElement.closest('.toast')")
    assert undo.get_attribute('title') == 'Rückgängig: Status auf Erledigt gesetzt (Strg+Z)'
    toast.get_by_role('button', name='Rückgängig').click()
    expect(page.get_by_role('status').filter(has_text='Zurückgenommen: Status auf Erledigt gesetzt')).to_be_visible()
    expect(page.locator('.toast button', has_text='Rückgängig')).to_have_count(0)
    assert card.evaluate("c => c.closest('.lane')?.querySelector('h2')?.textContent || ''") == status_before
    # Escape schließt die Meldung.
    page.locator('#mail-DEMO0008').focus()
    page.keyboard.press('4')
    expect(page.locator('.toast', has_text='Status auf Erledigt gesetzt')).to_be_visible()
    page.keyboard.press('Escape')
    expect(page.locator('.toast')).to_have_count(0)
    # Schließen-Knopf.
    page.locator('#undo').click()
    expect(page.locator('.toast')).to_be_visible()
    page.get_by_role('button', name='Meldung schließen').click()
    expect(page.locator('.toast')).to_have_count(0)
    # Eine ältere Rückmeldung nimmt nur ihren eigenen Schritt zurück, nie eine spätere Änderung.
    done = page.locator('.lane').nth(3)
    page.locator('#mail-DEMO0008').focus()
    page.keyboard.press('4')
    expect(page.locator('.toast', has_text='Status auf Erledigt gesetzt')).to_be_visible()
    page.evaluate("window.stale=document.querySelector('.toast button')")
    page.locator('#mail-DEMO0001').focus()
    page.keyboard.press('4')
    expect(done.locator('#mail-DEMO0001')).to_have_count(1)
    page.evaluate('window.stale.click()')
    expect(page.locator('.toast')).to_have_text('Rückgängig nicht mehr möglich, weil danach etwas anderes geändert wurde.×')
    expect(done.locator('#mail-DEMO0001')).to_have_count(1)
    expect(done.locator('#mail-DEMO0008')).to_have_count(1)
    # Nach Strg+Z passt die Rückmeldung des zurückgenommenen Schritts nicht mehr und nimmt nicht den davor zurück.
    page.locator('#mail-DEMO0003').focus()
    page.keyboard.press('4')
    expect(done.locator('#mail-DEMO0003')).to_have_count(1)
    page.evaluate("window.stale=document.querySelector('.toast button')")
    page.keyboard.press('Control+z')
    expect(page.locator('.toast', has_text='Zurückgenommen')).to_be_visible()
    expect(done.locator('#mail-DEMO0003')).to_have_count(0)
    page.evaluate('window.stale.click()')
    expect(page.locator('.toast')).to_contain_text('Rückgängig nicht mehr möglich')
    expect(done.locator('#mail-DEMO0001')).to_have_count(1)
    expect(done.locator('#mail-DEMO0008')).to_have_count(1)
    # Solange der Knopf den Fokus hat, verschwindet die Meldung nicht. Danach geht der Fokus zur Karte zurück.
    page.clock.install()
    page.locator('#mail-DEMO0002').focus()
    page.keyboard.press('2')
    toast = page.locator('.toast', has_text='Status auf In Bearbeitung gesetzt')
    expect(toast).to_be_visible()
    toast.get_by_role('button', name='Rückgängig').focus()
    page.clock.run_for(9000)
    expect(toast).to_be_visible()
    page.keyboard.press('Escape')
    expect(page.locator('.toast')).to_have_count(0)
    expect(page.locator('#mail-DEMO0002')).to_be_focused()


LIVE = """
localStorage.setItem('board.layout.intro','1')
localStorage.setItem('kanban-board-options-v1', JSON.stringify({poll_seconds:0}))
const folders=[{id:'01',name:'Posteingang',path:'',isInbox:true}]
window.store=[{id:'a1',folderId:'01',folder:'Posteingang',status:'Offen',subject:'Angebot',sender:'Anna',body:'Text',received:'2026-11-20T08:00:00',tags:[],attachments:[]}]
window.__TAURI__={core:{invoke:async(name,args={})=>{
  if(name==='outlook_batch')return
  if(name==='outlook_categories')return '[]'
  if(name==='outlook_folders')return JSON.stringify(folders)
  if(name==='outlook_board')return JSON.stringify(window.store)
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='outlook_tags'){const mail=window.store.find(m=>m.id===args.id);const previous=[...mail.tags];mail.tags=[...args.wanted];return JSON.stringify({previous,tags:mail.tags})}
  throw Error('Unerwarteter Befehl: '+name)
}}}
"""


def check_source_switch(page, base):
    """Die Rückmeldung einer Outlook-Änderung verschwindet beim Wechsel ins Beispielpostfach."""
    page.add_init_script(LIVE)
    page.goto(base)
    page.locator('#loadInbox').click()
    page.locator('#mail-a1').focus()
    page.keyboard.press('f')
    expect(page.locator('.toast').get_by_role('button', name='Rückgängig')).to_be_visible()
    page.locator('#moreTools summary').click()
    page.locator('#backDemo').click()
    expect(page.locator('#mail-DEMO0008')).to_be_visible()
    expect(page.locator('.toast')).to_have_count(0)


if __name__ == "__main__":
    dist = Path(__file__).resolve().parents[1] / "dist"
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=dist)) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path=os.getenv("CHROMIUM") or shutil.which("chromium"))
                page = browser.new_page(viewport={"width": 1280, "height": 720})
                page.add_init_script("localStorage.setItem('board.layout.intro','1')")
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                check(page, f"http://127.0.0.1:{server.server_port}")
                assert not errors, errors
                live = browser.new_page(viewport={"width": 1280, "height": 720})
                live.on("pageerror", lambda error: errors.append(str(error)))
                check_source_switch(live, f"http://127.0.0.1:{server.server_port}")
                assert not errors, errors
                print("OK – Rückmeldung mit Rückgängig")
                browser.close()
        finally:
            server.shutdown()
