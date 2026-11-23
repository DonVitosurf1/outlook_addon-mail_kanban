"""Mit installiertem Playwright und Chromium nach npm run build ausführen."""
import re
import os
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=root / "dist"))
Thread(target=server.serve_forever, daemon=True).start()
bootstrap = """
localStorage.setItem('kanban-board-options-v1', JSON.stringify({project_folders:['Einkauf'],archive_folder:'Archiv',poll_seconds:0}))
const folders = [{id:'01',name:'Posteingang',path:'',isInbox:true},{id:'02',name:'Einkauf',path:'Einkauf'},{id:'03',name:'Archiv',path:'Archiv'}]
let mail={id:'aa',folderId:'01',folder:'Posteingang',status:'Offen',subject:'Einkauf Rechnung',sender:'Anna',body:'Einkauf',tags:[],attachments:[]}
window.ageDone=()=>{mail={...mail,status:'Erledigt',statusSince:'2023-02-10T11:00:00Z'}}
window.editInOutlook=()=>{mail={...mail,statusSince:'2026-01-15T12:00:00Z'};window.currentMail=mail}
let sequence=170
window.calls=[]
window.__TAURI__={core:{invoke:async(name,args={})=>{
  window.calls.push(name)
  if(name==='outlook_batch'){
    if(Boolean(window.batchActive)===args.active) throw Error('Fehlerhafter Stapelbeginn oder Abschluss')
    window.batchActive=args.active
    return
  }
  if(['outlook_move', 'outlook_status', 'outlook_undo'].includes(name) && !window.batchActive) throw Error('Fehlender Schreibschutz für '+name)
  if(name==='outlook_categories')return '[]'
  if(name==='outlook_status'){
    if(mail.id!==args.id || mail.folderId!==args.folder)throw Error('Status im falschen Ordner')
    const previous=mail.status,previousSince=mail.statusSince||''
    if(args.expected!=null && (args.expected!==previous || (args.expectedSince!=null && args.expectedSince!==previousSince))) return JSON.stringify({conflict:true})
    mail={...mail,status:args.status,statusSince:args.since??new Date().toISOString()}
    window.currentMail=mail
    return JSON.stringify({previous,previousSince,statusSince:mail.statusSince})
  }
  if(name==='outlook_folders') return JSON.stringify(folders)
  if(name==='outlook_board')return JSON.stringify([mail])
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='outlook_folder')return JSON.stringify(mail.folderId===args.folder?[mail]:[])
  if(name==='outlook_move'||name==='outlook_undo'){
    if(mail.id!==args.id || mail.folderId!==args.source) throw Error('ID oder Quellordner veraltet')
    if(window.blockWrites) throw Error('Outlook beschäftigt')
    const id=(++sequence).toString(16)
    mail={...mail,id,folderId:args.target,folder:folders.find(f=>f.id===args.target).name}
    window.currentMail=mail
    return JSON.stringify({id,source:args.source,target:args.target})
  }
  throw Error('Unerwarteter Befehl: '+name)
}}}
"""
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.getenv("CHROMIUM") or shutil.which("chromium"))
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.add_init_script(bootstrap)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(f"http://127.0.0.1:{server.server_port}/")
        expect(page.locator(".foot")).to_have_text("Klassisches Outlook")
        expect(page.locator(".focus-section h2")).to_have_text("Ansichten")
        expect(page.locator("#focusViews button", has_text="Fokus")).to_have_count(1)
        card = page.locator(".card").filter(has_text="Einkauf Rechnung")
        card.click()
        # Auch das Archivieren beim Erledigen fragt zuerst nach der Freigabe.
        page.locator("#status").select_option("Erledigt")
        expect(page.locator("#moveQuestion")).to_contain_text("Jetzt erlauben und „Einkauf Rechnung“ als erledigt markieren")
        expect(page.locator("#moveQuestion")).to_contain_text("Archiv")
        page.locator('#moveConfirm button[value="cancel"]').click()
        assert page.evaluate("!calls.includes('outlook_status')")
        page.locator("#suggestFolder").click()
        accept = page.locator("#applySuggestion")
        accept.click()
        # Ohne Freigabe fragt der Dialog statt eines Fehlers.
        expect(page.locator("#moveQuestion")).to_contain_text("Das Board darf noch keine Mails in Outlook verschieben. Jetzt erlauben und „Einkauf Rechnung“ nach „Einkauf“ verschieben?")
        expect(page.locator("#moveConfirmOk")).to_have_text("Erlauben und verschieben")
        page.locator('#moveConfirm button[value="cancel"]').click()
        assert page.evaluate("!calls.includes('outlook_move')")
        assert page.evaluate("JSON.parse(localStorage.getItem('kanban-board-options-v1')).allow_move!==true")
        expect(page.locator("#moveConfirmOk")).to_have_text("Verschieben")
        # Erlauben verschiebt und setzt allow_move samt Einstellungs-Checkbox.
        page.locator("#suggestFolder").click()
        accept.click()
        page.locator('#moveConfirm button[value="confirm"]').click()
        expect(page.locator(".toast")).to_contain_text(re.compile("^(Nach „|Status auf|Kategorien|Notiz|Nachfassen|Wiedervorlage|Fokus)"))
        assert page.evaluate("currentMail.folderId==='02'")
        assert page.evaluate("JSON.parse(localStorage.getItem('kanban-board-options-v1')).allow_move===true")
        assert page.evaluate("document.querySelector('#allowMove').checked")
        expect(page.locator("#moveConfirmOk")).to_have_text("Verschieben")
        # Danach fragt der Dialog wie gewohnt ohne Freigabetext.
        page.keyboard.press("Control+z")
        expect(page.locator(".toast")).to_contain_text(re.compile("Zurückgenommen|rückgängig"))
        card.click()
        page.locator("#suggestFolder").click()
        accept.click()
        expect(page.locator("#moveQuestion")).not_to_contain_text("Jetzt erlauben")
        page.locator('#moveConfirm button[value="cancel"]').click()
        assert not errors, errors
        print("OK: Freigabedialog beim ersten Verschieben, Abbrechen ändert nichts, Erlauben verschiebt und setzt allow_move, Seitenleiste „Ansichten“.")
        browser.close()
finally:
    server.shutdown()
