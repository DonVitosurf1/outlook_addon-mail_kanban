"""A3: Tabelle nach Grafikspeicher, kopierbarer ollama-pull-Befehl, kein Download."""
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
localStorage.setItem('kanban-board-options-v1', JSON.stringify({poll_seconds:0}))
localStorage.setItem('outlook-kanban-ai-settings-v1', JSON.stringify({enabled:true,model:'lokal'}))
window.calls=[]
window.__TAURI__={core:{invoke:async(name)=>{
  window.calls.push(name)
  if(name==='outlook_folders')return JSON.stringify([{id:'01',name:'Posteingang',path:'',isInbox:true}])
  if(name==='outlook_board')return '[]'
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='outlook_categories')return '[]'
  if(name==='ai_models')return ['lokal']
  if(name==='ai_model_info')return {loaded:false}
  return '[]'
}}}
"""

if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=root / 'dist')) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path=os.getenv('CHROMIUM') or shutil.which('chromium'))
                page = browser.new_page(viewport={'width': 1280, 'height': 900})
                page.add_init_script("localStorage.setItem('board.layout.intro','1')")
                page.context.grant_permissions(['clipboard-read', 'clipboard-write'])
                page.add_init_script(LIVE)
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                expect(page.locator('.foot')).to_have_text('Klassisches Outlook')
                page.locator('#moreTools summary').click()
                page.locator('#openSettings').click()
                dialog = page.locator('#settingsDialog')
                dialog.get_by_role('button', name='Lokale KI', exact=True).click()
                table = dialog.get_by_role('table', name='Modell nach Grafikspeicher')
                expect(table).to_contain_text('8 GB')
                expect(table).to_contain_text('ollama pull llama3.1:8b')
                table.get_by_role('button', name='ollama pull qwen2.5:14b').click()
                expect(dialog.locator('[role=status]').filter(has_text='Kopiert:')).to_have_text('Kopiert: ollama pull qwen2.5:14b')
                assert page.evaluate('navigator.clipboard.readText()') == 'ollama pull qwen2.5:14b'
                assert 'ollama' not in [name for name in page.evaluate('window.calls') if name.startswith('ollama') or 'pull' in name]
                shot = os.environ.get('MAILBOARD_SHOT')
                if shot:
                    page.screenshot(path=shot)
                browser.close()
        finally:
            server.shutdown()
    print('OK – Empfehlung kopiert einen ollama-pull-Befehl und lädt nichts')
