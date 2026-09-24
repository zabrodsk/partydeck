import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createApp} from '../server/index.js';
import {Blackjack} from '../server/blackjack.js';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const app=await createApp({dbFile:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
const out='output/blackjack-layout';await mkdir(out,{recursive:true});const errors=[],checks=[];
const sizes=[[320,568],[390,844],[430,932],[741,837],[768,1024],[1024,768],[1440,900],[1920,1080],[844,390]];
const ready=p=>p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).connected);
function fixture(count=2,complete=true,mode='shared'){
 const people=Array.from({length:count},(_,i)=>app.store.create(['Dusan','Lili','Samantha','Christopher','Alex','Mia','Leo','Nora'][i]));
 const r=app.manager.create(people[0],{name:'Card night',mode,game:'blackjack'});
 for(const p of people){app.manager.join(r,p);app.manager.connect(r,p.id,'fixture-'+p.id);}
 app.manager.connect(r,null,'fixture-display',true);r.handNumber=5;r.phase='playing';r.handStart=Object.fromEntries(people.map(p=>[p.id,2000]));
 r.bj=new Blackjack(people.map(p=>({id:p.id,stack:2000,bet:20})),[...people.map(()=>'2C'),'JS',...people.map(()=>'3D'),'JD',...Array(40).fill('2H')]);
 r.bj.players.forEach((p,i)=>{p.hands[0].cards=i%2?['3H','2S','4C','2D','5H','3C']:['5H','2S','3S','QS'];});
 // Split-hand stress case, with several card ranks still needing to remain visible.
 if(count===8)r.bj.players[0].hands=Array.from({length:4},(_,i)=>({cards:['2S','3D','2H','4C'],bet:20,split:true,status:'playing'}));
 if(complete){r.bj.settle();app.manager.syncBlackjack(r);app.manager.finishBlackjack(r);}else app.manager.syncBlackjack(r);
 r.version++;return {r,people};
}
async function open(browser,f,path='table',width=390,height=844,id=f.people[0].id){
 const c=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});
 if(path==='room')await c.addCookies([{name:'table_session',value:app.store.session(id),url:base}]);
 const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'/'+path+'/'+f.r.code);await ready(p);return p;
}
async function check(p,name,{sheet=false}={}){
 await p.evaluate(async()=>{await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
 const g=await p.evaluate(sheet=>{
  const visible=e=>e.getClientRects().length&&!e.closest('[inert]');
  const outside=[...document.querySelectorAll(sheet?'.betting-modal button,.betting-modal input,.betting-header':'.room-header,.table-centre,.seat,.result-summary,.display-footer,.action-dock,.hand-content,.round-tabs')].filter(visible).filter(e=>{const b=e.getBoundingClientRect();return b.left<-.5||b.right>innerWidth+.5||b.top<-.5||b.bottom>innerHeight+.5;}).map(e=>[e.className,Math.round(e.getBoundingClientRect().bottom)]);
  const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};},seats=[...document.querySelectorAll('.seat')].map(box),board=document.querySelector('.table-centre');
  const overlaps=(a,b)=>Math.min(a.right,b.right)-Math.max(a.x,b.x)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>2;
  const collisions=seats.flatMap((a,i)=>seats.slice(i+1).map((b,j)=>overlaps(a,b)?[i,i+j+1]:null).filter(Boolean));
  if(board)for(const [i,a]of seats.entries())if(overlaps(a,box(board)))collisions.push(['dealer',i]);
  const clippedSeats=[...document.querySelectorAll('.seat')].flatMap((seat,i)=>{const a=seat.getBoundingClientRect();return [...seat.children].filter(e=>{const b=e.getBoundingClientRect();return b.top<a.top-2||b.bottom>a.bottom+2||b.left<a.left-2||b.right>a.right+2;}).map(e=>[i,e.className]);});
  const tinyCards=[...document.querySelectorAll('.hand-fan .card')].filter(visible).filter(e=>e.getBoundingClientRect().width<8).length;
  return {scrollX:document.documentElement.scrollWidth>innerWidth+1,scrollY:document.documentElement.scrollHeight>innerHeight+1,outside,collisions,clippedSeats,tinyCards};
 },sheet);

 checks.push({name,...g});await p.screenshot({path:`${out}/${name}.png`});
 assert.deepEqual(g,{scrollX:false,scrollY:false,outside:[],collisions:[],clippedSeats:[],tinyCards:0},name);
}
try{
 for(const [engine,name]of [[chromium,'chromium'],[webkit,'webkit']]){
  const browser=await engine.launch({headless:true});
  try{
   for(const count of [2,8]){
    const f=fixture(count),display=await open(browser,f);
    for(const [width,height]of sizes){await display.setViewportSize({width,height});await check(display,`${name}-table-${count}-${width}x${height}`);}
    await display.context().close();
    for(const mode of ['shared','phones']){
     f.r.mode=mode;f.r.version++;const p=await open(browser,f,'room');
     for(const [width,height]of sizes){await p.setViewportSize({width,height});await check(p,`${name}-hand-${mode}-${count}-${width}x${height}`);}
     if(mode==='phones'){await p.locator('[data-do=table-view]').click();await check(p,`${name}-table-tab-${count}`);await p.locator('[data-do=hand-view]').click();assert.equal(await p.locator('.private-hand').count(),1);}
     await p.context().close();
    }
   }
   const waiting=fixture(8);app.manager.prepare(waiting.r);waiting.r.players.forEach(p=>p.betReady=true);waiting.r.version++;const w=await open(browser,waiting,'room');
   for(const [width,height]of [[320,568],[390,844],[844,390]]){await w.setViewportSize({width,height});await check(w,`${name}-waiting-${width}x${height}`);}
   await w.context().close();
   const active=fixture(8,false),playing=await open(browser,active);
   for(const [width,height]of [[320,568],[844,390],[1440,900]]){await playing.setViewportSize({width,height});await check(playing,`${name}-playing-${width}x${height}`);}
   await playing.context().close();
   const f=fixture(),host=await open(browser,f,'room'),friend=await open(browser,f,'room',390,844,f.people[1].id);
   await host.locator('[data-command=prepare]').click();await host.locator('.betting-modal').waitFor();await friend.locator('.betting-modal').waitFor();
   for(const [width,height]of sizes){await host.setViewportSize({width,height});await check(host,`${name}-bet-${width}x${height}`,{sheet:true});}
   await host.setViewportSize({width:390,height:844});await host.locator('[data-bet-amount="100"]').click();await host.locator('.bet-confirm').click();await host.waitForFunction(()=>!document.querySelector('.betting-modal'));
   assert.equal(await host.locator('[data-command=start]').isDisabled(),true);assert.equal(f.r.phase,'betting');assert.equal(f.r.players[0].bet,100);
   await friend.locator('[data-bet-amount="50"]').click();await friend.locator('.bet-confirm').click();await host.waitForFunction(()=>!document.querySelector('[data-command=start]').disabled);
   assert.equal(f.r.players[1].bet,50);await check(host,`${name}-all-ready`);
   await host.locator('[data-command=start]').click();await host.locator('.private-hand').waitFor();assert.equal(f.r.handNumber,6);assert.deepEqual(f.r.bj.players.map(p=>p.hands[0].bet),[100,50]);
   await check(host,`${name}-dealt`);await host.context().close();await friend.context().close();
   console.log(`${name}: layouts and next-hand betting passed`);
  }finally{await browser.close();}
 }
 assert.deepEqual(errors,[]);
}finally{await writeFile(out+'/results.json',JSON.stringify({checks,errors},null,2));await app.close();}
