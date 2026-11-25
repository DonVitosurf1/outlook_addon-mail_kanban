import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { zipSync, unzipSync } from 'fflate'

const release=process.argv[2]||'src-tauri/target/release'
const { version }=JSON.parse(await readFile('package.json','utf8'))
const files={}
for(const [source,name] of [['mail-board.exe','Mail-Board.exe'],['Mail-Board-Outlook.exe','Mail-Board-Outlook.exe']])
  files[name]=new Uint8Array(await readFile(join(release,source)))
// MSVC links the WebView2 loader statically. GNU builds ship its runtime DLL.
try {
  files['WebView2Loader.dll']=new Uint8Array(await readFile(join(release,'WebView2Loader.dll')))
} catch(error) { if(error.code!=='ENOENT')throw error }
files['Start.txt']=new TextEncoder().encode([
  `Mail-Board ${version} für klassisches Outlook`,
  '',
  '1. Alle Dateien aus dem ZIP in denselben Ordner entpacken.',
  '2. Mail-Board.exe starten. Die App lädt automatisch die Mails aus dem eingerichteten klassischen Outlook-Profil.',
  '3. Bei einem Verbindungsfehler bleibt das Board leer. Klassisches Outlook mit dem eigenen Profil öffnen, offene Outlook-Dialoge schließen und im Board erneut verbinden.',
  'Zum Ausprobieren ohne Postfach: Werkzeuge → Beispielpostfach öffnen.',
  '',
  'Windows x64 mit WebView2 Runtime. Der Outlook-Helfer benötigt .NET Framework 4.8.',
  'Für normale Nutzung sind keine Entwicklerwerkzeuge erforderlich. Lokale KI ist optional.',
  'Den vollständigen Test mit Verschieben und Strg+Z beschreibt Windows-Pruefliste.md.',
].join('\r\n'))
files['Windows-Pruefliste.md']=new Uint8Array(await readFile('docs/WINDOWS-ABNAHME.md'))
// Versuchsweiser Outlook-Hintergrundserver. Liegt neben der EXE unter outlook-server/
// und wird nur mit gesetztem MAILBOARD_OUTLOOK_SERVER genutzt (siehe outlook-server/README.md).
files['outlook-server/mailboard_server.py']=new Uint8Array(await readFile('outlook-server/mailboard_server.py'))
files['Mail-Board-mit-Server.cmd']=new Uint8Array(await readFile('Mail-Board-mit-Server.cmd'))
const archive=zipSync(files,{level:6})
const unpacked=unzipSync(archive)
for(const [key,bytes] of Object.entries(files))
  if (!Buffer.from(unpacked[key]).equals(bytes))throw new Error('ZIP-Prüfung fehlgeschlagen: '+key)
await mkdir('downloads',{recursive:true})
await writeFile('downloads/Mail-Board-Windows-x64.zip',archive)
console.log('downloads/Mail-Board-Windows-x64.zip',archive.length,'Bytes')
