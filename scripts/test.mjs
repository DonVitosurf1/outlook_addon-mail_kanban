import { build } from 'esbuild'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const files=(await readdir('tests')).filter(name=>name.endsWith('.test.ts'))
if (!files.length) throw new Error('Keine TypeScript-Tests gefunden')
const directory=await mkdtemp(join(tmpdir(),'mail-board-tests-'))
try {
  await build({entryPoints:files.map(f=>'tests/'+f),outdir:directory,bundle:true,platform:'node',format:'cjs',outExtension:{'.js':'.cjs'}})
  const args=files.map(name=>join(directory,name.replace(/\.ts$/,'.cjs')))
  const result=spawnSync(process.execPath,['--test',...args],{stdio:'inherit'})
  if(result.error)throw result.error
  process.exitCode=result.status??1
} finally { await rm(directory,{recursive:true,force:true}) }
