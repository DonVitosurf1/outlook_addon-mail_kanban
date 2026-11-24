"""Kurze Einführung (U4): Schritte, Überspringen, Merken je Postfach und erneutes Zeigen über die Hilfe."""
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


def open_demo(page, base):
    page.goto(base)
    page.locator('#moreTools summary').click()
    page.locator('#backDemo').click()


def check(page, base):
    open_demo(page, base)
    intro = page.get_by_role('dialog', name='Kurze Einführung')
    expect(intro).to_be_visible()
    assert intro.get_attribute('aria-modal') == 'false'
    expect(intro).to_contain_text('Jede Spalte ist ein Status')
    expect(intro.get_by_role('button', name='Weiter')).to_be_focused()
    # Tasten in der Blase lösen keine Kartenaktionen aus.
    card = page.locator('#mail-DEMO0008')
    lane_before = card.evaluate("c => c.closest('.lane')?.querySelector('h2')?.textContent || ''")
    card.click(modifiers=['Control'])
    page.get_by_role('button', name='Weiter').focus()
    for key in ['4', 'f']:
        page.keyboard.press(key)
    assert card.evaluate("c => c.closest('.lane')?.querySelector('h2')?.textContent || ''") == lane_before
    expect(page.locator('#mail-DEMO0008 .flag-focus')).to_have_count(0)
    page.get_by_role('button', name='Weiter').click()
    expect(intro).to_contain_text('Klick öffnet die Mail')
    page.get_by_role('button', name='Weiter').click()
    expect(intro).to_contain_text('Kalender, Vorgänge und Routinen')
    expect(intro.get_by_role('button', name='Fertig')).to_be_visible()
    page.get_by_role('button', name='Überspringen').click()
    expect(intro).to_have_count(0)
    assert page.evaluate("localStorage.getItem('board.layout.intro-demo')") == '1'
    assert page.evaluate("localStorage.getItem('board.layout.intro-outlook')") is None
    # Nach Neuladen keine Einführung mehr.
    open_demo(page, base)
    expect(page.locator('.card').first).to_be_visible()
    page.wait_for_timeout(300)
    expect(intro).to_have_count(0)
    # Über die Hilfe erneut starten, Escape überspringt.
    page.locator('#moreTools summary').click()
    page.locator('#cockpit-help').click()
    page.get_by_role('searchbox', name='Hilfethemen durchsuchen').fill('Einführung')
    expect(page.locator('summary', has_text='Einführung erneut zeigen')).to_have_count(1)
    page.get_by_role('button', name='Einführung erneut zeigen').click()
    expect(intro).to_be_visible()
    expect(intro).to_contain_text('Jede Spalte ist ein Status')
    # Escape schließt nur die Einführung, die Auswahl auf dem Board bleibt.
    page.locator('#mail-DEMO0008').click(modifiers=['Control'])
    expect(page.locator('#mail-DEMO0008')).to_have_attribute('aria-pressed', 'true')
    intro.get_by_role('button', name='Weiter').focus()
    page.keyboard.press('Escape')
    expect(intro).to_have_count(0)
    expect(page.locator('#mail-DEMO0008')).to_have_attribute('aria-pressed', 'true')
    # Der alte Schlüssel gilt für beide Postfächer als gesehen.
    page.evaluate("localStorage.clear(); localStorage.setItem('board.layout.intro','1')")
    open_demo(page, base)
    expect(page.locator('.card').first).to_be_visible()
    page.wait_for_timeout(300)
    expect(intro).to_have_count(0)


if __name__ == "__main__":
    dist = Path(__file__).resolve().parents[1] / "dist"
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=dist)) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=os.getenv("CHROMIUM") or shutil.which("chromium"))
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            check(page, f"http://127.0.0.1:{server.server_port}/")
            assert not errors, errors
            browser.close()
    print("intro-smoke ok")
