"""KI-Qualität: Trefferquote, Trend und CSV aus den gespeicherten Zählern."""
import os
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright

bridge = """
window.__TAURI__={core:{invoke:async(command)=>{
  if(command==='outlook_folders')return JSON.stringify([{id:'01',name:'Posteingang',path:'',isInbox:true}])
  if(command==='outlook_board')return JSON.stringify([{id:'aa',folderId:'01',folder:'Posteingang',subject:'Nur im echten Profil',
    sender:'Anna',body:'Text',status:'Offen',tags:[],attachments:[]}])
  if(command==='outlook_categories')return '[]'
  if(command==='outlook_correspondence')return '{"sent":[],"incoming":[]}'
  throw Error('Unerwarteter Outlook-Aufruf: '+command)
}}}
"""
seed = """
localStorage.setItem('board.layout.intro','1')
const day=offset=>{const d=new Date();d.setDate(d.getDate()-offset);const p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())}
const store={[day(0)]:{'ablage:Regel':{'-':{ok:11,bad:9}}},[day(30)]:{'ablage:Regel':{'-':{ok:18,bad:2}}}}
localStorage.setItem('mailboard-ai-feedback-v1',JSON.stringify(store))
"""

with ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler,
        directory=Path(__file__).resolve().parents[1]/'dist')) as server:
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path=os.getenv('CHROMIUM') or shutil.which('chromium'))
            page=browser.new_page()
            errors=[]
            page.on('pageerror',lambda error: errors.append(str(error)))
            page.add_init_script(seed)
            page.add_init_script(bridge)
            page.goto(f'http://127.0.0.1:{server.server_port}')
            expect(page.locator('.card')).to_contain_text('Nur im echten Profil')
            page.locator('#cockpit-start').click()
            page.get_by_role('button', name='KI-Qualität').click()
            dialog=page.locator('#cockpit-dialog')
            expect(dialog).to_contain_text('Ablagevorschläge nur 55 %: Steckbriefe der Lernordner prüfen.')
            expect(dialog).to_contain_text('Ablage: Regel')
            expect(dialog).to_contain_text('55 %')
            expect(dialog).to_contain_text('schlechter')
            if os.environ.get('MAILBOARD_SHOT'): page.screenshot(path=os.environ['MAILBOARD_SHOT'])
            with page.expect_download() as download:
                dialog.get_by_role('button', name='Als CSV exportieren').click()
            text=download.value.path()
            csv=Path(text).read_text(encoding='utf-8') if text else ''
            assert 'Ablage: Regel;-;11;9;55 %;schlechter' in csv, csv
            assert not errors, errors
            browser.close()
            print('OK – KI-Qualität mit Hinweis, Trend und CSV.')
    finally:
        server.shutdown()
