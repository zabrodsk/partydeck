import assert from 'node:assert/strict';
import {createApp} from '../server/index.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const app=await createApp({dbFile:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
const a=app.store.create('Alex'),b=app.store.create('Sam');const room=app.manager.create(a,{mode:'shared',game:'poker'});const tokens={};for(const p of [a,b]){app.manager.join(room,p);app.manager.connect(room,p.id,'fixture-'+p.id,false);tokens[p.id]=app.store.session(p.id);}
const browser=await chromium.launch({headless:true});const errors=[];
try {
 const c=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'no-preference'});await c.addCookies([{name:'table_session',value:tokens[a.id],url:base}]);const phone=await c.newPage();phone.on('pageerror',e=>errors.push(e.message));await phone.goto(base+'/room/'+room.code);
 const d=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'no-preference'});const display=await d.newPage();display.on('pageerror',e=>errors.push(e.message));await display.goto(base+'/table/'+room.code);
 await phone.locator('[data-command=start]:enabled').waitFor();await phone.locator('[data-command=start]').click();
 await display.waitForFunction(()=>[...document.querySelectorAll('.seat-cards .card')].some(n=>window.gsap?.isTweening(n)));
 await display.waitForFunction(()=>[...document.querySelectorAll('.seat-cards .card')].length===4&&![...document.querySelectorAll('.seat-cards .card')].some(n=>window.gsap?.isTweening(n)));
 const peek=phone.locator('#peek');const box=await peek.boundingBox();await phone.mouse.move(box.x+box.width/2,box.y+box.height/2);await phone.mouse.down();assert.equal(await peek.getAttribute('aria-pressed'),'true');
 assert.equal(await phone.locator('.own-cards .card[aria-label="Face-down card"]').count(),0);
 await phone.mouse.up();assert.equal(await phone.locator('.own-cards .card[aria-label="Face-down card"]').count(),2);
 assert.equal(await display.locator('.seat-cards .card[aria-label="Face-down card"]').count(),4);
 const active=app.manager.activeId(room);const response=await fetch(base+'/api/rooms/'+room.code+'/command',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:'table_session='+tokens[active]},body:JSON.stringify({command:'action',args:{action:'fold'},version:room.version,requestId:crypto.randomUUID()})});assert.equal(response.status,200);
 await display.waitForFunction(()=>document.querySelector('.collected-card'));
 await display.waitForFunction(()=>!document.querySelector('.collected-card'));
 await phone.locator('[data-command=start]').click();await display.waitForFunction(()=>[...document.querySelectorAll('.seat-cards .card')].some(n=>window.gsap?.isTweening(n)));
 await display.waitForFunction(()=>![...document.querySelectorAll('.seat-cards .card')].some(n=>window.gsap?.isTweening(n)));
 await display.emulateMedia({reducedMotion:'reduce'});await display.reload();await display.locator('.seat-cards .card').first().waitFor();assert.equal(await display.evaluate(()=>[...document.querySelectorAll('.card')].some(n=>window.gsap?.isTweening(n))),false);
 assert.deepEqual(errors,[]);console.log('Motion checks passed: deal, next hand, collection, immediate privacy on release, reduced motion.');
} finally {await browser.close();await app.close();}
