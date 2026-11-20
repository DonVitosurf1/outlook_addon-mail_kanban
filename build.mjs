import { build } from 'esbuild'
import { mkdir, copyFile } from 'node:fs/promises'
await mkdir('dist',{recursive:true})
await build({entryPoints:['src/board.ts'],bundle:true,minify:true,outfile:'dist/board.js',target:'es2022'})
for(const file of ['index.html','board.css']) await copyFile(file,'dist/'+file)
