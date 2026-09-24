import {readdir,mkdir,stat,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
await mkdir('public/cards/play',{recursive:true});
let original=0,small=0,large=0;
for(const name of (await readdir('public/cards')).filter(n=>n.endsWith('.png'))){
 original+=(await stat('public/cards/'+name)).size;
 for(const width of [320,640]){
  const out=`public/cards/play/${name.slice(0,-4)}-${width}.webp`;
  execFileSync('cwebp',['-quiet','-resize',String(width),'0','-q','86','-m','6','public/cards/'+name,'-o',out]);
  const bytes=(await stat(out)).size;if(width===320)small+=bytes;else large+=bytes;
 }
}
execFileSync('cwebp',['-quiet','-resize','460','0','-q','90','-m','6','public/brand/partydeck.png','-o','public/brand/partydeck-small.webp']);
const report={originalPngBytes:original,gameplay320Bytes:small,retina640Bytes:large,reductionPercent:Math.round((1-large/original)*100)};
await mkdir('output',{recursive:true});await writeFile('output/asset-performance.json',JSON.stringify(report,null,2));console.log(report);
