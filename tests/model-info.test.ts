import assert from 'node:assert/strict'
import test from 'node:test'
import { formatModelInfo, formatParameters } from '../src/model-info'

test('Modellinfo: Größe, Quantisierung, Kontext und GPU in einer Zeile',()=>{
  assert.equal(formatModelInfo({parameters:8030261248,quantization:'Q4_K_M',context:8192,loaded:true,gpu:1}),'8 B · Q4_K_M · 8.192 Token · GPU')
  assert.equal(formatModelInfo({parameters:7.6e9,loaded:true,gpu:0.6}),'7,6 B · GPU 60 %')
  assert.equal(formatModelInfo({quantization:'F16',loaded:true,gpu:0}),'F16 · CPU')
  assert.equal(formatModelInfo({context:32768,loaded:false}),'32.768 Token · noch nicht geladen')
  assert.equal(formatModelInfo({loaded:true}),'geladen')
  // Geladen zählt die tatsächliche Kontextlänge, nicht die größte mögliche.
  assert.equal(formatModelInfo({context:131072,loaded_context:4096,loaded:true,gpu:1}),'Kontext 4.096 Token (geladen) · GPU')
  assert.equal(formatModelInfo({context:131072,loaded_context:4096,loaded:false}),'131.072 Token · noch nicht geladen')
})
test('Modellinfo: fehlende und ungültige Angaben werden weggelassen',()=>{
  assert.equal(formatModelInfo({}),'Keine Angaben vom Modellserver')
  assert.equal(formatModelInfo('[]'),'Keine Angaben vom Modellserver')
  assert.equal(formatModelInfo(null),'Keine Angaben vom Modellserver')
  assert.equal(formatModelInfo({parameters:-1,context:Number.NaN,quantization:' ',loaded:'ja',gpu:2}),'Keine Angaben vom Modellserver')
  assert.equal(formatModelInfo({loaded:true,gpu:7}),'GPU')
})
test('Parameterzahl in Milliarden oder Millionen',()=>{
  assert.equal(formatParameters(137e6),'137 M')
  assert.equal(formatParameters(1.54e9),'1,5 B')
  assert.equal(formatParameters(70.55e9),'70,6 B')
})
