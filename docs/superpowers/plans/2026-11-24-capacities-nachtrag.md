# Capacities-Nachtrag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine schon übernommene Mail kann einen Nachtrag an ihre Capacities-Notiz hängen, und das Projekt verweist auf diese Notiz als Objekt.

**Architecture:** `src/capacities.ts` bleibt die Schnittstelle. Ein vorhandenes `noteId` legt nichts neu an. Hat sich der Text geändert, hängt `POST /blocks/append` nur den Nachtrag an die Notiz. Der Verweis am Projekt ist ein `LinkToken` mit `entityId` der Notiz, kein zweiter Mailtext. Personen werden am Namen oder an der Mailadresse wiedererkannt.

**Tech Stack:** TypeScript, esbuild-Tests (`node scripts/test.mjs`), Playwright-Smoke `tests/capacities-smoke.py`, Capacities API v1.

## Global Constraints

- Mailtext geht nur in die Notiz oder ihren Nachtrag, nie in den Projektverweis.
- Die Notiz wird nicht neu geschrieben. Die Markdown-Schnittstelle kann den bestehenden Text nicht ersetzen.
- Nur mit Outlook. Im Beispielpostfach bleiben die Knöpfe verborgen.
- Der Token bleibt außerhalb der Sicherung. Kennungen der Notiz dürfen in der Sicherung stehen.
- Kein Anhang-Upload, keine Bereiche, Themen, Meetings oder Tagesnotiz, kein Rückweg aus Capacities.
- Windows-Abnahme, die offenen Entscheidungen in `docs/PLAN.md` Abschnitt 6 und die seltenen Fehler in Abschnitt 7 gehören nicht in diesen Plan.

---

### Task 1: Nachtrag und Objektverweis

**Files:** `src/capacities.ts`, `src/board.ts`, `tests/capacities.test.ts`

- [x] Test: unveränderter zweiter Klick erzeugt keinen Aufruf.
- [x] Test: geänderter Text hängt `## Nachtrag` an die Notiz und sendet den alten Markdown-Körper nicht noch einmal.
- [x] Test: der Projektverweis ist ein `LinkToken` mit `entityId` der Notiz und ohne den Mailtext.
- [x] `saveMailAsNote` hängt den Nachtrag nur an, wenn `supplement` gesetzt ist.
- [x] Das Board speichert einen Stempel aus Betreff, Text und Kartennotiz. Gleicher Stempel meldet „schon eine Notiz“. Ein neuer Stempel hängt den Nachtrag an.

### Task 2: Person an Name oder Adresse

**Files:** `src/capacities.ts`, `tests/capacities.test.ts`

- [x] Test: eine Person mit dem Titel der Mailadresse wird wiederverwendet, es entsteht keine zweite.
- [x] Die Suche trifft, wenn der Titel dem Anzeigenamen oder der Adresse entspricht.

### Task 3: Später, nicht in diesem Durchgang

- Eine Text-Eigenschaft der Notiz für die Mail-Kennung, damit eine neue Installation dieselbe Notiz findet. Nur wenn der Typ so eine Eigenschaft hat.
- Anhangdateien, sobald das Board die Datei selbst lesen kann.
- Status und Bereich des Projekt-Typs bleiben leer, bis die Eigenschaften aus dem Space bekannt und bestätigt sind.
