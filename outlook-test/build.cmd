@echo off
cd /d "%~dp0"
"%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /platform:anycpu /out:Outlook-Test.exe /reference:Microsoft.CSharp.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll OutlookTest.cs
