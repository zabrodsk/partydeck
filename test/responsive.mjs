import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createApp} from '../server/index.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const app=await createApp({dbFile:':memory:'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
const browser=await chromium.launch({headless:true});const out='output/responsive';await mkdir(out,{recursive:true});const results=[],errors=[];
const names=['Alexandra','Christopher','Leo','Samantha','Josephine','Nora','Maximilian','Ali'];
const sizes=[[320,740],[390,844],[768,1024],[1024,768],[1366,768],[1440,900],[1920,1080]];
async function capture(p,name){await p.evaluate(async()=>{await Promise.all([...document.images].filter(i=>i.loading!=='lazy').map(i=>i.decode().catch(()=>{})));});await p.screenshot({path:`${out}/${name}.png`,fullPage:true});const data=await p.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,broken:[...document.images].filter(i=>i.loading!=='lazy'&&(!i.complete||!i.naturalWidth)).map(i=>i.src)}));assert.equal(data.overflow,false,name+' horizontal overflow');assert.deepEqual(data.broken,[],name+' broken images');return data;}
try{
 for(const game of ['poker','blackjack']){
  const members=names.map(name=>app.store.create(name));const r=app.manager.create(members[0],{mode:'shared',game});
  for(const p of members){app.manager.join(r,p);app.manager.connect(r,p.id,'fixture-'+p.id,false);}
  app.manager.connect(r,null,'fixture-display',true);app.manager.start(r);
  const c=await browser.newContext({reducedMotion:'reduce'});const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
  for(const [width,height]of sizes){await p.setViewportSize({width,height});await p.goto(base+'/table/'+r.code);await p.waitForSelector('.table-stage');await capture(p,`${game}-table-${width}`);
   const layout=await p.evaluate(()=>{const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};const seats=[...document.querySelectorAll('.seat')].map(box),board=box(document.querySelector('.table-centre'));const overlap=(a,b)=>Math.min(a.right,b.right)-Math.max(a.x,b.x)>3&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>3;return {overlaps:seats.flatMap((a,i)=>seats.slice(i+1).map((b,j)=>overlap(a,b)?[i,i+j+1]:null).filter(Boolean)),boardCollisions:seats.map((a,i)=>overlap(a,board)?i:null).filter(i=>i!==null),clipped:seats.some(a=>a.x<0||a.right>innerWidth),height:document.documentElement.scrollHeight,viewport:innerHeight};});results.push({game,width,height,...layout});assert.deepEqual(layout.overlaps,[],`${game} ${width} seat overlaps`);assert.deepEqual(layout.boardCollisions,[],`${game} ${width} board overlaps`);assert.equal(layout.clipped,false,`${game} ${width} clipped seats`);
  }
  await c.close();
  const host=await browser.newContext({reducedMotion:'reduce'});await host.addCookies([{name:'table_session',value:app.store.session(members[0].id),url:base}]);const phone=await host.newPage();
  for(const [width,height]of [[320,740],[390,844],[768,1024],[1440,900]]){await phone.setViewportSize({width,height});await phone.goto(base+'/room/'+r.code);await phone.waitForSelector('.private-hand');await capture(phone,`${game}-hand-${width}`);if(game==='poker'){const rect=await phone.locator('#peek').boundingBox();assert.ok(rect.y+rect.height<height,`peek below fold at ${width}`);}}
  await host.close();
 }
 const c=await browser.newContext({reducedMotion:'reduce'});const p=await c.newPage();
 for(const [width,height]of sizes){await p.setViewportSize({width,height});await p.goto(base);await capture(p,'landing-'+width);await p.getByRole('button',{name:'Start a table',exact:false}).first().click();await capture(p,'setup-'+width);}
 await c.close();assert.deepEqual(errors,[]);await writeFile(out+'/results.json',JSON.stringify({passed:true,results},null,2));console.log('Responsive checks passed for '+sizes.length+' viewports, both games, private hands and onboarding.');
}finally{await browser.close();await app.close();}
