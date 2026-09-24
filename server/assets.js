import {readFile,stat} from 'node:fs/promises';
import {extname} from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompress,gzip} from 'node:zlib';
import {promisify} from 'node:util';
const br=promisify(brotliCompress),gz=promisify(gzip);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json'};
export function assetServer({production=false}={}){
 const cache=new Map();
 return async function serve(req,res,file,path){
  let asset=cache.get(file);const info=(!production||!asset)?await stat(file):null;
  if(info&&!info.isFile())throw Error('Not a file');
  if(!asset||info&&info.mtimeMs!==asset.mtime){
   const data=await readFile(file);const compressible=/\.(html|css|js|svg|json)$/.test(file);
   asset={data,mtime:info.mtimeMs,etag:'W/"'+createHash('sha256').update(data).digest('hex').slice(0,20)+'"',type:mime[extname(file)]||'application/octet-stream'};
   if(compressible&&data.length>512)[asset.br,asset.gzip]=await Promise.all([br(data),gz(data)]);
   // Never cache originals or arbitrary large files in server memory.
   if(data.length<2e6)cache.set(file,asset);
  }
  const headers={'Content-Type':asset.type,'ETag':asset.etag,'Vary':'Accept-Encoding','Cache-Control':/^\/(cards\/play|art|brand)\//.test(path)?'public, max-age=86400, stale-while-revalidate=604800':'public, max-age=0, must-revalidate'};
  if(req.headers['if-none-match']?.split(',').map(x=>x.trim()).includes(asset.etag)){res.writeHead(304,headers);res.end();return;}
  const encodings=(req.headers['accept-encoding']||'').split(',').map(x=>{const [name,...params]=x.trim().split(';');return {name,q:Number(params.find(p=>p.trim().startsWith('q='))?.trim().slice(2)??1)};}).filter(x=>x.q>0);
  const encoding=asset.br&&encodings.some(x=>x.name==='br')?'br':asset.gzip&&encodings.some(x=>x.name==='gzip')?'gzip':null;
  const data=encoding?asset[encoding]:asset.data;if(encoding)headers['Content-Encoding']=encoding;headers['Content-Length']=data.length;
  res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:data);
 };
}
