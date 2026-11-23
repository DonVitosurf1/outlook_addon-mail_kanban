"""Die Taste ? öffnet die Tastenkürzel-Übersicht, Escape schließt sie."""
import os
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright


def check_shortcuts(page, base_url):
    page.goto(base_url)
    page.locator('#moreTools summary').click()
    page.locator('#backDemo').click()
    dialog = page.locator('#cockpit-dialog')
    # In einem Eingabefeld bleibt ? ein normales Zeichen.
    page.locator('#search').focus()
    page.keyboard.press('?')
    expect(dialog).to_be_hidden()
    page.locator('#search').fill('')
    page.locator('body').click(position={'x': 2, 'y': 2})
    page.keyboard.press('?')
    expect(dialog.get_by_role('heading', name='Tastenkürzel')).to_be_visible()
    for group in ['Karte', 'Board', 'Ansichten', 'Triage', 'Dialoge']:
        expect(dialog.get_by_role('table', name=group)).to_be_visible()
    expect(dialog.locator('kbd', has_text='Strg').first).to_be_visible()
    page.keyboard.press('Escape')
    expect(dialog).to_be_hidden()
    # Über die Hilfe erreichbar.
    page.keyboard.press('F1')
    dialog.get_by_role('button', name='Tastenkürzel anzeigen').click()
    expect(dialog.get_by_role('heading', name='Tastenkürzel')).to_be_visible()
    page.keyboard.press('Escape')
    expect(dialog).to_be_hidden()


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
                check_shortcuts(page, f'http://127.0.0.1:{server.server_port}')
                assert not errors, errors
                browser.close()
                print('OK – Tastenkürzel-Übersicht per ? und Hilfe, Escape schließt')
        finally:
            server.shutdown()
