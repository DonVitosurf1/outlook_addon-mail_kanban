"""Vorgang-Vorschlag (K4) mit simuliertem Outlook und simuliertem ai_groups: Pille, Zuordnen mit Undo, Ablehnen bleibt nach Neuladen und neuer EntryID."""
import datetime as dt
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
  window.fresh=true
}
const folders=[{id:'01',name:'Posteingang',path:'',isInbox:true}]
const mail=(id,subject,tags)=>({id,folderId:'01',folder:'Posteingang',status:'Offen',subject,sender:'Anna',body:'Inhalt '+subject,tags,attachments:[],received:'2026-10-20T10:00:00'})
window.store=JSON.parse(sessionStorage.getItem('store')||'null')||[
  mail('m1','Umzug Labor planen',['Vorgang: Umzug']),
  mail('m2','Kartons packen',[]),
  mail('m3','Kisten bestellen',[]),
  mail('m4','Quartalsbericht',[]),
]
window.calls=[]
window.__TAURI__={core:{invoke:async(name,args={})=>{
  window.calls.push([name,args])
  if(name==='outlook_batch'){window.batchActive=args.active;return}
  if(name==='outlook_categories')return '[]'
  if(name==='outlook_folders')return JSON.stringify(folders)
  if(name==='outlook_board')return JSON.stringify(window.store)
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='ai_embed')return args.items.length
  if(name==='ai_groups'){
    const score={Kartons:0.9,Kisten:0.9,Quartalsbericht:0.5}
    return args.items.map(item=>{const key=Object.keys(score).find(k=>item.text.includes(k));return {id:item.id,best:'Umzug',score:score[key],margin:0.1}})
  }
  if(name==='outlook_tags'){
    if(!window.batchActive)throw Error('Kategorien ohne Schreibstapel')
    const mail=window.store.find(m=>m.id===args.id)
    const previous=[...mail.tags];mail.tags=[...args.wanted]
    return JSON.stringify({previous,tags:mail.tags})
  }
  throw Error('Unerwarteter Befehl: '+name)
}}}
"""

root = Path(__file__).resolve().parents[1]
with ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=root / 'dist')) as server:
    Thread(target=server.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{server.server_port}/'
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=os.getenv('CHROMIUM') or shutil.which('chromium'))
            page = browser.new_page(viewport={'width': 1440, 'height': 900})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.add_init_script(LIVE)
            page.goto(base)
            expect(page.locator('.foot')).to_have_text('Klassisches Outlook')
            calls = lambda name: page.evaluate(f"calls.filter(c=>c[0]==={json.dumps(name)})")
            tags = lambda id: page.evaluate(f"store.find(m=>m.id==={json.dumps(id)}).tags")
            pill = lambda id: page.locator(f'#mail-{id} .case-suggest')
            case_feedback = lambda: json.loads(page.evaluate("localStorage.getItem('mailboard-ai-feedback-v1')") or "{}").get(dt.date.today().isoformat(), {}).get("vorgang")

            # Nur Mails über Schwelle und Abstand bekommen eine Pille, Mails mit Vorgang und schwache nicht.
            expect(pill('m2').locator('.flag-case')).to_have_text('Vorgang Umzug?')
            expect(page.locator('.card button')).to_have_count(0)
            expect(page.locator('#mail-m2')).to_contain_text('Vorgang Umzug?')
            expect(pill('m3')).to_have_count(1)
            expect(pill('m4')).to_have_count(0)
            expect(pill('m1')).to_have_count(0)
            [request] = [c[1] for c in calls('ai_groups')][-1:]
            assert [g['name'] for g in request['groups']] == ['Umzug'] and len(request['groups'][0]['items']) == 1, request
            assert len(request['items']) == 3, request

            # Klick auf die Pille ordnet zu und öffnet die Karte nicht.
            pill('m2').locator('.flag-case').click()
            expect(page.locator('#detail')).not_to_be_visible()
            expect(page.locator('#mail-m2 .card-chip')).to_have_text('Vorgang: Umzug')
            expect(pill('m2')).to_have_count(0)
            assert tags('m2') == ['Vorgang: Umzug'], tags('m2')
            # B1: angenommen zählt als Treffer des Embedding-Modells.
            assert case_feedback() == {'qwen3-embedding:0.6b': {'ok': 1}}, case_feedback()
            page.locator('#undo').click()
            expect(pill('m2')).to_have_count(1)
            assert tags('m2') == [], tags('m2')
            # Rückgängig nimmt auch den Treffer zurück.
            assert case_feedback() is None, case_feedback()

            # Tastatur: Strg+K öffnet bei fokussierter Karte die Palette, das Kartenmenü bietet das Zuordnen an.
            page.locator('#mail-m2').focus()
            page.keyboard.press('Control+k')
            expect(page.locator('#paletteFilter')).to_be_visible()
            page.keyboard.press('Escape')
            page.locator('#mail-m2').focus()
            page.keyboard.press('Shift+F10')
            page.get_by_role('menuitem', name='Vorgang Umzug zuordnen').click()
            expect(pill('m2')).to_have_count(0)
            assert tags('m2') == ['Vorgang: Umzug'], tags('m2')
            expect(page.locator('#detail')).not_to_be_visible()
            page.locator('#undo').click()
            expect(pill('m2')).to_have_count(1)

            # Befehlspalette: „Vorgangsvorschlag übernehmen“ für die markierte Karte.
            page.locator('#mail-m3').click(modifiers=['Control'])
            page.keyboard.press('Control+k')
            page.locator('#paletteFilter').fill('Vorgangsvorschlag')
            page.keyboard.press('Enter')
            expect(pill('m3')).to_have_count(0)
            assert tags('m3') == ['Vorgang: Umzug'], tags('m3')
            page.locator('#undo').click()
            expect(pill('m3')).to_have_count(1)

            # Ablehnen per Palette (m3 markiert) und per Klick auf das „×“ (m2).
            if page.locator('#mail-m3').get_attribute('aria-pressed') != 'true':
                page.locator('#mail-m3').click(modifiers=['Control'])
            page.keyboard.press('Control+k')
            page.locator('#paletteFilter').fill('Vorgangsvorschlag ablehnen')
            page.keyboard.press('Enter')
            expect(pill('m3')).to_have_count(0)
            page.evaluate("localStorage.setItem('mailboard-case-dismissed-v1','[]')")
            page.reload()
            expect(pill('m3')).to_have_count(1)

            # Ablehnen blendet aus. Das gilt auch nach dem Neuladen und mit neuer EntryID.
            before = case_feedback()['qwen3-embedding:0.6b'].get('bad', 0)
            pill('m2').locator('.case-suggest-x').click()
            expect(pill('m2')).to_have_count(0)
            assert case_feedback()['qwen3-embedding:0.6b']['bad'] == before + 1, case_feedback()
            expect(pill('m3')).to_have_count(1)
            assert 'mailboard-case-dismissed-v1' in page.evaluate('Object.keys(localStorage)')
            page.evaluate("sessionStorage.setItem('store',JSON.stringify(store.map(m=>m.id==='m2'?{...m,id:'m2neu'}:m)))")
            page.reload()
            expect(page.locator('#mail-m2neu')).to_have_count(1)
            expect(pill('m3')).to_have_count(1)
            expect(page.locator('#mail-m2neu .case-suggest')).to_have_count(0)

            # Einstellung: Schwelle 0,95 blendet alle Vorschläge aus.
            page.locator('#moreTools summary').click()
            page.locator('#openSettings').click()
            threshold = page.locator('#settings-lernen input[step="0.01"]').first
            assert threshold.input_value() == '0.8'
            threshold.fill('0.95')
            threshold.press('Tab')
            expect(page.locator('.case-suggest')).to_have_count(0)
            assert page.evaluate("JSON.parse(localStorage.getItem('kanban-board-options-v1')).case_threshold") == 0.95
            assert not errors, errors
            browser.close()
            print('OK – Vorgang-Vorschlag: Pille, Zuordnen mit Undo, Tastatur, Palette, Ablehnen, Schwelle')
    finally:
        server.shutdown()
