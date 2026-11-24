"""Morgen-Triage auf dem Board, Fokus-Taste F, Routinen, Wochenkalender und Vorgänge gegen das gebaute Demo-Board prüfen."""
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


def lane(page, index):
    return page.locator('#board .lane').nth(index)


def check_focus(page):
    page.locator('#mail-DEMO0000').click(modifiers=['Control'])
    page.keyboard.press('f')
    # Der Fokus erscheint als Kennzeichen-Pille über dem Betreff, nicht zusätzlich als Kategorie-Chip.
    expect(page.locator('#mail-DEMO0000 .card-flags .flag-focus')).to_have_text('Fokus')
    expect(page.locator('#mail-DEMO0000 .card-chip', has_text='Fokus')).to_have_count(0)
    focus = page.locator('#focusViews button', has_text='Fokus')
    expect(focus).to_have_text('Fokus · 1')
    # Gemischte Auswahl: F setzt den Fokus für alle, ein zweites F löst ihn für alle. Beides ist rücknehmbar.
    page.locator('#mail-DEMO0001').click(modifiers=['Control'])
    page.locator('#mail-DEMO0001').focus()
    page.keyboard.press('f')
    expect(focus).to_have_text('Fokus · 2')
    focus.click()
    expect(page.locator('#board .card')).to_have_count(2)
    page.locator('#undo').click()
    expect(focus).to_have_text('Fokus · 1')
    page.locator('#focusViews button', has_text='Alle aktiven').click()


def check_triage(page):
    page.locator('#search').fill('Raum')
    expect(page.locator('#summary')).to_have_text('1 von 14 Mails')
    page.locator('#search').blur()
    page.keyboard.press('Control+t')
    banner = page.get_by_role('region', name='Morgen-Triage')
    expect(banner.get_by_role('heading', name='Heute dran')).to_be_visible()
    expect(page.locator('#search')).to_have_value('')
    # Nur die fällige Wartende steht im ersten Schritt. Erledigen nimmt sie heraus.
    expect(page.locator('#board .card')).to_have_count(1)
    expect(banner).to_contain_text('1 Karte in diesem Schritt')
    page.locator('#mail-DEMO0008').focus()
    page.keyboard.press('4')
    expect(banner).to_contain_text('Nichts zu tun in diesem Schritt')
    expect(banner.get_by_text('Ablage prüfen')).to_be_visible()
    banner.get_by_role('button', name='Erledigt').click()
    expect(banner.get_by_text('Ablage prüfen')).to_have_count(0)

    banner.get_by_role('button', name='Nächster Schritt').click()
    expect(banner.get_by_role('heading', name='Offen durchgehen')).to_be_visible()
    expect(lane(page, 0).locator('.card')).to_have_count(6)
    expect(lane(page, 1).locator('.card')).to_have_count(0)
    page.locator('#mail-DEMO0002').focus()
    page.keyboard.press('2')
    expect(banner).to_contain_text('5 Karten in diesem Schritt')
    banner.get_by_role('button', name='Nächster Schritt').click()
    expect(banner.get_by_role('heading', name='Rest parken')).to_be_visible()
    expect(page.locator('#board .card')).to_have_count(5)
    banner.get_by_role('button', name='Triage beenden').click()
    expect(banner).to_be_hidden()
    expect(page.locator('#search')).to_have_value('Raum')
    expect(page.locator('#summary')).to_have_text('1 von 14 Mails')
    # Das Beispielpostfach hält Triage-Zeitpunkt und Routinen nur im Speicher, das echte Profil bleibt unberührt.
    assert page.evaluate("[localStorage.getItem('mailboard-triage-last-v1'),localStorage.getItem('mailboard-routines-v1')]") == [None, None]
    page.locator('#search').fill('')


def check_routine(page):
    page.get_by_role('tab', name='Routinen').click()
    d = page.locator('#routinesView')
    expect(d).to_be_visible()
    expect(page.locator('#board')).to_be_hidden()
    d.get_by_label('Titel').fill('Ablage prüfen')
    d.get_by_role('combobox', name='Rhythmus').select_option('daily')
    d.get_by_role('combobox', name='Verknüpfte Ansicht').select_option('hygiene')
    d.get_by_role('button', name='Routine anlegen').click()
    expect(d.get_by_text('Täglich · heute fällig · öffnet Warten-Hygiene')).to_be_visible()
    page.get_by_role('tab', name='Board').click()


def check_case_and_calendar(page, today, next_monday):
    page.locator('#mail-DEMO0003').click(button='right')
    page.get_by_role('menu').get_by_role('menuitem', name='Vorgang zuordnen …').click()
    picker = page.get_by_role('dialog', name='Vorgang zuordnen')
    picker.get_by_label('Name des neuen Vorgangs').fill('Wartung, Zentrifuge')
    picker.get_by_role('button', name='Zuordnen').click()
    expect(picker.get_by_role('alert')).to_contain_text('Komma')
    picker.get_by_label('Name des neuen Vorgangs').fill('Wartung Zentrifuge')
    picker.get_by_role('button', name='Zuordnen').click()
    expect(page.locator('#mail-DEMO0003 .card-chip', has_text='Vorgang: Wartung Zentrifuge')).to_have_count(1)
    side = page.locator('#caseViews button', has_text='Wartung Zentrifuge')
    expect(side).to_contain_text('1')
    side.click()
    expect(page.locator('#board .card')).to_have_count(1)
    page.locator('#viewMenu summary').click()
    page.locator('#viewControls').get_by_role('button', name='Zurücksetzen').click()
    page.keyboard.press('Escape')

    page.get_by_role('tab', name='Vorgänge').click()
    cases = page.locator('#casesView')
    cases.get_by_role('button', name='Wartung Zentrifuge · 1 Mails').click()
    cases.get_by_role('textbox', name='Neuer Checklistenpunkt').fill('Techniker bestätigen')
    cases.get_by_label('Termin für den neuen Punkt').fill(today)
    cases.get_by_role('button', name='Punkt hinzufügen').click()
    expect(cases.get_by_text('0 von 1 Punkten erledigt')).to_be_visible()
    expect(cases.get_by_role('button', name='In Capacities anlegen')).to_have_count(0)
    page.get_by_role('tab', name='Board').click()
    # Mit Checkliste zeigt die Karte den Fortschritt statt des Vorgangs-Chips.
    expect(page.locator('#mail-DEMO0003 .card-progress')).to_contain_text('0/1')
    expect(page.locator('#mail-DEMO0003 .card-chip', has_text='Vorgang')).to_have_count(0)

    # Wiedervorlage in der nächsten Woche setzen und im Kalender per Drag-and-drop zwei Tage später legen.
    page.locator('#mail-DEMO0004').focus()
    page.keyboard.press('w')
    page.locator('.view-dialog[open] input[type=date]').fill(next_monday)
    page.locator('.view-dialog[open]').get_by_role('button', name='Übernehmen').click()
    page.get_by_role('tab', name='Kalender').click()
    cal = page.locator('#calendarView')
    item = cal.locator('.calendar-day.today li', has_text='Techniker bestätigen')
    item.get_by_role('checkbox').check()
    expect(item).to_have_class('calendar-entry kind-checklist done')
    cal.get_by_role('button', name='Nächste Woche').click()
    entry = cal.get_by_role('button', name='Wiedervorlage · Rückfrage Bestellung 2026-118')
    expect(cal.locator('.calendar-day').first).to_contain_text('Rückfrage Bestellung')
    entry.drag_to(cal.locator('.calendar-day').nth(2))
    expect(cal.get_by_role('status')).to_contain_text('Wiedervorlage für „Rückfrage Bestellung 2026-118“')
    expect(cal.locator('.calendar-day').nth(2)).to_contain_text('Rückfrage Bestellung')
    page.get_by_role('tab', name='Board').click()
    expect(page.locator('#mail-DEMO0003 .card-progress')).to_contain_text('1/1')
    wednesday = (dt.date.fromisoformat(next_monday) + dt.timedelta(days=2)).isoformat()
    page.locator('#focusViews button', has_text='Wiedervorlage').click()
    short = lambda day: dt.date.fromisoformat(day).strftime('%d.%m.')
    expect(page.locator('#mail-DEMO0004')).to_contain_text('Wiedervorlage am ' + short(wednesday))
    page.locator('#undo').click()
    expect(page.locator('#mail-DEMO0004')).to_contain_text('Wiedervorlage am ' + short(next_monday))


LIVE = """
localStorage.setItem('kanban-board-options-v1', JSON.stringify({poll_seconds:0}))
const folders=[{id:'01',name:'Posteingang',path:'',isInbox:true}]
window.store=[
  {id:'a1',folderId:'01',folder:'Posteingang',status:'Offen',subject:'Angebot Zentrifuge',sender:'Anna',body:'',tags:['Fokus'],attachments:[]},
  {id:'b2',folderId:'01',folder:'Posteingang',status:'Offen',subject:'Termin Wartung',sender:'Ben',body:'',tags:['Wichtig'],attachments:[]},
]
window.tagCalls=[]
window.__TAURI__={core:{invoke:async(name,args={})=>{
  if(name==='outlook_batch'){window.batchActive=args.active;return}
  if(name==='outlook_categories')return '[]'
  if(name==='outlook_folders')return JSON.stringify(folders)
  if(name==='outlook_board')return JSON.stringify(window.store)
  if(name==='outlook_correspondence')return JSON.stringify({incoming:[],sent:[]})
  if(name==='outlook_tags'){
    if(!window.batchActive)throw Error('Kategorien ohne Schreibstapel')
    const mail=window.store.find(m=>m.id===args.id)
    const previous=[...mail.tags];mail.tags=[...args.wanted]
    window.tagCalls.push([args.id,[...args.wanted]])
    return JSON.stringify({previous,tags:mail.tags})
  }
  throw Error('Unerwarteter Befehl: '+name)
}}}
"""


def check_live(browser, base):
    """F und Vorgangszuordnung schreiben je Mail die passenden Outlook-Kategorien und lassen sich gemeinsam zurücknehmen."""
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    page.add_init_script("localStorage.setItem('board.layout.intro','1')")
    page.add_init_script(LIVE)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base)
    page.locator('#loadInbox').click()
    expect(page.locator('#board .card')).to_have_count(2)
    page.locator('#mail-a1').click(modifiers=['Control'])
    page.locator('#mail-b2').click(modifiers=['Control'])
    page.locator('#mail-b2').focus()
    page.keyboard.press('f')
    expect(page.locator('#focusViews button', has_text='Fokus')).to_have_text('Fokus · 2')
    # Nur die Mail ohne Fokus wird geschrieben, vorhandene Kategorien bleiben erhalten.
    assert page.evaluate('tagCalls') == [['b2', ['Wichtig', 'Fokus']]], page.evaluate('tagCalls')
    page.locator('#undo').click()
    expect(page.locator('#focusViews button', has_text='Fokus')).to_have_text('Fokus · 1')
    assert page.evaluate('store.find(m=>m.id==="b2").tags') == ['Wichtig']
    page.locator('#mail-a1').click(modifiers=['Control'])
    page.locator('#mail-b2').click(modifiers=['Control'])
    page.keyboard.press('Control+k')
    page.locator('#paletteFilter').fill('Vorgang zuordnen')
    page.keyboard.press('Enter')
    picker = page.get_by_role('dialog', name='Vorgang zuordnen')
    picker.get_by_label('Name des neuen Vorgangs').fill('Messe 2027')
    picker.get_by_role('button', name='Zuordnen').click()
    expect(page.locator('#caseViews button', has_text='Messe 2027')).to_contain_text('2')
    assert page.evaluate('store.map(m=>m.tags)') == [['Fokus', 'Vorgang: Messe 2027'], ['Wichtig', 'Vorgang: Messe 2027']]
    assert not errors, errors
    page.close()


def check_start(page):
    page.locator('#cockpit-start').click()
    start = page.locator('#cockpit-dialog')
    expect(start.get_by_text('Keine Routine fällig.')).to_be_visible()
    for gone in ['Vorgänge', 'Routinen', 'Wochenkalender', 'Hilfe', 'Gesendet ohne Antwort']:
        expect(start.get_by_role('button', name=gone, exact=True)).to_have_count(0)
    # Eine fällige Routine lässt sich in Start abhaken.
    start.get_by_role('button', name='Schließen').click()
    page.get_by_role('tab', name='Routinen').click()
    d = page.locator('#routinesView')
    d.get_by_label('Titel').fill('Start prüfen')
    d.get_by_role('combobox', name='Rhythmus').select_option('daily')
    d.get_by_role('button', name='Routine anlegen').click()
    page.locator('#cockpit-start').click()
    expect(start.get_by_text('Start prüfen')).to_be_visible()
    start.get_by_role('button', name='Start prüfen erledigt').click()
    expect(start.get_by_text('Keine Routine fällig.')).to_be_visible()
    # Klick auf „im Fokus“ schließt Start und zeigt die Fokusansicht auf dem Board.
    start.get_by_role('button', name='im Fokus').click()
    expect(start).to_be_hidden()
    expect(page.locator('#board')).to_be_visible()
    expect(page.locator('#focusViews button', has_text='Fokus').first).to_have_attribute('aria-pressed', 'true')
    page.locator('#viewMenu summary').click()
    page.locator('#viewControls').get_by_role('button', name='Zurücksetzen').click()
    page.keyboard.press('Escape')
    # Die Triage holt aus jeder Ansicht zurück auf das Board.
    page.keyboard.press('Control+t')
    expect(page.locator('#board')).to_be_visible()
    expect(page.get_by_role('region', name='Morgen-Triage')).to_be_visible()
    expect(page.locator('#triageStart')).to_have_text('Zur Triage')
    page.get_by_role('region', name='Morgen-Triage').get_by_role('button', name='Triage abbrechen').click()
    expect(page.locator('#triageStart')).to_have_text('Morgen-Triage starten')


if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    demo = {m['id']: m for m in json.loads((root / 'src' / 'demo.json').read_text(encoding='utf-8'))}
    today = dt.date.today()
    next_monday = (today + dt.timedelta(days=7 - today.weekday())).isoformat()
    seed = {'DEMO0008': {'status': 'Warten', 'folder': demo['DEMO0008']['folder'], 'followUp': '2020-01-06'}}
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=root / 'dist')) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path=os.getenv('CHROMIUM') or shutil.which('chromium'))
                page = browser.new_page(viewport={'width': 1440, 'height': 900})
                page.add_init_script("localStorage.setItem('board.layout.intro','1')")
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                base = f'http://127.0.0.1:{server.server_port}/'
                page.goto(base)
                page.evaluate('seed => localStorage.setItem("outlook-kanban-demo-positions-v1", JSON.stringify(seed))', seed)
                page.goto(base)
                page.locator('#moreTools summary').click()
                page.locator('#backDemo').click()
                expect(page.locator('.foot')).to_have_text('Beispielpostfach')
                check_focus(page)
                check_routine(page)
                check_triage(page)
                check_case_and_calendar(page, today.isoformat(), next_monday)
                check_start(page)
                assert not errors, errors
                check_live(browser, base)
                browser.close()
                print('OK – Board-Triage mit Briefing und Rückkehr zur Ansicht, Fokus mit Undo, Routine, Vorgang mit Checkliste, Kalenderplanung mit Undo, Outlook-Kategorien für Fokus und Vorgang')
        finally:
            server.shutdown()
