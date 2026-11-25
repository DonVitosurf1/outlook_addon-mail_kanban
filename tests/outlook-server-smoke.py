"""Prüft den Outlook-Hintergrundserver über die echte stdin/stdout-Pipe (Demo-Quelle).

Testet Protokoll, Fehlerverhalten und die Datenformate, ohne Outlook. Die COM-Quelle
selbst lässt sich nur unter Windows mit klassischem Outlook prüfen.
"""
import json
import subprocess
import sys
from pathlib import Path

SERVER = Path(__file__).resolve().parents[1] / "outlook-server" / "mailboard_server.py"

FOLDER_KEYS = {"id", "name", "path", "isInbox", "parentId", "rootId", "omitted"}
CARD_KEYS = {"id", "storeId", "folderId", "folder", "subject", "sender", "senderEmail",
             "received", "conversationId", "body", "status", "hasStatus", "tags",
             "attachments", "isSent", "recipients", "recipientEmails", "statusSince",
             "followUp", "snoozeUntil", "note"}


def main():
    proc = subprocess.Popen(
        [sys.executable, str(SERVER), "--demo"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", bufsize=1,
    )
    try:
        checks(proc)
    finally:
        proc.stdin.close()
        proc.wait(timeout=5)
    print("OK – Protokoll, Ordner, Karten und Fehlerfälle des Hintergrundservers.")


def call(proc, req_id, args):
    proc.stdin.write(json.dumps({"id": req_id, "args": args}) + "\n")
    proc.stdin.flush()
    line = proc.stdout.readline()
    assert line, "Keine Antwort vom Server erhalten"
    return json.loads(line)


def checks(proc):
    # Bereitschaft/Ping
    pong = call(proc, 1, ["--ping"])
    assert pong == {"id": 1, "ok": True, "out": json.dumps("pong"), "err": None}, pong

    # Antwort trägt die Anfrage-ID zurück (Zuordnung bei paralleler Nutzung)
    assert call(proc, 7, ["--ping"])["id"] == 7

    # Ordner: richtige Form, genau ein Posteingang
    folders = json.loads(ok_out(call(proc, 2, ["--folders"])))
    assert isinstance(folders, list) and folders, "Ordnerliste leer"
    for f in folders:
        assert FOLDER_KEYS <= set(f), f"Ordner-Felder fehlen: {FOLDER_KEYS - set(f)}"
    assert sum(1 for f in folders if f["isInbox"]) == 1, "genau ein Posteingang erwartet"

    # Posteingang: nur Posteingangs-Karten, vollständige Form
    inbox = json.loads(ok_out(call(proc, 3, ["--inbox"])))
    assert inbox, "Posteingang leer"
    for c in inbox:
        assert CARD_KEYS <= set(c), f"Karten-Felder fehlen: {CARD_KEYS - set(c)}"
        assert c["folderId"] == "INBOX"
        assert isinstance(c["tags"], list) and isinstance(c["attachments"], list)

    # Board: Posteingang plus ausgewählter Ordner
    board = json.loads(ok_out(call(proc, 4, ["--board", json.dumps(["F-PROJ"])])))
    folder_ids = {c["folderId"] for c in board}
    assert "INBOX" in folder_ids and "F-PROJ" in folder_ids, folder_ids
    assert "F-TIPS" not in folder_ids, "nicht gewählter Ordner darf nicht erscheinen"

    # Einzelner Ordner
    one = json.loads(ok_out(call(proc, 5, ["--folder", "F-PROJ"])))
    assert one and all(c["folderId"] == "F-PROJ" for c in one)

    # Nicht portierter Befehl: klarer Fehler, Server läuft weiter
    bad = call(proc, 6, ["--draft", "x", "y", "reply", "Text"])
    assert bad["ok"] is False and "noch nicht portiert" in bad["err"], bad
    assert call(proc, 8, ["--ping"])["ok"] is True, "Server nach Fehler nicht mehr ansprechbar"

    # Ungültige Anfrage ohne Befehl
    empty = call(proc, 9, [])
    assert empty["ok"] is False, empty


def ok_out(reply):
    assert reply["ok"] is True, f"Befehl fehlgeschlagen: {reply.get('err')}"
    return reply["out"]


if __name__ == "__main__":
    main()
