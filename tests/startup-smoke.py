"""Produktstart mit geschlossenem Outlook, bewusster Beispielauswahl und erneutem Verbinden."""
import os
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright

bridge = """
window.mode='closed'
window.calls=[]
window.__TAURI__={core:{invoke:async(command)=>{
  window.calls.push(command)
  if(command==='outlook_folders'){
    if(window.mode==='closed')throw Error('Outlook ist geschlossen.')
    if(window.mode==='slow')await new Promise(resolve=>window.releaseFolders=resolve)
    return JSON.stringify([{id:'01',name:'Posteingang',path:'',isInbox:true,omitted:1}])
  }
  if(command==='outlook_board')return JSON.stringify([{id:'aa',folderId:'01',folder:'Posteingang',subject:'Nur im echten Profil',
    sender:'Anna',body:'Text',status:'Offen',tags:[],attachments:[]}])
  if(command==='outlook_categories')return '[]'
  if(command==='outlook_correspondence')return '{"sent":[],"incoming":[]}'
  throw Error('Unerwarteter Outlook-Aufruf: '+command)
}}}
"""

with ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler,
        directory=Path(__file__).resolve().parents[1]/'dist')) as server:
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path=os.getenv('CHROMIUM') or shutil.which('chromium'))
            page=browser.new_page()
            page.add_init_script("localStorage.setItem('board.layout.intro','1')")
            errors=[]
            page.on('pageerror',lambda error: errors.append(str(error)))
            page.add_init_script(bridge)
            page.goto(f'http://127.0.0.1:{server.server_port}')
            expect(page.locator('#message')).to_contain_text('Outlook ist geschlossen')
            expect(page.locator('.card')).to_have_count(0)
            expect(page.locator('#projectTools')).to_be_hidden()
            assert page.evaluate('calls') == ['outlook_folders']
            page.evaluate("mode='slow'")
            page.locator('#loadInbox').click()
            page.wait_for_function('typeof releaseFolders==="function"')
            page.locator('#moreTools summary').click()
            page.locator('#backDemo').click()
            page.evaluate('releaseFolders()')
            expect(page.locator('.foot')).to_have_text('Beispielpostfach')
            expect(page.locator('.card')).to_have_count(14)
            assert page.evaluate("!calls.includes('outlook_board')")
            page.locator('#moreTools summary').click()
            expect(page.locator('#projectTools')).to_be_hidden()
            page.locator('#moreTools summary').click()
            page.evaluate("mode='ready'")
            page.locator('#loadInbox').click()
            expect(page.locator('.card')).to_have_count(1)
            expect(page.locator('.card')).to_contain_text('Nur im echten Profil')
            expect(page.locator('#message')).to_contain_text('1 Ordner liegt tiefer als acht Ebenen und wird nicht angezeigt.')
            if os.environ.get('MAILBOARD_SHOT'): page.screenshot(path=os.environ['MAILBOARD_SHOT'])
            expect(page.locator('.foot')).to_have_text('Klassisches Outlook')
            page.reload()
            expect(page.locator('#message')).to_contain_text('Outlook ist geschlossen')
            expect(page.locator('.card')).to_have_count(0)
            assert not errors,errors
            browser.close()
            print('OK – Start, Verbindungsfehler, explizite Beispiele, verspätete Antwort, Wiederverbinden und Neustart.')
    finally:
        server.shutdown()
