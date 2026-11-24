"""Kartenmetadaten und native Mausdrops auf freie Spalten- und Gruppenzellen nach npm run build."""
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import shutil
from playwright.sync_api import sync_playwright,expect

root=Path(__file__).resolve().parents[1]
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=root/'dist'))
Thread(target=server.serve_forever,daemon=True).start()
mock="""
const folders=[{id:'01',name:'Posteingang',isInbox:true,path:''},{id:'02',name:'Labor',path:'Labor'}]
const base={sender:'Sabine Wolf',subject:'Wartung der Anlage',folder:'Posteingang',folderId:'01',body:'',attachments:[],tags:[]}
const rows=[{...base,id:'aa',status:'Offen',received:'2026-11-21T08:07:00Z'},
{...base,id:'bb',status:'Warten',followUp:'2026-11-21',received:'2026-11-20T12:47:00Z',folder:'Labor',folderId:'02'}]
localStorage.setItem('kanban-board-options-v1',JSON.stringify({project_folders:['Labor'],allow_move:true,poll_seconds:0}))
window.__TAURI__={core:{invoke:async(name,args={})=>{
 if(name==='outlook_folders')return JSON.stringify(folders)
 if(name==='outlook_board')return JSON.stringify(rows)
 if(name==='outlook_correspondence')return '{"incoming":[],"sent":[]}'
 if(name==='outlook_categories')return '[]'
 if(name==='outlook_status'){
   const m=rows.find(m=>m.id===args.id),previous=m.status;m.status=args.status;return JSON.stringify({previous})
 }
 if(name==='outlook_move'){
   const m=rows.find(m=>m.id===args.id);m.folderId=args.target;m.folder='Labor';return JSON.stringify({id:m.id,source:args.source,target:args.target})
 }
 return '{}'
}}}
"""
def drag_to_blank(p,source,target):
 source.scroll_into_view_if_needed()
 dest=target.evaluate("""el=>{
 const b=el.getBoundingClientRect()
 const screen=el.closest('#board').getBoundingClientRect()
 for(let y=Math.min(b.bottom,screen.bottom,innerHeight)-4;y>Math.max(0,screen.top,b.top);y-=4)
  for(let x=Math.max(b.left,screen.left,0)+4;x<Math.min(b.right,screen.right,innerWidth);x+=4)
   if(document.elementFromPoint(x,y)===el)return {x,y}
 return null
 }""")
 assert dest, "Keine freie Ablagefläche im Ziel sichtbar"
 src=source.bounding_box()
 p.mouse.move(src['x']+10,src['y']+8)
 p.mouse.down();p.mouse.move(src['x']+26,src['y']+8,steps=4)
 p.mouse.move(dest['x']+1,dest['y'],steps=12);p.mouse.move(dest['x'],dest['y']);p.mouse.up()

try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=shutil.which('chromium'))
  p=browser.new_page(viewport={'width':1440,'height':900},timezone_id='Europe/Berlin')
  p.add_init_script("localStorage.setItem('board.layout.intro','1')")
  p.clock.set_fixed_time(datetime(2026,11,21,12,0,tzinfo=timezone.utc))
  p.add_init_script(mock);p.goto(f'http://127.0.0.1:{server.server_port}/')
  source=p.locator('#mail-aa');expect(source).to_be_visible()
  expect(source.locator(':scope > :first-child')).to_have_text('Wartung der Anlage')
  expect(source.locator('time')).to_have_text('09:07')
  expect(source.locator('time')).to_have_attribute('datetime','2026-11-21T08:07:00Z')
  assert '21. November 2026' in source.locator('time').get_attribute('title')
  waiting=p.locator('#mail-bb')
  expect(waiting.locator('time')).to_have_text('20.11.')
  expect(waiting.locator('.card-attention')).to_have_text('Heute nachfassen')
  assert '2026-11-21' not in waiting.inner_text()
  drag_to_blank(p,source,p.locator('.lane[data-status="In Bearbeitung"]'))
  expect(p.locator('.lane[data-status="In Bearbeitung"] #mail-aa')).to_be_attached()
  trigger=p.locator('#viewMenu summary')
  trigger.click()
  p.get_by_label('Gruppierung',exact=True).select_option("folder")
  trigger.click()
  cell=p.locator('.group-cell[data-folder="02"][data-status="Offen"]')
  drag_to_blank(p,source,cell)
  p.locator('#moveConfirm button[value="confirm"]').click()
  expect(cell.locator('#mail-aa')).to_be_attached()
  print('OK: Zeit, Betreff, Nachfassen, native Drag-and-drop-Bewegung auf freie Spalten- und Gruppenfläche.')
  browser.close()
finally:
 server.shutdown()
