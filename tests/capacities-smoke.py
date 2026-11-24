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
const mail={id:'aa',folderId:'01',folder:'Posteingang',status:'Warten',subject:'Angebot',sender:'Anna <anna@labor.de>',body:'GEHEIM im Mailtext https://example.com/angebot',tags:['Vorgang: Bestellung'],attachments:['Kosten.xlsx'],received:'2026-11-24T08:00:00'}
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
                route.fulfill(json={'structures':[
                    {'id':'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee','title':'Projekt','pluralName':'Projekte'},
                    {'id':'77777777-7777-4777-8777-777777777777','title':'Notiz','pluralName':'Notizen'},
                    {'id':'88888888-8888-4888-8888-888888888888','title':'Person','pluralName':'Personen'},
                    {'id':'99999999-9999-4999-8999-999999999999','title':'Atomare Notiz','pluralName':'Atomare Notizen'},
                    {'id':'RootTask','propertyDefinitions':[
                    {'id':'status','name':'Status','type':'label','labelSet':[{'id':'todo','name':'Offen'},{'id':'done','name':'Erledigt'}]},
                    {'id':'date','name':'Datum','type':'date'}]}]})
            elif request.url.endswith('/object/markdown'):
                route.fulfill(json={'id':'33333333-3333-4333-8333-333333333333' if 'GEHEIM' in (request.post_data or '') else '11111111-1111-4111-8111-111111111111'})
            elif request.url.endswith('/objects/search'):
                route.fulfill(json={'results':[{'id':'44444444-4444-4444-8444-444444444444','structureId':'88888888-8888-4888-8888-888888888888','title':'Anna'}],'nextCursor':None,'hasMore':False})
            elif request.url.endswith('/object/url'):
                route.fulfill(json={'id':'55555555-5555-4555-8555-555555555555'})
            elif request.url.endswith('/blocks/append'):
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
        page.get_by_role('tab', name='Board').click()
        page.locator('#mail-aa').click()
        detail = page.locator('#detail')
        detail.get_by_role('button', name='Als Notiz in Capacities').click()
        expect(page.locator('#message')).to_contain_text('Mail als Notiz in Capacities angelegt')
        note = next(call for call in calls if call['path']=='/object/markdown' and 'GEHEIM' in call['body'])
        assert '77777777-7777-4777-8777-777777777777' in note['body']
        appended = [call['body'] for call in calls if call['path']=='/blocks/append']
        assert appended and all('GEHEIM' not in body for body in appended)
        detail.get_by_role('button', name='Notiz in Capacities vorhanden').click()
        expect(page.locator('#message')).to_contain_text('schon eine Notiz')
        detail.get_by_role('button', name='Links in Capacities übernehmen').click()
        expect(page.locator('#message')).to_contain_text('Links in Capacities übernommen')
        assert any(call['path']=='/object/url' and 'https://example.com/angebot' in call['body'] for call in calls)
        page.locator('#body').click()
        page.locator('#body').select_text()
        detail.get_by_role('button', name='Satz als atomare Notiz').click()
        expect(page.locator('#message')).to_contain_text('Satz als atomare Notiz angelegt')
        page.screenshot(path='/opt/cursor/artifacts/capacities-notiz.png')
        assert not errors, errors
        browser.close()
        print('OK – Projekt, Notiz mit Text, Links und atomarer Satz')
finally:
    server.shutdown()
