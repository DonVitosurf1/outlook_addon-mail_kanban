"""Posteingang abarbeiten (E7) mit simuliertem Outlook: 40 Posteingangsmails in zwei Seiten, sichere Stapel ablegen mit Undo,
Archivangebot mit Altersgrenze und Undo, Hinweis ohne Archiv, Einzeln durchgehen öffnet Aufräumen mit den unsicheren Mails, Abschluss."""
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
  localStorage.setItem('kanban-board-options-v1', JSON.stringify({poll_seconds:0,allow_move:true,
    project_folders:[],suggestion_folders:['Einkauf','Labor'],archive_folder:'Archiv',
    filing_rules:[{match:'domain:einkauf.test',folder:'Einkauf'},{match:'domain:labor.test',folder:'Labor'}]}))
  localStorage.setItem('mailboard-setup-v1', JSON.stringify({version:1,step:'E7',
    status:{E1:'done',E2:'done',E3:'done',E4:'skipped',E5:'skipped',E6:'done',E7:'open'},measurements:{},outliers:{},confirmed:[],outlierFolders:[],data:{}}))
}
const day=864e5,ago=n=>new Date(Date.now()-n*day).toISOString()
let n=0
const mail=(subject,from,age,hasStatus=false)=>({id:'i'+(n++),subject,sender:from.split('@')[0],senderEmail:from,body:'Inhalt',received:ago(age),hasStatus})
// Älteste zuerst: 12 alte Newsletter, Bestellungen, Messwerte, Fragen zum Labor, 2 mit Status, 6 jüngere Newsletter.
const inbox=[
  ...Array.from({length:12},(_,i)=>mail('Newsletter alt '+i,'news@extern.test',300-i)),
  ...Array.from({length:10},(_,i)=>mail('Bestellung '+i,'anna@einkauf.test',250-i)),
  ...Array.from({length:6},(_,i)=>mail('Messwerte '+i,'bernd@labor.test',200-i)),
  ...Array.from({length:4},(_,i)=>mail('Frage zum Labor '+i,'clara@extern.test',150-i)),
  mail('Mit Status 0','dora@extern.test',120,true),mail('Mit Status 1','dora@extern.test',110,true),
  ...Array.from({length:6},(_,i)=>mail('Newsletter neu '+i,'news@extern.test',50-i)),
]
const folders=[
  {id:'01',name:'Posteingang',path:'',isInbox:true,parentId:'root',rootId:'root',mails:inbox},
  {id:'02',name:'Einkauf',path:'Einkauf',parentId:'root',rootId:'root',mails:[]},
  {id:'03',name:'Labor',path:'Labor',parentId:'root',rootId:'root',mails:[]},
  {id:'04',name:'Archiv',path:'Archiv',parentId:'root',rootId:'root',mails:[]},
]
const card=(m,f)=>({...m,folderId:f.id,folder:f.name,status:m.hasStatus?'In Bearbeitung':'Offen',tags:[],attachments:[]})
const write=name=>{if(!window.batchActive)throw Error(name+' ohne Schreibstapel')}
window.outlook={folders}
window.calls=[]
window.__TAURI__={core:{invoke:async(name,args={})=>{
  window.calls.push([name,args,!!window.batchActive])
  if(name==='outlook_batch'){window.batchActive=args.active;return}
  if(name==='outlook_categories')return '[]'
  if(name==='outlook_folders')return JSON.stringify(folders.map(({mails,...f})=>f))
  if(name==='outlook_folder_counts')return JSON.stringify(folders.filter(f=>!args.folders||args.folders.includes(f.id)).map(f=>({id:f.id,count:f.mails.length})))
  if(name==='outlook_board')return '[]'
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='outlook_backlog'){
    // Seite ab dem Fortsetzungspunkt. Der Helfer darf weniger als die Grenze liefern: hier höchstens 25 je Seite.
    const rows=[...folders[0].mails].sort((a,b)=>a.received.localeCompare(b.received))
    const start=args.cursor?Number(args.cursor.split('|')[0]):0,end=start+Math.min(args.limit,25)
    return JSON.stringify({cards:rows.slice(start,end).map(m=>card(m,folders[0])),next:end<rows.length?end+'|'+rows[end-1].id:null})
  }
  if(name==='outlook_move'||name==='outlook_undo'){
    write(name)
    const from=folders.find(f=>f.id===args.source),to=folders.find(f=>f.id===args.target)
    const row=from?.mails.find(m=>m.id===args.id)
    if(!row||!to)throw Error('Mail oder Ordner nicht mehr vorhanden.')
    from.mails=from.mails.filter(m=>m!==row);row.id='n'+row.id;to.mails.push(row)
    return JSON.stringify({id:row.id,source:args.source,target:args.target})
  }
  if(name==='ai_suggest')return []
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
            count = lambda folder: page.evaluate(f"outlook.folders.find(f=>f.id==={json.dumps(folder)}).mails.length")
            page.locator('#cockpit-start').click()
            expect(page.locator('#cockpit-dialog')).to_contain_text('Einrichtung: 6 von 7 Schritten')
            page.keyboard.press('Escape')
            page.locator('#moreTools summary').click()
            page.locator('#setupOpen').click()
            view = page.locator('#setupView')
            expect(view.get_by_role('heading', name='Schritt 7 · Posteingang abarbeiten')).to_be_visible()
            status = view.locator('.setup-status')

            # Abschließen vor dem ersten Lesen fragt nach. Abbrechen lässt den Schritt offen.
            view.get_by_role('button', name='Einrichtung abschließen').click()
            early = page.get_by_role('dialog').filter(has_text='Posteingang noch nicht gelesen. Trotzdem abschließen?')
            early.get_by_role('button', name='Abbrechen').click()
            expect(view.get_by_role('heading', name='Schritt 7 · Posteingang abarbeiten')).to_be_visible()
            assert page.evaluate("JSON.parse(localStorage.getItem('mailboard-setup-v1')).status.E7") == 'open'

            # Lesen in Seiten mit Fortsetzungspunkt bis zum Ende, Mails mit Status zählen nicht.
            view.get_by_role('button', name='Posteingang lesen').click()
            expect(status).to_have_text('38 Mails gelesen: 16 sicher, 4 unsicher, 18 ohne Ziel.')
            assert [c[1] for c in calls('outlook_backlog')] == [{'limit': 250}, {'limit': 250, 'cursor': '25|i24'}], calls('outlook_backlog')
            expect(view.get_by_role('button', name='Neu lesen')).to_be_visible()

            # Sichere Stapel je Ziel mit aufklappbarer Betreffliste.
            safe = view.get_by_role('region', name='Sichere Vorschläge', exact=True)
            expect(safe.locator('summary')).to_have_text(['10 Mails nach „Einkauf“', '6 Mails nach „Labor“'])
            expect(safe.locator('details ul li').first).to_be_hidden()
            safe.locator('summary').first.click()
            expect(safe.locator('details').first.locator('li')).to_have_count(10)
            expect(safe.locator('details').first.locator('li').first).to_have_text('Bestellung 0')

            # Stapel ablegen: Bestätigung, Abbrechen ändert nichts.
            safe.get_by_role('button', name='Stapel ablegen: 10 Mails nach „Einkauf“').click()
            confirm = page.locator('#moveConfirm')
            expect(confirm).to_contain_text('10 Mails nach „Einkauf“ verschieben?')
            confirm.get_by_role('button', name='Abbrechen').click()
            assert calls('outlook_move') == []
            safe.get_by_role('button', name='Stapel ablegen: 10 Mails nach „Einkauf“').click()
            confirm.get_by_role('button', name='Verschieben').click()
            expect(status).to_have_text('10 Mails nach „Einkauf“ abgelegt.')
            assert count('02') == 10 and count('01') == 30
            moves = calls('outlook_move')
            assert len(moves) == 10 and all(c[2] and c[1]['target'] == '02' for c in moves), moves
            expect(safe.locator('summary')).to_have_text(['6 Mails nach „Labor“'])
            expect(safe.get_by_role('heading', name='Sichere Vorschläge', exact=True)).to_be_focused()

            # Ein Rückgängig-Schritt holt den ganzen Stapel zurück.
            toast = page.locator('.toast')
            expect(toast).to_contain_text('Einkauf')
            toast.get_by_role('button', name='Rückgängig').click()
            expect(toast).to_contain_text('Zurückgenommen')
            assert count('02') == 0 and count('01') == 40
            assert len(calls('outlook_undo')) == 10 and all(c[2] for c in calls('outlook_undo'))
            # Die Ansicht weist auf „Neu lesen“ hin, statt die zurückgeholten Mails still zu verschweigen.
            undone = 'Zurückgenommen. Mit „Neu lesen“ siehst du die Mails wieder.'
            expect(status).to_have_text(undone)
            expect(view.locator('.setup-note', has_text=undone)).to_be_visible()

            # Archivangebot mit Altersgrenze in Monaten, ohne Ziel und älter als die Grenze.
            none = view.get_by_role('region', name='Ohne Ziel')
            months = none.get_by_label('Älter als')
            expect(months).to_have_value('3')
            expect(none).to_contain_text('18 Mails ohne Ablagevorschlag. Älter als 3 Monate: 12. 6 jüngere bleiben im Posteingang.')
            months.fill('1')
            months.press('Tab')
            expect(none).to_contain_text('Älter als 1 Monat: 18. 0 jüngere bleiben im Posteingang.')
            assert page.evaluate("JSON.parse(localStorage.getItem('mailboard-setup-v1')).data.E7") == {'months': 1}
            months.fill('3')
            months.press('Tab')
            offer = none.get_by_role('button', name='12 Mails ins Archiv „Archiv“ verschieben')
            expect(offer).to_have_text('12 Mails ins Archiv verschieben')
            offer.click()
            expect(confirm).to_contain_text('12 Mails nach „Archiv“ verschieben?')
            confirm.get_by_role('button', name='Verschieben').click()
            expect(status).to_have_text('12 Mails ins Archiv „Archiv“ verschoben.')
            assert count('04') == 12 and count('01') == 28
            archived = page.evaluate("outlook.folders.find(f=>f.id==='04').mails.map(m=>m.subject)")
            assert all(s.startswith('Newsletter alt') for s in archived), archived
            expect(none).to_contain_text('6 Mails ohne Ablagevorschlag. Älter als 3 Monate: 0. 6 jüngere bleiben im Posteingang.')
            expect(none.get_by_role('button')).to_have_count(0)
            expect(toast).to_contain_text('Archiv')
            # Strg+Z statt der Rückmeldung: derselbe Hinweis.
            view.get_by_role('heading', name='Ohne Ziel').focus()
            page.keyboard.press('Control+z')
            expect(toast).to_contain_text('Zurückgenommen')
            assert count('04') == 0 and count('01') == 40
            expect(status).to_have_text(undone)

            # Ohne Archivziel: Hinweis mit Sprung zu Schritt 1.
            view.get_by_role('button', name='Neu lesen').click()
            expect(status).to_have_text('38 Mails gelesen: 16 sicher, 4 unsicher, 18 ohne Ziel.')
            expect(view.locator('.setup-note', has_text=undone)).to_have_count(0)
            page.evaluate("""(()=>{const o=JSON.parse(localStorage.getItem('kanban-board-options-v1'));o.archive_folder='';
              localStorage.setItem('kanban-board-options-v1',JSON.stringify(o))})()""")
            view.locator('.setup-steps button').nth(6).click()
            expect(none).to_contain_text('Es ist kein Archivordner gewählt.')
            expect(none.get_by_role('button', name='12 Mails ins Archiv „Archiv“ verschieben')).to_have_count(0)
            none.get_by_role('button', name='Zu Schritt 1: Ordner wählen').click()
            expect(view.get_by_role('heading', name='Schritt 1 · Ordner wählen')).to_be_focused()
            page.evaluate("""(()=>{const o=JSON.parse(localStorage.getItem('kanban-board-options-v1'));o.archive_folder='Archiv';
              localStorage.setItem('kanban-board-options-v1',JSON.stringify(o))})()""")
            view.locator('.setup-steps button').nth(6).click()
            expect(none.get_by_role('button', name='12 Mails ins Archiv „Archiv“ verschieben')).to_be_visible()

            # Einzeln durchgehen öffnet „Posteingang aufräumen“ mit genau den unsicheren Mails, ohne den Board-Rückstand zu laden.
            unsure = view.get_by_role('region', name='Unsichere Vorschläge')
            expect(unsure).to_contain_text('4 Mails haben einen Vorschlag ohne hohe Sicherheit.')
            backlog_calls = len(calls('outlook_backlog'))
            unsure.get_by_role('button', name='Einzeln durchgehen').click()
            cleanup = page.get_by_role('dialog', name='Posteingang aufräumen')
            expect(cleanup).to_be_visible()
            expect(cleanup.locator('small').first).to_have_text('4 noch durchzusehen')
            expect(cleanup.locator('h2')).to_have_text('Frage zum Labor 0')
            assert len(calls('outlook_backlog')) == backlog_calls
            subjects = []
            for _ in range(4):
                subjects.append(cleanup.locator('h2').text_content())
                cleanup.get_by_role('button', name='Überspringen').click()
            assert subjects == ['Frage zum Labor 0', 'Frage zum Labor 1', 'Frage zum Labor 2', 'Frage zum Labor 3'], subjects
            expect(cleanup.locator('h2')).to_have_text('Durchsicht beendet')
            cleanup.get_by_role('button', name='Zurück', exact=True).click()
            expect(cleanup.locator('h2')).to_have_text('Frage zum Labor 3')
            # Eine Mail außerhalb des Boards verschieben: Bestätigung, Schreibstapel, danach die nächste.
            cleanup.get_by_label('Zielordner').select_option(label='Labor')
            cleanup.get_by_role('button', name='In Zielordner verschieben').click()
            confirm.get_by_role('button', name='Verschieben').click()
            expect(cleanup.locator('h2')).to_have_text('Durchsicht beendet')
            last = calls('outlook_move')[-1]
            assert last[2] and last[1]['source'] == '01' and last[1]['target'] == '03', last
            assert page.evaluate("outlook.folders.find(f=>f.id==='03').mails.map(m=>m.subject)") == ['Frage zum Labor 3']
            cleanup.get_by_role('button', name='Schließen').click()
            expect(cleanup).to_be_hidden()
            expect(unsure).to_contain_text('3 Mails haben einen Vorschlag ohne hohe Sicherheit.')
            expect(unsure.get_by_role('heading', name='Unsichere Vorschläge')).to_be_focused()

            # Abschluss: Einrichtung abgeschlossen, Start zeigt keinen Fortschritt mehr, kein Hinweis über dem Board.
            view.get_by_role('button', name='Einrichtung abschließen').click()
            expect(view.locator('.setup-complete')).to_have_text('Die Einrichtung ist abgeschlossen. Du kannst einzelne Schritte jederzeit erneut öffnen.')
            assert page.evaluate("JSON.parse(localStorage.getItem('mailboard-setup-v1')).status.E7") == 'done'
            view.get_by_role('button', name='Pausieren').click()
            expect(page.locator('.setup-hint')).to_be_hidden()
            page.locator('#cockpit-start').click()
            expect(page.locator('#cockpit-dialog')).to_be_visible()
            expect(page.locator('#cockpit-dialog')).not_to_contain_text('Einrichtung:')
            assert not errors, errors
            browser.close()
            print('OK – Lesen in Seiten, sichere Stapel mit Undo, Archivangebot mit Undo, Hinweis ohne Archiv, Einzeln durchgehen, Abschluss')
    finally:
        server.shutdown()
