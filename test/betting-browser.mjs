import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createApp} from '../server/index.js';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const app=await createApp({dbFile:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${app.server.address().port}`,out='output/betting';await mkdir(out,{recursive:true});
const errors=[];
const read=p=>p.evaluate(()=>JSON.parse(window.render_game_to_text()));
async function ready(p){await p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).connected);}
async function geometry(p,name){
 await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const result=await p.evaluate(()=>{
  const box=selector=>document.querySelector(selector).getBoundingClientRect();
  const sheet=box('.betting-modal'),submit=box('.bet-confirm'),close=box('.betting-header .close');
  const overflow=[...document.querySelectorAll('.betting-modal *')].filter(e=>e.getClientRects().length).filter(e=>{const r=e.getBoundingClientRect();return r.left<sheet.left-1||r.right>sheet.right+1;}).map(e=>e.className);
  return {overflow,pageOverflow:document.documentElement.scrollWidth>innerWidth,sheetVisible:sheet.top>=-1&&sheet.bottom<=innerHeight+1,submitVisible:submit.top>=sheet.top&&submit.bottom<=sheet.bottom,closeVisible:close.top>=0&&close.bottom<=innerHeight};
 });
 assert.deepEqual(result,{overflow:[],pageOverflow:false,sheetVisible:true,submitVisible:true,closeVisible:true},name);
 await p.screenshot({path:`${out}/${name}.png`});
}
function fixture(game='poker'){
 const host=app.store.create('Alex'),friend=app.store.create('Sam');
 const room=app.manager.create(host,{game,mode:'shared'});
 for(const person of [host,friend]){app.manager.join(room,person);app.manager.connect(room,person.id,'fixture-'+person.id);}
 app.manager.connect(room,null,'fixture-display',true);
 if(game==='poker')app.manager.start(room);
 return {room,player:game==='poker'?app.manager.activeId(room):host.id};
}
async function open(browser,fixture,width=390,height=844){
 const context=await browser.newContext({viewport:{width,height},isMobile:width<600,hasTouch:width<600,reducedMotion:'reduce'});
 await context.addCookies([{name:'table_session',value:app.store.session(fixture.player),url:base}]);
 await context.addInitScript(()=>{const NativeEventSource=window.EventSource;window.EventSource=class extends NativeEventSource{constructor(...args){super(...args);window.testStream=this;}};});
 const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base+'/room/'+fixture.room.code);await ready(p);return p;
}
for(const [engine,name] of [[chromium,'chromium'],[webkit,'webkit']]){
 const browser=await engine.launch({headless:true});
 try{
  const f=fixture(),p=await open(browser,f);
  await p.locator('[data-do=raise]').click();
  assert.equal(await p.locator('.betting-modal').evaluate(e=>e.contains(document.activeElement)),true);
  assert.equal(await p.locator('.room-shell').evaluate(e=>e.inert),true);
  assert.equal(await p.locator('#bet-amount').inputValue(),'40');
  await p.locator('#bet-amount').fill('80');
  assert.equal(await p.locator('[data-bet-added]').textContent(),'70 chips');
  assert.equal(await p.locator('[data-bet-remaining]').textContent(),'1,920');
  // A presence update must retain the actual input node, value and focus.
  await p.evaluate(()=>window.originalBetInput=document.querySelector('#bet-amount'));
  const extra=await browser.newPage();await extra.goto(base+'/table/'+f.room.code);await ready(extra);
  await p.waitForFunction(()=>document.querySelector('#bet-amount')===window.originalBetInput&&document.querySelector('#bet-amount').value==='80');
  assert.equal(await p.locator('#bet-amount').evaluate(e=>e===document.activeElement),true);
  for(const size of [[320,568],[390,844],[430,932],[741,837],[768,1024],[1024,768],[1440,900],[844,390],[390,360]]){
   await p.setViewportSize({width:size[0],height:size[1]});await p.locator('#bet-amount').blur();await geometry(p,`${name}-raise-${size.join('x')}`);
  }
  // The sheet scrolls behind its fixed confirmation control in keyboard-sized space.
  await p.locator('#betting-form').evaluate(e=>e.scrollTop=e.scrollHeight);
  assert.equal(await p.evaluate(()=>document.querySelector('.bet-breakdown').getBoundingClientRect().bottom<=document.querySelector('.betting-footer').getBoundingClientRect().top+1),true);
  await p.setViewportSize({width:390,height:844});
  await p.locator('#betting-form').evaluate(e=>e.scrollTop=0);
  // Simulate the transport error and its next real snapshot without touching another room.
  await p.evaluate(()=>window.testStream.dispatchEvent(new Event('error')));
  assert.equal(await p.locator('.bet-confirm').isDisabled(),true);assert.equal(await p.locator('#bet-amount').inputValue(),'80');
  await p.evaluate(room=>window.testStream.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({room})})),app.manager.view(f.room,f.player));
  assert.equal(await p.locator('.bet-confirm').isEnabled(),true);assert.equal(await p.locator('#bet-amount').inputValue(),'80');
  await p.locator('#bet-amount').fill('2001');assert.equal(await p.locator('.bet-confirm').isDisabled(),true);assert.match(await p.locator('#bet-error').textContent(),/40.*2,000/);
  await p.locator('#bet-amount').fill('');assert.equal(await p.locator('.bet-confirm').isDisabled(),true);
  await p.locator('[data-bet-amount="2000"]').click();assert.equal(await p.locator('[data-bet-remaining]').textContent(),'0 · All in');
  await p.locator('.bet-slider').focus();await p.keyboard.press('ArrowLeft');assert.equal(await p.locator('#bet-amount').inputValue(),'1999');
  await p.getByLabel('Close betting').focus();await p.keyboard.press('Shift+Tab');assert.equal(await p.locator('.bet-cancel').evaluate(e=>e===document.activeElement),true);
  await p.keyboard.press('Escape');assert.equal(await p.locator('.betting-modal').count(),0);assert.equal(await p.locator('[data-do=raise]').evaluate(e=>e===document.activeElement),true);
  assert.equal(await p.locator('.room-shell').evaluate(e=>e.inert),false);
  await p.locator('[data-do=raise]').click();await p.locator('#bet-amount').fill('80');
  // A stale command stays editable and does not silently lose the selected amount.
  await p.route('**/command',route=>route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'The table changed. Please try again.'})}));
  await p.locator('.bet-confirm').click();await p.getByText('The table changed. Please try again.',{exact:true}).waitFor();
  assert.equal(await p.locator('#bet-amount').inputValue(),'80');await p.unroute('**/command');
  await p.locator('.bet-confirm').click();await p.waitForFunction(()=>!document.querySelector('.betting-modal'));
  await p.waitForFunction(()=>JSON.parse(window.render_game_to_text()).room.me.stack===1920);
  assert.equal(f.room.players.find(x=>x.id===f.player).currentBet,80);
  await extra.close();await p.context().close();
  // All in requires explicit confirmation and sends the full total, including the blind.
  const all=fixture(),a=await open(browser,all);await a.locator('[data-do=raise]').click();await a.locator('[data-bet-amount="2000"]').click();
  assert.equal(all.room.players.find(x=>x.id===all.player).stack,1990);
  await a.locator('.bet-confirm').click();await a.waitForFunction(()=>JSON.parse(window.render_game_to_text()).room.me.stack===0);await a.context().close();
  const bj=fixture('blackjack');bj.room.players[0].stack=1999;
  const b=await open(browser,bj,320,568);await b.locator('[data-do=edit-bet]').tap();
  await b.locator('#bet-amount').fill('51');assert.equal(await b.locator('.bet-confirm').isDisabled(),true);
  await b.locator('[data-bet-amount="100"]').click();await geometry(b,`${name}-blackjack-320`);
  await b.locator('.bet-confirm').click();await b.waitForFunction(()=>JSON.parse(window.render_game_to_text()).room.me.bet===100);
  assert.equal((await read(b)).room.me.stack,1999);assert.match(await b.locator('.next-bet strong').textContent(),/100/);
  await b.locator('[data-do=edit-bet]').tap();
  // A hand started on another device closes the editor before an obsolete bet can be placed.
  const request=b.context().request;const version=(await read(b)).room.version;
  await request.post(base+'/api/rooms/'+bj.room.code+'/command',{data:{command:'start',args:{},version,requestId:'external-start-'+name}});
  await b.waitForFunction(()=>!document.querySelector('.betting-modal'));assert.equal(await b.locator('.room-shell').evaluate(e=>e.inert),false);
  await b.context().close();console.log(name+': betting, chip accounting, stale requests, focus and responsive checks passed.');
 }finally{await browser.close();}
}
assert.deepEqual(errors,[]);await app.close();
