"""Verify offline, explicit sample data and stale Outlook/AI results via normal UI entry points."""
import os
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright

bootstrap = """
window.calls=[]
const options={enabled:true,auto:true,model:'lokal'}
localStorage.setItem('outlook-kanban-ai-settings-v1',JSON.stringify(options))
localStorage.setItem('outlook-kanban-ai-rules-v1',JSON.stringify({items:[{match:'sender:privat@firma.de',folder:'Vertraulich'}]}))
const incoming={id:'a1',folderId:'01',folder:'Posteingang',status:'Warten',subject:'Vertrauliche Live-Nachricht',
    sender:'Firma',body:'Nur für Outlook',tags:[],attachments:[]}
window.__TAURI__={core:{invoke:async(cmd)=>{
    window.calls.push(cmd)
    if(cmd==='outlook_folders')return JSON.stringify([{id:'01',name:'Posteingang',path:'',isInbox:true}])
    if(cmd==='outlook_board')return JSON.stringify([incoming])
    if(cmd==='outlook_correspondence')return new Promise(resolve=>window.finishCorrespondence=()=>resolve(JSON.stringify({
        sent:[{id:'s1',subject:'Vertrauliche gesendete Mail',received:new Date().toISOString(),conversationId:'c1',isSent:true}],incoming:[]})))
    if(cmd==='ai_analyze')return new Promise(resolve=>window.finishAnalysis=()=>resolve({
        zusammenfassung:'Vertrauliche Analyse',antwort_noetig:true,arten:[],ordner:null,frist:null}))
    return '[]'
}}}
"""


def run(browser, base):
    offline = browser.new_page()
    offline.add_init_script("localStorage.setItem('board.layout.intro','1')")
    offline.goto(base)
    offline.locator('#cockpit-start').click()
    expect(offline.locator('#cockpit-dialog')).to_contain_text('kein Postfach geöffnet')
    expect(offline.locator('#cockpit-dialog')).not_to_contain_text('0 fällig')
    offline.keyboard.press('Escape')
    offline.keyboard.press('Control+g')
    expect(offline.get_by_role('dialog')).to_have_count(0)
    offline.close()

    page = browser.new_page()
    page.add_init_script("localStorage.setItem('board.layout.intro','1')")
    page.add_init_script(bootstrap)
    page.goto(base)
    expect(page.locator('.foot')).to_have_text('Klassisches Outlook')
    page.wait_for_function('() => Boolean(window.finishAnalysis && window.finishCorrespondence)')
    page.locator('#moreTools summary').click()
    page.locator('#backDemo').click()
    expect(page.locator('.foot')).to_have_text('Beispielpostfach')
    call_count = page.evaluate('window.calls.length')
    page.evaluate('window.finishAnalysis(); window.finishCorrespondence()')
    page.locator('#cockpit-start').click()
    page.get_by_role('button',name='Ablage-Auswertung').click()
    expect(page.locator('#cockpit-dialog')).not_to_contain_text('privat@firma.de')
    expect(page.locator('#cockpit-dialog')).not_to_contain_text('Testlauf starten')
    page.keyboard.press('Escape')
    page.keyboard.press('Control+g')
    history = page.get_by_role('dialog',name='Gesendet ohne Antwort')
    expect(history).to_contain_text('Freigabe für Laborausstattung')
    expect(history).not_to_contain_text('Vertraulich')
    assert page.evaluate('window.calls.length') == call_count
    assert page.evaluate("localStorage.getItem('outlook-kanban-ai-cache-v1')") is None
    page.close()


if __name__ == '__main__':
    dist = Path(__file__).resolve().parents[1] / 'dist'
    with ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=dist)) as server:
        Thread(target=server.serve_forever,daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path=os.getenv('CHROMIUM') or shutil.which('chromium'))
                run(browser,f'http://127.0.0.1:{server.server_port}')
                browser.close()
        finally:
            server.shutdown()
