"""Vorgang nach Capacities: Seite einmal, Aufgaben danach, ohne Mailtext."""
import json
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
case = json.dumps([{'name':'Bestellung','created':'2026-11-24','note':'Angebot da','items':[{'id':'p1','text':'bestellen','done':False,'due':'2026-11-30'}]}])
bootstrap = """
localStorage.setItem('kanban-board-options-v1', JSON.stringify({poll_seconds:0}))
localStorage.setItem('mailboard-capacities-token-v1', 'cap-api-test')
localStorage.setItem('mailboard-cases-v1', %s)
const mail={id:'aa',folderId:'01',folder:'Posteingang',status:'Warten',subject:'Angebot',sender:'Anna',body:'GEHEIM im Mailtext',tags:['Vorgang: Bestellung'],attachments:[]}
window.__TAURI__={core:{invoke:async(name)=>{
  if(name==='outlook_folders')return JSON.stringify([{id:'01',name:'Posteingang',path:'',isInbox:true}])
  if(name==='outlook_board')return JSON.stringify([mail])
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='outlook_categories')return '[]'
  return '[]'
}}}
""" % json.dumps(case)
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.getenv('CHROMIUM') or shutil.which('chromium'))
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        calls = []
        def fulfill(route):
            request = route.request
            calls.append({'method':request.method,'path':request.url.replace('https://api.capacities.io',''),'body':request.post_data or ''})
            if request.url.endswith('/space/structures'):
                route.fulfill(json={'structures':[{'id':'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee','title':'Projekt','pluralName':'Projekte'},{'id':'RootTask','propertyDefinitions':[
                    {'id':'status','name':'Status','type':'label','labelSet':[{'id':'todo','name':'Offen'},{'id':'done','name':'Erledigt'}]},
                    {'id':'date','name':'Datum','type':'date'}]}]})
            elif request.url.endswith('/object/markdown'):
                route.fulfill(json={'id':'11111111-1111-4111-8111-111111111111'})
            else:
                route.fulfill(json={'id':'22222222-2222-4222-8222-222222222222'})
        page.route('https://api.capacities.io/**', fulfill)
        page.add_init_script("localStorage.setItem('board.layout.intro','1')")
        page.add_init_script(bootstrap)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        expect(page.locator('.foot')).to_have_text('Klassisches Outlook')
        page.get_by_role('tab', name='Vorgänge').click()
        cases = page.locator('#casesView')
        cases.get_by_role('button', name='Bestellung · 1 Mails').click()
        cases.get_by_role('button', name='In Capacities anlegen').click()
        expect(page.locator('#message')).to_contain_text('Projekt in Capacities angelegt')
        assert any(call['path']=='/object/markdown' and 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' in call['body'] for call in calls)
        expect(cases.get_by_role('button', name='Aufgaben in Capacities aktualisieren')).to_be_visible()
        page.screenshot(path='/opt/cursor/artifacts/capacities-angelegt.png')
        bodies = '\n'.join(call['body'] for call in calls)
        assert 'GEHEIM' not in bodies
        assert sum(call['path']=='/object/markdown' for call in calls) == 1
        cases.get_by_role('button', name='Aufgaben in Capacities aktualisieren').click()
        expect(page.locator('#message')).to_contain_text('Aufgaben in Capacities aktualisiert')
        assert sum(call['path']=='/object/markdown' for call in calls) == 1
        assert not errors, errors
        browser.close()
        print('OK – Vorgang als Projekt, danach nur die Aufgaben, ohne Mailtext')
finally:
    server.shutdown()
