"""Projektabschluss und Rücknahme mit geänderten Ordner-IDs im Board prüfen."""
import re
import os
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright

bootstrap = """
const base='01 Projekte', original=base+'/Labor', archived=base+'/_Abgeschlossen/Labor'
const folders=[{id:'aa',name:base,path:base,parentId:'ab'},
  {id:'bb',name:'Labor',path:original,parentId:'aa'},
  {id:'cc',name:'_Abgeschlossen',path:base+'/_Abgeschlossen',parentId:'aa'},
  {id:'dd',name:'Zubehör',path:original+'/Zubehör',parentId:'bb'}]
const mail={id:'77',folderId:'dd',subject:'Testmail im Unterordner',sender:'Labor',body:'Prüfung',folder:'Zubehör',status:'Warten',tags:[],attachments:[]}
window.calls=[]
localStorage.setItem('kanban-board-options-v1',JSON.stringify({
  project_folders:[original], suggestion_folders:[original+'/Zubehör'],
  archive_folder:'',folder_descriptions:{[original]:'Proben'},
  filing_rules:[{match:'domain:labor.test',folder:original}]}))
localStorage.setItem('kanban-profile-edits-v1',JSON.stringify({[original]:'## Zweck\\nProben'}))
window.__TAURI__={core:{invoke:async(op,args)=>{
  window.calls.push(op)
  if(op==='outlook_board')return JSON.stringify([mail])
  if(op==='outlook_categories')return '[]'
  if(op==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(op==='outlook_status'){
    if(args.id!==mail.id || args.folder!==mail.folderId || window.orphan)throw Error('Mail oder Ordner nicht mehr vorhanden. Bitte aktualisieren.')
    const previous=mail.status;mail.status=args.status
    return JSON.stringify({previous,previousSince:''})
  }
  if(op==='outlook_folders'){if(!window.connected)throw Error('Outlook ist geschlossen.');return JSON.stringify(folders)}
  if(op==='outlook_batch')return
  if(op==='project_move'||op==='project_rename'){
    const f=folders[1],child=folders[3],to=folders.find(x=>x.id===(args.target||f.parentId))
    if(args.folder!==f.id || (op==='project_move' && args.source!==f.parentId)) throw Error('Veralteter Ordner')
    const previousParentId=f.parentId,previousName=f.name,name=args.name||f.name
    Object.assign(f,{id:f.id+'1',name,parentId:to.id,path:to.path+'/'+name})
    Object.assign(child,{id:child.id+'1',parentId:f.id,path:f.path+'/'+child.name})
    mail.folderId=child.id
    return JSON.stringify({...f,previousParentId,previousName})
  }
  throw Error('Unerwartete Aktion '+op)
}}}
"""
with ThreadingHTTPServer(("127.0.0.1",0), partial(SimpleHTTPRequestHandler,
        directory=Path(__file__).resolve().parents[1]/"dist")) as server:
    Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path=os.getenv("CHROMIUM") or shutil.which("chromium"))
            page=browser.new_page()
            page.add_init_script(bootstrap)
            page.goto(f"http://127.0.0.1:{server.server_port}")
            expect(page.locator("#projectTools")).to_be_hidden()
            assert page.evaluate("""()=>{const before=calls.length; document.getElementById('projectTools').click(); return calls.length===before;}""")
            page.evaluate("window.connected=true")
            page.locator("#loadInbox").click()
            card=page.get_by_role("button",name="Testmail im Unterordner",exact=False).first
            card.click()
            page.locator("#status").select_option("In Bearbeitung")
            expect(page.locator(".toast")).to_contain_text(re.compile("^(Nach „|Status auf|Kategorien|Notiz|Nachfassen|Wiedervorlage|Fokus)"))
            page.locator("#moreTools summary").click()
            page.locator("#projectTools").click()
            dialog=page.locator(".project-tools")
            dialog.get_by_role("combobox").select_option("bb")
            dialog.get_by_label("Neuer Name").fill("Labor 2")
            dialog.get_by_role("button",name="Ordner umbenennen").click()
            page.get_by_role("button",name="Bestätigen").click()
            expect(dialog.get_by_role("combobox")).to_have_value("bb1")
            dialog.get_by_role("button",name="Projekt abschließen").click()
            page.get_by_role("button",name="Bestätigen").click()
            expect(dialog.get_by_role("button",name="Projekt wieder öffnen")).to_be_enabled()
            options="JSON.parse(localStorage.getItem('kanban-board-options-v1'))"
            assert page.evaluate(options+".project_folders") == []
            assert page.evaluate(options+".suggestion_folders") == []
            assert page.evaluate(options+".filing_rules[0].folder") == "01 Projekte/_Abgeschlossen/Labor 2"
            dialog.get_by_role("button",name="Letzte Projektänderung zurücknehmen").click()
            page.wait_for_function("JSON.parse(localStorage.getItem('kanban-board-options-v1')).project_folders.length === 1")
            expect(dialog.locator('option[value="bb111"]')).to_have_count(1)
            dialog.get_by_role("button",name="Letzte Projektänderung zurücknehmen").click()
            expect(dialog.get_by_role("combobox")).to_contain_text("01 Projekte/Labor")
            page.wait_for_function("JSON.parse(localStorage.getItem('kanban-board-options-v1')).filing_rules[0].folder==='01 Projekte/Labor'")
            assert page.evaluate(options+".suggestion_folders") == ["01 Projekte/Labor/Zubehör"]
            assert page.evaluate(options+".filing_rules[0].folder") == "01 Projekte/Labor"
            assert page.evaluate("JSON.parse(localStorage.getItem('kanban-profile-edits-v1'))['01 Projekte/Labor']") == '## Zweck\nProben'
            dialog.get_by_role("button",name="Schließen",exact=True).click()
            page.evaluate("window.orphan=true")
            page.locator("#undo").click()
            expect(page.locator("#message")).to_contain_text("nicht eindeutig zuordnen")
            expect(page.locator("#undo")).to_be_enabled()
            page.evaluate("window.orphan=false")
            page.locator("#undo").click()
            expect(page.locator(".toast")).to_contain_text(re.compile("Zurückgenommen|rückgängig"))
            if not page.locator("#backDemo").is_visible():page.locator("#moreTools summary").click()
            page.locator("#backDemo").click()
            calls=page.evaluate("calls.length")
            page.evaluate("document.getElementById('projectTools').click()")
            assert page.evaluate("calls.length") == calls
            expect(page.locator("#projectTools")).to_be_hidden()
            browser.close()
            print("OK – Projektabschluss mit neuer Ordner-ID, Rücknahme, Zielauswahl, Regeln und Steckbrief.")
    finally:
        server.shutdown()
