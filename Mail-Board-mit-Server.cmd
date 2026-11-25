@echo off
REM ==========================================================================
REM  Startet Mail-Board.exe mit dem Python-Hintergrundserver (Versuch).
REM  Diese Datei gehoert in denselben Ordner wie Mail-Board.exe.
REM
REM  Aufruf:   Mail-Board-mit-Server.cmd         (echtes Outlook ueber Python)
REM            Mail-Board-mit-Server.cmd demo    (Beispieldaten, ohne Outlook)
REM
REM  Zum Zurueckschalten einfach Mail-Board.exe normal starten.
REM  Erklaerung: outlook-server\README.md
REM ==========================================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "EXE=Mail-Board.exe"
if not exist "%EXE%" (
    echo [Fehler] %EXE% liegt nicht in diesem Ordner:
    echo          %CD%
    echo Diese Datei gehoert neben Mail-Board.exe im entpackten ZIP.
    pause
    exit /b 1
)

REM --- Server einschalten -------------------------------------------------
set "MAILBOARD_OUTLOOK_SERVER=1"

REM --- Demo-Quelle, wenn "demo" uebergeben wird --------------------------
if /I "%~1"=="demo" (
    set "MAILBOARD_SERVER_DEMO=1"
    echo Hinweis: Demo-Quelle aktiv, es werden keine echten Mails gelesen.
)

REM --- Python finden (falls nicht schon ueber MAILBOARD_PYTHON gesetzt) ---
if defined MAILBOARD_PYTHON goto :havepython

set "VENV=%LOCALAPPDATA%\OutlookKanban\venv\Scripts\python.exe"
if exist "%VENV%" (
    set "MAILBOARD_PYTHON=%VENV%"
    echo Python aus der vorhandenen venv der Python-App.
    goto :havepython
)

for /f "delims=" %%P in ('py -3 -c "import sys;print(sys.executable)" 2^>nul') do set "MAILBOARD_PYTHON=%%P"
if defined MAILBOARD_PYTHON goto :havepython

for /f "delims=" %%P in ('where python 2^>nul') do (
    set "MAILBOARD_PYTHON=%%P"
    goto :havepython
)

echo [Fehler] Kein Python gefunden.
echo Bitte Python 3 installieren (https://www.python.org/downloads/, "Add python.exe to PATH")
echo oder vor dem Start MAILBOARD_PYTHON auf eine python.exe setzen.
pause
exit /b 1

:havepython
echo Python:  "%MAILBOARD_PYTHON%"

REM --- pywin32 pruefen (nur Hinweis; ohne faellt die App auf den Helfer zurueck) ---
if not defined MAILBOARD_SERVER_DEMO (
    "%MAILBOARD_PYTHON%" -c "import win32com.client" >nul 2>&1
    if errorlevel 1 (
        echo [Hinweis] In diesem Python fehlt pywin32. Fuer echtes Outlook einmalig:
        echo           "%MAILBOARD_PYTHON%" -m pip install pywin32
        echo           Ohne pywin32 nutzt die App weiter den bisherigen Outlook-Helfer.
    )
)

echo Server:  an (MAILBOARD_OUTLOOK_SERVER=1)
echo Starte %EXE% ...
start "" "%EXE%"
endlocal
