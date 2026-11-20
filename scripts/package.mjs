import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { zipSync, unzipSync } from 'fflate'

const release=process.argv[2]||'src-tauri/target/release'
const files={}
for(const [source,name] of [['outlook-kanban-demo.exe','Mail-Board.exe'],['Outlook-Test.exe','Outlook-Test.exe']])
  files[name]=new Uint8Array(await readFile(join(release,source)))
// MSVC links the WebView2 loader statically. GNU builds ship its runtime DLL.
try {
  files['WebView2Loader.dll']=new Uint8Array(await readFile(join(release,'WebView2Loader.dll')))
} catch(error) { if(error.code!=='ENOENT')throw error }
const archive=zipSync(files,{level:6})
const unpacked=unzipSync(archive)
for(const [key,bytes] of Object.entries(files))
  if (!Buffer.from(unpacked[key]).equals(bytes))throw new Error('ZIP-Prüfung fehlgeschlagen: '+key)
await mkdir('downloads',{recursive:true})
await writeFile('downloads/Mail-Board-Windows-x64.zip',archive)
console.log('downloads/Mail-Board-Windows-x64.zip',archive.length,'Bytes')
