# In a Windows desktop session: .\tests\window-reopen.ps1 -Exe C:\Test\Mail-Board.exe
param([Parameter(Mandatory = $true)][string]$Exe)
$ErrorActionPreference = 'Stop'
$binary = (Resolve-Path -LiteralPath $Exe).ProviderPath
if (Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($binary)) -ErrorAction SilentlyContinue) {
    throw 'Bitte offene Mail-Board-Fenster vor dem Test schließen.'
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MailBoardWindowTest {
    public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32")] public static extern bool MoveWindow(IntPtr window, int x, int y, int w, int h, bool paint);
    [DllImport("user32")] public static extern bool ShowWindow(IntPtr window, int command);
}
'@
function Start-BoardWindow {
    $script:boardProcess = Start-Process -FilePath $binary -PassThru
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while ($timer.Elapsed.TotalSeconds -lt 30) {
        $script:boardProcess.Refresh()
        if ($script:boardProcess.HasExited) { throw 'Mail-Board wurde vorzeitig beendet.' }
        if ($script:boardProcess.MainWindowHandle -ne [IntPtr]::Zero) {
            return $script:boardProcess.MainWindowHandle
        }
        Start-Sleep -Milliseconds 100
    }
    throw 'Das Hauptfenster erschien nicht innerhalb von 30 Sekunden.'
}
function Close-BoardWindow {
    if ($script:boardProcess -and !$script:boardProcess.HasExited) {
        if (!$script:boardProcess.CloseMainWindow() -or !$script:boardProcess.WaitForExit(30000)) {
            throw 'Das Hauptfenster konnte nicht regulär beendet werden.'
        }
    }
}
function Read-Rectangle([IntPtr]$Window) {
    $rect = New-Object MailBoardWindowTest+Rect
    if (![MailBoardWindowTest]::GetWindowRect($Window, [ref]$rect)) {
        throw 'Fensterrechteck konnte nicht gelesen werden.'
    }
    return $rect
}
$monitor = [Windows.Forms.Screen]::AllScreens | Where-Object { !$_.Primary } | Select-Object -First 1
if (!$monitor) { $monitor = [Windows.Forms.Screen]::PrimaryScreen }
$area = $monitor.WorkingArea
$stateFile = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'de.outlookkanban.mailboard\.window-state.json'
$previousState = if ([IO.File]::Exists($stateFile)) { ,([IO.File]::ReadAllBytes($stateFile)) }
try {
    $window = Start-BoardWindow
    [void][MailBoardWindowTest]::ShowWindow($window, 9)
    if (![MailBoardWindowTest]::MoveWindow($window, $area.Left+40, $area.Top+40,
        [Math]::Min(1000, $area.Width-60), [Math]::Min(650, $area.Height-60), $true)) {
        throw 'Testfenster ließ sich nicht positionieren.'
    }
    Start-Sleep -Milliseconds 500
    $expected = Read-Rectangle $window
    Close-BoardWindow
    $window = Start-BoardWindow
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        $actual = Read-Rectangle $window
        $mismatch = @('Left','Top','Right','Bottom' | Where-Object { [Math]::Abs($actual.$_ - $expected.$_) -gt 8 })
        if (!$mismatch.Count) { break }
        Start-Sleep -Milliseconds 100
    } while ($timer.Elapsed.TotalSeconds -lt 10)
    if ($mismatch.Count) { throw ('Fenstergeometrie weicht nach Neustart ab: ' + ($mismatch -join ', ')) }
    Write-Output ('Position und Größe nach Neustart wiederhergestellt auf ' + $monitor.DeviceName)
} finally {
    Close-BoardWindow
    if ($null -ne $previousState) { [IO.File]::WriteAllBytes($stateFile, $previousState) }
    elseif ([IO.File]::Exists($stateFile)) { [IO.File]::Delete($stateFile) }
}
