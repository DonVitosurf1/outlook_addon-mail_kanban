"""Rückgängig bleibt erfolgreich, wenn Outlook die Änderung schon zurückgenommen hat und nur das anschließende Lesen scheitert."""
import os
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright

root = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=root / 'dist'))
Thread(target=server.serve_forever, daemon=True).start()
bootstrap = r"""
localStorage.setItem('kanban-board-options-v1', JSON.stringify({project_folders:['Einkauf'],allow_move:true,poll_seconds:0}))
const folders=[{id:'01',name:'Posteingang',path:'',isInbox:true},{id:'02',name:'Einkauf',path:'Einkauf'}]
let mail={id:'aa',folderId:'01',folder:'Posteingang',status:'Offen',subject:'Einkauf Rechnung',sender:'Anna',body:'Einkauf',tags:[],attachments:[]}
window.currentMail=mail
window.__TAURI__={core:{invoke:async(name,args={})=>{
  if(name==='outlook_batch'){window.batchActive=args.active;return}
  if(name==='outlook_categories')return '[]'
  if(name==='outlook_folders')return JSON.stringify(folders)
  if(name==='outlook_board'||name==='outlook_folder'){
    if(window.failRead){window.failRead=0;throw Error('Postfach gerade nicht lesbar')}
    return JSON.stringify(name==='outlook_folder'&&mail.folderId!==args.folder?[]:[mail])
  }
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='outlook_move'||name==='outlook_undo'){
    if(!window.batchActive)throw Error('Fehlender Schreibschutz')
    mail={...mail,id:'bb',folderId:args.target,folder:folders.find(f=>f.id===args.target).name}
    window.currentMail=mail
    return JSON.stringify({id:mail.id,source:args.source,target:args.target})
  }
  throw Error('Unerwarteter Befehl: '+name)
}}}
"""
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.getenv('CHROMIUM') or shutil.which('chromium'))
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        page.add_init_script("localStorage.setItem('board.layout.intro','1')")
        page.add_init_script(bootstrap)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        expect(page.locator('.foot')).to_have_text('Klassisches Outlook')
        page.locator('.card').click()
        page.locator('#suggestFolder').click()
        page.locator('#applySuggestion').click()
        page.locator('#moveConfirm button[value="confirm"]').click()
        expect(page.locator('#undo')).to_be_enabled()
        page.evaluate('window.failRead=1')
        page.locator('#undo').click()
        expect(page.locator('.toast')).to_contain_text('Zurückgenommen')
        expect(page.locator('#message')).to_contain_text('Aktualisieren')
        expect(page.locator('#message')).to_contain_text('Postfach gerade nicht lesbar')
        expect(page.locator('#undo')).to_be_disabled()
        assert page.evaluate("currentMail.folderId==='01'")
        assert not errors, errors
        browser.close()
        print('OK – Rückgängig bleibt erfolgreich, wenn nur das Nachlesen scheitert')
finally:
    server.shutdown()
