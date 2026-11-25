"""Langlaufender Outlook-Helfer als Hintergrundprozess.

Die Tauri-App startet diesen Prozess einmal und spricht über eine stdin/stdout-Pipe
mit ihm, statt bei jedem Befehl Mail-Board-Outlook.exe neu zu starten. Das ist der
Versuchsaufbau, um zu prüfen, ob eine dauerhaft laufende Python-Komponente unter dem
Firmen-Virenschutz stabil und schnell genug läuft.

Protokoll (eine JSON-Zeile je Nachricht, UTF-8):
  Anfrage:  {"id": 1, "args": ["--folders"]}
  Antwort:  {"id": 1, "ok": true,  "out": "<JSON-Text wie vom C#-Helfer>"}
            {"id": 1, "ok": false, "err": "Fehlertext"}

`out` ist derselbe JSON-Text, den der bisherige Helfer auf stdout geschrieben hat,
damit die Rust-Seite ihn unverändert durchreichen kann. stdout gehört allein den
Antworten; alles andere (Bereitschaft, Protokoll) geht auf stderr.

Nur `--folders`, `--inbox`, `--board` und `--folder` sind portiert. Alle anderen
Befehle liefern bewusst einen klaren Fehler, damit die App nichts still Falsches tut.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

STATES = ["Offen", "In Bearbeitung", "Warten", "Erledigt"]
STATUS_PREFIX = "Status: "
BODY_LIMIT = 1500
DEFAULT_LIMIT = 500


def log(message: str) -> None:
    print(f"[mailboard-server] {message}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# Datenquellen: echtes Outlook über COM, oder eine Demo-Quelle ohne Outlook,
# damit sich Protokoll und Prozessverwaltung auch ohne Windows testen lassen.
# ---------------------------------------------------------------------------


class DemoBackend:
    """Feste Beispieldaten in genau den Formaten, die das Board erwartet."""

    name = "demo"

    _folders = [
        {"id": "INBOX", "name": "Posteingang", "path": "", "isInbox": True,
         "parentId": "ROOT", "rootId": "ROOT", "omitted": 0},
        {"id": "F-PROJ", "name": "Projekte", "path": "Projekte", "isInbox": False,
         "parentId": "ROOT", "rootId": "ROOT", "omitted": 0},
        {"id": "F-TIPS", "name": "Pipettenspitzen", "path": "Pipettenspitzen", "isInbox": False,
         "parentId": "ROOT", "rootId": "ROOT", "omitted": 0},
    ]

    def folders(self):
        return self._folders

    def inbox_ids(self):
        return [f["id"] for f in self._folders if f.get("isInbox")]

    def cards(self, folder_ids):
        base = {
            "storeId": "DEMO-STORE", "conversationId": "", "senderEmail": "anna@example.com",
            "received": _iso(datetime(2026, 11, 24, 16, 9)), "isSent": False,
            "recipients": "", "recipientEmails": [], "statusSince": "",
            "followUp": "", "snoozeUntil": "", "note": "",
        }
        rows = [
            {**base, "id": "DEMO-1", "folderId": "INBOX", "folder": "Posteingang",
             "subject": "Angebot Pipettenspitzen 200 µl", "sender": "Dr. Anna Weber",
             "body": "Anbei das Angebot für die gefilterten Spitzen.",
             "status": "Offen", "hasStatus": False, "tags": ["Wichtig"],
             "attachments": ["Angebot_200ul.pdf"]},
            {**base, "id": "DEMO-2", "folderId": "INBOX", "folder": "Posteingang",
             "subject": "Raumplanung Q1", "sender": "Thomas Krüger",
             "body": "Können wir die Raumplanung diese Woche abschließen?",
             "status": "Offen", "hasStatus": False, "tags": [], "attachments": []},
            {**base, "id": "DEMO-3", "folderId": "F-PROJ", "folder": "Projekte",
             "subject": "Teammeeting Protokoll", "sender": "Sabine Wolf",
             "body": "Das Protokoll vom Dienstag.",
             "status": "In Bearbeitung", "hasStatus": True, "tags": [], "attachments": []},
        ]
        wanted = set(folder_ids)
        return [row for row in rows if row["folderId"] in wanted]


class OutlookBackend:
    """Echtes klassisches Outlook über das lokale COM-Objektmodell (pywin32)."""

    name = "outlook"
    OL_INBOX = 6
    OL_SENT = 5
    MAX_DEPTH = 8

    def __init__(self):
        import pythoncom  # noqa: F401  (nur Verfügbarkeit prüfen)
        import win32com.client  # noqa: F401

        self._com = None
        self._ns = None
        self._store = None
        self._inbox_id = None
        self._sent_id = None
        self._root_id = None

    def _connect(self):
        if self._ns is not None:
            return
        import pythoncom
        import win32com.client

        pythoncom.CoInitialize()
        # Dispatch bindet an ein laufendes Outlook, falls vorhanden, und startet sonst eines.
        app = win32com.client.Dispatch("Outlook.Application")
        ns = app.GetNamespace("MAPI")
        inbox = ns.GetDefaultFolder(self.OL_INBOX)
        self._ns = ns
        self._store = inbox.StoreID
        self._inbox_id = inbox.EntryID
        self._sent_id = ns.GetDefaultFolder(self.OL_SENT).EntryID
        self._root_id = inbox.Parent.EntryID
        log("mit Outlook verbunden")

    def _folder(self, folder_id: str):
        return self._ns.GetFolderFromID(folder_id, self._store)

    def folders(self):
        self._connect()
        inbox = self._ns.GetFolderFromID(self._inbox_id, self._store)
        root = inbox.Parent
        result = []
        self._walk(root, "", None, 0, result)
        return result

    def inbox_ids(self):
        # Billig: nur die Posteingangs-ID, ohne den ganzen Ordnerbaum zu durchlaufen.
        self._connect()
        return [self._inbox_id]

    def _walk(self, parent, absolute, relative, depth, result):
        for sub in parent.Folders:
            try:
                if int(sub.DefaultItemType) != 0 or not _same(sub.StoreID, self._store):
                    continue
                fid, name = sub.EntryID, sub.Name
                full = f"{absolute}/{name}" if absolute else name
                is_inbox = _same(fid, self._inbox_id)
                if is_inbox:
                    key = ""
                elif relative is None:
                    key = full
                elif relative == "":
                    key = name
                else:
                    key = f"{relative}/{name}"
                result.append({
                    "id": fid, "name": name, "path": key, "isInbox": is_inbox,
                    "parentId": parent.EntryID, "rootId": self._root_id,
                    "omitted": 0 if depth < self.MAX_DEPTH else self._hidden(sub),
                })
                if depth < self.MAX_DEPTH:
                    child_rel = key if (is_inbox or relative is not None) else None
                    self._walk(sub, full, child_rel, depth + 1, result)
            except Exception as exc:  # COM-Fehler an einzelnen Ordnern überspringen
                log(f"Ordner übersprungen: {exc}")

    def _hidden(self, folder) -> int:
        count = 0
        for sub in folder.Folders:
            try:
                if int(sub.DefaultItemType) == 0 and _same(sub.StoreID, self._store):
                    count += 1 + self._hidden(sub)
            except Exception:
                pass
        return count

    def cards(self, folder_ids):
        self._connect()
        rows = []
        for fid in folder_ids:
            try:
                folder = self._folder(fid)
            except Exception as exc:
                log(f"Ordner {fid} nicht lesbar: {exc}")
                continue
            rows.extend(self._cards_in(folder))
        return rows

    def _cards_in(self, folder):
        folder_id = folder.EntryID
        folder_name = folder.Name
        is_sent_folder = _same(folder_id, self._sent_id)
        out = []
        items = folder.Items
        try:
            items.Sort("[ReceivedTime]", True)
        except Exception:
            pass
        mail = items.GetFirst()
        seen = 0
        while mail is not None and seen < DEFAULT_LIMIT:
            seen += 1
            try:
                if int(getattr(mail, "Class", 43)) == 43:  # 43 = olMail
                    out.append(self._card(mail, folder_id, folder_name, is_sent_folder))
            except Exception as exc:
                log(f"Mail übersprungen: {exc}")
            mail = items.GetNext()
        return out

    def _card(self, mail, folder_id, folder_name, is_sent_folder):
        cats = _categories(getattr(mail, "Categories", "") or "")
        status = _status_of(cats)
        tags = [c for c in cats if not c.lower().startswith(STATUS_PREFIX.lower())]
        sender_email = _get(mail, "SenderEmailAddress", "").strip()
        is_sent = is_sent_folder
        return {
            "id": mail.EntryID, "storeId": self._store, "folderId": folder_id,
            "folder": folder_name, "subject": _get(mail, "Subject", "(ohne Betreff)"),
            "sender": _get(mail, "SenderName", ""), "senderEmail": sender_email,
            "received": _iso(_naive(getattr(mail, "ReceivedTime", None))),
            "conversationId": _get(mail, "ConversationID", ""),
            "body": _get(mail, "Body", "")[:BODY_LIMIT],
            "status": status or "Offen", "hasStatus": bool(status),
            "tags": tags, "attachments": _files(mail), "isSent": is_sent,
            "recipients": _get(mail, "To", "") if is_sent else "",
            "recipientEmails": [], "statusSince": "", "followUp": "",
            "snoozeUntil": "", "note": "",
        }


# ---------------------------------------------------------------------------
# Hilfsfunktionen
# ---------------------------------------------------------------------------


def _same(a, b) -> bool:
    return (a or "").lower() == (b or "").lower()


def _get(item, attr, default=""):
    try:
        value = getattr(item, attr, None)
        return default if value is None else str(value)
    except Exception:
        return default


def _naive(value):
    if value is None:
        return None
    try:
        return datetime(value.year, value.month, value.day, value.hour, value.minute, value.second)
    except Exception:
        return None


def _iso(value) -> str:
    if value is None:
        return ""
    # Mit lokalem Zeitzonen-Offset, wie der C#-Helfer ("o"-Format). Ohne Offset läse
    # JavaScript die Zeit sonst als UTC/lokal falsch und Empfangszeiten verrutschten.
    try:
        return value.astimezone().isoformat()
    except (ValueError, OSError):
        return value.replace(tzinfo=None).isoformat()


def _categories(text: str):
    return [part.strip() for part in text.split(",") if part.strip()]


def _status_of(cats):
    for state in STATES:
        target = (STATUS_PREFIX + state).lower()
        for cat in cats:
            if cat.lower() == target:
                return state
    return ""


def _files(mail):
    names = []
    try:
        entries = mail.Attachments
        for i in range(1, int(entries.Count) + 1):
            names.append(str(entries.Item(i).FileName))
    except Exception:
        pass
    return names


# ---------------------------------------------------------------------------
# Befehle
# ---------------------------------------------------------------------------


def _int(text, lo, hi, default):
    try:
        value = int(text)
    except (TypeError, ValueError):
        return default
    return value if lo <= value <= hi else default


def handle(backend, args):
    """Liefert den JSON-Text (wie der C#-Helfer) oder wirft bei Fehlern."""
    if not args:
        raise ValueError("Kein Befehl angegeben.")
    command = args[0]

    if command == "--ping":
        return json.dumps("pong")

    if command == "--sleep":
        # Nur zum Prüfen des Timeout-Pfads: wartet die angegebenen Millisekunden.
        import time
        time.sleep(_int(args[1] if len(args) > 1 else "0", 0, 600000, 0) / 1000)
        return json.dumps("slept")

    if command == "--folders":
        return json.dumps(backend.folders(), ensure_ascii=False)

    if command in ("--inbox", "--board", "--folder"):
        folder_ids = _board_folders(backend, command, args)
        return json.dumps(backend.cards(folder_ids), ensure_ascii=False)

    raise NotImplementedError(
        f"Befehl im Server-Modus noch nicht portiert: {command}. "
        f"Nur --folders, --inbox, --board und --folder sind im Versuch enthalten."
    )


def _board_folders(backend, command, args):
    if command == "--folder":
        if len(args) < 2:
            raise ValueError("--folder braucht eine Ordner-ID.")
        return [args[1]]

    ids = set(backend.inbox_ids())
    if command == "--board" and len(args) > 1:
        try:
            for fid in json.loads(args[1]):
                ids.add(fid)
        except (ValueError, TypeError):
            raise ValueError("--board erwartet die Ordnerliste als JSON.")
    return list(ids)


def pick_backend(force_demo: bool):
    if force_demo:
        log("Demo-Quelle erzwungen (--demo).")
        return DemoBackend()
    try:
        backend = OutlookBackend()
        log("Outlook-Quelle bereit (pywin32 gefunden).")
        return backend
    except Exception as exc:
        log(f"Kein Outlook/pywin32 ({exc}) – Demo-Quelle.")
        return DemoBackend()


def main(argv):
    # Die Pipe muss unabhängig von der Windows-Codepage UTF-8 sein, sonst liest die
    # Rust-Seite kaputte Bytes. Zusätzlich sendet _reply reines ASCII (Umlaute als \uXXXX).
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", newline="\n")
        except (AttributeError, ValueError):
            pass
    backend = pick_backend("--demo" in argv)
    # stdout strikt den Antworten vorbehalten; eine Bereitschaftszeile geht auf stderr.
    log(f"bereit, Quelle={backend.name}")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
            req_id = message.get("id")
            args = message.get("args") or []
        except (ValueError, AttributeError) as exc:
            _reply(None, False, None, f"Ungültige Anfrage: {exc}")
            continue
        try:
            out = handle(backend, args)
            _reply(req_id, True, out, None)
        except Exception as exc:  # jeder Befehlsfehler wird gemeldet, der Server läuft weiter
            _reply(req_id, False, None, str(exc))
    log("Eingabe beendet, Server stoppt.")


def _reply(req_id, ok, out, err):
    payload = {"id": req_id, "ok": ok, "out": out, "err": err}
    # ensure_ascii=True: Umlaute werden zu \uXXXX, die Zeile ist damit reines ASCII
    # und unabhängig von der Konsolen-Codepage gültiges UTF-8.
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    main(sys.argv[1:])
