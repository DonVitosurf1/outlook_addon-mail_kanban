"""Ausreißer prüfen (E3) mit simuliertem Outlook und simuliertem ai_outliers: verschieben mit Bestätigung und Undo, bleibt hier, nicht lernen."""
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
  localStorage.setItem('kanban-board-options-v1', JSON.stringify({poll_seconds:0,allow_move:true,suggestion_folders:['Einkauf','Labor']}))
  localStorage.setItem('outlook-kanban-ai-settings-v1', JSON.stringify({enabled:true,embeddings:true}))
  localStorage.setItem('outlook-kanban-ai-training-v1', JSON.stringify({rows:[
    {folder:'Einkauf',id:'mai',features:['w:probenbericht']},{folder:'Einkauf',id:'e0',features:['w:bestellung']}],stamp:1}))
  localStorage.setItem('mailboard-setup-v1', JSON.stringify({version:1,step:'E3',
    status:{E1:'done',E2:'done',E3:'open',E4:'open',E5:'open',E6:'open',E7:'open'},measurements:{},outliers:{},data:{}}))
}
const folders=[
  {id:'01',name:'Posteingang',path:'',isInbox:true,parentId:'root',rootId:'root'},
  {id:'02',name:'Einkauf',path:'Einkauf',parentId:'01',rootId:'root'},
  {id:'03',name:'Labor',path:'Labor',parentId:'01',rootId:'root'},
]
const mail=(id,subject,sender,day)=>({id,subject,sender,senderEmail:sender.toLowerCase()+'@firma.test',body:'Inhalt '+subject,
  received:'2026-10-'+String(day).padStart(2,'0')+'T10:00:00'})
const training={
  '02':[...Array.from({length:6},(_,i)=>mail('e'+i,'Bestellung Pipetten '+i,'Einkauf',20-i)),
    mail('mai','Probenbericht Mai','Labor',12),mail('juni','Probenbericht Juni','Labor',13)],
  '03':[...Array.from({length:4},(_,i)=>mail('l'+i,'Probe Analyse '+i,'Labor',20-i)),
    mail('kittel','Bestellung Kittel','Einkauf',11),mail('urlaub','Urlaubsplan','Personal',10)],
}
const flagged={Einkauf:{'Probenbericht Mai':0.5,'Probenbericht Juni':0.3},Labor:{'Bestellung Kittel':0.2,'Urlaubsplan':0.45}}
window.calls=[]
window.__TAURI__={core:{invoke:async(name,args={})=>{
  window.calls.push([name,args,!!window.batchActive])
  if(name==='outlook_batch'){window.batchActive=args.active;return}
  if(name==='outlook_categories')return '[]'
  if(name==='outlook_folders')return JSON.stringify(folders)
  if(name==='outlook_board')return JSON.stringify([{id:'m1',folderId:'01',folder:'Posteingang',status:'Offen',subject:'Neue Anfrage',sender:'Anna',body:'',tags:[],attachments:[]}])
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='outlook_training')return JSON.stringify(training[args.folder]||[])
  if(name==='ai_embed')return args.items.length
  if(name==='ai_outliers')return args.folders.flatMap(f=>f.items.flatMap(item=>{
    const hit=Object.entries(flagged[f.key]||{}).find(([subject])=>item.text.includes(subject))
    return hit?[{id:item.id,folder:f.key,suggested:f.key==='Einkauf'?'Labor':'Einkauf',own:hit[1],other:0.9}]:[]
  }))
  if(name==='outlook_move'){
    if(!window.batchActive)throw Error('Verschieben ohne Schreibstapel')
    return JSON.stringify({id:'neu-'+args.id,source:args.source,target:args.target})
  }
  if(name==='outlook_undo')return JSON.stringify({id:args.id.replace(/^neu-/,''),source:args.source,target:args.target})
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
            state = lambda: page.evaluate("JSON.parse(localStorage.getItem('mailboard-setup-v1'))")
            page.locator('#moreTools summary').click()
            page.locator('#setupOpen').click()
            view = page.locator('#setupView')
            expect(view.get_by_role('heading', name='Schritt 3 · Ausreißer prüfen')).to_be_visible()
            expect(view).to_contain_text('Verglichen wird mit den Embeddings')
            view.get_by_role('button', name='Ausreißer suchen').click()
            expect(view.locator('.setup-status')).to_have_text('Prüfung abgeschlossen (Embeddings).')

            # Lernmails aus outlook_training, Vergleich über ai_outliers mit Ablageschwelle und Mindestabstand.
            assert sorted(c[1]['folder'] for c in calls('outlook_training')) == ['02', '03']
            [request] = [c[1] for c in calls('ai_outliers')]
            assert request['threshold'] == 0.78 and request['margin'] == 0.05, request
            assert [(f['key'], len(f['items'])) for f in request['folders']] == [('Einkauf', 8), ('Labor', 6)], request
            assert 'Probenbericht Mai' in request['folders'][0]['items'][6]['text']

            # Kennzahl: Labor hat 2 von 6 (33 %) Ausreißer und ist Kandidat für E4, Einkauf mit 25 % nicht.
            saved = state()
            assert saved['outlierFolders'] == [{'folder': 'Labor', 'outliers': 2, 'total': 6}], saved
            assert saved['status']['E3'] == 'done', saved
            folders = view.locator('details.setup-outlier-folder')
            expect(folders).to_have_count(2)
            labor, einkauf = folders.nth(0), folders.nth(1)
            expect(labor.locator('summary')).to_have_text('Labor · 2 von 6 Lernmails verdächtig (33 %) · viele Ausreißer, Kandidat für Schritt 4')
            expect(einkauf.locator('summary')).to_have_text('Einkauf · 2 von 8 Lernmails verdächtig (25 %)')
            expect(view.locator('.setup-outliers .setup-note')).to_have_text('Viele Ausreißer, Kandidaten für Schritt 4: Labor (33 %)')
            # Sortiert nach Deutlichkeit: Kittel (0,9 statt 0,2) vor Urlaubsplan (0,9 statt 0,45).
            expect(labor.locator('li strong')).to_have_text(['„Bestellung Kittel“', '„Urlaubsplan“'])
            expect(labor.locator('li small').first).to_have_text('Einkauf · 11.10.2026 · passt zu „Einkauf“: 0,90 statt 0,20')
            expect(einkauf.locator('li').first).to_be_hidden()

            # Verschieben: Abbrechen ändert nichts.
            einkauf.locator('summary').click()
            expect(einkauf.locator('li strong')).to_have_text(['„Probenbericht Juni“', '„Probenbericht Mai“'])
            einkauf.get_by_role('button', name='Verschieben nach „Labor“: „Probenbericht Mai“').click()
            dialog = page.locator('#moveConfirm')
            expect(dialog).to_contain_text('„Probenbericht Mai“ nach „Labor“ verschieben?')
            dialog.get_by_role('button', name='Abbrechen').click()
            assert calls('outlook_move') == []
            expect(einkauf.locator('li')).to_have_count(2)

            # Stapel je Ordner: Bestätigung, Schreibstapel, Rückmeldung mit Rückgängig, Lernbeispiel umgehängt.
            batch = einkauf.get_by_role('group', name='Alle in Einkauf')
            expect(batch.get_by_role('button')).to_have_text(['Alle 2 nach „Labor“ verschieben', 'Alle bleiben hier', 'Alle nicht lernen'])
            batch.get_by_role('button', name='Alle 2 nach „Labor“ verschieben').click()
            expect(dialog).to_contain_text('2 Mails nach „Labor“ verschieben?')
            dialog.get_by_role('button', name='Verschieben').click()
            expect(view.locator('.setup-status')).to_have_text('2 Mails nach „Labor“ verschoben.')
            moves = [(c[1]['id'], c[1]['source'], c[1]['target'], c[2]) for c in calls('outlook_move')]
            assert sorted(moves) == [('juni', '02', '03', True), ('mai', '02', '03', True)], moves
            expect(folders).to_have_count(1)
            expect(page.locator('.toast')).to_contain_text('Rückgängig')
            training = page.evaluate("JSON.parse(localStorage.getItem('outlook-kanban-ai-training-v1')).rows")
            assert [r['id'] for r in training] == ['e0'], training
            feedback = page.evaluate("JSON.parse(localStorage.getItem('outlook-kanban-filing-feedback-v1')).rows")
            assert sorted((r['folder'], r['id']) for r in feedback) == [('Labor', 'juni'), ('Labor', 'mai')], feedback
            decisions = state()['outliers']
            assert sorted(d['decision'] + ':' + d['target'] for d in decisions.values()) == ['moved:Labor'] * 2, decisions
            page.locator('.toast').get_by_role('button', name='Rückgängig').click()
            expect(page.locator('.toast')).to_contain_text('Zurückgenommen')
            undone = sorted((c[1]['id'], c[1]['source'], c[1]['target']) for c in calls('outlook_undo'))
            assert undone == [('neu-juni', '03', '02'), ('neu-mai', '03', '02')], undone

            # Nach dem Rückgängig meldet eine neue Prüfung beide wieder. „Bleibt hier“ wird nie wieder gemeldet.
            view.get_by_role('button', name='Neu prüfen').click()
            expect(view.locator('.setup-status')).to_have_text('Prüfung abgeschlossen (Embeddings).')
            einkauf = view.locator('details[data-folder="Einkauf"]')
            expect(einkauf.locator('li')).to_have_count(2)
            einkauf.get_by_role('button', name='Bleibt hier: „Probenbericht Juni“').click()
            expect(view.locator('.setup-status')).to_have_text('„Probenbericht Juni“ bleibt hier und wird nicht mehr gemeldet.')
            expect(einkauf.locator('li strong')).to_have_text(['„Probenbericht Mai“'])
            expect(einkauf.get_by_role('button', name='Verschieben nach „Labor“: „Probenbericht Mai“')).to_be_focused()
            confirmed = state()['confirmed']
            assert len(confirmed) == 1, confirmed
            assert state()['outliers'][confirmed[0]] == {'folder': 'Einkauf', 'decision': 'stay'}

            # Nicht lernen: gespeichert unter mailboard-learn-excluded-v1, fehlt bei der nächsten Prüfung.
            labor = view.locator('details[data-folder="Labor"]')
            labor.get_by_role('button', name='Nicht lernen: „Urlaubsplan“').click()
            expect(view.locator('.setup-status')).to_have_text('„Urlaubsplan“ wird nicht mehr zum Lernen verwendet.')
            excluded = page.evaluate("JSON.parse(localStorage.getItem('mailboard-learn-excluded-v1')).ids")
            assert len(excluded) == 1, excluded
            view.get_by_role('button', name='Neu prüfen').click()
            expect(view.locator('.setup-status')).to_have_text('Prüfung abgeschlossen (Embeddings).')
            request = calls('ai_outliers')[-1][1]
            labor_items = [i['text'] for f in request['folders'] if f['key'] == 'Labor' for i in f['items']]
            assert len(labor_items) == 5 and not any('Urlaubsplan' in t for t in labor_items), labor_items
            expect(view.locator('details[data-folder="Einkauf"] li strong')).to_have_text(['„Probenbericht Mai“'])
            expect(view.locator('details[data-folder="Labor"] li strong')).to_have_text(['„Bestellung Kittel“'])
            assert state()['outlierFolders'] == [], state()
            assert not errors, errors
            browser.close()
            print('OK – Ausreißer: Prüfung mit Kennzahl, Verschieben mit Bestätigung und Undo, Bleibt hier, Nicht lernen')
    finally:
        server.shutdown()
