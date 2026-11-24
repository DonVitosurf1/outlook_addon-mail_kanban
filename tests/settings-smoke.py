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
localStorage.setItem('kanban-board-options-v1', JSON.stringify({poll_seconds:0}))
localStorage.setItem('outlook-kanban-ai-settings-v1', JSON.stringify({enabled:true,url:'http://127.0.0.1:11434',model:'',embedModel:'qwen3-embedding:0.6b'}))
window.calls=[]
window.__TAURI__={core:{invoke:async(name,args={})=>{
  window.calls.push(name)
  if(name==='outlook_folders')return JSON.stringify([{id:'01',name:'Posteingang',path:'',isInbox:true}])
  if(name==='outlook_board')return JSON.stringify([])
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='outlook_categories')return '[]'
  if(name==='ai_models')return ['embed-x','qwen3-embedding:0.6b','llama3:8b']
  if(name==='ai_model_info'){window.infoArgs=(window.infoArgs||[]).concat([args]);return args.model==='llama3:8b'?{parameters:8030261248,quantization:'Q4_K_M',context:8192,loaded:true,size:1,gpu:1}:{parameters:6e8,quantization:'Q8_0',context:32768,loaded:false}}
  if(name==='ai_analyze'){await new Promise(r=>setTimeout(r,60));return {zusammenfassung:'x',antwort_noetig:true,arten:[],ordner:null,frist:null}}
  return '[]'
}}}
"""
try:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=os.getenv("CHROMIUM") or shutil.which("chromium"))
        base = f"http://127.0.0.1:{server.server_port}/"
        page = browser.new_page(viewport={"width": 1280, "height": 500})
        page.add_init_script("localStorage.setItem('board.layout.intro','1')")
        page.add_init_script(bootstrap)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(base)
        expect(page.locator(".foot")).to_have_text("Klassisches Outlook")
        page.locator("#moreTools summary").click()
        page.locator("#openSettings").click()
        dialog = page.locator("#settingsDialog")
        for title in ["Outlook", "Board", "Lokale KI", "Lernen", "Darstellung"]:
            expect(dialog.get_by_role("heading", name=title, exact=True)).to_be_visible()
        expect(dialog.get_by_role("button", name="VIP-Liste bearbeiten …")).to_have_count(1)
        assert dialog.locator("#settings-board #editVip").count() == 1
        assert dialog.locator("#settings-darstellung").get_by_label("Kompakte Karten").count() == 1
        assert dialog.locator("#settings-lernen").get_by_label("Lernordner stündlich aktualisieren").count() == 1
        hint = dialog.get_by_label("Geladene Outlook-Mails im Hintergrund analysieren")
        assert "Belastet Rechner" in page.locator("#" + hint.get_attribute("aria-describedby")).inner_text()
        expect(dialog.get_by_role("navigation", name="Abschnitte der Einstellungen")).to_be_visible()
        # A1: Modellangaben beim Öffnen und nach einem Modellwechsel, nur mit dem Modellnamen.
        embed_info = page.locator("#" + dialog.get_by_label("Embedding-Modell").get_attribute("aria-describedby"))
        expect(embed_info).to_have_text("600 M · Q8_0 · 32.768 Token · noch nicht geladen")
        chat = dialog.get_by_label("Modell für Hintergrund", exact=True)
        chat_info = page.locator("#" + chat.get_attribute("aria-describedby"))
        expect(chat_info).to_have_text("")
        chat.fill("llama3:8b")
        chat.dispatch_event("change")
        expect(chat_info).to_have_text("8 B · Q4_K_M · 8.192 Token · GPU")
        assert page.evaluate("window.infoArgs.map(a=>Object.keys(a).sort().join(','))") == ["model,url"] * 2
        chat.fill("")
        chat.dispatch_event("change")
        expect(chat_info).to_have_text("")
        dialog.get_by_role("navigation").get_by_role("button", name="Darstellung").click()
        expect(dialog.get_by_role("heading", name="Darstellung")).to_be_focused()
        dialog.get_by_role("button", name="Verbindung testen").click()
        out = dialog.locator("[role=status]").filter(has_text="Antwortzeit")
        expect(out).to_contain_text("Hintergrundmodell: llama3:8b")
        expect(out).to_contain_text("Entwurfsmodell: wie Hintergrund")
        expect(out).to_contain_text("vorhanden")
        expect(out).to_contain_text(" s")
        # Einstellungen überleben ein erneutes Aufbauen des KI-Bereichs.
        assert dialog.locator("h3").count() == 5
        assert not errors, errors
        page.close()
        demo = browser.new_page(viewport={"width": 1280, "height": 800})
        demo.add_init_script("localStorage.setItem('board.layout.intro','1')")
        demo.goto(base)
        expect(demo.locator("#openSettings")).to_be_hidden()
        browser.close()
    print("OK – Einstellungen: Abschnitte, Hinweise und Verbindungstest")
finally:
    server.shutdown()
