import { randomUUID } from 'node:crypto';
import { Database, HttpError } from './database.js';
import { qrSvg } from '../server/qr.js';
import html from '../public/index.html';

const security={
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{...security,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const cookies=req=>Object.fromEntries((req.headers.get('cookie')||'').split(';').map(s=>s.trim().split('=')));
const sessionCookie=(key,url)=>`table_session=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${key?2592000:0}${url.protocol==='https:'?'; Secure':''}`;
async function body(req) {
  if(Number(req.headers.get('Content-Length'))>16384)throw new HttpError('Request too large.',413);
  let text='';const reader=req.body?.getReader();
  if(reader){const decoder=new TextDecoder();let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();throw new HttpError('Request too large.',413);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
  try{const value=JSON.parse(text||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw new HttpError('Invalid request.');}
}

export default {
  async fetch(req,env,ctx) {
    const url=new URL(req.url),path=url.pathname;
    try {
      if(path==='/health') {await env.DB.prepare('SELECT code FROM rooms LIMIT 1').first();return json({ok:true,runtime:'sites'});}
      if(!path.startsWith('/api/')) {
        if(!['GET','HEAD'].includes(req.method))return json({error:'Method not allowed.'},405);
        if(path==='/'||/^\/(deck|join|room|table)(\/[^/]+)?\/?$/.test(path))return new Response(req.method==='HEAD'?null:html,{headers:{...security,'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'}});
        return env.ASSETS?env.ASSETS.fetch(req):new Response('Not found',{status:404});
      }
      if(req.headers.get('origin')&&req.headers.get('origin')!==url.origin)return json({error:'This request came from a different site.'},403);
      // Explicitly read from the primary. Game commands must not use a stale replica.
      const db=new Database(env.DB.withSession?env.DB.withSession('first-primary'):env.DB);
      const cookie=cookies(req),key=cookie.table_session,ip=req.headers.get('CF-Connecting-IP')||'local';
      const p=await db.identity(key);
      const needPlayer=()=>{if(!p)throw new HttpError('Join with your nickname first.',401);return p;};
      if(path==='/api/network'&&req.method==='GET')return json({publicUrl:url.origin,localUrl:null,transport:'poll'});
      if(path==='/api/me'&&req.method==='GET')return json({profile:await db.profile(p)});
      if(path==='/api/guest'&&req.method==='POST') {
        await db.rate(ip,'guest',20);const b=await body(req),player=p||await db.guest(b.name),session=await db.session(player.id);
        return json({profile:await db.profile(player)},200,{'Set-Cookie':sessionCookie(session,url)});
      }
      if(path==='/api/register'&&req.method==='POST') {
        needPlayer();await db.rate(ip,'register',10);const b=await body(req);return json({profile:await db.profile(await db.register(p,b.username,b.password))});
      }
      if(path==='/api/login'&&req.method==='POST') {
        await db.rate(ip,'login',10);const b=await body(req),player=await db.login(b.username,b.password),session=await db.session(player.id);
        return json({profile:await db.profile(player)},200,{'Set-Cookie':sessionCookie(session,url)});
      }
      if(path==='/api/logout'&&req.method==='POST') {await db.revoke(key);return json({ok:true},200,{'Set-Cookie':sessionCookie('',url)});}
      if(path==='/api/rooms'&&req.method==='POST') {
        await db.rate(ip,'create',10);const options=await body(req),display=options.displayOnly===true&&options.mode==='shared';
        let creator=p,headers={};
        if(display) {
          const device=/^[a-f0-9-]{36}$/.test(cookie.table_device||'')?cookie.table_device:randomUUID();creator={id:'display-'+device};
          headers['Set-Cookie']=`table_device=${device}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${url.protocol==='https:'?'; Secure':''}`;
        }else needPlayer();
        const r=await db.create(creator,options);ctx.waitUntil(db.cleanup().catch(()=>{}));return json({code:r.code,view:display?'display':'player'},200,headers);
      }
      const match=path.match(/^\/api\/rooms\/([A-Z0-9]{6})\/(join|poll|disconnect|command|qr)$/i);
      if(match) {
        const code=match[1].toUpperCase(),op=match[2],display=url.searchParams.get('view')==='display';
        if(op==='qr'&&req.method==='GET'){await db.room(code);return new Response(qrSvg(new URL('/join/'+code,url.origin).href),{headers:{...security,'Content-Type':'image/svg+xml','Cache-Control':'no-store'}});}
        if(!(display&&['poll','disconnect'].includes(op)))needPlayer();
        if(op==='join'&&req.method==='POST') {
          await db.rate(ip,'join',30);await db.update(code,(manager,r)=>manager.join(r,p));return json({ok:true});
        }
        if(op==='poll'&&req.method==='GET') {
          const row=await db.room(code),stored=JSON.parse(row.state);
          if(!display&&!stored.players.some(x=>x.id===p.id))throw new HttpError('Join the room first.',403);
          await db.heartbeat(code,p,url.searchParams.get('client'),display);
          const {manager,room}=await db.update(code);return json({room:manager.view(room,p?.id,display)});
        }
        if(op==='disconnect'&&req.method==='POST') {
          const b=await body(req);await db.disconnect(code,p,b.client,display);return json({ok:true});
        }
        if(op==='command'&&req.method==='POST') {
          await db.rate(p.id,'command',120);const b=await body(req);
          const {manager,room}=await db.update(code,(manager,r)=>{manager.command(r,p.id,b.command,b.args,b.version,b.requestId);if(b.command==='game')r.replay=null;});
          return json({ok:true,room:manager.view(room,p.id)});
        }
      }
      return json({error:'Not found.'},404);
    }catch(e) {
      if(e instanceof HttpError)return json({error:e.message},e.status);
      if(/D1|SQLITE|binding|not a function|not implemented|not supported/i.test(e.message)) {console.error('Partydeck request failed:',e.message);return json({error:'The table service is temporarily unavailable. Please try again.'},503);}
      return json({error:e.message||'That action could not be completed.'},400);
    }
  },
};
