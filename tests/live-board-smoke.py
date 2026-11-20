"""Mit installiertem Playwright und Chromium nach npm run build ausführen."""
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
localStorage.setItem('kanban-board-options-v1', JSON.stringify({project_folders:['Einkauf'],archive_folder:'Archiv',allow_move:true, poll_seconds:0}))
const folders = [{id:'01',name:'Posteingang',path:'',isInbox:true},{id:'02',name:'Einkauf',path:'Einkauf'},{id:'03',name:'Archiv',path:'Archiv'}]
let mail={id:'aa',folderId:'01',folder:'Posteingang',status:'Offen',subject:'Einkauf Rechnung',sender:'Anna',body:'Einkauf',tags:[],attachments:[]}
window.ageDone=()=>{mail={...mail,status:'Erledigt',statusSince:'2023-02-10T11:00:00Z'}}
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
    mail={...mail,status:args.status,statusSince:args.since??new Date().toISOString()}
    window.currentMail=mail
    return JSON.stringify({previous,previousSince})
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
        expect(page.locator(".card")).to_have_count(14)
        page.locator("#loadInbox").click()
        card = page.locator(".card").filter(has_text="Einkauf Rechnung")
        expect(card).to_have_count(1)
        card.click()
        page.locator("#suggestFolder").click()
        accept = page.locator("#applySuggestion")
        expect(accept).to_contain_text("Einkauf")
        accept.click()
        page.locator('#moveConfirm button[value="cancel"]').click()
        assert page.evaluate("!calls.includes('outlook_move')")
        page.locator("#suggestFolder").click()
        accept.click()
        page.locator('#moveConfirm button[value="confirm"]').click()
        expect(page.locator("#message")).to_contain_text("1 von 1")
        assert page.evaluate("currentMail.folderId==='02'")
        page.locator("#loadInbox").click()
        expect(page.locator("#loadInbox")).to_be_enabled()
        page.evaluate("window.blockWrites=true")
        page.locator("#undo").click()
        expect(page.locator("#message")).to_contain_text("Outlook beschäftigt")
        expect(page.locator("#undo")).to_be_enabled()
        page.evaluate("window.blockWrites=false")
        page.keyboard.press("Control+z")
        expect(page.locator("#message")).to_contain_text("rückgängig")
        assert page.evaluate("currentMail.folderId==='01' && currentMail.id!=='aa'")
        card.click()
        page.locator("#status").select_option("Erledigt")
        expect(page.locator("#moveQuestion")).to_contain_text("Archiv")
        page.locator('#moveConfirm button[value="confirm"]').click()
        expect(page.locator("#message")).to_contain_text("1 von 1")
        assert page.evaluate("currentMail.folderId==='03' && currentMail.status==='Erledigt'")
        page.keyboard.press("Control+z")
        expect(page.locator("#message")).to_contain_text("rückgängig")
        assert page.evaluate("currentMail.folderId==='01' && currentMail.status==='Offen' && currentMail.statusSince===''")
        page.evaluate("window.ageDone()")
        page.locator("#loadInbox").click()
        older=page.locator("#archiveDone")
        expect(older).to_contain_text("1 Erledigte")
        older.click()
        page.locator('#moveConfirm button[value="confirm"]').click()
        expect(page.locator("#message")).to_contain_text("1 von 1")
        assert page.evaluate("currentMail.folderId==='03'")
        page.keyboard.press("Control+z")
        expect(page.locator("#message")).to_contain_text("rückgängig")
        assert page.evaluate("currentMail.folderId==='01' && currentMail.statusSince.startsWith('2023-')")
        page.locator("#backDemo").click()
        expect(page.locator(".card")).to_have_count(14)
        assert not errors, errors
        print("OK: Outlook laden, lokale Empfehlung, Abbrechen, Verschieben, Aktualisieren, fehlgeschlagenes Undo, erfolgreicher Wiederholungsversuch mit neuer ID, Erledigt mit Archiv und Altersarchivierung mit Undo.")
        browser.close()
finally:
    server.shutdown()
