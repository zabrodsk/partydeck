import {randomBytes,timingSafeEqual} from 'node:crypto';
import {WorkOS} from '@workos-inc/node';
export const cookieValue=(req,name)=>req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);
export function appendCookie(res,value){const old=res.getHeader('Set-Cookie');res.setHeader('Set-Cookie',[...(Array.isArray(old)?old:old?[old]:[]),value]);}
export function authKit(store,{publicUrl,apiKey=process.env.WORKOS_API_KEY,clientId=process.env.WORKOS_CLIENT_ID,password=process.env.WORKOS_COOKIE_PASSWORD,client}={}){
 const enabled=!!(publicUrl&&apiKey&&clientId&&password?.length>=32);
 const workos=enabled?(client||new WorkOS(apiKey,{clientId})):null;
 const flows=new Map();const secure=publicUrl?.startsWith('https:')?'; Secure':'';
 const setCookie=(res,name,value,maxAge=30*86400)=>appendCookie(res,`${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);
 const load=req=>workos.userManagement.loadSealedSession({sessionData:cookieValue(req,'partydeck_auth'),cookiePassword:password});
 return {
  enabled,
  async resolve(req,res){
   if(!enabled||!cookieValue(req,'partydeck_auth'))return null;
   try{const session=load(req);let auth=await session.authenticate();if(!auth.authenticated){auth=await session.refresh();if(auth.authenticated&&auth.sealedSession)setCookie(res,'partydeck_auth',auth.sealedSession);}if(auth.authenticated)return store.workosPlayer(auth.user);setCookie(res,'partydeck_auth','',0);return null;}catch{return null;}
  },
  async start(req,res,url,guest){
   if(!enabled){res.writeHead(503,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('Account sign-in is not configured yet. You can still join as a guest.');return;}
   for(const [key,flow]of flows)if(flow.expires<Date.now())flows.delete(key);
   if(flows.size>=500){res.writeHead(429);res.end('Please try again shortly.');return;}
   const {url:authorizationUrl,state,codeVerifier}=await workos.userManagement.getAuthorizationUrlWithPKCE({provider:'authkit',clientId,redirectUri:publicUrl+'/auth/callback',screenHint:url.searchParams.get('signup')==='1'?'sign-up':'sign-in'});
   const binding=randomBytes(32).toString('hex');const requested=url.searchParams.get('returnTo')||'/';
   const returnTo=/^\/(?:room|join)\/[A-Z0-9]{6}$/.test(requested)?requested:'/';
   flows.set(state,{binding,codeVerifier,guestId:guest?.id,returnTo,expires:Date.now()+10*60000});setCookie(res,'partydeck_login',binding,600);
   res.writeHead(302,{Location:authorizationUrl,'Cache-Control':'no-store'});res.end();
  },
  async callback(req,res,url){
   const state=url.searchParams.get('state'),flow=flows.get(state),binding=cookieValue(req,'partydeck_login')||'';
   if(!enabled||!flow||flow.expires<Date.now()||binding.length!==flow.binding.length||!timingSafeEqual(Buffer.from(binding),Buffer.from(flow.binding))){res.writeHead(400,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('This sign-in expired. Return to Partydeck and sign in again.');return;}
   flows.delete(state);setCookie(res,'partydeck_login','',0);
   try{
    const code=url.searchParams.get('code');if(!code)throw Error();
    const result=await workos.userManagement.authenticateWithCode({clientId,code,codeVerifier:flow.codeVerifier,session:{sealSession:true,cookiePassword:password}});
    if(!result.user?.id||!result.sealedSession)throw Error();
    store.workosPlayer(result.user,flow.guestId);setCookie(res,'partydeck_auth',result.sealedSession);
    // Remove the old local session, preventing a saved account from remaining accessible through a guest cookie.
    store.revoke(cookieValue(req,'table_session'));appendCookie(res,`table_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
    res.writeHead(302,{Location:flow.returnTo,'Cache-Control':'no-store'});res.end();
   }catch{res.writeHead(302,{Location:'/?auth=failed','Cache-Control':'no-store'});res.end();}
  },
  async logout(req,res){
   let logoutUrl=null;if(enabled&&cookieValue(req,'partydeck_auth'))try{logoutUrl=await load(req).getLogoutUrl({returnTo:publicUrl});}catch{}
   setCookie(res,'partydeck_auth','',0);return logoutUrl;
  }
 };
}
