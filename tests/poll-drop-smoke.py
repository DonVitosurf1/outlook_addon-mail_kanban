"""Regressionstest für Hintergrundlesen, Kartenfokus und den kombinierten Ordner-/Status-Drop."""
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright


root = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=root / "dist"))
Thread(target=server.serve_forever, daemon=True).start()
bootstrap = """
localStorage.setItem('kanban-board-options-v1', JSON.stringify({
  project_folders:['Labor'],allow_move:true,poll_seconds:5
}))
const folders=[{id:'01',name:'Posteingang',path:'',isInbox:true},{id:'02',name:'Labor',path:'Labor'}]
const make=(id,folderId,status,hasStatus=true)=>({
  id,folderId,folder:folders.find(f=>f.id===folderId).name,status,hasStatus,subject:'Projekt '+id,
  sender:'Muster',received:'2026-11-20T10:00:00Z',body:'Kurztext',tags:[],attachments:[]
})
let rows=[make('aa','01','Offen',false),make('ab','01','Offen',false),make('bb','02','Warten'),
          ...Array.from({length:30},(_,i)=>make('f'+i,'01','Offen'))]
window.addIncoming=id=>rows.push(make(id,'01','Offen'))
window.writes=[]
window.reads=0
let seq=0
window.__TAURI__={core:{invoke:async(name,args={})=>{
  if(name==='outlook_folders')return JSON.stringify(folders)
  if(name==='outlook_board'){
    reads++
    const snapshot=JSON.stringify(rows.filter(row=>row.folderId==='01'||row.hasStatus))
    if(window.holdRead){
      window.holdRead=false
      await new Promise(resolve=>window.resumeRead=resolve)
    }
    return snapshot
  }
  if(name==='outlook_folder')return JSON.stringify(rows.filter(row=>row.folderId===args.folder))
  if(name==='outlook_categories')return '[]'
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='outlook_connect'||name==='outlook_prefix'||name==='outlook_batch')return '{}'
  if(name==='outlook_move'||name==='outlook_undo'){
    const row=rows.find(x=>x.id===args.id&&x.folderId===args.source)
    if(!row)throw Error('Veraltete EntryID')
    rows=rows.filter(x=>x!==row)
    const id='d'+(++seq)
    rows.push({...row,id,folderId:args.target,folder:folders.find(x=>x.id===args.target).name})
    writes.push([name,args.id,args.target])
    return JSON.stringify({id,source:args.source,target:args.target})
  }
  if(name==='outlook_status'){
    const row=rows.find(x=>x.id===args.id&&x.folderId===args.folder)
    if(!row)throw Error('Status mit falscher ID oder falschem Zielordner')
    const previous=row.hasStatus?row.status:''
    row.status=args.status||'Offen'
    row.hasStatus=!!args.status
    writes.push([name,args.id,args.folder,args.status])
    return JSON.stringify({previous})
  }
  throw Error('Unerwarteter Befehl: '+name)
}}}
"""


def drop(page, card, folder):
    transfer = page.evaluate_handle("new DataTransfer()")
    page.dispatch_event(card, "dragstart", {"dataTransfer": transfer})
    page.locator(f'.group-cell[data-folder="{folder}"][data-status="Offen"]').dispatch_event(
        "drop", {"dataTransfer": transfer}
    )


try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=shutil.which("chromium"))
        page = browser.new_page(viewport={"width": 960, "height": 620})
        page.clock.install()
        page.add_init_script(bootstrap)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(f"http://127.0.0.1:{server.server_port}/")
        expect(page.locator("#mail-aa")).to_be_attached()
        search = page.locator("#search")
        search.fill("Projekt")
        search.evaluate("(node)=>node.setSelectionRange(2,4)")
        page.evaluate("addIncoming('ac')")
        page.clock.fast_forward(5100)
        expect(page.locator("#mail-ac")).to_be_attached()
        expect(search).to_be_focused()
        assert search.evaluate("n=>[n.value,n.selectionStart,n.selectionEnd]") == ["Projekt",2,4]

        page.locator("#mail-aa").click(modifiers=["Control"])
        focused = page.locator("#mail-ab")
        focused.click(modifiers=["Control"])
        focused.focus()
        board = page.locator("#board")
        position = board.evaluate("n=>{n.scrollTop=300;n.scrollLeft=75;return [n.scrollTop,n.scrollLeft]}")
        assert position[0] == 300
        page.evaluate("addIncoming('ae')")
        page.clock.fast_forward(5100)
        expect(page.locator("#mail-ae")).to_be_attached()
        expect(focused).to_be_focused()
        expect(focused).to_have_attribute("aria-pressed","true")
        expect(page.locator("#mail-aa")).to_have_attribute("aria-pressed","true")
        expect(page.locator(".selection-count")).to_have_text("2 markiert")
        assert board.evaluate("n=>[n.scrollTop,n.scrollLeft]") == position
        expect(search).to_have_value("Projekt")

        expect(page.locator(".selection-count")).to_be_visible()
        expect(page.locator("#viewControls")).to_be_hidden()
        view_trigger=page.locator("#viewMenu summary")
        view_trigger.click()
        group_by=page.get_by_label("Gruppierung",exact=True)
        group_by.select_option("folder")
        group_by.focus()
        page.keyboard.press("Escape")
        expect(view_trigger).to_be_focused()
        expect(page.locator("#viewControls")).to_be_hidden()
        expect(view_trigger).to_have_accessible_name("Ansicht · 1")
        drop(page,"#mail-aa","01")
        expect(page.locator("#message")).to_contain_text("1 von 1")
        assert page.evaluate("writes") == [["outlook_status","aa","01","Offen"]]
        page.locator("#undo").click()
        expect(page.locator("#message")).to_contain_text("rückgängig")
        drop(page,"#mail-ab","02")
        page.locator('#moveConfirm button[value="confirm"]').click()
        expect(page.locator('.group-cell[data-folder="02"][data-status="Offen"] #mail-d1')).to_be_attached()
        assert page.evaluate("writes.slice(-2)") == [
            ["outlook_move","ab","02"], ["outlook_status","d1","02","Offen"]
        ]
        page.locator("#undo").click()
        expect(page.locator('.group-cell[data-folder="01"][data-status="Offen"] #mail-d2')).to_be_attached()
        assert page.evaluate("writes.slice(-2)") == [
            ["outlook_status","d1","02",""], ["outlook_undo","d1","01"]
        ]
        page.evaluate("window.holdRead=true")
        page.clock.fast_forward(5100)
        page.wait_for_function("typeof resumeRead==='function'")
        page.locator('#folders').get_by_role('button',name='Labor').click()
        expect(page.locator('#title')).to_contain_text('Labor')
        expect(page.locator('#mail-d2')).to_have_count(0)
        page.evaluate("resumeRead()")
        expect(page.locator('#mail-d2')).to_have_count(0)
        expect(page.locator('#summary')).to_have_text('1 von 1 Mails')
        assert not errors, errors
        print("OK: Polling mit Fokus, Texteingabe, Mehrfachauswahl und Scrollposition; expliziter Offen-Status nach beiden Gruppendrops und Undo.")
        browser.close()
finally:
    server.shutdown()
