@echo off
setlocal
rem Baut Mail-Board vollständig unter Windows: Oberfläche, Outlook-Helfer, Desktop-App und ZIP.
rem Doppelklick genügt. Das Ergebnis liegt danach in downloads\Mail-Board-Windows-x64.zip.
cd /d "%~dp0"

echo Mail-Board wird gebaut.
echo.
call :need node "Node.js (https://nodejs.org, LTS)" || goto fail
call :need npm "Node.js mit npm" || goto fail
call :need cargo "Rust (https://rustup.rs, Toolchain stable-x86_64-pc-windows-msvc)" || goto fail
if not exist "%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" (
  echo Fehlt: .NET Framework 4.8 ^(fuer den Outlook-Helfer^).
  goto fail
)

echo [1/4] Abhaengigkeiten installieren ...
call npm ci || goto fail
echo [2/4] Tests ...
call npm test || goto fail
echo [3/4] Outlook-Helfer, Desktop-App und ZIP bauen ...
call npm run portable || goto fail
echo [4/4] Fertig.
echo.
echo Das Paket liegt unter: %CD%\downloads\Mail-Board-Windows-x64.zip
echo Die App selbst: %CD%\src-tauri\target\release\mail-board.exe
explorer "%CD%\downloads"
pause
exit /b 0

:need
where %1 >nul 2>nul && exit /b 0
echo Fehlt: %~2
exit /b 1

:fail
echo.
echo Der Bau ist fehlgeschlagen. Die Meldungen oben nennen den Grund.
pause
exit /b 1
