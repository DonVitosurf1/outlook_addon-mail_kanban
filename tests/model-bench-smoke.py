"""A2: Modelltest mit sechs Beispielmails, Note und Tempo, keine Postfachmails."""
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
localStorage.setItem('outlook-kanban-ai-settings-v1', JSON.stringify({enabled:true,auto:false,model:'lokal'}))
window.bench=[]
window.__TAURI__={core:{invoke:async(name,args={})=>{
  if(name==='outlook_folders')return JSON.stringify([{id:'01',name:'Posteingang',path:'',isInbox:true}])
  if(name==='outlook_board')return JSON.stringify([{id:'echt',folderId:'01',folder:'Posteingang',subject:'Echte Mail',sender:'Anna',body:'Bitte nicht an das Modell.',status:'Offen',tags:[],attachments:[]}])
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='outlook_categories')return '[]'
  if(name==='ai_models')return ['lokal']
  if(name==='ai_model_info')return {parameters:8e9,loaded:true,gpu:1}
  if(name==='ai_analyze'){
    window.bench.push(args.mail.subject)
    const reply=/Raumplanung|Rückfrage|Teammeeting/.test(args.mail.subject)
    return {zusammenfassung:'Kurz',antwort_noetig:reply,arten:[],ordner:null,frist:null,aufgaben:[]}
  }
  return '[]'
}}}
"""

if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=root / 'dist')) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path=os.getenv('CHROMIUM') or shutil.which('chromium'))
                page = browser.new_page(viewport={'width': 1280, 'height': 900})
                page.add_init_script("localStorage.setItem('board.layout.intro','1')")
                page.add_init_script(LIVE)
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                expect(page.locator('.foot')).to_have_text('Klassisches Outlook')
                page.locator('#moreTools summary').click()
                page.locator('#openSettings').click()
                dialog = page.locator('#settingsDialog')
                dialog.get_by_role('button', name='Lokale KI', exact=True).click()
                dialog.get_by_role('button', name='Modell testen').click()
                status = dialog.locator('[role=status]').filter(has_text='Modelltest:')
                expect(status).to_contain_text('Sehr gut · 6 von 6 Treffer · 6 gültig')
                subjects = page.evaluate('window.bench')
                assert subjects == [
                    'Angebot Pipettenspitzen 200 µl', 'Raumplanung Q1', 'Wartungsfenster am Samstag',
                    'Rückfrage Bestellung 2026-118', 'Teammeeting Protokoll', 'Lieferavis'], subjects
                assert 'Echte Mail' not in subjects
                shot = os.environ.get('MAILBOARD_SHOT')
                if shot:
                    page.screenshot(path=shot)
                browser.close()
        finally:
            server.shutdown()
    print('OK – Modelltest bewertet sechs Beispielmails')
