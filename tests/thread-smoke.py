"""C1: Die Analyse schickt Verlauf und Anhangnamen mit, solange die Einstellung an ist."""
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
  {id:'a1',folderId:'01',folder:'Posteingang',status:'Offen',subject:'Angebot Zentrifuge',sender:'Anna',
   body:'Bitte freigeben.',received:'2026-11-20T08:00:00',tags:[],attachments:['Angebot.pdf']},
]
window.analyses=[]
window.threadCalls=0
window.__TAURI__={core:{invoke:async(name,args={})=>{
  if(name==='outlook_categories')return '[]'
  if(name==='outlook_folders')return JSON.stringify(folders)
  if(name==='outlook_board')return JSON.stringify(window.store)
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='ai_models')return ['lokal']
  if(name==='ai_model_info')return {parameters:8e9,loaded:true,gpu:1}
  if(name==='outlook_thread'){
    window.threadCalls++
    if(args.id!=='a1'||args.folder!=='01')throw Error('Falsche Mail')
    return JSON.stringify([{direction:'gesendet',text:'Hier das Angebot.'}])
  }
  if(name==='ai_analyze'){
    window.analyses.push(args.mail)
    return {zusammenfassung:'Freigabe',antwort_noetig:true,frist:null,ordner:null,arten:[],aufgaben:[]}
  }
  throw Error('Unerwarteter Befehl: '+name)
}}}
"""


def open_page(browser, base, ai):
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    page.add_init_script("localStorage.setItem('board.layout.intro','1')")
    page.add_init_script('window.AI=' + json.dumps(ai))
    page.add_init_script(LIVE)
    page.goto(base)
    page.locator('#loadInbox').click()
    expect(page.locator('#mail-a1')).to_contain_text('Angebot Zentrifuge')
    page.wait_for_function('window.analyses.length===1')
    return page


def run(browser, base):
    page = open_page(browser, base, {'enabled': True, 'auto': True, 'model': 'lokal'})
    first = page.evaluate('window.analyses[0]')
    assert first['earlier'][0]['text'] == 'Hier das Angebot.', first
    assert first['earlier'][0]['direction'] == 'gesendet', first
    assert first['attachments'] == ['Angebot.pdf'], first
    assert page.evaluate('window.threadCalls') == 1
    page.locator('#moreTools summary').click()
    page.locator('#openSettings').click()
    dialog = page.locator('#settingsDialog')
    box = dialog.get_by_role('checkbox', name='Verlauf und Anhänge mitschicken')
    expect(box).to_be_checked()
    dialog.get_by_role('button', name='Lokale KI', exact=True).click()
    expect(box).to_be_visible()
    shot = os.environ.get('MAILBOARD_SHOT')
    if shot:
        page.screenshot(path=shot)
    box.uncheck()
    dialog.get_by_role('button', name='KI-Einstellungen speichern').click()
    expect(dialog.locator('[role=status]').filter(has_text='KI-Einstellungen gespeichert.')).to_have_count(1)
    saved = json.loads(page.evaluate("localStorage.getItem('outlook-kanban-ai-settings-v1')"))
    assert saved['context'] is False, saved
    page.keyboard.press('Escape')
    page.locator('#mail-a1').click()
    page.get_by_role('button', name='Mit lokaler KI analysieren').click()
    page.wait_for_function('window.analyses.length===2')
    second = page.evaluate('window.analyses[1]')
    assert second['earlier'] == [] and second['attachments'] == [], second
    assert page.evaluate('window.threadCalls') == 1
    page.close()


def switched_off(browser, base):
    """Eine gespeicherte Einstellung ohne Verlauf ruft den Helfer nicht auf."""
    page = open_page(browser, base, {'enabled': True, 'auto': True, 'model': 'lokal', 'context': False})
    mail = page.evaluate('window.analyses[0]')
    assert mail['earlier'] == [] and mail['attachments'] == [], mail
    assert page.evaluate('window.threadCalls') == 0
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
                switched_off(browser, base)
                browser.close()
        finally:
            server.shutdown()
    print('OK – Verlauf und Anhänge gehen nur bei eingeschalteter Einstellung an die Analyse')
