import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createApp} from '../server/index.js';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const app=await createApp({dbFile:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
const out='output/poker-layout';await mkdir(out,{recursive:true});const checks=[],errors=[];
const sizes=[[320,568],[390,844],[430,932],[741,837],[768,1024],[1024,768],[1440,900],[1920,1080],[844,390]];
const ready=p=>p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).connected);
const read=p=>p.evaluate(()=>JSON.parse(window.render_game_to_text()).room);
function fixture(count=2,mode='phones'){
 const people=Array.from({length:count},(_,i)=>app.store.create(['Alexandra','Christopher','Samantha','Maximilian','Josephine','Nora','Leo','Ali'][i]));
 const r=app.manager.create(people[0],{name:'Friday night',mode,game:'poker'});
 for(const p of people){app.manager.join(r,p);app.manager.connect(r,p.id,'fixture-'+p.id);}
 app.manager.connect(r,null,'fixture-display',true);app.manager.start(r);r.version++;
 return {r,people};
}
async function open(browser,f,path='table',id=f.people[0].id){
 const c=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
 if(path==='room')await c.addCookies([{name:'table_session',value:app.store.session(id),url:base}]);
 const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/'+path+'/'+f.r.code);await ready(p);return p;
}
async function check(p,name){
 await p.evaluate(async()=>{await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
 const g=await p.evaluate(()=>{
  const visible=e=>e.getClientRects().length&&!e.closest('[inert]');
  const outside=[...document.querySelectorAll('.room-header,.table-centre,.seat,.seat-meta,.seat-action,.seat-status,.result-summary,.display-footer,.action-dock,.hand-content,.round-tabs,.table-controls,.card,#peek')].filter(visible).filter(e=>{const b=e.getBoundingClientRect();return b.left<-.5||b.right>innerWidth+.5||b.top<-.5||b.bottom>innerHeight+.5;}).map(e=>[e.className,Math.round(e.getBoundingClientRect().bottom)]);
  const box=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom};};
  const overlaps=(a,b)=>Math.min(a.right,b.right)-Math.max(a.x,b.x)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>2;
  const seats=[...document.querySelectorAll('.seat')].map(box),board=document.querySelector('.table-centre');
  const collisions=seats.flatMap((a,i)=>seats.slice(i+1).map((b,j)=>overlaps(a,b)?[i,i+j+1]:null).filter(Boolean));
  if(board)for(const [i,a]of seats.entries())if(overlaps(a,box(board)))collisions.push(['board',i]);
  const clippedSeats=[...document.querySelectorAll('.seat')].flatMap((seat,i)=>{const a=seat.getBoundingClientRect();return [...seat.children].filter(e=>{const b=e.getBoundingClientRect();return b.top<a.top-2||b.bottom>a.bottom+2||b.left<a.left-2||b.right>a.right+2;}).map(e=>[i,e.className]);});
  const tinyCards=[...document.querySelectorAll('.own-cards .card')].filter(e=>e.getBoundingClientRect().width<50).length;
  return {scrollX:document.documentElement.scrollWidth>innerWidth+1,scrollY:document.documentElement.scrollHeight>innerHeight+1,outside,collisions,clippedSeats,tinyCards};
 });
 checks.push({name,...g});
 if(/390x844|1440x900|320x568|844x390/.test(name))await p.screenshot({path:`${out}/${name}.png`});
 assert.deepEqual(g,{scrollX:false,scrollY:false,outside:[],collisions:[],clippedSeats:[],tinyCards:0},name);
}
function advance(r){let guard=0;while(r.phase==='playing'){assert.ok(++guard<100);const a=r.engine.legalActions().actions;app.manager.action(r,app.manager.activeId(r),a.includes('check')?'check':'call');}r.version++;}
try{
 for(const [engine,name]of [[chromium,'chromium'],[webkit,'webkit']]){
  const browser=await engine.launch({headless:true});
  try{
   for(const count of [2,3,4,5,6,7,8]){
    const f=fixture(count),p=await open(browser,f);
    for(const [width,height]of sizes){await p.setViewportSize({width,height});await check(p,`${name}-table-${count}-${width}x${height}`);}
    advance(f.r);await p.reload();await ready(p);
    for(const [width,height]of [[320,568],[390,844],[1440,900],[844,390]]){await p.setViewportSize({width,height});await check(p,`${name}-complete-${count}-${width}x${height}`);}
    await p.context().close();
   }
   const f=fixture(8),host=await open(browser,f,'room',app.manager.activeId(f.r));
   assert.equal(await host.locator('.table-stage').count(),0);
   for(const [width,height]of sizes){await host.setViewportSize({width,height});await check(host,`${name}-hand-${width}x${height}`);}
   await host.setViewportSize({width:390,height:844});
   await host.locator('#peek').focus();await host.keyboard.down('Space');assert.ok((await read(host)).me.cards.every(Boolean));await host.keyboard.up('Space');assert.ok((await read(host)).me.cards.every(c=>c===null));
   await host.locator('[data-do=table-view]').click();assert.equal(await host.locator('.private-hand').count(),0);assert.equal(await host.locator('#peek').count(),0);
   assert.equal(await host.locator('.seat-cards [aria-label="Face-down card"]').count(),16);
   for(const [width,height]of sizes){await host.setViewportSize({width,height});await check(host,`${name}-table-tab-${width}x${height}`);}
   await host.getByRole('button',{name:'Play your hand'}).click();await host.locator('[data-do=raise]').click();await host.locator('.betting-modal').waitFor();await host.getByLabel('Close betting').click();
   await host.locator('[data-do=table-view]').click();await host.request.post(base+'/api/rooms/'+f.r.code+'/command',{data:{command:'action',args:{action:'call'},version:f.r.version,requestId:crypto.randomUUID()}});await host.waitForFunction(()=>document.querySelector('.table-controls')?.textContent.includes('is playing'));
   assert.equal(await host.locator('.table-stage').count(),1,'Updates preserve the selected view');
   advance(f.r);await host.reload();await ready(host);
   for(const [width,height]of sizes){await host.setViewportSize({width,height});await check(host,`${name}-result-hand-${width}x${height}`);}
   await host.context().close();
   const owner=await open(browser,f,'room');await owner.locator('[data-do=table-view]').click();
   for(const [width,height]of sizes){await owner.setViewportSize({width,height});await check(owner,`${name}-host-result-table-${width}x${height}`);}
   assert.equal(await owner.locator('[data-command=start]').isEnabled(),true);
   await owner.locator('[data-command=start]').click();await owner.locator('.private-hand').waitFor();assert.equal(await owner.locator('.table-stage').count(),0,'A new deal returns to the private hand');
   await owner.context().close();advance(f.r);
   f.r.mode='shared';f.r.version++;const shared=await open(browser,f,'room');
   assert.equal(await shared.locator('.round-tabs,.table-stage').count(),0);
   for(const [width,height]of [[320,568],[1440,900],[844,390]]){await shared.setViewportSize({width,height});await check(shared,`${name}-shared-hand-${width}x${height}`);}
   await shared.context().close();
   console.log(`${name}: poker viewport, tabs, privacy and actions passed`);
  }finally{await browser.close();}
 }
 assert.deepEqual(errors,[]);
}finally{await writeFile(out+'/results.json',JSON.stringify({checks,errors},null,2));await app.close();}
