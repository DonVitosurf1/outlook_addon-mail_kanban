"""Steckbriefe (E5) und Neu lernen und vergleichen (E6) mit simuliertem Outlook und simuliertem ai_profile."""
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
  localStorage.setItem('kanban-board-options-v1', JSON.stringify({poll_seconds:0,
    project_folders:[],suggestion_folders:['Einkauf','Labor','Reisen','Wartung']}))
  localStorage.setItem('kanban-profile-edits-v1', JSON.stringify({Wartung:'## Zweck\\nGeräte warten'}))
  localStorage.setItem('outlook-kanban-ai-settings-v1', JSON.stringify({enabled:true,model:'lokal',embeddings:false}))
  localStorage.setItem('mailboard-setup-v1', JSON.stringify({version:1,step:'E2',
    status:{E1:'done',E2:'open',E3:'skipped',E4:'skipped',E5:'open',E6:'open',E7:'open'},
    measurements:{},outliers:{},confirmed:[],outlierFolders:[],data:{}}))
}
const folders=[
  {id:'01',name:'Posteingang',path:'',isInbox:true,parentId:'root',rootId:'root'},
  {id:'02',name:'Einkauf',path:'Einkauf',parentId:'01',rootId:'root'},
  {id:'03',name:'Labor',path:'Labor',parentId:'01',rootId:'root'},
  {id:'04',name:'Reisen',path:'Reisen',parentId:'01',rootId:'root'},
  {id:'05',name:'Wartung',path:'Wartung',parentId:'01',rootId:'root'},
]
const sample=(folder,n,subject,sender)=>Array.from({length:n},(_,i)=>({id:folder+'-'+i,subject:subject+' '+i,sender,
  senderEmail:sender.toLowerCase()+'@'+folder+'.test',body:'Text '+i,received:'2026-10-'+String(28-i).padStart(2,'0')+'T10:00:00'}))
window.training={'02':sample('02',20,'Bestellung Pipetten','Einkauf'),'03':sample('03',20,'Probe Analyse','Labor'),
  '04':sample('04',20,'Reisekosten Beleg','Reisen'),'05':sample('05',20,'Wartung Zentrifuge','Wartung')}
window.calls=[]
window.__TAURI__={core:{invoke:async(name,args={})=>{
  window.calls.push([name,args])
  if(name==='outlook_batch')return
  if(name==='outlook_categories')return '[]'
  if(name==='outlook_folders')return JSON.stringify(folders)
  if(name==='outlook_board')return '[]'
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='outlook_training')return JSON.stringify(window.training[args.folder]||[])
  if(name==='ai_profile'){
    if(window.gate)await window.gate()
    if(args.key==='Reisen'&&!window.reisenOk)throw Error('Modell antwortet nicht')
    return '## Zweck\\nEntwurf für '+args.key
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
            profiles = lambda: page.evaluate("JSON.parse(localStorage.getItem('kanban-profile-edits-v1'))")
            page.locator('#moreTools summary').click()
            page.locator('#setupOpen').click()
            view = page.locator('#setupView')

            # Ausgangswert aus E2.
            view.get_by_role('button', name='Lernen und messen', exact=True).click()
            expect(view.get_by_text('Ausgangswert vom')).to_be_visible()
            view.locator('.setup-steps button', has_text='Steckbriefe').click()
            expect(view.get_by_role('heading', name='Schritt 5 · Steckbriefe')).to_be_visible()

            # E5: „Wartung“ hat schon einen Steckbrief, die anderen drei bekommen nacheinander einen Entwurf.
            expect(view.locator('.setup-body > p').first).to_have_text('3 Lernordner ohne Steckbrief.')
            # Abbrechen: der laufende Entwurf wird fertig, danach kein weiterer Aufruf, nichts gespeichert.
            page.evaluate("(()=>{window.gate=()=>new Promise(r=>{window.release=()=>{window.gate=null;r()}})})()")
            view.get_by_role('button', name='Steckbriefe entwerfen').click()
            expect(view.get_by_role('button', name='Abbrechen')).to_be_visible()
            view.get_by_role('button', name='Abbrechen').click()
            page.evaluate("window.release()")
            expect(view.locator('.setup-status')).to_have_text('Angehalten. 2 Ordner noch ohne Entwurf.')
            assert [c[1]['key'] for c in calls('ai_profile')] == ['Einkauf'], calls('ai_profile')
            page.wait_for_timeout(300)
            assert len(calls('ai_profile')) == 1
            assert profiles() == {'Wartung': '## Zweck\nGeräte warten'}, profiles()
            view.get_by_role('button', name='Steckbriefe entwerfen').click()
            drafts = view.get_by_role('list', name='Steckbrief-Entwürfe')
            expect(drafts.locator('li')).to_have_count(3)
            assert [c[1]['key'] for c in calls('ai_profile')] == ['Einkauf', 'Labor', 'Reisen'], calls('ai_profile')
            expect(view.locator('.setup-status')).to_have_text('Alle Entwürfe sind fertig. Prüfe sie unten.')
            expect(drafts.locator('li').nth(2)).to_contain_text('Fehler: Modell antwortet nicht')
            expect(drafts.get_by_label('Steckbrief-Entwurf: Einkauf')).to_have_value('## Zweck\nEntwurf für Einkauf')
            assert profiles() == {'Wartung': '## Zweck\nGeräte warten'}, profiles()

            # Übernehmen speichert (mit Bearbeitung), Verwerfen speichert nichts.
            drafts.get_by_label('Steckbrief-Entwurf: Einkauf').fill('## Zweck\nBestellungen und Rechnungen')
            drafts.get_by_role('button', name='Übernehmen: Einkauf').click()
            drafts.get_by_role('button', name='Verwerfen: Labor').click()
            expect(view.locator('.setup-status')).to_have_text('Entwurf für „Labor“ verworfen.')
            saved = profiles()
            assert set(saved) == {'Wartung', 'Einkauf'}, saved
            assert 'folder: Einkauf' in saved['Einkauf'] and 'Bestellungen und Rechnungen' in saved['Einkauf'], saved
            expect(drafts.locator('li').nth(0)).to_contain_text('Übernommen')
            expect(drafts.locator('li').nth(1)).to_contain_text('Verworfen')

            # Fehlgeschlagener Entwurf lässt sich einzeln erneut entwerfen.
            page.evaluate("window.reisenOk=true")
            drafts.get_by_role('button', name='Erneut entwerfen: Reisen').click()
            expect(drafts.get_by_label('Steckbrief-Entwurf: Reisen')).to_have_value('## Zweck\nEntwurf für Reisen')
            assert [c[1]['key'] for c in calls('ai_profile')] == ['Einkauf', 'Labor', 'Reisen', 'Reisen']
            drafts.get_by_role('button', name='Verwerfen: Reisen').click()

            # E6: Labor-Mails ähneln jetzt den Einkaufsmails, Labor wird schlechter.
            page.evaluate("training['03']=training['02'].map(m=>({...m,id:'x'+m.id}))")
            view.get_by_role('button', name='Schritt abschließen', exact=True).click()
            expect(view.get_by_role('heading', name='Schritt 6 · Neu lernen und vergleichen')).to_be_visible()
            view.get_by_role('button', name='Neu lernen und vergleichen', exact=True).click()
            table = view.locator('table.setup-compare').nth(1)
            expect(table.locator('caption')).to_have_text('Trefferquote je Ordner')
            expect(table.locator('thead th')).to_have_text(['Ordner', 'Ausgangswert', 'Jetzt', 'Differenz', 'Hinweis'])
            worse = table.locator('tr.setup-worse')
            expect(worse.first).to_contain_text('schlechter')
            names = [t.split('\t')[0] for t in worse.all_inner_texts()]
            assert 'Labor' in names or 'Einkauf' in names, names
            expect(table.locator('tr', has_text='Reisen')).to_contain_text('Pp.')
            expect(view.locator('table.setup-compare').first.locator('caption')).to_have_text('Trefferquote je Quelle')
            state = page.evaluate("JSON.parse(localStorage.getItem('mailboard-setup-v1'))")
            assert state['measurements']['baseline'] and state['measurements']['after'], state
            view.get_by_role('button', name='Schritt abschließen', exact=True).click()
            assert page.evaluate("JSON.parse(localStorage.getItem('mailboard-setup-v1'))")['status']['E6'] == 'done'
            assert not errors, errors
            browser.close()
            print('OK – Steckbriefe entwerfen, übernehmen, verwerfen; Neu lernen und vergleichen mit Markierung „schlechter“')
    finally:
        server.shutdown()
