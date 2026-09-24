import { createServer } from 'node:http';
import { resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Store } from './storage.js';
import { RoomManager, achievements } from './rooms.js';
import { qrSvg } from './qr.js';
import { assetServer } from './assets.js';
import { authKit,appendCookie } from './auth.js';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json'};
const sessionKey=req=>req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('table_session='))?.slice(14);
export async function createApp({dbFile=process.env.DATA_PATH||resolve(ROOT,'data/table.sqlite'),graceMs=30000,publicUrl=process.env.PUBLIC_URL,authOptions={}}={}) {
  const store=new Store(dbFile), manager=new RoomManager(store,{graceMs}), streams=new Set(), limits=new Map();
  const auth=authKit(store,{publicUrl,...authOptions});
  const serveAsset=assetServer({production:process.env.NODE_ENV==='production'});
  const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  const cookie=(res,key,req)=>appendCookie(res,`table_session=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${(publicUrl?.startsWith('https:')||req.socket.encrypted)?'; Secure':''}`);
  const me=req=>req.authPlayer||(()=>{const p=store.resolve(sessionKey(req));return p?.authProvider?null:p;})();
  const profile=p=>p?{...p,stats:{...p.stats,sessions:p.stats.sessions.length},achievements}:null;
  const publish=r=>{for(const s of streams)if(s.room===r){s.res.write(`data: ${JSON.stringify({room:manager.view(r,s.playerId,s.display),profile:profile(store.player(s.playerId))})}\n\n`);}};
  function rate(req,route,max=120){const key=(req.socket.remoteAddress||'')+route;const now=Date.now();let l=limits.get(key);if(!l||now-l.time>60000){l={time:now,count:0};limits.set(key,l);}if(++l.count>max)throw Error('Too many requests. Please wait a minute.');}
  async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>16384)throw Error('Request too large.');}try{return JSON.parse(data||'{}');}catch{throw Error('Invalid request.');}}
  function originOkay(req){if(!req.headers.origin)return true;const allowed=publicUrl?new URL(publicUrl).origin:null;const expected=`${req.socket.encrypted?'https':'http'}://${req.headers.host}`;return req.headers.origin===expected||req.headers.origin===allowed;}
  const server=createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try{
      const url=new URL(req.url,'http://localhost');const path=url.pathname;
      if(path==='/auth/callback'&&req.method==='GET'){await auth.callback(req,res,url);return;}
      if((path.startsWith('/api/')||path==='/auth/login')&&path!=='/api/network')req.authPlayer=await auth.resolve(req,res);
      if(path==='/auth/login'&&req.method==='GET'){rate(req,'auth',15);await auth.start(req,res,url,me(req));return;}
      if(path==='/health'){json(res,200,{ok:true,rooms:manager.rooms.size});return;}
      if(path.startsWith('/api/')&&!originOkay(req)){json(res,403,{error:'This request came from a different site.'});return;}
      if(path==='/api/me'&&req.method==='GET'){json(res,200,{profile:profile(me(req)),auth:{workos:auth.enabled}});return;}
      if(path==='/api/network'&&req.method==='GET'){
        const port=server.address()?.port;const addresses=Object.values(networkInterfaces()).flat().filter(x=>x&&x.family==='IPv4'&&!x.internal).map(x=>`http://${x.address}:${port}`);
        json(res,200,{publicUrl:publicUrl||null,localUrl:addresses[0]||null});return;
      }
      if(path==='/api/guest'&&req.method==='POST'){rate(req,'guest',20);const {name}=await body(req);if(typeof name!=='string'||!name.trim()||name.trim().length>24)throw Error('Enter a nickname of up to 24 characters.');let p=me(req);if(!p)p=store.create(name.trim());cookie(res,store.session(p.id),req);json(res,200,{profile:profile(p)});return;}
      if(path==='/api/login'&&req.method==='POST'){rate(req,'login',10);const {username,password}=await body(req);const p=await store.login(username,password);cookie(res,store.session(p.id),req);json(res,200,{profile:profile(p)});return;}
      if(path==='/api/register'&&req.method==='POST'){rate(req,'register',10);const p=me(req);if(!p){json(res,401,{error:'Join with a nickname first.'});return;}const {username,password}=await body(req);json(res,200,{profile:profile(await store.register(p.id,username,password))});return;}
      if(path==='/api/logout'&&req.method==='POST'){store.revoke(sessionKey(req));appendCookie(res,'table_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');for(const s of streams)if(sessionKey(req)&&s.session===sessionKey(req)||req.authPlayer&&s.playerId===req.authPlayer.id)s.res.end();const logoutUrl=await auth.logout(req,res);json(res,200,{ok:true,logoutUrl});return;}
      if(path==='/api/rooms'&&req.method==='POST'){
        rate(req,'create',10);const options=await body(req);let p=me(req);
        if(options.displayOnly===true&&options.mode==='shared'){
          let device=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('table_device='))?.slice(13);
          if(!/^[a-f0-9-]{36}$/.test(device||''))device=randomUUID();
          appendCookie(res,`table_device=${device}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${publicUrl?.startsWith('https:')?'; Secure':''}`);
          p={id:'display-'+device};
        }
        if(!p){json(res,401,{error:'Enter your nickname first.'});return;}
        const r=manager.create(p,options);json(res,200,{code:r.code,view:options.displayOnly===true&&r.mode==='shared'?'display':'player'});return;
      }
      const match=path.match(/^\/api\/rooms\/([A-Z0-9]{6})\/(join|stream|command|qr)$/i);
      if(match){
        const r=manager.get(match[1]),op=match[2];
        if(op==='qr'&&req.method==='GET'){
          const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(req.headers.host || '');
          const lan = Object.values(networkInterfaces()).flat().find(x=>x&&x.family==='IPv4'&&!x.internal);
          const host=publicUrl||(local&&lan?`http://${lan.address}:${server.address().port}`:`http://${req.headers.host}`);
          const link=new URL(`/join/${r.code}`,host).href;res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-store'});res.end(qrSvg(link));return;
        }
        const p=me(req);const display=url.searchParams.get('view')==='display';
        if(!p&&!(op==='stream'&&display)){json(res,401,{error:'Join with your nickname first.'});return;}
        if(op==='join'&&req.method==='POST'){rate(req,'join',30);manager.join(r,p);publish(r);json(res,200,{ok:true});return;}
        if(op==='command'&&req.method==='POST'){rate(req,'command',120);const b=await body(req);manager.command(r,p.id,b.command,b.args,b.version,b.requestId);publish(r);json(res,200,{ok:true});return;}
        if(op==='stream'&&req.method==='GET'){
          rate(req,'stream',60);if(streams.size>=512)throw Error('The server has reached its connection limit.');
          const key=randomUUID();manager.connect(r,p?.id,key,display);
          res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write('retry: 1500\n\n');
          const stream={room:r,playerId:p?.id,display,res,session:sessionKey(req)};streams.add(stream);publish(r);
          const keepalive=setInterval(()=>res.write(': heartbeat\n\n'),15000);
          req.on('close',()=>{clearInterval(keepalive);streams.delete(stream);manager.disconnect(r,p?.id,key,display);publish(r);});return;
        }
      }
      if(path.startsWith('/api/')){json(res,404,{error:'Not found.'});return;}
      if(!['GET','HEAD'].includes(req.method)){json(res,405,{error:'Method not allowed.'});return;}
      let file=path==='/vendor/gsap.min.js'?resolve(ROOT,'node_modules/gsap/dist/gsap.min.js'):resolve(ROOT,'public','.'+decodeURIComponent(path));
      if(!file.startsWith(resolve(ROOT,'public')+'/')&&path!=='/vendor/gsap.min.js'&&path!=='/'){json(res,403,{error:'Not allowed.'});return;}
      if(!extname(path))file=resolve(ROOT,'public/index.html');
      try{await serveAsset(req,res,file,path);}catch{res.writeHead(404);res.end('Not found');}
    }catch(e){if(!res.headersSent)json(res,400,{error:e.message||'That action could not be completed.'});else res.end();}
  });
  const timer=setInterval(()=>{for(const r of manager.tick())publish(r);for(const [key,l]of limits)if(Date.now()-l.time>60000)limits.delete(key);},1000);timer.unref();
  return {server,store,manager,close:async()=>{clearInterval(timer);for(const s of streams)s.res.end();await new Promise(resolve=>server.close(resolve));store.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const app=await createApp();const port=Number(process.env.PORT||3000);app.server.listen(port,'0.0.0.0',()=>console.log(`Partydeck listening on http://localhost:${port}`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();process.exit(0);});
}
