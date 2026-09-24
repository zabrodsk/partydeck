import test from 'node:test';
import assert from 'node:assert/strict';
import {bettingOptions,bettingAmounts,bettingPresets} from '../public/betting.js';
const poker=()=>({code:'ABCDEF',game:'poker',phase:'playing',handNumber:1,stage:'Pre-flop',activeId:'me',players:[{id:'me',bet:10}],me:{id:'me',seated:true,stack:1990,bet:20,legal:{actions:['fold','call','raise'],chipRange:{min:40,max:2000}}}});
const blackjack=()=>({code:'ABCDEF',game:'blackjack',phase:'lobby',handNumber:0,me:{seated:true,stack:1999,bet:20}});
test('poker editor distinguishes a round total from newly committed chips',()=>{
 const options=bettingOptions(poker(),'poker');
 assert.deepEqual(bettingAmounts(options,'80'),{amount:80,valid:true,added:70,remaining:1920});
 assert.deepEqual(bettingAmounts(options,'2000'),{amount:2000,valid:true,added:1990,remaining:0});
 for(const raw of ['','1e3','80.5','-40','2001','39',' 80','Infinity'])assert.equal(bettingAmounts(options,raw).valid,false,raw);
});
test('opening bets and short all-ins use the actual legal limits',()=>{
 const r=poker();r.players[0].bet=0;r.me.legal={actions:['check','bet'],chipRange:{min:20,max:1990}};
 let options=bettingOptions(r,'poker');assert.equal(options.action,'bet');assert.equal(bettingAmounts(options,'20').added,20);
 r.me.stack=25;r.players[0].bet=10;r.me.legal={actions:['call','raise'],chipRange:{min:35,max:35}};
 options=bettingOptions(r,'poker');assert.deepEqual(bettingPresets(options),[{amount:35,label:'All in'}]);assert.equal(bettingAmounts(options,'35').remaining,0);
});
test('blackjack keeps odd chips in the stack and only accepts even bets',()=>{
 const options=bettingOptions(blackjack(),'blackjack');assert.equal(options.max,1998);assert.equal(options.step,2);
 assert.equal(bettingAmounts(options,'51').valid,false);assert.equal(bettingAmounts(options,'1998').remaining,1);
 for(const preset of bettingPresets(options))assert.equal(bettingAmounts(options,String(preset.amount)).valid,true);
 const r=blackjack();r.me.stack=1;assert.equal(bettingOptions(r,'blackjack'),null);
 r.me.stack=4;assert.deepEqual(bettingPresets(bettingOptions(r,'blackjack')),[{amount:4,label:'All in'}]);
});
test('editing survives presence updates but cannot carry into another turn or hand',()=>{
 const r=poker(),key=bettingOptions(r,'poker').key;r.version=100;r.players.push({id:'new',bet:0});
 assert.equal(bettingOptions(r,'poker').key,key);
 r.activeId='new';assert.equal(bettingOptions(r,'poker'),null);
 r.activeId='me';r.handNumber++;assert.notEqual(bettingOptions(r,'poker').key,key);
 r.paused=true;assert.equal(bettingOptions(r,'poker'),null);
 r.paused=false;r.me.seated=false;assert.equal(bettingOptions(r,'poker'),null);
 const b=blackjack();b.phase='playing';assert.equal(bettingOptions(b,'blackjack'),null);
});
