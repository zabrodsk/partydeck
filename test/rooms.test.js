import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/storage.js';
import { RoomManager } from '../server/rooms.js';

test('display-only creation has no seat; first phone becomes host and can start',t=>{
  const store=new Store(':memory:');t.after(()=>store.close());const m=new RoomManager(store);
  const r=m.create({id:'display-device'},{mode:'shared',displayOnly:true});
  assert.equal(r.hostId,null);assert.equal(r.players.length,0);m.connect(r,null,'tv',true);
  const a=store.create('Phone host'),b=store.create('Friend');m.join(r,a);m.connect(r,a.id,'a');m.join(r,b);m.connect(r,b.id,'b');
  assert.equal(r.hostId,a.id);assert.equal(m.view(r,a.id).me.isHost,true);assert.equal(m.view(r,null,true).me,null);
  m.command(r,a.id,'start',{},r.version,'start-from-phone');assert.equal(r.phase,'playing');
  assert.equal(r.players.length,2);assert.equal(Object.keys(r.handStart).length,2);
  assert.throws(()=>m.command(r,'display-device','action',{action:'fold'},r.version,'display-action'),/seat/);
});

test('an old unstarted room moves hosting from the display device to its connected phone',t=>{
  const store=new Store(':memory:');t.after(()=>store.close());const m=new RoomManager(store);
  const oldHost=store.create('Laptop'),phone=store.create('Phone');
  const r=m.create(oldHost,{mode:'shared',game:'blackjack'});delete r.creatorId;
  m.join(r,phone);m.connect(r,phone.id,'phone');r.paused=true;
  m.connect(r,oldHost.id,'screen',true);
  assert.equal(r.hostId,phone.id);assert.equal(r.players.find(p=>p.id===oldHost.id).seated,false);assert.equal(r.paused,false);
  m.command(r,phone.id,'start',{},r.version,'phone-starts-legacy');assert.ok(['playing','complete'].includes(r.phase));
});

function setup(t,n=3,opts={}) {
  const store=new Store(':memory:');t.after(()=>store.close());let now=100000;
  const m=new RoomManager(store,{now:()=>now,graceMs:30000});
  const people=Array.from({length:n},(_,i)=>store.create('Player '+i));
  const r=m.create(people[0],{mode:'phones',...opts});
  for(const p of people){m.join(r,p);m.connect(r,p.id,p.id);}
  let request=0;
  const cmd=(id,command,args={})=>m.command(r,id,command,args,r.version,'request-'+(++request));
  const start=()=>cmd(r.hostId,'start');
  const finish=()=>{let guard=0;while(r.phase==='playing'){assert.ok(++guard<100);const id=m.activeId(r),legal=m.view(r,id).me.legal.actions;cmd(id,'action',{action:legal.includes('check')?'check':legal.includes('call')?'call':'stand'});}};
  return {store,m,r,people,cmd,start,finish,advance:ms=>{now+=ms;return m.tick();}};
}

test('private cards never reach the shared display or another player; shared phones omit the board',t=>{
  const {m,r,people,start,cmd}=setup(t,3,{mode:'shared'});m.connect(r,null,'display',true);start();
  const display=m.view(r,null,true);assert.equal(display.me,null);assert.ok(display.players.every(p=>p.cards===null));
  const phone=m.view(r,people[0].id);assert.equal(phone.me.cards.length,2);assert.deepEqual(phone.board,[]);assert.equal(phone.pot,null);
  assert.ok(!JSON.stringify(phone).includes('privateCards'));assert.ok(!JSON.stringify(display).includes('engine'));
  for(const p of people.slice(1))assert.ok(!JSON.stringify(phone).includes(JSON.stringify(r.privateCards[p.id])));
  for(let i=0;i<3;i++){const id=m.activeId(r),actions=m.view(r,id).me.legal.actions;cmd(id,'action',{action:actions.includes('call')?'call':'check'});}
  assert.equal(m.view(r,null,true).board.length,3);assert.deepEqual(m.view(r,people[0].id).board,[]);
});
test('stale, repeated, unauthorized and out-of-turn commands cannot change chips',t=>{
  const {m,r,people,cmd,start}=setup(t);assert.throws(()=>cmd(people[1].id,'start'),/host/);start();
  const id=m.activeId(r),other=people.find(p=>p.id!==id).id,stack=r.players.map(p=>p.stack),v=r.version;
  assert.throws(()=>cmd(other,'action',{action:'fold'}),/turn/);
  assert.throws(()=>m.command(r,id,'action',{action:'fold'},v-1,'stale-test'),/changed/);
  assert.throws(()=>cmd(id,'action',{action:'raise',amount:1}),/allowed range/);
  assert.deepEqual(r.players.map(p=>p.stack),stack);
  m.command(r,id,'action',{action:'call'},v,'same-request');const after=r.version;
  m.command(r,id,'action',{action:'call'},v,'same-request');assert.equal(r.version,after);
});
test('uncontested hands settle without showing the winner cards',t=>{
  const {r,m,cmd,start,store}=setup(t,2);start();cmd(m.activeId(r),'action',{action:'fold'});
  assert.equal(r.phase,'complete');assert.equal(r.players.reduce((n,p)=>n+p.stack,0),4000);assert.deepEqual(r.revealed,{});
  assert.equal(r.results.length,1);assert.equal(store.player(r.results[0].id).stats.wins,1);
  assert.equal(r.results[0].amount,20);assert.equal(r.pot,20);
});
test('different all-in stacks generate side pots and conserve every chip across 2–8 seats',t=>{
  const {r,m,cmd,start}=setup(t,8);
  for(let round=0;round<40;round++){
    const count=2+round%7;for(const [i,p]of r.players.entries()){p.seated=i<count;p.stack=11+i*59+round%5;}
    const initial=r.players.filter(p=>p.seated).reduce((n,p)=>n+p.stack,0);start();let guard=0;
    while(r.phase==='playing'){
      assert.ok(++guard<100);const id=m.activeId(r),legal=m.view(r,id).me.legal;
      const action=legal.actions.includes('raise')?'raise':legal.actions.includes('bet')?'bet':legal.actions.includes('call')?'call':'check';
      cmd(id,'action',{action,amount:legal.chipRange?.max});
    }
    assert.equal(r.players.filter(p=>p.seated).reduce((n,p)=>n+p.stack,0),initial);
    assert.equal(r.board.length,5);assert.ok(r.results.length>=1);
    assert.equal(r.results.reduce((n,p)=>n+p.amount,0),r.pot);
    assert.equal(r.pot,initial-59,'unmatched final side pot is returned, not counted as a win');
  }
});
test('grace period retains the hand, reconnect restores it, expiration folds and releases the seat',t=>{
  const {r,m,start,cmd,advance}=setup(t,2);start();const id=m.activeId(r),original=[...r.privateCards[id]];
  m.disconnect(r,id,id);advance(29000);assert.equal(r.phase,'playing');m.connect(r,id,'return');assert.deepEqual(m.view(r,id).me.cards,original);
  m.disconnect(r,id,'return');advance(31000);assert.equal(r.phase,'complete');assert.equal(r.players.find(p=>p.id===id).seated,false);
  assert.equal(r.players.reduce((n,p)=>n+p.stack,0),4000);
});
test('display loss pauses actions and host can switch to phones and resume',t=>{
  const {r,m,start,cmd}=setup(t,2,{mode:'shared'});assert.throws(start,/display/);m.connect(r,null,'tv',true);start();m.disconnect(r,null,'tv',true);
  assert.equal(r.paused,true);assert.throws(()=>cmd(m.activeId(r),'action',{action:'fold'}),/not taking/);
  cmd(r.hostId,'mode',{mode:'phones'});cmd(r.hostId,'pause');assert.equal(r.paused,false);assert.ok(m.view(r,r.hostId).pot>0);
});
test('host transfer, rebuys, game change and mixed-game achievements',t=>{
  const {r,m,people,start,cmd,finish,store}=setup(t,3);start();finish();
  const poor=r.players.find(p=>p.stack<2000);if(poor){cmd(poor.id,'rebuy-request');cmd(r.hostId,'rebuy',{playerId:poor.id});assert.equal(poor.stack,2000);}
  cmd(r.hostId,'transfer',{playerId:people[1].id});assert.equal(r.hostId,people[1].id);
  cmd(r.hostId,'game',{game:'blackjack'});start();finish();
  assert.ok(store.player(people[0].id).stats.achievements.includes('mixed-table'));
  assert.ok(store.player(people[0].id).stats.achievements.includes('game-night'));
});
test('restarting cancels an incomplete hand, refunds stacks, and never persists private cards',t=>{
  const {r,m,store,start,cmd}=setup(t,2);start();cmd(m.activeId(r),'action',{action:'raise',amount:100});
  const saved=store.rooms()[0];assert.equal(saved.privateCards,undefined);assert.equal(saved.engine,undefined);
  const restarted=new RoomManager(store);const restored=restarted.get(r.code);
  assert.equal(restored.phase,'lobby');assert.equal(restored.paused,true);assert.deepEqual(restored.players.map(p=>p.stack),[2000,2000]);
  assert.match(restored.notice,/cancelled/);assert.equal(store.player(r.hostId).stats.hands,0);
});
test('saved profiles authenticate and keep achievements after signing in elsewhere',async t=>{
  const {store,r,start,finish}=setup(t,2);start();finish();const p=await store.register(r.hostId,'friday_friend','long-test-password');
  const signed=await store.login('FRIDAY_FRIEND','long-test-password');assert.equal(signed.id,p.id);assert.equal(signed.stats.hands,1);
  await assert.rejects(store.login('friday_friend','wrong-password'),/Check/);
  const session=store.session(p.id);assert.equal(store.resolve(session).id,p.id);store.revoke(session);assert.equal(store.resolve(session),null);
});
test('a connected player can recover a paused table after its host and display disappear',t=>{
  const {r,m,people,start,cmd,advance}=setup(t,2,{mode:'shared'});m.connect(r,null,'tv',true);start();
  m.disconnect(r,r.hostId,r.hostId);m.disconnect(r,null,'tv',true);
  assert.throws(()=>cmd(people[1].id,'claim-host'),/reconnect/);advance(31000);
  cmd(people[1].id,'claim-host');cmd(people[1].id,'mode',{mode:'phones'});cmd(people[1].id,'pause');
  assert.equal(r.hostId,people[1].id);assert.equal(r.paused,false);
});
test('disconnecting after going all-in does not fold or remove pot eligibility',t=>{
  const {r,m,cmd,start,advance,finish}=setup(t,3);r.players[0].stack=100;start();
  const id=m.activeId(r),legal=m.view(r,id).me.legal;
  cmd(id,'action',{action:'raise',amount:legal.chipRange.max});m.disconnect(r,id,id);advance(31000);
  assert.equal(r.players.find(p=>p.id===id).seated,true);assert.ok(!r.players.find(p=>p.id===id).lastAction.includes('Fold'));
  finish();assert.equal(r.players.reduce((n,p)=>n+p.stack,0),4100);
});

test('blackjack next hand waits for explicit bets from every connected player',t=>{
 const {r,m,people,cmd,finish}=setup(t,2,{game:'blackjack'});
 assert.throws(()=>cmd(people[1].id,'prepare'),/host/);
 cmd(r.hostId,'prepare');assert.equal(r.phase,'betting');assert.equal(r.handNumber,0);
 assert.throws(()=>cmd(r.hostId,'start'),/confirm/);
 cmd(people[0].id,'bet',{amount:50});assert.equal(m.view(r,people[0].id).me.betReady,true);
 assert.equal(r.players[0].stack,2000);assert.throws(()=>cmd(r.hostId,'start'),/confirm/);
 cmd(people[1].id,'bet',{amount:100});cmd(r.hostId,'start');
 assert.equal(r.handNumber,1);assert.equal(r.bj.players[0].hands[0].bet,50);assert.equal(r.bj.players[1].hands[0].bet,100);
 finish();cmd(r.hostId,'prepare');assert.ok(r.players.every(p=>!p.betReady));assert.equal(r.results.length,0);assert.equal(r.bj,null);
 assert.equal(m.view(r,people[0].id).me.hands.length,0);
 cmd(people[0].id,'bet',{amount:20});
 m.disconnect(r,people[1].id,people[1].id);cmd(r.hostId,'start');assert.equal(r.bj.players.length,1);
});

test('joining or reconnecting during blackjack betting cannot deal an unconfirmed bet',t=>{
 const {r,m,people,cmd,store}=setup(t,2,{game:'blackjack'});cmd(r.hostId,'prepare');
 cmd(r.hostId,'bet',{amount:20});m.disconnect(r,people[1].id,people[1].id);m.connect(r,people[1].id,'returned');
 assert.throws(()=>cmd(r.hostId,'start'),/confirm/);
 cmd(people[1].id,'bet',{amount:50});
 const late=store.create('Late player');m.join(r,late);m.connect(r,late.id,'late');assert.throws(()=>cmd(r.hostId,'start'),/confirm/);
 cmd(late.id,'bet',{amount:100});cmd(r.hostId,'start');assert.equal(r.bj.players.length,3);
});
