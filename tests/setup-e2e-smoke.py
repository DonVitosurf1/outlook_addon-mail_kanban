"""Einrichtung durchgehend E0–E7 mit simuliertem Outlook und simulierter lokaler KI.

Drei Lernordner (Einkauf, Labor und das Sammelbecken „Allgemein“) und 40 Posteingangsmails. Unterwegs: pausieren und fortsetzen,
Ausreißer verschieben mit Undo, Zusammenlegen nach „_Zusammengelegt“ mit Undo, Stapelablage, Archivangebot. Am Ende ist die
Einrichtung abgeschlossen. Das simulierte Outlook hält seinen Zustand: Verschieben, Rückgängig und Ordneränderungen wirken auf die Daten.
"""
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
  // Noch keine Lernziele: der Hinweis über dem Board bietet die Einrichtung an (E0). Ablageregeln gibt es schon.
  localStorage.setItem('kanban-board-options-v1', JSON.stringify({poll_seconds:0,allow_move:true,
    filing_rules:[{match:'domain:einkauf.test',folder:'Einkauf'},{match:'domain:labor.test',folder:'Labor'}]}))
  localStorage.setItem('outlook-kanban-ai-settings-v1', JSON.stringify({enabled:true,model:'lokal',embeddings:true,embedModel:'lokal-embed'}))
}
const day=864e5,ago=n=>new Date(Date.now()-n*day).toISOString().slice(0,19)
const mail=(id,subject,from,age,hasStatus=false)=>({id,subject,sender:from.split('@')[0],senderEmail:from,body:'Inhalt '+subject,received:ago(age),hasStatus})
const many=(n,prefix,subject,from,start)=>Array.from({length:n},(_,i)=>mail(prefix+i,subject+' '+i,from,start+i))
let n=0
const inboxMail=(subject,from,age,hasStatus)=>mail('i'+(n++),subject,from,age,hasStatus)
// 40 Posteingangsmails, älteste zuerst: alte Newsletter, Bestellungen, Messwerte, Fragen, 2 mit Status, neue Newsletter.
const inbox=[
  ...Array.from({length:12},(_,i)=>inboxMail('Newsletter alt '+i,'news@extern.test',300-i)),
  ...Array.from({length:10},(_,i)=>inboxMail('Bestellung Nachschub '+i,'anna@einkauf.test',250-i)),
  ...Array.from({length:6},(_,i)=>inboxMail('Messwerte Charge '+i,'bernd@labor.test',200-i)),
  ...Array.from({length:4},(_,i)=>inboxMail('Rückfrage '+i,'clara@extern.test',150-i)),
  inboxMail('Mit Status 0','dora@extern.test',120,true),inboxMail('Mit Status 1','dora@extern.test',110,true),
  ...Array.from({length:6},(_,i)=>inboxMail('Newsletter neu '+i,'news@extern.test',50-i)),
]
const folders=[
  {id:'01',name:'Posteingang',isInbox:true,parentId:'root',rootId:'root',mails:inbox},
  {id:'02',name:'Einkauf',parentId:'root',rootId:'root',mails:many(20,'e','Bestellung Pipetten','anna@einkauf.test',20)},
  {id:'03',name:'Labor',parentId:'root',rootId:'root',mails:many(25,'l','Probe Analyse','bernd@labor.test',20)},
  // Sammelbecken: Notizen und zwei Bestellungen, die eigentlich nach Einkauf gehören.
  {id:'04',name:'Allgemein',parentId:'root',rootId:'root',mails:[...many(18,'a','Notiz Labor','clara@firma.test',20),
    mail('k1','Bestellung Kittel 1','anna@einkauf.test',30),mail('k2','Bestellung Kittel 2','anna@einkauf.test',31)]},
  {id:'05',name:'Gesendete Elemente',parentId:'root',rootId:'root',mails:[]},
]
const pathOf=f=>f.isInbox?'':f.parentId==='root'?f.name:pathOf(folders.find(p=>p.id===f.parentId))+'/'+f.name
const listed=()=>folders.map(({mails,...f})=>({...f,path:pathOf(f)}))
const card=(m,f)=>({...m,folderId:f.id,folder:f.name,status:m.hasStatus?'In Bearbeitung':'Offen',tags:[],attachments:[]})
const write=name=>{if(!window.batchActive)throw Error(name+' ohne Schreibstapel')}
// Simulierte Embeddings: Labor und das Sammelbecken liegen nah beieinander (Kosinus über 0,9), Einkauf weit weg.
const vectorOf=texts=>texts.some(t=>t.includes('Notiz'))?[0.95,0.3,0]:texts.some(t=>t.includes('Probe'))?[1,0,0]:[0,1,0]
window.outlook={folders,pathOf}
window.calls=[]
window.unexpected=[]
window.__TAURI__={core:{invoke:async(name,args={})=>{
  window.calls.push([name,args,!!window.batchActive])
  if(name==='outlook_batch'){window.batchActive=args.active;return}
  if(name==='outlook_categories')return '[]'
  if(name==='outlook_folders')return JSON.stringify(listed())
  if(name==='outlook_folder_counts')return JSON.stringify(folders.filter(f=>!args.folders||args.folders.includes(f.id)).map(f=>({id:f.id,count:f.mails.length})))
  if(name==='outlook_board')return '[]'
  if(name==='outlook_folder')return '[]'
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='outlook_training'){
    const f=folders.find(x=>x.id===args.folder)
    return JSON.stringify(f.mails.slice(0,args.limit).map(m=>({...m,folderId:f.id})))
  }
  if(name==='outlook_backlog'){
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
  if(name==='project_create'){
    write(name)
    if(folders.some(f=>f.parentId===args.parent&&f.name===args.name))throw Error('Unter diesem Namen gibt es bereits einen Ordner.')
    const f={id:'z'+folders.length,name:args.name,parentId:args.parent,rootId:'root',mails:[]};folders.push(f)
    return JSON.stringify({...listed().find(x=>x.id===f.id),previousName:'',previousParentId:''})
  }
  if(name==='project_move'){
    write(name)
    const f=folders.find(x=>x.id===args.folder)
    if(!f||f.parentId!==args.source)throw Error('Der Projektordner wurde inzwischen verschoben.')
    const previousParentId=f.parentId;f.parentId=args.target;f.id+='F'
    return JSON.stringify({...listed().find(x=>x.id===f.id),previousName:f.name,previousParentId})
  }
  if(name==='ai_models')return ['lokal','lokal-embed']
  if(name==='ai_embed')return args.items.length
  if(name==='ai_suggest')return []
  if(name==='ai_centroid')return {vector:vectorOf(args.samples.map(s=>s.text)),index:null}
  if(name==='ai_outliers')return args.folders.flatMap(f=>f.items.flatMap(item=>
    f.key==='Allgemein'&&item.text.includes('Bestellung Kittel')?[{id:item.id,folder:f.key,suggested:'Einkauf',own:0.3,other:0.9}]:[]))
  if(name==='ai_profile')return '## Zweck\\nEntwurf für '+args.key
  window.unexpected.push(name)
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
            page = browser.new_page(viewport={'width': 1440, 'height': 1000})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.add_init_script(LIVE)
            page.goto(base)
            expect(page.locator('.foot')).to_have_text('Klassisches Outlook')
            calls = lambda name: page.evaluate(f"calls.filter(c=>c[0]==={json.dumps(name)})")
            state = lambda: page.evaluate("JSON.parse(localStorage.getItem('mailboard-setup-v1'))")
            options = lambda: page.evaluate("JSON.parse(localStorage.getItem('kanban-board-options-v1'))")
            count = lambda folder: page.evaluate(f"outlook.folders.find(f=>f.name==={json.dumps(folder)}).mails.length")
            view = page.locator('#setupView')
            status = view.locator('.setup-status')
            toast = page.locator('.toast')
            confirm = page.locator('#moveConfirm')
            heading = lambda number, title: view.get_by_role('heading', name=f'Schritt {number} · {title}')

            def resume(number, title):
                """Pausieren führt zurück zum Board; über Werkzeuge → Einrichtung geht es am selben Schritt weiter."""
                view.get_by_role('button', name='Pausieren').click()
                expect(page.locator('#board')).to_be_visible()
                expect(view).to_be_hidden()
                expect(toast).to_contain_text('Einrichtung pausiert.')
                page.locator('#moreTools summary').click()
                page.locator('#setupOpen').click()
                expect(heading(number, title)).to_be_visible()

            # E0: Hinweis über dem Board.
            hint = page.locator('.setup-hint')
            expect(hint).to_be_visible()
            hint.get_by_role('button', name='Einrichtung starten').click()
            expect(heading(1, 'Ordner wählen')).to_be_visible()

            # E1: Vorbelegung mit den drei Lernordnern, Zahlen je Ordner, Archiv anlegen.
            for name in ['Einkauf', 'Labor', 'Allgemein']:
                expect(view.get_by_label('Lernen: ' + name, exact=True)).to_be_checked()
            expect(view.get_by_label('Lernen: Gesendete Elemente', exact=True)).not_to_be_checked()
            expect(view.locator('table tbody tr').filter(has_text='Allgemein').locator('td').first).to_have_text('20')
            view.get_by_role('button', name='Archivordner anlegen').click()
            page.get_by_role('dialog').filter(has_text='Ordner „Archiv“ auf oberster Ebene').get_by_role('button', name='Anlegen').click()
            expect(view.get_by_label('Archiv: Archiv', exact=True)).to_be_checked()
            view.get_by_role('button', name='Speichern und weiter').click()
            assert sorted(options()['suggestion_folders']) == ['Allgemein', 'Einkauf', 'Labor'], options()
            assert options()['archive_folder'] == 'Archiv', options()

            # E2: Lernen und messen mit Embeddings (Ordnerprofile über ai_centroid), Ausgangswert.
            expect(heading(2, 'Lernen und messen')).to_be_visible()
            view.get_by_role('button', name='Lernen und messen', exact=True).click()
            expect(status).to_contain_text('Lernen und Messen abgeschlossen.')
            expect(view.get_by_text('Ausgangswert vom')).to_be_visible()
            assert sorted(c[1]['folder'] for c in calls('outlook_training')) == ['02', '03', '04']
            assert len(calls('ai_centroid')) == 3
            baseline = state()['measurements']['baseline']
            assert baseline['samples'] == {'Einkauf': 20, 'Labor': 25, 'Allgemein': 20}, baseline['samples']
            # Pausieren über die Rückmeldung, Fortsetzen über Start.
            view.get_by_role('button', name='Pausieren').click()
            page.locator('#cockpit-start').click()
            start = page.locator('#cockpit-dialog')
            expect(start).to_contain_text('Einrichtung: 2 von 7 Schritten')
            start.get_by_role('button', name='Einrichtung öffnen').click()
            expect(heading(2, 'Lernen und messen')).to_be_visible()
            view.get_by_role('button', name='Weiter', exact=True).click()

            # E3: Ausreißer im Sammelbecken verschieben, dann zurücknehmen.
            expect(heading(3, 'Ausreißer prüfen')).to_be_visible()
            view.get_by_role('button', name='Ausreißer suchen').click()
            expect(status).to_have_text('Prüfung abgeschlossen (Embeddings).')
            allgemein = view.locator('details[data-folder="Allgemein"]')
            expect(allgemein.locator('summary')).to_contain_text('Allgemein · 2 von 20 Lernmails verdächtig (10 %)')
            allgemein.get_by_role('group', name='Alle in Allgemein').get_by_role('button', name='Alle 2 nach „Einkauf“ verschieben').click()
            expect(confirm).to_contain_text('2 Mails nach „Einkauf“ verschieben?')
            confirm.get_by_role('button', name='Verschieben').click()
            expect(status).to_have_text('2 Mails nach „Einkauf“ verschoben.')
            assert count('Allgemein') == 18 and count('Einkauf') == 22
            assert all(c[2] for c in calls('outlook_move'))
            toast.get_by_role('button', name='Rückgängig').click()
            expect(toast).to_contain_text('Zurückgenommen')
            assert count('Allgemein') == 20 and count('Einkauf') == 20
            assert state()['status']['E3'] == 'done'
            view.get_by_role('button', name='Weiter', exact=True).click()

            # E4: Labor und Sammelbecken überschneiden sich. Pausieren und fortsetzen, dann zusammenlegen und zurücknehmen.
            expect(heading(4, 'Struktur verfeinern')).to_be_visible()
            merge = view.get_by_role('region', name='Überschneidungen')
            title = '„Allgemein“ in „Labor“ zusammenlegen (20 Mails)'
            expect(merge.locator('li strong').filter(has_text=title)).to_have_count(1)
            resume(4, 'Struktur verfeinern')
            merge.get_by_role('button', name='Zusammenlegen: ' + title).click()
            ask = page.get_by_role('dialog').filter(has_text='alle 20 Mails aus „Allgemein“ nach „Labor“ verschieben')
            ask.get_by_role('button', name='Zusammenlegen').click()
            expect(status).to_contain_text('„Allgemein“ in „Labor“ zusammengelegt: 20 Mails verschoben, der Ordner liegt jetzt unter „_Zusammengelegt/Allgemein“.')
            assert count('Labor') == 45 and count('Allgemein') == 0
            paths = page.evaluate("outlook.folders.map(f=>outlook.pathOf(f))")
            assert '_Zusammengelegt/Allgemein' in paths, paths
            assert sorted(options()['suggestion_folders']) == ['Einkauf', 'Labor'], options()
            writes = [c for c in page.evaluate("calls") if c[0] in ('outlook_move', 'project_create', 'project_move')]
            assert all(c[2] for c in writes), writes
            expect(toast).to_contain_text('„Allgemein“ in „Labor“ zusammengelegt')
            toast.get_by_role('button', name='Rückgängig').click()
            expect(toast).to_contain_text('rückgängig')
            expect(merge.locator('li strong').filter(has_text=title)).to_have_count(1)
            paths = page.evaluate("outlook.folders.map(f=>outlook.pathOf(f))")
            assert 'Allgemein' in paths and '_Zusammengelegt' in paths, paths
            assert count('Labor') == 25 and count('Allgemein') == 20
            assert sorted(options()['suggestion_folders']) == ['Allgemein', 'Einkauf', 'Labor'], options()
            view.get_by_role('button', name='Schritt abschließen', exact=True).click()

            # E5: Steckbriefe für alle drei Lernordner entwerfen und übernehmen.
            expect(heading(5, 'Steckbriefe')).to_be_visible()
            view.get_by_role('button', name='Steckbriefe entwerfen').click()
            drafts = view.get_by_role('list', name='Steckbrief-Entwürfe')
            expect(drafts.locator('li')).to_have_count(3)
            expect(status).to_have_text('Alle Entwürfe sind fertig. Prüfe sie unten.')
            for name in ['Einkauf', 'Labor', 'Allgemein']:
                drafts.get_by_role('button', name='Übernehmen: ' + name).click()
                expect(status).to_have_text(f'Steckbrief für „{name}“ gespeichert.')
            saved = page.evaluate("JSON.parse(localStorage.getItem('kanban-profile-edits-v1'))")
            assert sorted(saved) == ['Allgemein', 'Einkauf', 'Labor'] and 'Entwurf für Labor' in saved['Labor'], saved
            view.get_by_role('button', name='Schritt abschließen', exact=True).click()

            # E6: Neu lernen und mit dem Ausgangswert vergleichen.
            expect(heading(6, 'Neu lernen und vergleichen')).to_be_visible()
            view.get_by_role('button', name='Neu lernen und vergleichen', exact=True).click()
            expect(view.locator('table.setup-compare')).to_have_count(2)
            expect(view.locator('table.setup-compare').nth(1).locator('tbody th')).to_have_count(3)
            assert state()['measurements']['after'], state()
            view.get_by_role('button', name='Schritt abschließen', exact=True).click()

            # E7: Posteingang lesen, Stapel ablegen, Archivangebot.
            expect(heading(7, 'Posteingang abarbeiten')).to_be_visible()
            view.get_by_role('button', name='Posteingang lesen').click()
            expect(status).to_contain_text('38 Mails gelesen:')
            safe = view.get_by_role('region', name='Sichere Vorschläge', exact=True)
            # Einkauf und Labor über die Ablageregeln, die Rückfragen von Clara über das Gelernte aus dem Sammelbecken.
            expect(safe.locator('summary')).to_have_text(['10 Mails nach „Einkauf“', '6 Mails nach „Labor“', '4 Mails nach „Allgemein“'])
            safe.get_by_role('button', name='Stapel ablegen: 10 Mails nach „Einkauf“').click()
            expect(confirm).to_contain_text('10 Mails nach „Einkauf“ verschieben?')
            confirm.get_by_role('button', name='Verschieben').click()
            expect(status).to_have_text('10 Mails nach „Einkauf“ abgelegt.')
            assert count('Einkauf') == 30 and count('Posteingang') == 30
            resume(7, 'Posteingang abarbeiten')
            expect(safe.locator('summary')).to_have_text(['6 Mails nach „Labor“', '4 Mails nach „Allgemein“'])
            none = view.get_by_role('region', name='Ohne Ziel')
            offer = none.get_by_role('button', name='ins Archiv „Archiv“ verschieben')
            expect(offer).to_have_count(1)
            archived = int(offer.inner_text().split(' ')[0])
            assert archived >= 12, offer.inner_text()
            offer.click()
            expect(confirm).to_contain_text(f'{archived} Mails nach „Archiv“ verschieben?')
            confirm.get_by_role('button', name='Verschieben').click()
            expect(status).to_have_text(f'{archived} Mails ins Archiv „Archiv“ verschoben.')
            assert count('Archiv') == archived
            assert all(page.evaluate("outlook.folders.find(f=>f.name==='Archiv').mails.map(m=>m.subject.startsWith('Newsletter alt'))"))

            # Abschluss: Die Einrichtung ist abgeschlossen, Start zeigt keinen Fortschritt mehr.
            view.get_by_role('button', name='Einrichtung abschließen').click()
            expect(view.locator('.setup-complete')).to_have_text('Die Einrichtung ist abgeschlossen. Du kannst einzelne Schritte jederzeit erneut öffnen.')
            final = state()['status']
            assert all(final[s] == 'done' for s in ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7']), final
            view.get_by_role('button', name='Pausieren').click()
            expect(hint).to_be_hidden()
            page.locator('#cockpit-start').click()
            expect(page.locator('#cockpit-dialog')).not_to_contain_text('Einrichtung:')
            # Alle Postfachänderungen liefen im Schreibstapel, gelöscht wurde nichts.
            writes = [c for c in page.evaluate("calls") if c[0] in ('outlook_move', 'outlook_undo', 'project_create', 'project_move')]
            assert all(c[2] for c in writes), [c for c in writes if not c[2]]
            assert sum(len(f) for f in page.evaluate("outlook.folders.map(f=>f.mails.map(m=>m.id))")) == 40 + 20 + 25 + 20
            assert page.evaluate('unexpected') == [], page.evaluate('unexpected')
            assert not errors, errors
            browser.close()
            print('OK – Einrichtung E0–E7: Pausieren und Fortsetzen, Ausreißer mit Undo, Zusammenlegen mit Undo, Stapelablage, Archivangebot, abgeschlossen')
    finally:
        server.shutdown()
