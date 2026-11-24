"""Suche nach Bedeutung (K5) mit simuliertem Outlook und simuliertem ai_rank: Umschalter, Relevanz-Reihenfolge, Escape, Ähnliche Mails."""
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
if(!sessionStorage.getItem('seeded')){
  sessionStorage.setItem('seeded','1')
  localStorage.setItem('board.layout.intro','1')
  localStorage.setItem('kanban-board-options-v1', JSON.stringify({poll_seconds:0}))
  localStorage.setItem('outlook-kanban-ai-settings-v1', JSON.stringify({enabled:true,embeddings:true}))
}
const folders=[{id:'01',name:'Posteingang',path:'',isInbox:true}]
const mail=(id,subject,conv)=>({id,folderId:'01',folder:'Posteingang',status:'Offen',subject,sender:'Anna',body:'Inhalt '+subject,tags:[],attachments:[],received:'2026-10-2'+id.slice(1)+'T10:00:00',conversationId:conv})
window.store=[mail('m1','Rechnung Strom','c1'),mail('m2','Zahlungserinnerung','c2'),mail('m3','Urlaubsplanung','c3'),mail('m4','Mahnung offen','c2')]
window.calls=[]
window.__TAURI__={core:{invoke:async(name,args={})=>{
  window.calls.push([name,args])
  if(name==='outlook_categories')return '[]'
  if(name==='outlook_folders')return JSON.stringify(folders)
  if(name==='outlook_board')return JSON.stringify(window.store)
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='ai_embed')return args.items.length
  if(name==='ai_groups')return []
  if(name==='ai_rank'&&window.rankFails)throw Error('Modell nicht erreichbar')
  if(name==='ai_rank'){
    const score={Strom:0.4,Zahlungserinnerung:0.9,Mahnung:0.7,Urlaubsplanung:0.1}
    return args.items.map(i=>({id:i.id,score:score[Object.keys(score).find(k=>i.text.includes(k))]})).sort((a,b)=>b.score-a.score)
  }
  throw Error('Unerwarteter Befehl: '+name)
}}}
"""

root = Path(__file__).resolve().parents[1]
with ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=root / 'dist')) as server:
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}/'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.getenv('CHROMIUM') or shutil.which('chromium'))
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script(LIVE)
        page.goto(base)
        expect(page.locator('.foot')).to_have_text('Klassisches Outlook')
        toggle = page.locator('#semanticToggle')
        expect(toggle).to_be_visible()
        expect(toggle).to_have_attribute('aria-pressed', 'false')
        expect(page.locator('#mail-m1')).to_be_visible()
        page.wait_for_function("calls.some(c=>c[0]==='ai_embed')")
        page.wait_for_timeout(500)

        # Wortsuche findet das Wort nicht, Bedeutungssuche zeigt Treffer in Relevanz-Reihenfolge (ohne m3 unter 0.35).
        page.locator('#search').fill('Geld überweisen')
        expect(page.locator('.card')).to_have_count(0)
        toggle.click()
        expect(toggle).to_have_attribute('aria-pressed', 'true')
        # m2 und m4 gehören zur selben Unterhaltung und erscheinen als ein Stapel.
        expect(page.locator('.card')).to_have_count(2)
        ids = page.locator('.card').evaluate_all("n=>n.map(x=>x.id)")
        assert ids[0] in ('mail-m2', 'mail-m4') and ids[1] == 'mail-m1', ids
        expect(page.locator('#mail-m3')).to_have_count(0)

        # Fällt ai_rank aus, gilt die Wortsuche mit Hinweis.
        page.evaluate("rankFails=true")
        page.locator('#search').fill('Urlaub')
        expect(page.locator('.card')).to_have_count(1)
        expect(page.locator('#summary')).to_contain_text('Bedeutungssuche nicht verfügbar. Wortsuche aktiv.')
        page.evaluate("rankFails=false")
        page.locator('#search').fill('Geld überweisen')
        expect(page.locator('.card')).to_have_count(2)
        expect(page.locator('#summary')).not_to_contain_text('nicht verfügbar')

        # Escape stellt die Wortsuche wieder her.
        page.locator('#search').press('Escape')
        expect(toggle).to_have_attribute('aria-pressed', 'false')
        expect(page.locator('#search')).to_have_value('')
        expect(page.locator('.card')).to_have_count(3)
        page.locator('#search').fill('Urlaub')
        expect(page.locator('.card')).to_have_count(1)
        page.locator('#search').fill('')

        # Ähnliche Mails: ohne dieselbe Unterhaltung, Knopf öffnet die Mail.
        page.locator('#mail-m4').click()
        similar = page.locator('#similar')
        expect(similar).to_be_visible()
        names = similar.locator('button').all_inner_texts()
        assert 'Mahnung offen' not in names and 'Zahlungserinnerung' not in names and names == ['Rechnung Strom', 'Urlaubsplanung'], names
        similar.get_by_role('button', name='Rechnung Strom').click()
        expect(page.locator('#subject')).to_have_text('Rechnung Strom')
        assert not errors, errors
        browser.close()
print('ok')
