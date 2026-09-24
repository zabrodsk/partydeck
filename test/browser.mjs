import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { createApp } from '../server/index.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const app=process.env.TEST_BASE?null:await createApp({dbFile:':memory:'});
if(app)await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const base=process.env.TEST_BASE||`http://127.0.0.1:${app.server.address().port}`;
const username='alex_'+Date.now();
const browser=await chromium.launch({headless:true});
const errors=[];const out=process.env.TEST_BASE?'output/sites-browser':'output/browser';await mkdir(out,{recursive:true});
async function page(width=390,height=844){const c=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});return p;}
const read=p=>p.evaluate(()=>JSON.parse(window.render_game_to_text()));
async function ready(p){await p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(window.render_game_to_text()).connected);}
async function snap(p,name){await p.evaluate(async()=>await Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))));await p.screenshot({path:`${out}/${name}.png`,fullPage:true});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} overflows`);}
async function clickCommand(p,selector){const v=(await read(p)).room.version;await p.locator(selector).click();await p.waitForFunction(v=>JSON.parse(window.render_game_to_text()).room.version>v,v);}
async function dealBlackjack(host,phones){
 await clickCommand(host,'[data-command=prepare]');
 for(const p of phones){await p.locator('.betting-modal').waitFor();await clickCommand(p,'.bet-confirm');}
 await host.waitForFunction(()=>!document.querySelector('[data-command=start]').disabled);
 await clickCommand(host,'[data-command=start]');
}
try{
 const host=await page(),friend=await page(),third=await page(),display=await page(1440,1000);
 await display.goto(base);await display.getByRole('button',{name:'Start a table'}).click();
 assert.equal(await display.locator('[name=name]').isVisible(),false);
 await display.locator('[name=tableName]').fill('Friday night');await display.getByRole('button',{name:'Create table'}).click();await ready(display);
 assert.match(display.url(),/\/table\//);assert.equal((await read(display)).room.players.length,0);assert.equal(await display.locator('[data-command=start]').count(),0);
 await snap(display,'empty-display-lobby');await display.getByRole('button',{name:'Copy link'}).click();await display.getByRole('button',{name:'Invite friends'}).click();await display.getByLabel('Close dialog').click();
 const code=(await read(display)).room.code;
 await host.goto(base+'/join/'+code);await host.locator('[name=name]').fill('Alex');await host.getByRole('button',{name:'Join table'}).click();await ready(host);
 assert.equal((await read(host)).room.me.isHost,true);assert.equal(await host.getByRole('button',{name:'Start game'}).isDisabled(),true);await snap(host,'phone-waiting-lobby');
 for(const [p,name]of[[friend,'Mia'],[third,'Leo']]){await p.goto(base+'/join/'+code);await p.locator('[name=name]').fill(name);await p.getByRole('button',{name:'Join table'}).click();await ready(p);}
 await host.waitForFunction(()=>JSON.parse(window.render_game_to_text()).room.displayConnected);await host.waitForFunction(()=>JSON.parse(window.render_game_to_text()).room.players.length===3);
 assert.equal(await host.getByRole('button',{name:'Start game'}).isEnabled(),true);await snap(host,'phone-start-lobby');
 await host.locator('[data-do=invite]').click();await host.locator('.qr').waitFor();await snap(host,'invite');await host.locator('.qr').screenshot({path:out+'/qr.png'});await host.getByLabel('Close dialog').click();
 await snap(display,'lobby');await clickCommand(host,'[data-command=start]');await friend.waitForSelector('#peek');
 assert.equal(await host.locator('.table-stage').count(),0);assert.equal(await friend.locator('.table-stage').count(),0);
 assert.equal((await read(display)).room.me,null);assert.deepEqual((await read(friend)).room.board,[]);
 const peek=host.locator('#peek');await peek.focus();await host.keyboard.down('Space');assert.ok((await read(host)).room.me.cards.every(Boolean));await snap(host,'private-hand');await host.keyboard.up('Space');assert.ok((await read(host)).room.me.cards.every(c=>c===null));
 const allPhones=[host,friend,third];const byId=new Map();for(const p of[host,friend,third])byId.set((await read(p)).room.me.id,p);
 async function finish(){let guard=0;while((await read(host)).room.phase==='playing'){assert.ok(++guard<100);const id=(await read(host)).room.activeId,p=byId.get(id);await p.waitForFunction(id=>{const r=JSON.parse(window.render_game_to_text()).room;return r.activeId===id&&r.me.legal.actions.length;},id);const actions=(await read(p)).room.me.legal.actions;const a=actions.includes('check')?'check':actions.includes('call')?'call':'stand';await clickCommand(p,`[data-action=${a}]`);await host.waitForFunction(v=>JSON.parse(window.render_game_to_text()).room.version>=v,(await read(p)).room.version);}}
 // Play to the flop, then inspect public and private screens.
 for(let i=0;i<3;i++){const p=byId.get((await read(host)).room.activeId);await p.waitForFunction(()=>JSON.parse(window.render_game_to_text()).room.me.legal.actions.length);const a=(await read(p)).room.me.legal.actions.includes('call')?'call':'check';await clickCommand(p,`[data-action=${a}]`);await host.waitForFunction(v=>JSON.parse(window.render_game_to_text()).room.version>=v,(await read(p)).room.version);}
 await display.waitForFunction(()=>JSON.parse(window.render_game_to_text()).room.board.length===3);await snap(display,'poker-table');await snap(friend,'phone-controller');
 await finish();assert.equal((await read(host)).room.players.reduce((n,p)=>n+p.stack,0),6000);await snap(display,'showdown');
 await host.getByLabel('Table menu').click();await clickCommand(host,'[data-command=mode]');await host.locator('[data-do=table-view]').click();await host.waitForSelector('.table-stage');await snap(host,'phone-only');
 await host.getByLabel('Table menu').click();await clickCommand(host,'[data-command=game]');await host.waitForSelector('[data-command=prepare]');await dealBlackjack(host,allPhones);
 await snap(host,'blackjack-phone');await snap(display,'blackjack-table');await finish();
 await host.getByLabel('Table menu').click();await host.getByRole('button',{name:'My profile'}).click();await snap(host,'achievements');
 await host.locator('summary').click();await host.locator('[name=username]').fill(username);await host.locator('[name=password]').fill('test-password-123');await host.locator('#register-form button').click();await host.waitForFunction(name=>document.querySelector('.modal')?.textContent.includes('@'+name),username);
 const saved=await page();await saved.goto(base);await saved.getByRole('button',{name:'Sign in',exact:true}).click();await saved.locator('[name=username]').fill(username);await saved.locator('[name=password]').fill('test-password-123');await saved.locator('#login-form button').click();await saved.waitForSelector('.profile-dot');
 // Reload reconnects the same seat and profile without creating a new player.
 await friend.reload();await ready(friend);assert.equal((await read(friend)).room.players.length,3);
 // Full-table layout, with eight people and a narrow phone.
 for(const name of ['Sam','Jo','Nora','Max','Ali']){const p=await page();allPhones.push(p);await p.goto(base+'/join/'+code);await p.locator('[name=name]').fill(name);await p.getByRole('button',{name:'Join table'}).click();await ready(p);}
 await host.getByLabel('Close dialog').click();await host.waitForFunction(()=>JSON.parse(window.render_game_to_text()).room.players.length===8);await dealBlackjack(host,allPhones);
 await display.waitForFunction(()=>JSON.parse(window.render_game_to_text()).room.players.length===8);await snap(display,'eight-player-table');await host.setViewportSize({width:320,height:720});await snap(host,'eight-player-phone');
 const deck=await page(1440,1100);await deck.goto(base+'/deck',{timeout:120000});await deck.waitForSelector('.deck-grid');
 for(let i=0;i<5;i++){await deck.locator('.deck-page section').nth(i).screenshot({path:`${out}/deck-${i}.png`});}
 assert.equal(await deck.locator('.deck-page img').count(),53);assert.equal(await deck.evaluate(()=>[...document.images].every(i=>i.complete&&i.naturalWidth>0)),true);
 await deck.setViewportSize({width:320,height:720});await snap(deck,'deck-mobile');
 const mobile=await page();await mobile.goto(base);await mobile.getByRole('button',{name:'Start a table'}).click();
 assert.equal(await mobile.locator('[name=mode][value=phones]').isChecked(),true);await mobile.locator('[name=name]').fill('Mobile host');await mobile.locator('[name=game][value=blackjack]').check();
 await mobile.getByRole('button',{name:'Create table'}).click();await ready(mobile);assert.equal((await read(mobile)).room.me.isHost,true);assert.equal(await mobile.getByRole('button',{name:'Start game'}).isEnabled(),true);await snap(mobile,'mobile-create-lobby');
 await dealBlackjack(mobile,[mobile]);assert.ok(['playing','complete'].includes((await read(mobile)).room.phase));
 assert.deepEqual(errors,[]);await writeFile(`${out}/results.json`,JSON.stringify({passed:true,checks:['3 isolated phone sessions + shared display','QR image loads','hold-to-peek and release','complete poker hand and chip conservation','phone-only mode','automatic blackjack settlement','profile registration/login','same-seat reload','53 deck assets','320px mobile overflow','no browser errors']},null,2));console.log('Browser checks passed. Screenshots: '+out);
}finally{await browser.close();await app?.close();}
