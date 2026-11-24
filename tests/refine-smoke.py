"""Struktur verfeinern (E4) mit simuliertem Outlook und simulierter KI: Unterteilen öffnen, Zusammenlegen mit Bestätigung und Undo, Umbenennen, neue Ordner aus dem Posteingang."""
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
    project_folders:['Laborbedarf'],suggestion_folders:['Einkauf','Labor','Laborbedarf','Neu'],
    filing_rules:[{match:'domain:labor.test',folder:'Laborbedarf'}]}))
  localStorage.setItem('kanban-profile-edits-v1', JSON.stringify({Laborbedarf:'## Zweck\\nVerbrauchsmaterial'}))
  localStorage.setItem('outlook-kanban-ai-settings-v1', JSON.stringify({enabled:true,model:'lokal',embeddings:true}))
  localStorage.setItem('outlook-kanban-ai-training-v1', JSON.stringify({stamp:1,rows:[
    {folder:'Laborbedarf',id:'b0',features:['w:spitzen']},{folder:'Labor',id:'l0',features:['w:probe']}]}))
  const tally=(tested,correct)=>({tested,shown:tested,correct})
  localStorage.setItem('mailboard-setup-v1', JSON.stringify({version:1,step:'E4',
    status:{E1:'done',E2:'done',E3:'done',E4:'open',E5:'open',E6:'open',E7:'open'},
    measurements:{baseline:{date:'20.11.2026',note:'',samples:{Einkauf:300,Labor:40,Laborbedarf:5,Neu:3},
      report:{tested:30,folders:3,combined:{shown:30,correct:26},bayes:{shown:30,correct:26},rule:{shown:0,correct:0},sources:{},
        embedding:null,plain:null,semanticTested:0,missing:0,
        byFolder:{Einkauf:tally(10,10),Labor:tally(10,10),Laborbedarf:tally(10,6)},confusion:{Laborbedarf:{Labor:4}}}}},
    outliers:{},confirmed:[],outlierFolders:[],data:{}}))
}
const mail=(id,subject)=>({id,subject,sender:'Anna',senderEmail:'anna@labor.test',body:'Inhalt',received:'2026-10-01T10:00:00'})
const inboxMail=(id,subject,from)=>({id,subject,sender:'Bahn',senderEmail:from,body:'Beleg',received:'2026-11-01T10:00:00'})
const folders=[
  {id:'01',name:'Posteingang',path:'',isInbox:true,parentId:'root',rootId:'root',mails:[
    ...Array.from({length:7},(_,i)=>inboxMail('i'+i,'Reisekosten Beleg '+i,'reise@bahn.test')),
    inboxMail('x0','Newsletter November','news@bahn.test'),inboxMail('x1','Pipettenspitzen im Angebot','anna@labor.test')]},
  {id:'02',name:'Einkauf',path:'Einkauf',parentId:'root',rootId:'root',mails:Array.from({length:320},(_,i)=>mail('e'+i,'Bestellung '+i))},
  {id:'03',name:'Labor',path:'Labor',parentId:'root',rootId:'root',mails:Array.from({length:40},(_,i)=>mail('l'+i,'Probe '+i))},
  {id:'04',name:'Laborbedarf',path:'Laborbedarf',parentId:'root',rootId:'root',mails:Array.from({length:5},(_,i)=>mail('b'+i,'Pipettenspitzen '+i))},
  {id:'05',name:'Neu',path:'Neu',parentId:'root',rootId:'root',mails:[mail('n0','Zentrifuge defekt'),mail('n1','Wartung Zentrifuge')]},
]
const pathOf=f=>f.parentId==='root'?f.name:pathOf(folders.find(p=>p.id===f.parentId))+'/'+f.name
const listed=()=>folders.map(({mails,...f})=>({...f,path:pathOf(f)}))
// Zahlen nur auf Anfrage. Einkauf ohne Anzahl (nicht zählbar): E4 nennt die Lernmails als Untergrenze.
const counted=ids=>folders.filter(f=>ids.includes(f.id)&&f.id!=='02').map(f=>({id:f.id,count:f.mails.length}))
const write=name=>{if(!window.batchActive)throw Error(name+' ohne Schreibstapel')}
window.outlook={folders,pathOf}
window.calls=[]
window.names=['Labor','Laborgeräte']
window.clusterNames=['Reisekosten']
window.__TAURI__={core:{invoke:async(name,args={})=>{
  window.calls.push([name,args,!!window.batchActive])
  if(name==='outlook_batch'){window.batchActive=args.active;return}
  if(name==='outlook_categories')return '[]'
  if(name==='outlook_folders')return JSON.stringify(listed())
  if(name==='outlook_folder_counts')return JSON.stringify(counted(args.folders))
  if(name==='outlook_board')return JSON.stringify(folders.filter(f=>args.folders.includes(f.id)||f.isInbox).flatMap(f=>
    f.mails.map(m=>({...m,folderId:f.id,folder:f.name,status:'Offen',tags:[],attachments:[]}))))
  if(name==='outlook_folder')return '[]'
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='outlook_training'){
    const f=folders.find(x=>x.id===args.folder)
    return JSON.stringify(f.mails.slice(0,args.limit).map(m=>({...m,folderId:f.id})))
  }
  if(name==='outlook_move'||name==='outlook_undo'){
    write(name)
    const from=folders.find(f=>f.id===args.source),to=folders.find(f=>f.id===args.target)
    const row=from?.mails.find(m=>m.id===args.id)
    if(!row||!to)throw Error('Mail oder Ordner nicht mehr vorhanden.')
    if(name==='outlook_move'&&row.subject===window.failMove)throw Error('Outlook belegt')
    if(name==='outlook_undo'&&row.subject===window.failUndo)throw Error('Mail gesperrt')
    from.mails=from.mails.filter(m=>m!==row);row.id='n'+row.id;to.mails.push(row)
    return JSON.stringify({id:row.id,source:args.source,target:args.target})
  }
  if(name==='project_create'){
    write(name)
    if(folders.some(f=>f.parentId===args.parent&&f.name===args.name))throw Error('Unter diesem Namen gibt es bereits einen Ordner.')
    const f={id:'z'+folders.length,name:args.name,parentId:args.parent,rootId:'root',mails:[]};folders.push(f)
    return JSON.stringify({...listed().find(x=>x.id===f.id),previousName:null,previousParentId:null})
  }
  if(name==='project_move'){
    write(name)
    const f=folders.find(x=>x.id===args.folder)
    if(!f||f.parentId!==args.source)throw Error('Der Projektordner wurde inzwischen verschoben.')
    const previousParentId=f.parentId;f.parentId=args.target;f.id+='F'
    return JSON.stringify({...listed().find(x=>x.id===f.id),previousName:f.name,previousParentId})
  }
  if(name==='project_rename'){
    write(name)
    const f=folders.find(x=>x.id===args.folder),previousName=f.name;f.name=args.name
    return JSON.stringify({...listed().find(x=>x.id===f.id),previousName,previousParentId:f.parentId})
  }
  if(name==='ai_subfolders')return [{name:'Pipetten',subjects:['Bestellung 1']},{name:'Kittel',subjects:['Bestellung 2']}]
  if(name==='ai_folder_name')return window.names.shift()
  if(name==='ai_suggest')return []
  if(name==='ai_embed')return 0
  if(name==='ai_clusters'){
    const ids=args.items.filter(i=>i.text.includes('Reise')).map(i=>i.id)
    return ids.length>=args.minSize?[{ids}]:[]
  }
  if(name==='ai_cluster_name')return window.clusterNames.shift()
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
            options = lambda: page.evaluate("JSON.parse(localStorage.getItem('kanban-board-options-v1'))")
            profiles = lambda: page.evaluate("JSON.parse(localStorage.getItem('kanban-profile-edits-v1'))")
            page.locator('#moreTools summary').click()
            page.locator('#setupOpen').click()
            view = page.locator('#setupView')
            expect(view.get_by_role('heading', name='Schritt 4 · Struktur verfeinern')).to_be_visible()

            # Überfüllt: Einkauf mit 320 Mails. Unterteilen öffnet den vorhandenen Ablauf aus structure.ts.
            crowded = view.get_by_role('region', name='Überfüllte Ordner')
            expect(crowded.locator('li strong')).to_have_text(['„Einkauf“'])
            expect(crowded.locator('li small')).to_have_text('mindestens 300 Mails')
            crowded.get_by_role('button', name='Unterteilung vorschlagen: „Einkauf“').click()
            structure = page.locator('.structure-dialog')
            expect(structure.locator('fieldset')).to_have_count(2)
            assert calls('ai_subfolders')[0][1]['area'] == 'Einkauf'
            structure.get_by_role('button', name='Schließen').click()
            expect(structure).to_be_hidden()

            # Überschneidung aus der Messung (4 von 20 Testmails verwechselt), kleiner in größer, Richtung umkehrbar.
            merge = view.get_by_role('region', name='Überschneidungen')
            expect(merge.locator('li strong')).to_have_text(['„Laborbedarf“ in „Labor“ zusammenlegen (5 Mails)'])
            expect(merge.locator('li small')).to_have_text('in der Messung zu 20 % verwechselt')
            merge.get_by_role('button', name='Richtung umkehren: „Laborbedarf“ in „Labor“ zusammenlegen (5 Mails)').click()
            expect(merge.locator('li strong')).to_have_text(['„Labor“ in „Laborbedarf“ zusammenlegen (40 Mails)'])
            expect(merge.get_by_role('heading', name='Überschneidungen')).to_be_focused()
            merge.get_by_role('button', name='Richtung umkehren: „Labor“ in „Laborbedarf“ zusammenlegen (40 Mails)').click()
            title = '„Laborbedarf“ in „Labor“ zusammenlegen (5 Mails)'

            # Bestätigung mit Anzahl. Abbrechen ändert nichts.
            merge.get_by_role('button', name='Zusammenlegen: ' + title).click()
            confirm = page.get_by_role('dialog').filter(has_text='alle 5 Mails aus „Laborbedarf“ nach „Labor“ verschieben')
            expect(confirm).to_contain_text('den leeren Ordner nach „_Zusammengelegt“ verschieben?')
            confirm.get_by_role('button', name='Abbrechen').click()
            assert calls('outlook_move') == [] and calls('project_move') == []
            merge.get_by_role('button', name='Zusammenlegen: ' + title).click()
            confirm.get_by_role('button', name='Zusammenlegen').click()
            status = view.locator('.setup-status')
            expect(status).to_have_text('„Laborbedarf“ in „Labor“ zusammengelegt: 5 Mails verschoben, der Ordner liegt jetzt unter „_Zusammengelegt/Laborbedarf“.')

            # Reihenfolge: Mails seitenweise lesen und verschieben, Ablageordner anlegen, leeren Ordner verschieben, alles im Schreibstapel.
            sequence = [c[0] for c in page.evaluate("calls") if c[0] in ('outlook_move', 'project_create', 'project_move')]
            assert sequence == ['outlook_move'] * 5 + ['project_create', 'project_move'], sequence
            writes = [c for c in page.evaluate("calls") if c[0] in ('outlook_move', 'project_create', 'project_move')]
            assert all(c[2] for c in writes), writes
            assert all(c[1]['source'] == '04' and c[1]['target'] == '03' for c in calls('outlook_move'))
            assert calls('project_create')[0][1] == {'parent': 'root', 'name': '_Zusammengelegt'}
            listed = {f['id']: f for f in page.evaluate("outlook.folders.map(f=>({id:f.id,path:outlook.pathOf(f),count:f.mails.length}))")}
            assert listed['04F'] == {'id': '04F', 'path': '_Zusammengelegt/Laborbedarf', 'count': 0}, listed
            assert listed['03']['count'] == 45, listed
            # Umschlüsselung: Steckbrief zieht mit dem Ordner, Ziele, Regeln und Lernbeispiele gehen an „Labor“.
            saved = options()
            assert saved['project_folders'] == ['Labor'], saved
            assert saved['suggestion_folders'] == ['Einkauf', 'Labor', 'Neu'], saved
            assert saved['filing_rules'] == [{'match': 'domain:labor.test', 'folder': 'Labor'}], saved
            assert profiles()['_Zusammengelegt/Laborbedarf'].endswith('Verbrauchsmaterial') and profiles()['Laborbedarf'] == '', profiles()
            rows = page.evaluate("JSON.parse(localStorage.getItem('outlook-kanban-ai-training-v1')).rows.map(r=>r.folder+':'+r.id)")
            assert rows == ['Labor:b0', 'Labor:l0'], rows
            expect(merge.locator('li')).to_have_count(0)
            expect(merge).to_contain_text('Keine Überschneidungen gefunden.')

            toast = page.locator('.toast')
            expect(toast).to_contain_text('„Laborbedarf“ in „Labor“ zusammengelegt')

            # Auf dem Board (jetzt mit „Labor“) eine zusammengelegte Mail verschieben und das zurücknehmen: Sie hat danach eine neue ID.
            view.get_by_role('button', name='Pausieren').click()
            page.get_by_role('button', name='Pipettenspitzen 0', exact=False).first.click()
            page.locator('#folder').select_option(label='Einkauf')
            page.locator('#moveConfirm').get_by_role('button', name='Verschieben').click()
            expect(toast).to_contain_text('Einkauf')
            page.locator('#undo').click()
            expect(toast).to_contain_text('Zurückgenommen')
            board_undo = calls('outlook_undo')
            assert len(board_undo) == 1 and board_undo[0][1]['target'] == '03', board_undo
            new_id = page.evaluate("outlook.folders.find(f=>f.id==='03').mails.find(m=>m.subject==='Pipettenspitzen 0').id")

            # Ein Rückgängig-Schritt: Ordner zurück an seinen Platz, Mails zurück (auch mit der neuen ID), Einstellungen wie vorher.
            page.locator('#undo').click()
            expect(toast).to_contain_text('rückgängig')
            page.locator('#moreTools summary').click()
            page.locator('#setupOpen').click()
            expect(merge.locator('li strong')).to_have_text([title])
            back = calls('project_move')[-1][1]
            assert back == {'folder': '04F', 'source': 'z5', 'target': 'root'}, back
            undone = calls('outlook_undo')[1:]
            assert new_id in [c[1]['id'] for c in undone], (new_id, undone)
            assert len(undone) == 5 and all(c[2] and c[1]['source'] == '03' and c[1]['target'] == '04FF' for c in undone), undone
            listed = {f['id']: f for f in page.evaluate("outlook.folders.map(f=>({id:f.id,path:outlook.pathOf(f),count:f.mails.length}))")}
            assert listed['04FF'] == {'id': '04FF', 'path': 'Laborbedarf', 'count': 5}, listed
            assert listed['03']['count'] == 40 and listed['z5']['path'] == '_Zusammengelegt', listed
            saved = options()
            assert saved['project_folders'] == ['Laborbedarf'], saved
            assert sorted(saved['suggestion_folders']) == ['Einkauf', 'Labor', 'Laborbedarf', 'Neu'], saved
            assert saved['filing_rules'] == [{'match': 'domain:labor.test', 'folder': 'Laborbedarf'}], saved
            assert profiles()['Laborbedarf'].endswith('Verbrauchsmaterial'), profiles()
            rows = page.evaluate("JSON.parse(localStorage.getItem('outlook-kanban-ai-training-v1')).rows.map(r=>r.folder+':'+r.id)")
            assert rows == ['Laborbedarf:b0', 'Labor:l0'], rows

            # Umbenennen: Vorschlag der lokalen KI. Ein vorhandener Name wird abgelehnt, der zweite Vorschlag übernommen.
            rename = view.get_by_role('region', name='Unklare Namen')
            expect(rename.locator('li strong')).to_have_text(['„Neu“'])
            rename.get_by_role('button', name='Namen vorschlagen: „Neu“').click()
            expect(status).to_contain_text('Kein brauchbarer Vorschlag („Labor“)')
            request = calls('ai_folder_name')[0][1]
            assert request['key'] == 'Neu' and request['subjects'] == ['Zentrifuge defekt', 'Wartung Zentrifuge'] and request['model'] == 'lokal', request
            rename.get_by_role('button', name='Namen vorschlagen: „Neu“').click()
            field = rename.get_by_role('textbox', name='Neuer Name für „Neu“')
            expect(field).to_have_value('Laborgeräte')
            expect(field).to_be_focused()
            rename.get_by_role('button', name='Umbenennen: „Neu“').click()
            page.get_by_role('dialog').filter(has_text='„Neu“ in „Laborgeräte“ umbenennen?').get_by_role('button', name='Umbenennen').click()
            expect(status).to_have_text('„Neu“ heißt jetzt „Laborgeräte“.')
            [renamed] = calls('project_rename')
            assert renamed[1] == {'folder': '05', 'name': 'Laborgeräte'} and renamed[2], renamed
            assert 'Laborgeräte' in options()['suggestion_folders'] and 'Neu' not in options()['suggestion_folders'], options()
            expect(rename).to_contain_text('Keine unklaren Ordnernamen.')
            expect(toast).to_contain_text('„Neu“ in „Laborgeräte“ umbenannt')

            # Teilfehler: eine Mail lässt sich nicht verschieben. Der Ordner bleibt, die Einstellungen bleiben, Rückgängig holt die vier zurück.
            before = options()
            page.evaluate("window.failMove='Pipettenspitzen 3'")
            merge.get_by_role('button', name='Zusammenlegen: ' + title).click()
            confirm.get_by_role('button', name='Zusammenlegen').click()
            expect(status).to_have_text('4 Mails verschoben, dann abgebrochen. Mit Rückgängig holst du sie zurück. „Pipettenspitzen 3“: Outlook belegt')
            assert len(calls('project_move')) == 2 and len(calls('project_create')) == 1
            counts = lambda: page.evaluate("Object.fromEntries(outlook.folders.map(f=>[outlook.pathOf(f),f.mails.length]))")
            assert counts()['Laborbedarf'] == 1 and counts()['Labor'] == 44, counts()
            assert options() == before, (options(), before)
            expect(toast).to_contain_text('4 Mails verschoben, Zusammenlegen unvollständig')

            # Teilweise gescheitertes Rückgängig: stehen lassen, dann überspringen. Der Stapel bleibt frei.
            page.evaluate("window.failMove='';window.failUndo='Pipettenspitzen 1'")
            toast.get_by_role('button', name='Rückgängig').click()
            stuck = page.get_by_role('dialog').filter(has_text='1 Mail konnte nicht nach „Laborbedarf“ zurückverschoben werden')
            expect(stuck).to_contain_text('Mail gesperrt')
            stuck.get_by_role('button', name='Abbrechen').click()
            expect(page.locator('#message')).to_have_text('Rücknahme abgebrochen. Der Schritt bleibt verfügbar.')
            assert counts()['Laborbedarf'] == 4 and counts()['Labor'] == 41, counts()
            # Im Projektdialog dieselbe Rückfrage: hier überspringen.
            page.locator('#moreTools summary').click()
            page.locator('#projectTools').click()
            tools = page.get_by_role('dialog', name='Ordner und Steckbriefe')
            expect(tools.get_by_role('status')).to_contain_text('Ordner geladen')
            tools.get_by_role('button', name='Letzte Projektänderung zurücknehmen').click()
            asked = tools.get_by_role('dialog').filter(has_text='1 Mail konnte nicht nach „Laborbedarf“ zurückverschoben werden')
            expect(asked).to_contain_text('Diesen Rückgängig-Schritt überspringen und den aktuellen Outlook-Wert behalten?')
            assert calls('outlook_undo')[-1][2], calls('outlook_undo')[-1]
            asked.get_by_role('button', name='Schritt überspringen').click()
            expect(tools.get_by_role('status')).to_have_text('Rückgängig-Schritt übersprungen.')
            tools.get_by_role('button', name='Schließen', exact=True).last.click()
            expect(tools).to_be_hidden()
            assert counts()['Laborbedarf'] == 4 and counts()['Labor'] == 41, counts()
            # Der nächste Schritt im Stapel ist wieder erreichbar: das Umbenennen.
            view.locator('h3').focus()
            page.keyboard.press('Control+z')
            expect(rename.locator('li strong')).to_have_text(['„Neu“'])
            assert calls('project_rename')[-1][1] == {'folder': '05', 'name': 'Neu'}, calls('project_rename')
            page.evaluate("window.failUndo=''")

            # Neue Ordner aus dem Posteingang: sieben Reisemails ohne Ablagevorschlag bilden eine Gruppe, zwei andere nicht.
            inbox = view.get_by_role('region', name='Neue Ordner aus dem Posteingang')
            inbox.get_by_role('button', name='Posteingang prüfen').click()
            expect(status).to_have_text('1 Gruppe gefunden.')
            expect(inbox.locator('li strong')).to_have_text(['Gruppe 1 · 7 Mails'])
            expect(inbox.locator('li small')).to_contain_text('„Reisekosten Beleg 0“')
            clustered = calls('ai_clusters')[0][1]
            assert clustered['minSize'] == 5 and clustered['threshold'] == 0.82 and len(clustered['items']) == 8 and not any('Pipetten' in i['text'] for i in clustered['items']), clustered
            assert calls('ai_cluster_name')[0][1]['subjects'][0] == 'Reisekosten Beleg 0', calls('ai_cluster_name')
            name = inbox.get_by_role('textbox', name='Name des neuen Ordners für Gruppe 1')
            expect(name).to_have_value('Reisekosten')
            expect(inbox.get_by_role('combobox', name='Elternordner für Gruppe 1')).to_have_value('root')
            name.fill('Dienstreisen')
            before_creates = len(calls('project_create'))
            inbox.get_by_role('button', name='Anlegen und verteilen: Gruppe 1').click()
            ask = page.get_by_role('dialog').filter(has_text='Ordner „Dienstreisen“ anlegen und 7 Mails aus dem Posteingang dorthin verschieben?')
            ask.get_by_role('button', name='Abbrechen').click()
            assert len(calls('project_create')) == before_creates
            inbox.get_by_role('button', name='Anlegen und verteilen: Gruppe 1').click()
            ask.get_by_role('button', name='Anlegen und verteilen').click()
            page.locator('#moveConfirm').get_by_role('button', name='Verschieben').click()
            expect(status).to_have_text('„Dienstreisen“ angelegt. 7 Mails verschoben.')
            created = calls('project_create')[-1]
            assert created[1] == {'parent': 'root', 'name': 'Dienstreisen'} and created[2], created
            target = page.evaluate("outlook.folders.find(f=>f.name==='Dienstreisen').id")
            moves = [c for c in calls('outlook_move') if c[1]['target'] == target]
            assert len(moves) == 7 and all(c[2] and c[1]['source'] == '01' for c in moves), moves
            assert 'Dienstreisen' in options()['suggestion_folders'], options()
            expect(inbox).to_contain_text('Keine Gruppen gefunden.')
            expect(toast).to_contain_text('7 Mails')
            # Ein Rückgängig-Schritt holt die Mails zurück. Der leere Ordner bleibt, nichts wird gelöscht.
            page.locator('#undo').click()
            expect(toast).to_contain_text('Zurückgenommen')
            back = [c for c in calls('outlook_undo') if c[1]['source'] == target]
            assert len(back) == 7 and all(c[1]['target'] == '01' for c in back), back
            assert page.evaluate("outlook.folders.find(f=>f.id==='01').mails.length") == 9

            # Verwerfen blendet einen Vorschlag aus, bis du ihn wieder zeigen lässt.
            crowded.get_by_role('button', name='Verwerfen: „Einkauf“').click()
            expect(crowded).to_contain_text('Keine überfüllten Lernordner.')
            view.get_by_role('button', name='Verworfene wieder zeigen (1)').click()
            expect(crowded.locator('li strong')).to_have_text(['„Einkauf“'])
            view.get_by_role('button', name='Schritt abschließen').click()
            state = page.evaluate("JSON.parse(localStorage.getItem('mailboard-setup-v1'))")
            assert state['status']['E4'] == 'done', state
            assert not errors, errors
            browser.close()
            print('OK – Struktur verfeinern: Unterteilen, Zusammenlegen mit Bestätigung und Undo, Umbenennen, neue Ordner aus dem Posteingang, Verwerfen')
    finally:
        server.shutdown()
