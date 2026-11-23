@echo off
cd /d "%~dp0"
"%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /platform:anycpu /out:Mail-Board-Outlook.exe /reference:Microsoft.CSharp.dll /reference:System.Web.Extensions.dll OutlookBridge.cs BoardCommands.cs
