"""Kopierte Python-Sicherung über die reguläre Oberfläche importieren und exportieren."""
import io
import json
import os
import shutil
import zipfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import expect, sync_playwright

config = "project_folders: ['Labor']\ntext_snippets:\n  - label: Importierter Baustein\n    body: Eingangsprüfung\n    kind: note\n"
sample = io.BytesIO()
with zipfile.ZipFile(sample, "w") as archive:
    archive.writestr("config.yaml",config)
    archive.writestr("knowledge/labor.md","---\nfolder: Labor\n---\n## Zweck\nEingangsprüfung")
with ThreadingHTTPServer(("127.0.0.1",0),partial(SimpleHTTPRequestHandler,
        directory=Path(__file__).resolve().parents[1]/"dist")) as server:
    Thread(target=server.serve_forever,daemon=True).start()
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path=os.getenv("CHROMIUM") or shutil.which("chromium"))
            page=browser.new_page(accept_downloads=True)
            page.goto(f"http://127.0.0.1:{server.server_port}")
            def open_data():
                page.locator("#moreTools summary").click()
                page.locator("#dataSettings").click()
                return page.locator(".data-settings")
            def confirm_reload():
                with page.expect_navigation():
                    page.get_by_role("button",name="Bestätigen").click()
            data=open_data()
            data.locator('input[type=file]').set_input_files({
                "name":"python-kopie.zip","mimeType":"application/zip","buffer":sample.getvalue()})
            confirm_reload()
            data=open_data()
            expect(data.get_by_label("Name",exact=True)).to_have_value("Importierter Baustein")
            with page.expect_download() as result:
                data.get_by_role("button",name="ZIP sichern").click()
            with zipfile.ZipFile(result.value.path()) as saved:
                native=json.loads(saved.read("tauri-board-v1.json"))
                assert json.loads(native["values"]["kanban-import-v1"])["config.yaml"]==config
            data.get_by_role("button",name="Stand vor Import wiederherstellen").click()
            confirm_reload()
            assert page.evaluate("localStorage.getItem('kanban-import-v1')") is None
            browser.close()
            print("OK – Python-Kopie importiert, Textbaustein verwendet, Tauri-ZIP exportiert und Ausgangsstand wiederhergestellt.")
    finally:
        server.shutdown()
