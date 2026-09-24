// Byte-mode QR, version 5, error correction L. One 108-byte data block,
// 26 Reed-Solomon check bytes. Kept deliberately limited to short room URLs.
const SIZE=37, DATA=108, ECC=26;
function mul(a,b) {let r=0;for(let i=0;i<8;i++){if(b&1)r^=a;b>>>=1;a<<=1;if(a&256)a^=0x11d;}return r;}
function ecc(data) {
  let poly=[1],root=1;
  for(let i=0;i<ECC;i++){const next=Array(poly.length+1).fill(0);for(let j=0;j<poly.length;j++){next[j]^=poly[j];next[j+1]^=mul(poly[j],root);}poly=next;root=mul(root,2);}
  const out=Array(ECC).fill(0);for(const byte of data){const factor=byte^out.shift();out.push(0);for(let j=0;j<ECC;j++)out[j]^=mul(poly[j+1],factor);}return out;
}
export function qrMatrix(text) {
  const bytes=[...Buffer.from(text,'utf8')];if(bytes.length>106)throw Error('The join URL is too long for this QR code. Use the room code instead.');
  const bits=[];const put=(n,len)=>{for(let i=len-1;i>=0;i--)bits.push((n>>>i)&1);};
  put(4,4);put(bytes.length,8);for(const b of bytes)put(b,8);put(0,Math.min(4,DATA*8-bits.length));while(bits.length%8)bits.push(0);
  const data=[];for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((a,b)=>a*2+b,0));for(let pad=0;data.length<DATA;pad++)data.push(pad%2?0x11:0xec);
  const all=[...data,...ecc(data)].flatMap(b=>Array.from({length:8},(_,i)=>(b>>>(7-i))&1));
  const m=Array.from({length:SIZE},()=>Array(SIZE).fill(false));const fixed=Array.from({length:SIZE},()=>Array(SIZE).fill(false));
  const set=(x,y,v)=>{if(x>=0&&y>=0&&x<SIZE&&y<SIZE){m[y][x]=!!v;fixed[y][x]=true;}};
  function finder(x,y){for(let dy=-1;dy<=7;dy++)for(let dx=-1;dx<=7;dx++){const inner=dx>=0&&dx<=6&&dy>=0&&dy<=6;set(x+dx,y+dy,inner&&(dx===0||dx===6||dy===0||dy===6||(dx>=2&&dx<=4&&dy>=2&&dy<=4)));}}
  finder(0,0);finder(SIZE-7,0);finder(0,SIZE-7);
  for(let i=8;i<SIZE-8;i++){set(i,6,i%2===0);set(6,i,i%2===0);}
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(30+dx,30+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
  // Format information for L/mask 0, BCH encoded and masked.
  const format=(1<<3)|0;let remainder=format;
  for(let i=0;i<10;i++)remainder=(remainder<<1)^((remainder>>>9)*0x537);
  const encoded=((format<<10)|remainder)^0x5412;
  const fb=i=>(encoded>>>i)&1;
  for(let i=0;i<=5;i++)set(8,i,fb(i));set(8,7,fb(6));set(8,8,fb(7));set(7,8,fb(8));for(let i=9;i<15;i++)set(14-i,8,fb(i));
  for(let i=0;i<8;i++)set(SIZE-1-i,8,fb(i));for(let i=8;i<15;i++)set(8,SIZE-15+i,fb(i));set(8,SIZE-8,true);
  let index=0,up=true;
  for(let right=SIZE-1;right>=1;right-=2){if(right===6)right=5;for(let row=0;row<SIZE;row++){const y=up?SIZE-1-row:row;for(let dx=0;dx<2;dx++){const x=right-dx;if(!fixed[y][x]){m[y][x]=Boolean((all[index++]??0)^((x+y)%2===0?1:0));}}}up=!up;}
  return m;
}
export function qrSvg(text) {const m=qrMatrix(text),rects=[];for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++)if(m[y][x])rects.push(`M${x+4},${y+4}h1v1h-1z`);return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45" role="img" aria-label="Scan to join the table"><rect width="45" height="45" fill="white"/><path d="${rects.join('')}" fill="black"/></svg>`;}
