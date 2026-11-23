"""Tagesarbeit und sichere Sammelablage gegen das gebaute Demo-Board prüfen."""
import os
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright


def check_cockpit(page, base_url):
    page.goto(base_url)
    page.locator('#moreTools summary').click()
    page.locator('#backDemo').click()
    page.locator('#cockpit-start').click()
    page.get_by_role('button', name='Morgen-Triage starten').click()
    # Die Triage läuft im Banner auf dem Board, der Startdialog schließt sich.
    expect(page.locator('#cockpit-dialog')).to_be_hidden()
    banner = page.get_by_role('region', name='Morgen-Triage')
    for title in ['Heute dran', 'Offen durchgehen']:
        expect(banner.get_by_role('heading', name=title, exact=True)).to_be_visible()
        banner.get_by_role('button', name='Nächster Schritt').click()
    banner.get_by_role('button', name='Triage beenden').click()
    expect(banner).to_be_hidden()

    page.keyboard.press('F1')
    help_search = page.get_by_role('searchbox', name='Hilfethemen durchsuchen')
    help_search.fill('Schnittlauch')
    expect(page.get_by_text('Kein passendes Hilfethema gefunden.')).to_be_visible()
    help_search.fill('Anhänge')
    expect(page.get_by_text('Wie lese ich eine Nachricht?')).to_be_visible()
    page.locator('#cockpit-dialog').get_by_role('button',name='Schließen').click()

    expect(page.locator('#cockpit-dialog')).to_be_hidden()
    page.locator('#cockpit-start').focus()
    page.keyboard.press('Control+r')
    d = page.get_by_role('dialog', name='Posteingang aufräumen')
    heading = d.get_by_role('heading')
    current = heading.inner_text()
    d.get_by_role('button', name='Überspringen').click()
    expect(heading).not_to_have_text(current)
    d.get_by_role('button', name='Zurück', exact=True).click()
    expect(heading).to_have_text(current)
    page.keyboard.press('4')
    expect(heading).not_to_have_text(current)
    d.get_by_role('button', name='Letzte Board-Aktion zurücknehmen').click()
    expect(heading).to_have_text(current)

    # Ein gelerntes Ziel aus Outlook darf das Beispielpostfach nicht beeinflussen.
    page.evaluate("""() => localStorage.setItem('outlook-kanban-ai-training-v1',
      JSON.stringify({rows:Array.from({length:3},()=>({folder:'Organisation',features:['n:thomas krüger']}))}))""")
    d.get_by_role('button', name='Sichere Sammelvorschläge prüfen').click()
    expect(d).to_contain_text('Keine sicheren Sammelvorschläge gefunden.')
    expect(heading).to_have_text(current)



if __name__ == '__main__':
    dist = Path(__file__).resolve().parents[1] / 'dist'
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=dist)) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path=os.getenv('CHROMIUM') or shutil.which('chromium'))
                page = browser.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                check_cockpit(page, f'http://127.0.0.1:{server.server_port}')
                assert not errors, errors
                browser.close()
                print('OK – Start der Board-Triage, Hilfesuche, Aufräumen, isolierte Vorschläge und Undo')
        finally:
            server.shutdown()
