"""Einrichtung mit simuliertem Outlook: Hinweis, Ordnerwahl mit Vorbelegung und Archivanlage, Lernen und Messen, Pausieren und Fortsetzen."""
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
const folders=[
  {id:'01',name:'Posteingang',path:'',isInbox:true,parentId:'root',rootId:'root'},
  {id:'02',name:'Einkauf',path:'Einkauf',parentId:'01',rootId:'root'},
  {id:'03',name:'Labor',path:'Labor',parentId:'01',rootId:'root'},
  {id:'07',name:'Kleinkram',path:'Kleinkram',parentId:'01',rootId:'root'},
  {id:'04',name:'Gesendete Elemente',path:'/Gesendete Elemente',parentId:'root',rootId:'root'},
  {id:'05',name:'_Ablage',path:'/_Ablage',parentId:'root',rootId:'root'},
]
const sample=(folder,n,subject,sender)=>Array.from({length:n},(_,i)=>({id:folder+'-'+i,subject:subject+' '+i,sender,
  senderEmail:sender.toLowerCase()+'@'+folder+'.test',body:'',received:'2026-10-'+String(28-i).padStart(2,'0')+'T10:00:00'}))
const training={'02':sample('02',20,'Bestellung Pipetten','Einkauf'),'03':sample('03',15,'Probe Analyse','Labor'),'07':sample('07',4,'Allerlei Notiz','Kram')}
window.calls=[]
window.__TAURI__={core:{invoke:async(name,args={})=>{
  window.calls.push([name,args,!!window.batchActive])
  if(name==='outlook_batch'){window.batchActive=args.active;return}
  if(name==='outlook_categories')return '[]'
  if(name==='outlook_folders')return JSON.stringify(folders)
  // Zahlen nur auf Anfrage: Einkauf 120 Mails, Labor nicht zählbar (fehlt in der Antwort).
  if(name==='outlook_folder_counts')return JSON.stringify((args.folders??folders.map(f=>f.id)).filter(id=>id!=='03').map(id=>({id,count:id==='02'?120:7})))
  if(name==='outlook_board')return JSON.stringify([{id:'m1',folderId:'01',folder:'Posteingang',status:'Offen',subject:'Neue Anfrage',sender:'Anna',body:'',tags:[],attachments:[]}])
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='outlook_training')return JSON.stringify(training[args.folder]||[])
  if(name==='project_create'){
    if(!window.batchActive)throw Error('Ordneranlage ohne Schreibstapel')
    const created={id:'06',name:args.name,path:'/'+args.name,parentId:args.parent,rootId:'root',previousName:'',previousParentId:''}
    folders.push(created);return JSON.stringify(created)
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
            context = browser.new_context(viewport={'width': 1440, 'height': 900})
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.add_init_script("localStorage.setItem('board.layout.intro','1')")
            # Konfiguration nur beim ersten Laden setzen, damit ein Neuladen den gespeicherten Stand behält.
            page.add_init_script("if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');localStorage.removeItem('mailboard-setup-v1')}")
            page.add_init_script(LIVE.replace("localStorage.setItem('kanban-board-options-v1', JSON.stringify({poll_seconds:0}))",
                "if(!localStorage.getItem('kanban-board-options-v1'))localStorage.setItem('kanban-board-options-v1', JSON.stringify({poll_seconds:0}))"))
            page.goto(base)
            # U3: deutlicher Hinweis über dem Board nach dem Verbinden.
            hint = page.locator('.setup-hint')
            expect(hint).to_be_visible()
            expect(page.locator('.foot')).to_have_text('Klassisches Outlook')
            hint.get_by_role('button', name='Einrichtung starten').click()
            view = page.locator('#setupView')
            expect(view).to_be_visible()
            expect(page.locator('#board')).to_be_hidden()
            expect(hint).to_be_hidden()
            expect(view.get_by_role('heading', name='Schritt 1 · Ordner wählen')).to_be_visible()
            expect(view.locator('.setup-steps button')).to_have_count(7)
            expect(view.locator('.setup-steps [aria-current=step]')).to_contain_text('Ordner wählen')
            # E1: Zahlen je Ordner kommen eigens, das Ordnerlesen zählt nicht.
            rows = view.locator('table tbody tr')
            expect(rows.filter(has_text='Einkauf').locator('td').first).to_have_text('120')
            expect(rows.filter(has_text='Labor').locator('td').first).to_have_text('–')
            counted = page.evaluate("calls.filter(c=>c[0]==='outlook_folder_counts')")
            # E1 fragt alle Ordner ohne ID-Liste ab: die Befehlszeile bleibt kurz.
            assert len(counted) == 1 and 'folders' not in counted[0][1], counted
            # E1: Vorbelegung.
            for name in ['Einkauf', 'Labor', 'Kleinkram']:
                expect(view.get_by_label('Lernen: ' + name, exact=True)).to_be_checked()
            for name in ['/Gesendete Elemente', '/_Ablage']:
                expect(view.get_by_label('Lernen: ' + name, exact=True)).not_to_be_checked()
            expect(view.get_by_label('Lernen: Posteingang')).to_be_disabled()
            expect(view.get_by_label('Kein Archivordner')).to_be_checked()
            # Kein Archiv vorhanden: anlegen mit Bestätigung im Schreibstapel.
            view.get_by_role('button', name='Archivordner anlegen').click()
            page.get_by_role('button', name='Anlegen', exact=True).click()
            expect(view.get_by_label('Archiv: /Archiv', exact=True)).to_be_checked()
            expect(view.get_by_role('button', name='Archivordner anlegen')).to_be_hidden()
            created = page.evaluate("calls.filter(c=>c[0]==='project_create')")
            assert created == [['project_create', {'parent': 'root', 'name': 'Archiv'}, True]], created
            view.get_by_label('Board: Einkauf', exact=True).check()
            view.get_by_role('button', name='Speichern und weiter').click()
            options = page.evaluate("JSON.parse(localStorage.getItem('kanban-board-options-v1'))")
            assert options['project_folders'] == ['Einkauf'], options
            assert sorted(options['suggestion_folders']) == ['Einkauf', 'Kleinkram', 'Labor'], options
            assert options['archive_folder'] == '/Archiv', options
            # E2: Lernen und messen ohne lokale KI.
            expect(view.get_by_role('heading', name='Schritt 2 · Lernen und messen')).to_be_visible()
            expect(view.locator('.setup-steps button').first).to_contain_text('erledigt')
            expect(view).to_contain_text('nur mit Bayes')
            view.get_by_role('button', name='Lernen und messen', exact=True).click()
            table = view.locator('table.setup-folders')
            expect(table).to_be_visible()
            expect(view.locator('table.ai-evaluation').first).to_contain_text('Bayes einzeln')
            expect(table.locator('tr', has_text='Kleinkram')).to_contain_text('Wenige Mails')
            expect(table.locator('tr', has_text='Kleinkram')).to_have_class('setup-few')
            expect(table.locator('tr', has_text='Einkauf')).to_contain_text('100 %')
            expect(view.locator('.setup-status')).to_have_text('Lernen und Messen abgeschlossen.')
            state = page.evaluate("JSON.parse(localStorage.getItem('mailboard-setup-v1'))")
            assert state['status']['E1'] == 'done' and state['status']['E2'] == 'done', state
            assert state['measurements']['baseline']['samples'] == {'Einkauf': 20, 'Labor': 15, 'Kleinkram': 4}, state
            assert state['measurements']['baseline']['report']['byFolder']['Labor']['tested'] == 10, state
            trained = [c[1]['folder'] for c in page.evaluate("calls") if c[0] == 'outlook_training']
            assert sorted(trained) == ['02', '03', '07'], trained
            # Weiter zu E3: arbeitet ohne KI mit Bayes, also ohne KI-Hinweis.
            view.get_by_role('button', name='Weiter', exact=True).click()
            expect(view.get_by_role('heading', name='Schritt 3 · Ausreißer prüfen')).to_be_focused()
            expect(view).to_contain_text('Ohne Embeddings prüft das Board mit Bayes')
            expect(view).not_to_contain_text('braucht die lokale KI')
            # E4 braucht die KI nur für Teile, Zusammenlegen geht ohne.
            view.locator('.setup-steps button').nth(3).click()
            expect(view.locator('.setup-note').first).to_have_text('Unterteilen, Umbenennen und Gruppen aus dem Posteingang brauchen die lokale KI. Zusammenlegen nach der Messung aus Schritt 2 geht auch ohne sie.')
            view.locator('.setup-steps button').nth(4).click()
            expect(view.locator('.setup-note').first).to_have_text('Dieser Schritt braucht die lokale KI. Ohne sie kannst du ihn überspringen.')
            view.locator('.setup-steps button').nth(2).click()
            expect(view.get_by_role('heading', name='Schritt 3 · Ausreißer prüfen')).to_be_visible()
            # Pausieren: zurück zum Board, der Hinweis bleibt weg (Lernziele gesetzt), Start zeigt den Fortschritt.
            view.get_by_role('button', name='Pausieren').click()
            expect(page.locator('#board')).to_be_visible()
            expect(view).to_be_hidden()
            expect(hint).to_be_hidden()
            page.locator('#cockpit-start').click()
            start = page.locator('#cockpit-dialog')
            expect(start).to_contain_text('Einrichtung: 2 von 7 Schritten')
            start.get_by_role('button', name='Einrichtung öffnen').click()
            expect(view.get_by_role('heading', name='Schritt 3 · Ausreißer prüfen')).to_be_visible()
            # Nach dem Neuladen über Werkzeuge fortsetzen.
            page.reload()
            expect(page.locator('.foot')).to_have_text('Klassisches Outlook')
            page.locator('#moreTools summary').click()
            page.locator('#setupOpen').click()
            expect(view.get_by_role('heading', name='Schritt 3 · Ausreißer prüfen')).to_be_visible()
            expect(view.locator('table.setup-folders')).to_have_count(0)
            view.get_by_role('button', name='Überspringen').click()
            expect(view.get_by_role('heading', name='Schritt 4 · Struktur verfeinern')).to_be_visible()
            expect(view.locator('.setup-steps li').nth(2)).to_contain_text('übersprungen')
            # Rückblick auf E2 zeigt den gespeicherten Ausgangswert.
            view.locator('.setup-steps button').nth(1).click()
            expect(view.locator('table.setup-folders')).to_contain_text('Wenige Mails')
            # Tab-Leiste bleibt per Tastatur erreichbar und wechselt zurück.
            page.locator('#tab-board').focus()
            page.keyboard.press('ArrowRight')
            expect(page.locator('#tab-calendar')).to_have_attribute('aria-selected', 'true')
            expect(view).to_be_hidden()
            page.keyboard.press('ArrowLeft')
            expect(page.locator('#board')).to_be_visible()
            # Beispielpostfach: nur der Hinweis, kein gespeicherter Stand.
            saved = page.evaluate("localStorage.getItem('mailboard-setup-v1')")
            page.locator('#moreTools summary').click()
            page.locator('#backDemo').click()
            expect(page.locator('.foot')).to_have_text('Beispielpostfach')
            expect(hint).to_be_hidden()
            page.locator('#moreTools summary').click()
            page.locator('#setupOpen').click()
            expect(view).to_contain_text('Die Einrichtung arbeitet mit deinem Outlook-Postfach.')
            expect(view.locator('.setup-steps')).to_have_count(0)
            assert page.evaluate("localStorage.getItem('mailboard-setup-v1')") == saved
            assert not errors, errors
            context.close()

            # „Später“ gilt für die Sitzung, auch nach dem Neuladen.
            context = browser.new_context(viewport={'width': 1280, 'height': 800})
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.add_init_script("localStorage.setItem('board.layout.intro','1')")
            page.add_init_script(LIVE)
            page.goto(base)
            hint = page.locator('.setup-hint')
            expect(hint).to_be_visible()
            hint.get_by_role('button', name='Später').click()
            expect(hint).to_be_hidden()
            page.reload()
            expect(page.locator('.foot')).to_have_text('Klassisches Outlook')
            expect(hint).to_be_hidden()
            page.locator('#cockpit-start').click()
            expect(page.locator('#cockpit-dialog')).to_contain_text('Einrichtung: 0 von 7 Schritten')
            assert not errors, errors
            browser.close()
            print('OK – Hinweis, Ordnerwahl mit Archivanlage, Lernen und Messen, Pausieren und Fortsetzen, Beispielpostfach, Später')
    finally:
        server.shutdown()
