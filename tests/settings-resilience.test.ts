import assert from 'node:assert/strict'
import test from 'node:test'
import { getLegacyConfig, getLegacyProfiles, textSnippets, updateConfig, useSampleSettings } from '../src/data-settings'
import { readStoredRules } from '../src/stored-rules'

function storage(){
  const map=new Map<string,string>()
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    get length(){return map.size},
    key:(index:number)=>[...map.keys()][index]??null,
    getItem:(key:string)=>map.get(key)??null,
    setItem:(key:string,value:string)=>{map.set(key,value)},
    removeItem:(key:string)=>{map.delete(key)},
  }})
  useSampleSettings(false)
  return map
}

test('beschädigte lokale Einstellungen lassen das Board stehen',()=>{
  storage()
  localStorage.setItem('kanban-board-options-v1','{')
  localStorage.setItem('kanban-import-v1','{')
  localStorage.setItem('kanban-profile-edits-v1','{')
  localStorage.setItem('kanban-snippets-v1','{')
  assert.doesNotThrow(()=>getLegacyConfig())
  assert.deepEqual(getLegacyConfig().vip_senders,undefined)
  assert.doesNotThrow(()=>getLegacyProfiles())
  assert.doesNotThrow(()=>textSnippets('note'))
  updateConfig({allow_move:true})
  assert.equal(getLegacyConfig().allow_move,true)
})

test('unlesbare Ablageregeln werden nicht umgeschrieben',()=>{
  assert.equal(readStoredRules('{'),undefined)
  assert.deepEqual(readStoredRules(JSON.stringify({items:[{folder:'Labor'}]})).items,[{folder:'Labor'}])
  assert.equal(readStoredRules(null),undefined)
})
