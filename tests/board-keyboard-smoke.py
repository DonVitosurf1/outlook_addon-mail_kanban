"""Desktop-Layout und Tastatursteuerung nach npm run build mit Playwright prüfen."""
import os
import shutil
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright


def check_board(page, base_url, font_size):
    page.goto(base_url)
    page.locator('#moreTools summary').click()
    page.locator('#backDemo').click()
    search = page.locator("#search")
    cards = page.locator(".card")
    expect(cards.first).to_be_visible()
    page.evaluate("(size) => document.documentElement.style.fontSize = size", f"{font_size}px")

    page.keyboard.press("Control+f")
    expect(search).to_be_focused()
    search.fill("Pipettenspitzen")
    expect(cards.first).to_be_visible()
    desktop_view = page.get_by_role("combobox", name="Bildschirmansicht")
    expect(desktop_view).to_have_value("laptop")
    subject = cards.first.locator("strong")
    laptop_size = subject.evaluate("(el) => parseFloat(getComputedStyle(el).fontSize)")
    filtered_ids = cards.evaluate_all("(rows) => rows.map(r => r.id)")
    desktop_view.focus()
    desktop_view.press("End")
    expect(desktop_view).to_have_value("monitor")
    expect(search).to_have_value("Pipettenspitzen")
    assert cards.evaluate_all("(rows) => rows.map(r => r.id)") == filtered_ids
    assert subject.evaluate("(el) => parseFloat(getComputedStyle(el).fontSize)") > laptop_size
    search.fill("")
    cards.first.focus()
    page.keyboard.press("Space")
    expect(page.locator("#detail")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.locator("#detail")).to_be_hidden()

    page.locator(".card strong").first.evaluate("(n) => n.textContent = 'Pipettenspitzen'.repeat(14)")
    page.locator("#folders button").last.evaluate("(n) => n.firstChild.textContent = 'Beschaffungsordner'.repeat(7)")
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
    assert cards.first.evaluate("(card) => card.scrollWidth <= card.clientWidth + 1")

    page.keyboard.press("Control+k")
    palette = page.locator("#paletteFilter")
    expect(palette).to_be_focused()
    palette.fill("Sicht · VIP")
    page.keyboard.press("Enter")
    expect(page.get_by_role("combobox", name="Benannte Sicht")).to_have_value("vip")
    page.keyboard.press("Control+k")
    palette.fill("+++")
    expect(page.locator("#paletteEmpty")).to_be_visible()
    page.keyboard.press("Escape")
    expect(page.locator("#palette")).to_be_hidden()

    page.reload()
    expect(desktop_view).to_have_value("monitor")
    desktop_view.focus()
    desktop_view.press("Home")
    expect(desktop_view).to_have_value("laptop")
    page.reload()
    expect(desktop_view).to_have_value("laptop")
    page.evaluate("(size) => document.documentElement.style.fontSize = size", f"{font_size}px")
    trigger = page.locator("#moreTools summary")
    trigger.click()
    page.locator("#openSettings").click()
    settings = page.locator("#settingsDialog")
    expect(settings).to_be_visible()
    assert settings.evaluate("(dialog) => dialog.scrollWidth <= dialog.clientWidth + 1")
    settings.get_by_label("Echte Mails verschieben erlauben").focus()
    expect(settings.get_by_label("Echte Mails verschieben erlauben")).to_be_in_viewport()
    page.keyboard.press("Escape")
    expect(trigger).to_be_focused()


if __name__ == "__main__":
    dist = Path(__file__).resolve().parents[1] / "dist"
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=dist)) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path=os.getenv("CHROMIUM") or shutil.which("chromium"))
                for width, height, font in [(1920, 1080, 16), (1280, 720, 16), (960, 640, 24), (680, 480, 24)]:
                    page = browser.new_page(viewport={"width": width, "height": height})
                    errors = []
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    check_board(page, f"http://127.0.0.1:{server.server_port}", font)
                    assert not errors, errors
                    print(f"OK – Tastatur und Layout bei {width} × {height}, Grundschrift {font} px")
                    page.close()
                browser.close()
        finally:
            server.shutdown()
