"""B1 Rückmeldungen: Ablagevorschlag übernehmen oder verwerfen zählt, „passt / passt nicht“ zählt und lässt sich
zurücknehmen, ein geöffneter Antwortentwurf zählt seinen Änderungsgrad. Gespeichert werden nur Zahlen, im
Beispielpostfach gar nichts."""
import datetime as dt
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
localStorage.setItem('kanban-board-options-v1', JSON.stringify({poll_seconds:0,project_folders:['Labor','Einkauf'],allow_move:true}))
localStorage.setItem('outlook-kanban-ai-settings-v1',JSON.stringify({enabled:true,auto:true,model:'hinter'}))
localStorage.setItem('outlook-kanban-ai-rules-v1',JSON.stringify({items:[{match:'domain:labor.de',folder:'Labor'}]}))
const folders=[{id:'01',name:'Posteingang',path:'',isInbox:true},{id:'02',name:'Labor',path:'Labor'},{id:'03',name:'Einkauf',path:'Einkauf'}]
window.store=[
  {id:'a1',folderId:'01',folder:'Posteingang',status:'Offen',subject:'Messwerte Charge 12',sender:'Anna',senderEmail:'anna@labor.de',body:'Geheimer Inhalt der Messung.',received:'2026-11-20T08:00:00',tags:[],attachments:[]},
  {id:'a2',folderId:'01',folder:'Posteingang',status:'Offen',subject:'Kantinenplan',sender:'Bernd',senderEmail:'bernd@labor.de',body:'Speiseplan der Woche.',received:'2026-11-21T08:00:00',tags:[],attachments:[]},
  {id:'a3',folderId:'01',folder:'Posteingang',status:'Offen',subject:'Rechnung Zentrifuge',sender:'Carl',senderEmail:'carl@labor.de',body:'Rechnung anbei.',received:'2026-11-22T08:00:00',tags:[],attachments:[]},
]
let sequence=100
window.__TAURI__={core:{invoke:async(name,args={})=>{
  if(name==='outlook_batch')return
  if(name==='outlook_categories')return '[]'
  if(name==='outlook_folders')return JSON.stringify(folders)
  if(name==='outlook_board')return JSON.stringify(window.store)
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='outlook_move'){
    const mail=window.store.find(m=>m.id===args.id);const id='m'+(++sequence)
    Object.assign(mail,{id,folderId:args.target,folder:folders.find(f=>f.id===args.target).name})
    return JSON.stringify({id,source:args.source,target:args.target})
  }
  if(name==='outlook_draft'){window.drafted=args.text;return}
  if(name==='ai_models')return ['hinter']
  if(name==='ai_analyze')return {zusammenfassung:'Neue Messwerte',antwort_noetig:true,frist:'2026-11-27',ordner:null,arten:[],aufgaben:[]}
  if(name==='ai_reply')return 'Guten Tag, vielen Dank für die Messwerte der Charge. Ich prüfe sie bis Freitag. Viele Grüße'
  throw Error('Unerwarteter Befehl: '+name)
}}}
"""


def today(page):
    raw = page.evaluate("localStorage.getItem('mailboard-ai-feedback-v1')")
    return json.loads(raw or '{}').get(dt.date.today().isoformat(), {})


def live(browser, base):
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    page.add_init_script("localStorage.setItem('board.layout.intro','1')")
    page.add_init_script(LIVE)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base)
    page.locator('#loadInbox').click()
    expect(page.locator('#mail-a1')).to_contain_text('Neue Messwerte')
    page.locator('#mail-a1').click()

    # „passt nicht“ zählt, ein zweiter Klick nimmt die Stimme zurück.
    wrong = page.get_by_role('button', name='Zusammenfassung passt nicht')
    right = page.get_by_role('button', name='Zusammenfassung passt', exact=True)
    expect(wrong).to_have_attribute('aria-pressed', 'false')
    wrong.click()
    expect(wrong).to_have_attribute('aria-pressed', 'true')
    assert today(page) == {'zusammenfassung': {'hinter': {'bad': 1}}}, today(page)
    right.click()
    expect(right).to_have_attribute('aria-pressed', 'true')
    expect(wrong).to_have_attribute('aria-pressed', 'false')
    assert today(page) == {'zusammenfassung': {'hinter': {'ok': 1}}}, today(page)
    right.click()
    expect(right).to_have_attribute('aria-pressed', 'false')
    assert today(page) == {}, today(page)
    page.get_by_role('button', name='Frist passt', exact=True).click()
    page.get_by_role('button', name='„Antwort nötig“ passt nicht').click()
    expect(page.get_by_role('group', name='Rückmeldung: Frist')).to_be_visible()

    # Ein leicht geänderter Antwortentwurf zählt beim Öffnen in Outlook.
    page.get_by_role('button', name='KI-Antwort entwerfen').click()
    text = page.get_by_label('KI-Antwort vor dem Öffnen bearbeiten')
    expect(text).not_to_have_value('')
    text.fill(text.input_value().replace('Freitag', 'Montag'))
    page.get_by_role('button', name='Als Entwurf in Outlook öffnen').click()
    expect(page.locator('#notice, .toast, [role=status]').filter(has_text='Entwurf in Outlook geöffnet.').first).to_be_visible()
    assert today(page)['antwortentwurf'] == {'hinter': {'light': 1, 'ok': 1}}, today(page)

    # Ablagevorschlag übernommen: ein Treffer für die Quelle „Regel“.
    page.locator('#suggestFolder').click()
    expect(page.locator('#suggestionResult')).to_have_text('Domain-Regel')
    page.locator('#applySuggestion').click()
    page.locator('#moveConfirm button[value="confirm"]').click()
    expect(page.locator('.toast')).to_contain_text('Labor')
    assert today(page)['ablage:Regel'] == {'-': {'ok': 1}}, today(page)

    # Zweite Mail: „Unpassend“ zählt als Fehlgriff derselben Quelle.
    page.keyboard.press('Escape')
    page.locator('#mail-a2').click()
    page.locator('#suggestFolder').click()
    expect(page.locator('#suggestionResult')).to_have_text('Domain-Regel')
    page.get_by_role('button', name='Unpassend').click()
    assert today(page)['ablage:Regel'] == {'-': {'ok': 1, 'bad': 1}}, today(page)
    assert today(page)['frist'] == {'hinter': {'ok': 1}} and today(page)['antwort_noetig'] == {'hinter': {'bad': 1}}

    # Dritte Mail: Der Kartenhinweis („Labor“) zählt auch ohne Anfrage. Abgelegt in einen anderen Lernordner ist ein Fehlgriff.
    page.keyboard.press('Escape')
    expect(page.locator('#mail-a3')).to_contain_text('Labor')
    page.locator('#mail-a3').drag_to(page.locator('#folders button', has_text='Einkauf'))
    page.locator('#moveConfirm button[value="confirm"]').click()
    expect(page.locator('.toast')).to_contain_text('Einkauf')
    assert today(page)['ablage:Regel'] == {'-': {'ok': 1, 'bad': 2}}, today(page)
    # Die Quellenstatistik zählt nur ausdrücklich angeforderte Vorschläge (a1 übernommen, a2 verworfen).
    sources = json.loads(page.evaluate("localStorage.getItem('outlook-kanban-ai-statistics-v1')"))['sources']
    assert sources == {'Domain-Regel': {'correct': 1, 'wrong': 1}}, sources

    # Nur Zahlen: kein Betreff, Absender, Text oder Mail-Kennung im Speicher.
    stored = page.evaluate("localStorage.getItem('mailboard-ai-feedback-v1')")
    for secret in ['Messwerte', 'Anna', 'anna@labor.de', 'Geheimer', 'a1', 'Kantinenplan', 'Montag']:
        assert secret not in stored, (secret, stored)
    votes = page.evaluate("localStorage.getItem('mailboard-ai-votes-v1')")
    assert 'Messwerte' not in votes and 'a1' not in votes, votes
    assert not errors, errors
    page.close()


def sample(browser, base):
    """Im Beispielpostfach bleiben Rückmeldungen im Speicher."""
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    page.add_init_script("localStorage.setItem('board.layout.intro','1')")
    page.goto(base)
    page.locator('#moreTools summary').click()
    page.locator('#backDemo').click()
    expect(page.locator('.foot')).to_have_text('Beispielpostfach')
    page.locator('#mail-DEMO0000').click()
    page.locator('#folder').select_option('Posteingang')
    expect(page.locator('#mail-DEMO0000')).to_be_visible()
    page.locator('#suggestFolder').click()
    expect(page.locator('#suggestionResult')).to_have_text('Begriff aus dem Beispielordner')
    page.locator('#applySuggestion').click()
    expect(page.locator('.toast')).to_contain_text('Pipettenspitzen')
    assert page.evaluate("localStorage.getItem('mailboard-ai-feedback-v1')") is None
    assert page.evaluate("localStorage.getItem('mailboard-ai-votes-v1')") is None
    page.close()


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=root / 'dist')) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path=os.getenv('CHROMIUM') or shutil.which('chromium'))
                base = f'http://127.0.0.1:{server.server_port}/'
                live(browser, base)
                sample(browser, base)
                browser.close()
        finally:
            server.shutdown()
    print('OK – Rückmeldungen: Ablage, passt / passt nicht, Antwortentwurf, Beispielpostfach ohne Speicher')
