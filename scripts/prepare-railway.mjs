import {mkdir,rm,cp,readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),out='output/railway';
await rm(out,{recursive:true,force:true});await mkdir(out+'/public/cards',{recursive:true});
for(const file of ['package.json','package-lock.json','Dockerfile','.dockerignore'])await cp(file,out+'/'+file);
await cp('server',out+'/server',{recursive:true});
await mkdir(out+'/scripts',{recursive:true});await cp('scripts/container-entrypoint.sh',out+'/scripts/container-entrypoint.sh');
for(const file of await readdir('public'))if(file!=='cards')await cp('public/'+file,out+'/public/'+file,{recursive:true});
const cards=(await readdir('public/cards')).filter(x=>x.endsWith('.png'));
let original=0,compressed=0;
// Lossless encoding only. Keep every original pixel and alpha value, and retain
// all source PNGs in the project. No generated artwork is modified.
for(let i=0;i<cards.length;i+=6)await Promise.all(cards.slice(i,i+6).map(async name=>{
  const source='public/cards/'+name,target=out+'/public/cards/'+name.replace('.png','.webp');
  await exec('cwebp',['-quiet','-lossless','-exact','-m','6',source,'-o',target]);
  original+=(await stat(source)).size;compressed+=(await stat(target)).size;
}));
console.log(JSON.stringify({directory:out,cards:cards.length,originalBytes:original,encodedBytes:compressed}));
