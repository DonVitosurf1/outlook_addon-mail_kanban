from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from threading import Thread
from functools import partial
from pathlib import Path
import shutil
from playwright.sync_api import sync_playwright,expect
server=ThreadingHTTPServer(('127.0.0.1',0),partial(SimpleHTTPRequestHandler,directory=Path(__file__).resolve().parents[1]/'dist'))
Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=shutil.which('chromium'),args=['--no-sandbox'])
 p=b.new_page(viewport={'width':1280,'height':800})
 errors=[]
 p.on('pageerror',lambda e:errors.append(str(e)))
 p.goto(f'http://127.0.0.1:{server.server_port}/')
 expect(p.locator('.card')).to_have_count(14)
 a=p.locator('#mail-DEMO0000');c=p.locator('#mail-DEMO0001')
 a.click(modifiers=['Control']);c.click(modifiers=['Control'])
 expect(p.locator('.selection-count')).to_have_text('2 markiert')
 c.focus();p.keyboard.press('3')
 expect(p.locator('.lane').nth(2).locator('#mail-DEMO0000')).to_have_count(1)
 expect(p.locator('.lane').nth(2).locator('#mail-DEMO0001')).to_have_count(1)
 p.locator('#undo').click()
 expect(p.locator('.lane').first.locator('#mail-DEMO0000')).to_have_count(1)
 p.locator('#mail-DEMO0000').focus();p.keyboard.press('k')
 d=p.locator('.view-dialog[open]')
 expect(d).to_be_visible()
 d.get_by_role('combobox',name='Textbaustein einfügen').select_option(index=1)
 d.get_by_role('button',name='Übernehmen').click()
 expect(p.locator('#mail-DEMO0000')).to_contain_text('Notiz')
 p.get_by_label('Gruppierung',exact=True).select_option('tag');expect(p.locator('.group-label').first).to_be_visible()
 p.locator('.group-label button').first.click()
 expect(p.locator('.group-label button').first).to_have_attribute('aria-expanded','false')
 p.get_by_label('Benannte Sicht').select_option('undated');expect(p.locator('#summary')).to_contain_text('3 von 14')
 p.locator('#search').fill('unfindbarer text')
 expect(p.locator('.card')).to_have_count(0)
 p.locator('#viewControls').get_by_role('button',name='Zurücksetzen').click()
 expect(p.locator('#summary')).to_contain_text('14 von 14')
 # Keyboard preview follows focus without reopening a blocking dialog.
 p.get_by_label('Gruppierung',exact=True).select_option('')
 a.focus();p.keyboard.press('Shift+Space')
 expect(p.get_by_role('complementary',name='Kurzvorschau')).to_contain_text('Angebot Pipettenspitzen')
 p.keyboard.press('ArrowDown')
 expect(p.get_by_role('complementary',name='Kurzvorschau')).to_contain_text('Raumplanung')
 p.keyboard.press('Escape')
 expect(p.get_by_role('complementary',name='Kurzvorschau')).to_have_count(0)
 p.get_by_role('button',name='Offen einklappen').click()
 expect(a).to_be_hidden()
 p.get_by_role('button',name='Offen ausklappen').click()
 expect(a).to_be_visible()
 separator=p.get_by_role('separator',name='Ordnerleiste anpassen')
 width=p.locator('.sidebar').bounding_box()['width']
 separator.focus();p.keyboard.press('ArrowRight')
 assert p.locator('.sidebar').bounding_box()['width']>width
 p.get_by_label('Gruppierung',exact=True).select_option('folder')
 target=p.locator('.group-cell[data-folder=Posteingang][data-status=Warten]')
 dt=p.evaluate_handle('new DataTransfer()')
 p.dispatch_event('#mail-DEMO0000','dragstart',{'dataTransfer':dt})
 target.dispatch_event('drop',{'dataTransfer':dt})
 expect(target.locator('#mail-DEMO0000')).to_have_count(1)
 p.locator('#undo').click()
 expect(p.locator('.group-cell[data-folder=Pipettenspitzen][data-status=Offen] #mail-DEMO0000')).to_have_count(1)
 p.get_by_label('Gruppierung',exact=True).select_option('')
 p.keyboard.press('Control+g')
 sent=p.get_by_role('dialog',name='Gesendet ohne Antwort')
 expect(sent.locator('input')).to_have_count(2)
 sent.locator('input').first.check()
 sent.get_by_role('button',name='Auf „Warten“ setzen').click()
 expect(sent.locator('input')).to_have_count(1)
 sent.get_by_role('button',name='Schließen').click()
 expect(p.locator('.lane[data-status=Warten] #mail-SENT-DEMO1')).to_have_count(1)
 p.keyboard.press('Control+g');expect(sent.locator('input')).to_have_count(1)
 sent.get_by_role('button',name='Schließen').click()
 p.locator('#undo').click()
 expect(p.locator('#mail-SENT-DEMO1')).to_have_count(0)
 p.keyboard.press('Control+g');expect(sent.locator('input')).to_have_count(2)
 assert not errors,errors
 # A real DOM roundtrip with a replaceable COM boundary checks partial writes and reply evidence.
 p=b.new_page()
 p.add_init_script("""
 localStorage.setItem('kanban-board-options-v1', JSON.stringify({poll_seconds:0,reply_to_offen:true}))
 const days=d=>new Date(Date.now()-d*86400000).toISOString()
 const waiting={id:'aa',status:'Warten',isSent:true,conversationId:'thread',folder:'Gesendet',folderId:'02',statusSince:days(3),subject:'Warten auf Antwort',sender:'Ich',received:days(3),body:'',tags:[],attachments:[]}
 const reply={...waiting,id:'ab',isSent:false,folder:'Posteingang',folderId:'01',status:'Offen',sender:'Anna',received:days(1),subject:'Antwort auf Freigabe'}
 const outbound=['ac','ad'].map(id=>({...waiting,id,conversationId:id,hasStatus:false,status:'Offen',received:days(2),subject:'Gesendet '+id}))
 let rows=[waiting,reply]
 window.statusCalls=[]
 window.__TAURI__={core:{invoke:async (name,args={})=>{
   if(name==='outlook_folders')return JSON.stringify([{id:'01',isInbox:true,name:'Posteingang',path:''},{id:'02',name:'Gesendet',path:'Gesendet'}])
   if(name==='outlook_board')return JSON.stringify(rows)
   if(name==='outlook_categories')return '[]'
   if(name==='outlook_correspondence')return JSON.stringify({incoming:[reply],sent:outbound})
   if(name==='outlook_batch'||name==='outlook_prefix')return '{}'
   if(name==='outlook_status'){
     if(args.id==='ad')throw Error('Einzelne Mail gesperrt')
     const row=[...rows,...outbound].find(m=>m.id===args.id)
     const previous=row.status
     row.status=args.status
     if(row.id==='ac'){
       row.hasStatus=args.status==='Warten'
       rows=rows.filter(m=>m.id!=='ac')
       if(row.hasStatus)rows.push(row)
     }
     statusCalls.push({id:row.id,status:args.status})
     return JSON.stringify({previous})
   }
   throw Error('Unbekannt: '+name)
 }}}
 """)
 p.on('pageerror',lambda e:errors.append(str(e)))
 p.goto(f'http://127.0.0.1:{server.server_port}/')
 p.locator('#loadInbox').click()
 expect(p.locator('.lane[data-status=Erledigt] #mail-aa')).to_have_count(1)
 p.locator('#undo').click()
 expect(p.locator('.lane[data-status=Warten] #mail-aa')).to_contain_text('Antwort von Anna')
 p.locator('#loadInbox').click()
 expect(p.locator('#loadInbox')).to_be_enabled()
 p.locator('#mail-aa').click()
 expect(p.locator('#detailActions')).to_contain_text('Antwort von Anna')
 p.locator('#detailActions').get_by_role('button',name='Warten abschließen').click()
 expect(p.locator('.lane[data-status=Erledigt] #mail-aa')).to_have_count(1)
 p.keyboard.press('Control+g')
 sdialog=p.get_by_role('dialog',name='Gesendet ohne Antwort')
 expect(sdialog.locator('input')).to_have_count(2)
 for check in sdialog.locator('input').all():check.check()
 sdialog.get_by_role('button',name='Auf „Warten“ setzen').click()
 expect(sdialog.get_by_role('status')).to_contain_text('1 von 2')
 expect(sdialog.get_by_role('status')).to_contain_text('Einzelne Mail gesperrt')
 expect(sdialog.locator('input')).to_have_count(1)
 sdialog.get_by_role('button',name='Schließen').click()
 expect(p.locator('.lane[data-status=Warten] #mail-ac')).to_have_count(1)
 p.locator('#undo').click()
 expect(p.locator('#mail-ac')).to_have_count(0)
 assert p.evaluate("statusCalls.filter(x=>x.id==='aa').map(x=>x.status).join(',')")== 'Erledigt,Warten,Erledigt'
 assert not errors,errors
 print('OK: Auswahl, Filter, Folgevorschau, Gruppen-Ablage und Undo, gesendete Mails, Teilfehler, manuelle und automatische Antwortauflösung.')
 b.close()
