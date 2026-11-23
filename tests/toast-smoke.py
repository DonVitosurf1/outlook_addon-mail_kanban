"""Rückmeldung mit Rückgängig (U7) im Beispielpostfach prüfen."""
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


def check(page, base):
    page.goto(base)
    page.locator('#moreTools summary').click()
    page.locator('#backDemo').click()
    undo = page.locator('#undo')
    expect(page.locator('.card').first).to_be_visible()
    assert 'Letzte Änderung zurücknehmen' in undo.get_attribute('title')
    card = page.locator('#mail-DEMO0008')
    status_before = card.evaluate("c => c.closest('.lane')?.querySelector('h2')?.textContent || ''")
    card.focus()
    page.keyboard.press('4')
    toast = page.get_by_role('status').filter(has_text='Status auf Erledigt gesetzt')
    expect(toast).to_be_visible()
    expect(toast.get_by_role('button', name='Rückgängig')).to_be_visible()
    # Der Fokus bleibt auf der Karte, der Tooltip nennt die Aktion.
    assert page.evaluate("document.activeElement.id") != ''
    assert page.evaluate("!document.activeElement.closest('.toast')")
    assert undo.get_attribute('title') == 'Rückgängig: Status auf Erledigt gesetzt (Strg+Z)'
    toast.get_by_role('button', name='Rückgängig').click()
    expect(page.get_by_role('status').filter(has_text='Zurückgenommen: Status auf Erledigt gesetzt')).to_be_visible()
    expect(page.locator('.toast button', has_text='Rückgängig')).to_have_count(0)
    assert card.evaluate("c => c.closest('.lane')?.querySelector('h2')?.textContent || ''") == status_before
    # Escape schließt die Meldung.
    page.locator('#mail-DEMO0008').focus()
    page.keyboard.press('4')
    expect(page.locator('.toast', has_text='Status auf Erledigt gesetzt')).to_be_visible()
    page.keyboard.press('Escape')
    expect(page.locator('.toast')).to_have_count(0)
    # Schließen-Knopf.
    page.locator('#undo').click()
    expect(page.locator('.toast')).to_be_visible()
    page.get_by_role('button', name='Meldung schließen').click()
    expect(page.locator('.toast')).to_have_count(0)


if __name__ == "__main__":
    dist = Path(__file__).resolve().parents[1] / "dist"
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=dist)) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path=os.getenv("CHROMIUM") or shutil.which("chromium"))
                page = browser.new_page(viewport={"width": 1280, "height": 720})
                page.add_init_script("localStorage.setItem('board.layout.intro','1')")
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                check(page, f"http://127.0.0.1:{server.server_port}")
                assert not errors, errors
                print("OK – Rückmeldung mit Rückgängig")
                browser.close()
        finally:
            server.shutdown()
