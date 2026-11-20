"""Projektabschluss und Rücknahme mit geänderten Ordner-IDs im Board prüfen."""
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
  {id:'cc',name:'_Abgeschlossen',path:base+'/_Abgeschlossen',parentId:'aa'}]
localStorage.setItem('kanban-board-options-v1',JSON.stringify({
  project_folders:[original], suggestion_folders:[original+'/Zubehör'],
  archive_folder:'',folder_descriptions:{[original]:'Proben'},
  filing_rules:[{match:'domain:labor.test',folder:original}]}))
localStorage.setItem('kanban-profile-edits-v1',JSON.stringify({[original]:'## Zweck\\nProben'}))
window.__TAURI__={core:{invoke:async(op,args)=>{
  if(op==='outlook_folders')return JSON.stringify(folders)
  if(op==='outlook_batch')return
  if(op==='project_move'){
    const f=folders[1],to=folders.find(x=>x.id===args.target)
    if(args.folder!==f.id || args.source!==f.parentId) throw Error('Veralteter Ordner')
    const previousParentId=f.parentId
    Object.assign(f,{id:f.id+'1',parentId:to.id,path:to.path+'/Labor'})
    return JSON.stringify({...f,previousParentId,previousName:f.name})
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
            page.locator("#moreTools summary").click()
            page.locator("#projectTools").click()
            dialog=page.locator(".project-tools")
            dialog.get_by_role("combobox").select_option("bb")
            dialog.get_by_role("button",name="Projekt abschließen").click()
            page.get_by_role("button",name="Bestätigen").click()
            expect(dialog.get_by_role("button",name="Projekt wieder öffnen")).to_be_enabled()
            options="JSON.parse(localStorage.getItem('kanban-board-options-v1'))"
            assert page.evaluate(options+".project_folders") == []
            assert page.evaluate(options+".suggestion_folders") == []
            assert page.evaluate(options+".filing_rules[0].folder") == "01 Projekte/_Abgeschlossen/Labor"
            dialog.get_by_role("button",name="Letzte Projektänderung zurücknehmen").click()
            page.wait_for_function("JSON.parse(localStorage.getItem('kanban-board-options-v1')).project_folders.length === 1")
            assert page.evaluate(options+".suggestion_folders") == ["01 Projekte/Labor/Zubehör"]
            assert page.evaluate(options+".filing_rules[0].folder") == "01 Projekte/Labor"
            assert page.evaluate("JSON.parse(localStorage.getItem('kanban-profile-edits-v1'))['01 Projekte/Labor']") == '## Zweck\nProben'
            browser.close()
            print("OK – Projektabschluss mit neuer Ordner-ID, Rücknahme, Zielauswahl, Regeln und Steckbrief.")
    finally:
        server.shutdown()
