"""Ordnerunterteilung mit Fake-Outlook und Fake-Ollama nach npm run build prüfen."""
import os
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright

bootstrap = """
localStorage.setItem('outlook-kanban-ai-settings-v1', JSON.stringify({enabled:true,model:'lokal'}))
localStorage.setItem('kanban-board-options-v1', JSON.stringify({suggestion_folders:['IT/Drucker'],allow_move:true,projects_area:'IT'}))
const folders=[{id:'aa',name:'IT',parentId:'root',path:'IT'},
               {id:'bb',name:'Drucker',parentId:'aa',path:'IT/Drucker'}]
window.created=[]
window.moves=[]
window.__TAURI__={core:{invoke:async (cmd,args={})=>{
  if(cmd==='outlook_batch'){
    if(Boolean(window.batchActive)===args.active) throw Error('Fehlerhafter Stapelbeginn oder Abschluss')
    window.batchActive=args.active
    return
  }
  if(['project_create','project_move','outlook_move'].includes(cmd) && !window.batchActive) throw Error('Fehlender Schreibschutz für '+cmd)
 if(cmd==='outlook_folders')return JSON.stringify(folders)
 if(cmd==='outlook_folder')return JSON.stringify([{id:'de',folderId:'aa',sender:'IT',subject:'VPN einrichten',body:'Zugang',tags:[],attachments:[]}])
 if(cmd==='project_move'){
   const folder=folders.find(f=>f.id===args.folder),target=folders.find(f=>f.id===args.target)
   if(folder.parentId!==args.source||!target)throw Error('Ungültige Ordner für Archivierung')
   const receipt={...folder,previousName:folder.name,previousParentId:folder.parentId,parentId:target.id,path:target.path+'/'+folder.name}
   Object.assign(folder,receipt);return JSON.stringify(receipt)
 }
 if(cmd==='outlook_move'){
   window.moves.push(args)
   return JSON.stringify({id:'df',source:args.source,target:args.target})
 }
 if(cmd==='outlook_training'){
   if(args.folder!=='aa'||args.limit!==40)throw Error('Unerwartete Leseanforderung')
   return JSON.stringify([{subject:'Zugang zum VPN',body:'Bitte aktivieren'}])
 }
 if(cmd==='ai_subfolders'){
   if(args.examples[0].subject!=='Zugang zum VPN'||!args.existing.includes('Drucker'))
      throw Error('Fehlende Beispielmail oder vorhandene Ordner')
   return [{name:'Drucker',subjects:[]},{name:'Hardware',subjects:[]},
           {name:'Zugänge',subjects:['Zugang zum VPN']},{name:'Verträge',subjects:[]}]
 }
 if(cmd==='project_create'){
   if(folders.some(f=>f.name===args.name)) throw Error('Vorhandener Name')
   if(args.name==='VPN'&&!window.blockedOnce){window.blockedOnce=true;throw Error('Outlook ist beschäftigt')}
   const f={id:'cc'+folders.length,parentId:args.parent,path:'IT/'+args.name,name:args.name}
   folders.push(f);window.created.push(f.name);return JSON.stringify(f)
 }
 throw Error('Unerwarteter Aufruf '+cmd)
}}}
"""
if __name__ == "__main__":
    dist = Path(__file__).resolve().parents[1] / "dist"
    with ThreadingHTTPServer(("127.0.0.1",0), partial(SimpleHTTPRequestHandler, directory=dist)) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path=os.getenv("CHROMIUM") or shutil.which("chromium"))
                page = browser.new_page()
                page.add_init_script(bootstrap)
                page.goto(f"http://127.0.0.1:{server.server_port}")
                page.locator("#moreTools summary").click()
                page.locator("#projectTools").click()
                page.get_by_role("button", name="Unterteilung vorschlagen …").click()
                form = page.locator(".structure-dialog")
                groups = form.locator("fieldset")
                expect(groups).to_have_count(3)
                expect(form).to_contain_text("Zugang zum VPN")
                form.get_by_role("textbox", name="Name für Vorschlag 2").fill("VPN")
                groups.last.get_by_role("checkbox").uncheck()
                apply = form.get_by_role("button",name="Auswahl anlegen …")
                apply.click()
                form.get_by_role("button", name="Abbrechen").click()
                assert page.evaluate("created.length") == 0
                apply.click()
                form.get_by_role("button", name="Bestätigen").click()
                expect(form.get_by_role("status")).to_contain_text("Outlook ist beschäftigt")
                assert page.evaluate("created") == ["Hardware"]
                expect(groups.first.get_by_role("checkbox")).to_be_disabled()
                apply.click()
                form.get_by_role("button", name="Bestätigen").click()
                expect(form).to_be_hidden()
                assert page.evaluate("created") == ["Hardware","VPN"]
                targets = page.get_by_role("dialog",name="Mails aus „IT“ verteilen")
                expect(targets.get_by_label("IT/Hardware")).to_be_checked()
                expect(targets.get_by_label("IT/VPN")).to_be_checked()
                expect(targets.get_by_label("IT/Drucker")).not_to_be_checked()
                assert page.evaluate("JSON.parse(localStorage.getItem('kanban-board-options-v1')).suggestion_folders") == [
                    "IT/Drucker","IT/Hardware","IT/VPN"]
                targets.get_by_role("button",name="Vorschläge ermitteln").click()
                targets.get_by_label("VPN einrichten",exact=True).check()
                target = targets.get_by_label("Ziel für VPN einrichten")
                target.select_option(label="IT/VPN")
                targets.get_by_role("button",name="Markierte Mails verschieben").click()
                targets.get_by_role("button",name="Bestätigen").click()
                expect(targets.get_by_role("status")).to_contain_text("1 von 1 verschoben")
                assert page.evaluate("moves.length===1 && !batchActive")
                targets.get_by_role("button",name="Schließen").click()
                projects = page.get_by_role("dialog")
                projects.get_by_role("combobox").first.select_option(label="IT/VPN")
                projects.get_by_role("button",name="Projekt abschließen").click()
                page.get_by_role("button",name="Bestätigen").click()
                expect(projects.get_by_role("combobox").first).to_contain_text("IT/_Abgeschlossen/VPN")
                assert page.evaluate("!batchActive")
                browser.close()
                print("OK – Vorschau, Auswahl, Namensänderung, Abbruch, Teilfehler, Wiederholung, Ziele und Verteilung.")
        finally:
            server.shutdown()
