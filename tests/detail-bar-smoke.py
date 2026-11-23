"""Aktionsleiste in den Maildetails: Kürzel, Fokus, W-Taste, deaktivierte Entwürfe im Beispielpostfach."""
import os
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright


def check_bar(page, base_url):
    page.goto(base_url)
    page.locator('#moreTools summary').click()
    page.locator('#backDemo').click()
    page.locator('#mail-DEMO0000').click()
    detail = page.locator('#detail')
    bar = detail.get_by_role('toolbar')
    expect(bar).to_be_visible()
    reply = bar.get_by_role('button', name='Antworten', exact=False).first
    expect(reply).to_be_disabled()
    expect(reply).to_have_attribute('title', 'Entwürfe gibt es nur im Outlook-Postfach.')
    expect(reply).to_have_attribute('aria-keyshortcuts', 'R')
    expect(bar.locator('[data-act=snoozeUntil] kbd')).to_have_text('W')
    expect(bar.locator('[data-act=followUp]')).to_be_hidden()
    focus = bar.locator('[data-act=focus]')
    expect(focus).to_have_attribute('aria-pressed', 'false')
    focus.click()
    expect(detail).to_be_visible()
    expect(focus).to_have_attribute('aria-pressed', 'true')
    page.keyboard.press('Escape')
    expect(page.locator('#mail-DEMO0000')).to_contain_text('Fokus')
    # W im offenen Detaildialog öffnet das Datumsfeld, danach liegt der Fokus wieder im Detail.
    page.locator('#mail-DEMO0000').click()
    detail.locator('#subject').focus()
    page.keyboard.press('w')
    field = page.locator('dialog.view-dialog input[type=date]')
    expect(field).to_be_visible()
    page.keyboard.press('Escape')
    expect(field).to_have_count(0)
    expect(detail).to_be_visible()
    expect(page.locator('#detail [data-act=snoozeUntil]')).to_be_focused()


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
                check_bar(page, f'http://127.0.0.1:{server.server_port}')
                assert not errors, errors
                browser.close()
                print('OK – Aktionsleiste: Kürzel, Fokus, W-Taste, deaktivierte Entwürfe')
        finally:
            server.shutdown()
