@echo off
setlocal
cd /d "%~dp0"
set "CSC=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo .NET Framework 4.8 wurde nicht gefunden: %CSC%
  exit /b 1
)
"%CSC%" /nologo /target:winexe /platform:anycpu /out:Mail-Board-Outlook.exe /reference:Microsoft.CSharp.dll /reference:System.Web.Extensions.dll OutlookBridge.cs BoardCommands.cs
