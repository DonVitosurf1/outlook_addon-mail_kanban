// Baut den Outlook-Helfer (C#, .NET Framework 4.8) mit dem in Windows enthaltenen Compiler.
// Außerhalb von Windows gibt es diesen Compiler nicht. Dort bleibt der Schritt aus.
import { spawnSync } from 'node:child_process'

if (process.platform !== 'win32') {
  console.log('Outlook-Helfer: nur unter Windows baubar, Schritt übersprungen.')
} else {
  const result = spawnSync('cmd.exe', ['/d', '/c', 'outlook-test\\build.cmd'], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Outlook-Helfer konnte nicht gebaut werden (outlook-test\\build.cmd).')
  console.log('Outlook-Helfer gebaut: outlook-test\\Mail-Board-Outlook.exe')
}
