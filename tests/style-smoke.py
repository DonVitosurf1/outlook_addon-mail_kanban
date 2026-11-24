"""C3: Stilsteckbrief lernen, prüfen, speichern. Beispielpostfach ruft kein Modell."""
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
localStorage.setItem('outlook-kanban-ai-settings-v1',JSON.stringify({enabled:true,auto:false,model:'entwurf',embeddings:true,embedModel:'embed'}))
const folders=[{id:'01',name:'Posteingang',path:'',isInbox:true}]
window.store=[
  {id:'a1',folderId:'01',folder:'Posteingang',status:'Offen',subject:'Liefertermin',sender:'Anna',senderEmail:'anna@example.test',
   body:'Wann kommt die Lieferung?',received:'2026-11-20T08:00:00',tags:[],attachments:[]},
]
window.calls=[]
window.__TAURI__={core:{invoke:async(name,args={})=>{
  window.calls.push([name,args])
  if(name==='outlook_categories')return '[]'
  if(name==='outlook_folders')return JSON.stringify(folders)
  if(name==='outlook_board')return JSON.stringify(window.store)
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='ai_models')return ['entwurf','embed']
  if(name==='ai_embed')return 0
  if(name==='ai_model_info')return {parameters:8e9,loaded:true,gpu:1}
  if(name==='outlook_sent_style')return JSON.stringify([
    {to:'anna@example.test',subject:'Neu',text:'Hallo Anna, kannst du den Termin bestätigen?'},
    {to:'anna@example.test',subject:'Alt',text:'Sehr geehrte Frau Weber, anbei.'},
    {to:'labor@example.test',subject:'Dritte',text:'Dritte Antwort bleibt draußen.'},
  ])
  if(name==='ai_style')return {anrede:'Hallo',form:'Du',gruss:'Viele Grüße',laenge:'kurz',wendungen:'bitte um Rückmeldung'}
  if(name==='ai_rank')return [{id:'0',score:0.9},{id:'1',score:0.2},{id:'2',score:0.1}]
  if(name==='ai_reply')return 'Hallo Anna, ich prüfe den Termin.'
  throw Error('Unerwarteter Befehl: '+name)
}}}
"""


def open_settings(page):
    if not page.locator('#openSettings').is_visible():
        page.locator('#moreTools summary').click()
    page.locator('#openSettings').click()
    dialog = page.locator('#settingsDialog')
    dialog.get_by_role('button', name='Lokale KI', exact=True).click()
    return dialog


def run(browser, base):
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    page.add_init_script("localStorage.setItem('board.layout.intro','1')")
    page.add_init_script(LIVE)
    page.goto(base)
    page.locator('#loadInbox').click()
    expect(page.locator('#mail-a1')).to_contain_text('Liefertermin')
    dialog = open_settings(page)
    dialog.get_by_role('button', name='Stil aus gesendeten Mails lernen').click()
    box = dialog.get_by_label('Stilsteckbrief')
    expect(box).to_have_value('Anrede: Hallo\nAnsprache: Du\nGrußformel: Viele Grüße\nLänge: kurz\nWendungen: bitte um Rückmeldung')
    shot = os.environ.get('MAILBOARD_SHOT')
    if shot:
        page.screenshot(path=shot)
    dialog.get_by_role('button', name='Stilsteckbrief speichern').click()
    expect(dialog.locator('[role=status]').filter(has_text='Stilsteckbrief gespeichert.')).to_have_count(1)
    saved = json.loads(page.evaluate("localStorage.getItem('mailboard-writing-style-v1')"))
    assert saved['form'] == 'Du' and 'Hallo' in saved['text'], saved
    page.keyboard.press('Escape')
    page.locator('#mail-a1').click()
    page.get_by_role('button', name='KI-Antwort entwerfen').click()
    expect(page.get_by_label('KI-Antwort vor dem Öffnen bearbeiten')).to_have_value('Hallo Anna, ich prüfe den Termin.')
    reply = [args for name, args in page.evaluate('window.calls') if name == 'ai_reply'][-1]
    assert 'Ansprache an diesen Empfänger: Du' in reply['style'], reply['style']
    assert [row['subject'] for row in reply['examples']] == ['Neu', 'Alt'], reply['examples']
    assert 'Dritte' not in json.dumps(reply['examples'])
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
                browser.close()
        finally:
            server.shutdown()
    print('OK – Stilsteckbrief wird geprüft, gespeichert und im Antwortentwurf verwendet')
