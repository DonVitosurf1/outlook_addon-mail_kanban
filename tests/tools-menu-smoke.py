"""Werkzeuge-Menü aufgeräumt: Gesendet ohne Antwort, Unterhaltungen zusammenfassen und VIP-Liste an ihrem neuen Ort."""
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


root = Path(__file__).resolve().parents[1]
with ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=root / 'dist')) as server:
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=os.getenv('CHROMIUM') or shutil.which('chromium'))
            page = browser.new_page(viewport={'width': 1440, 'height': 900})
            page.add_init_script("localStorage.setItem('board.layout.intro','1')")
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.evaluate('localStorage.clear()')
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            # Offline: kein Eintrag in den Ansichten.
            expect(page.locator('#sentUnanswered')).to_have_count(0)
            # Einstellungen: VIP-Liste.
            page.locator('#moreTools summary').click()
            page.locator('#openSettings').click()
            page.locator('#settingsDialog').get_by_role('button', name='VIP-Liste bearbeiten …').click()
            expect(page.get_by_role('dialog', name='VIP-Absender')).to_be_visible()
            page.keyboard.press('Escape')
            page.keyboard.press('Escape')
            page.locator('#moreTools summary').click()
            page.locator('#backDemo').click()
            expect(page.locator('.foot')).to_have_text('Beispielpostfach')
            # Werkzeuge: nur noch die sieben Einträge in fester Reihenfolge.
            ids = page.locator('#moreTools .tools-panel button').evaluate_all('els => els.map(e => e.id)')
            assert ids == ['paletteTrigger', 'openSettings', 'projectTools', 'setupOpen', 'dataSettings', 'backDemo', 'cockpit-help'], ids
            for gone in ['Gesendet ohne Antwort', 'VIP-Liste', 'Unterhaltungen zusammenfassen']:
                expect(page.locator('#moreTools .tools-panel')).not_to_contain_text(gone)
            page.keyboard.press('Escape')
            # Seitenleiste: Eintrag nach „Wiedervorlage“, öffnet den Dialog.
            names = page.locator('#focusViews button').all_text_contents()
            assert names[-1] == 'Gesendet ohne Antwort' and names[-2].startswith('Wiedervorlage'), names
            expect(page.locator('#sentUnanswered')).not_to_have_attribute('aria-pressed', r'.*')
            page.locator('#sentUnanswered').click()
            expect(page.get_by_role('dialog', name='Gesendet ohne Antwort')).to_be_visible()
            page.keyboard.press('Escape')
            # Menü Ansicht: Schalter mit sichtbarem Zustand.
            page.locator('#viewMenu summary').click()
            box = page.locator('#viewControls').get_by_label('Unterhaltungen zusammenfassen')
            expect(box).to_be_checked()
            box.uncheck()
            page.reload()
            page.locator('#moreTools summary').click()
            page.locator('#backDemo').click()
            page.locator('#viewMenu summary').click()
            expect(page.locator('#viewControls').get_by_label('Unterhaltungen zusammenfassen')).not_to_be_checked()
            page.keyboard.press('Escape')
            assert not errors, errors
            browser.close()
            print('OK – Werkzeuge-Menü, Ansichten-Eintrag, Ansicht-Schalter und VIP-Liste in den Einstellungen')
    finally:
        server.shutdown()
