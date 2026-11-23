"""Kontextmenü der Karten: Gruppen, Pfeiltasten, Umschalt+F10, Escape, Mehrfachauswahl."""
import os
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright


def check_menu(page, base_url):
    page.goto(base_url)
    page.locator('#moreTools summary').click()
    page.locator('#backDemo').click()
    card = page.locator('#mail-DEMO0000')
    card.click(button='right')
    menu = page.get_by_role('menu')
    expect(menu).to_be_visible()
    for name in ['Status', 'Antworten', 'Planen', 'Ordnen']:
        expect(menu.get_by_role('group', name=name)).to_be_visible()
    expect(menu.get_by_role('menuitem', name='Offen')).to_contain_text('1')
    box = menu.bounding_box()
    vp = page.viewport_size
    assert box['x'] >= 0 and box['y'] >= 0 and box['x'] + box['width'] <= vp['width'] and box['y'] + box['height'] <= vp['height'], box
    # Pfeiltasten und Eingabe setzen den Status; Pos1/Ende springen.
    page.keyboard.press('End')
    last = menu.get_by_role('menuitem').last
    expect(last).to_be_focused()
    page.keyboard.press('Home')
    expect(menu.get_by_role('menuitem').first).to_be_focused()
    page.keyboard.press('ArrowDown')
    page.keyboard.press('ArrowDown')
    page.keyboard.press('Enter')
    expect(menu).to_have_count(0)
    expect(page.locator('.lane').nth(2).locator('#mail-DEMO0000')).to_have_count(1)
    # Umschalt+F10 an der fokussierten Karte, Escape gibt den Fokus zurück.
    card = page.locator('#mail-DEMO0001')
    card.focus()
    page.keyboard.press('Shift+F10')
    expect(menu).to_be_visible()
    page.keyboard.press('Escape')
    expect(menu).to_have_count(0)
    expect(card).to_be_focused()
    # Klick außerhalb schließt.
    page.keyboard.press('Shift+F10')
    expect(menu).to_be_visible()
    page.locator('body').click(position={'x': 2, 'y': 2})
    expect(menu).to_have_count(0)
    # Mehrfachauswahl: Kopf nennt die Anzahl, Einzelmail-Einträge entfallen.
    expect(page.locator('#mail-DEMO0001')).to_have_attribute('aria-pressed', 'true')
    page.locator('#mail-DEMO0002').click(modifiers=['Control'])
    page.locator('#mail-DEMO0002').click(button='right')
    expect(menu).to_contain_text('2 markierte Mails')
    expect(menu.get_by_role('menuitem', name='Details')).to_have_count(0)
    page.keyboard.press('Escape')
    # Knopf „Kartenaktionen“ im Menü Ansicht.
    page.locator('#viewMenu summary').click()
    page.locator('#viewControls').get_by_role('button', name='Kartenaktionen').click()
    expect(menu).to_be_visible()
    page.keyboard.press('Escape')


if __name__ == '__main__':
    dist = Path(__file__).resolve().parents[1] / 'dist'
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=dist)) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path=os.getenv('CHROMIUM') or shutil.which('chromium'))
                page = browser.new_page()
                page.add_init_script("localStorage.setItem('board.layout.intro','1')")
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                check_menu(page, f'http://127.0.0.1:{server.server_port}')
                assert not errors, errors
                browser.close()
                print('OK – Kontextmenü: Gruppen, Pfeiltasten, Umschalt+F10, Escape')
        finally:
            server.shutdown()
