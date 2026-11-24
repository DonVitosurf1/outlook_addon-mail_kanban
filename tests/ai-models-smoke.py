"""A4 Zwei Modelle: Hintergrundanalyse mit dem Modell für Hintergrund, Antwortentwurf mit dem Modell für Entwürfe,
Verbindungstest prüft beide. Ältere Einstellungen ohne Entwurfsmodell nutzen weiter ein Modell."""
import json
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
localStorage.setItem('outlook-kanban-ai-settings-v1',JSON.stringify(window.AI))
const folders=[{id:'01',name:'Posteingang',path:'',isInbox:true}]
window.store=[
  {id:'a1',folderId:'01',folder:'Posteingang',status:'Offen',subject:'Rückfrage Lieferung',sender:'Anna',body:'Wann kommt die Bestellung?',received:'2026-11-20T08:00:00',tags:[],attachments:[]},
]
window.calls=[]
window.__TAURI__={core:{invoke:async(name,args={})=>{
  window.calls.push([name,args.model||''])
  if(name==='outlook_categories')return '[]'
  if(name==='outlook_folders')return JSON.stringify(folders)
  if(name==='outlook_board')return JSON.stringify(window.store)
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='ai_models')return ['hinter','entwurf']
  if(name==='ai_model_info')return {parameters:8e9,loaded:true,gpu:1}
  if(name==='ai_analyze')return {zusammenfassung:'Frage zur Lieferung',antwort_noetig:true,frist:null,ordner:null,arten:[],aufgaben:[]}
  if(name==='ai_reply')return 'Guten Tag, die Lieferung kommt am [Datum].'
  throw Error('Unerwarteter Befehl: '+name)
}}}
"""


def models(page, command):
    return [model for name, model in page.evaluate('window.calls') if name == command]


def open_page(browser, base, ai):
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    page.add_init_script("localStorage.setItem('board.layout.intro','1')")
    page.add_init_script('window.AI=' + json.dumps(ai))
    page.add_init_script(LIVE)
    page.goto(base)
    page.locator('#loadInbox').click()
    expect(page.locator('#mail-a1')).to_contain_text('Frage zur Lieferung')
    return page


def draft_reply(page):
    page.locator('#mail-a1').click()
    page.get_by_role('button', name='KI-Antwort entwerfen').click()
    expect(page.get_by_label('KI-Antwort vor dem Öffnen bearbeiten')).to_have_value('Guten Tag, die Lieferung kommt am [Datum].')


def run(browser, base):
    page = open_page(browser, base, {'enabled': True, 'auto': True, 'model': 'hinter', 'draftModel': 'entwurf'})
    assert models(page, 'ai_analyze') == ['hinter'], page.evaluate('window.calls')
    draft_reply(page)
    assert models(page, 'ai_reply') == ['entwurf'], page.evaluate('window.calls')
    page.keyboard.press('Escape')
    page.locator('#moreTools summary').click()
    page.locator('#openSettings').click()
    dialog = page.locator('#settingsDialog')
    expect(dialog.get_by_label('Modell für Hintergrund', exact=True)).to_have_value('hinter')
    writer = dialog.get_by_label('Modell für Entwürfe', exact=True)
    expect(writer).to_have_value('entwurf')
    assert writer.get_attribute('placeholder') == 'wie Hintergrund'
    dialog.get_by_role('button', name='Verbindung testen').click()
    out = dialog.locator('[role=status]').filter(has_text='Antwortzeit')
    expect(out).to_contain_text('Hintergrundmodell: hinter · Entwurfsmodell: entwurf (lokal geprüft)')
    # Der Lokalitätsnachweis für das Entwurfsmodell sendet keine Mail, nur den Modellnamen.
    assert 'entwurf' in models(page, 'ai_model_info')
    # Ein leeres Feld bedeutet wieder „wie Hintergrund“ und wird so gespeichert.
    writer.fill('')
    dialog.get_by_role('button', name='KI-Einstellungen speichern').click()
    expect(dialog.locator('[role=status]').filter(has_text='KI-Einstellungen gespeichert.')).to_have_count(1)
    saved = json.loads(page.evaluate("localStorage.getItem('outlook-kanban-ai-settings-v1')"))
    assert saved['draftModel'] == '' and saved['model'] == 'hinter', saved
    page.close()


def legacy(browser, base):
    """Einstellungen aus der Zeit vor A4 haben kein Entwurfsmodell: Entwürfe nutzen weiter das eine Modell."""
    page = open_page(browser, base, {'enabled': True, 'auto': True, 'model': 'hinter'})
    draft_reply(page)
    assert models(page, 'ai_reply') == ['hinter'], page.evaluate('window.calls')
    page.close()


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=root / 'dist')) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path=os.getenv('CHROMIUM') or shutil.which('chromium'))
                base = f'http://127.0.0.1:{server.server_port}/'
                run(browser, base)
                legacy(browser, base)
                browser.close()
        finally:
            server.shutdown()
    print('OK – Zwei Modelle: Hintergrund und Entwürfe getrennt, Verbindungstest prüft beide')
