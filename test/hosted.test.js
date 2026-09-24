import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Database } from '../worker/database.js';
import { HostedRooms } from '../worker/room-state.js';

function binding(){
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0000_charming_cobalt_man.sql',import.meta.url),'utf8'));
  const prepare=(query,params=[])=>({bind:(...values)=>prepare(query,values),
    first:async()=>sql.prepare(query).get(...params)||null,
    all:async()=>({results:sql.prepare(query).all(...params)}),
    run:async()=>({meta:{changes:sql.prepare(query).run(...params).changes}})});
  return {prepare,async batch(statements){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}},close:()=>sql.close()};
}

test('every poker action survives fresh Worker instances across 2–8 seats and unequal all-ins',()=>{
  for(let seats=2;seats<=8;seats++)for(let trial=0;trial<12;trial++){
    let m=new HostedRooms(),r=m.create({id:'p0',name:'P0'},{mode:'phones'});
    for(let i=1;i<seats;i++)m.join(r,{id:'p'+i,name:'P'+i});
    for(const [i,p] of r.players.entries()){p.stack=20+37*i;m.connect(r,p.id,p.id);}
    const total=r.players.reduce((n,p)=>n+p.stack,0);m.start(r);
    let guard=0;
    while(r.phase==='playing'){
      assert.ok(++guard<100);
      const before=m.view(r,m.activeId(r));
      const snapshot=JSON.parse(JSON.stringify(m.snapshot(r)));m=new HostedRooms();r=m.hydrate(snapshot);
      const after=m.view(r,m.activeId(r));
      assert.deepEqual(after.me.cards,before.me.cards);assert.deepEqual(after.me.legal,before.me.legal);assert.deepEqual(after.board,before.board);
      for(const p of r.players)m.connect(r,p.id,p.id);
      const legal=after.me.legal,action=legal.actions.includes('raise')?'raise':legal.actions.includes('bet')?'bet':legal.actions.includes('call')?'call':'check';
      m.action(r,m.activeId(r),action,legal.chipRange?.max);
    }
    assert.equal(r.players.reduce((n,p)=>n+p.stack,0),total);
    const restored=new HostedRooms().hydrate(JSON.parse(JSON.stringify(m.snapshot(r))));assert.deepEqual(restored.results,r.results);
  }
});

test('D1 conditional writes reject a racing action and persist settlement once',async()=>{
  const env=binding(),db=new Database(env);
  const a=await db.guest('Alex'),b=await db.guest('Mia');const r=await db.create(a,{mode:'phones'});
  await db.update(r.code,(m,r)=>m.join(r,b));
  for(const p of[a,b])await db.heartbeat(r.code,p,randomUUID());
  let state=await db.update(r.code);
  await db.update(r.code,(m,r)=>m.command(r,a.id,'start',{},state.room.version,randomUUID()));
  state=await db.update(r.code);const id=state.manager.activeId(state.room),version=state.room.version;
  // Serialize batches as D1 does, while letting the reads race.
  const batch=env.batch.bind(env);let tail=Promise.resolve();env.batch=items=>{const result=tail.then(()=>batch(items));tail=result.catch(()=>{});return result;};
  const actionId=randomUUID();
  await Promise.all([db.update(r.code,(m,r)=>m.command(r,id,'action',{action:'fold'},version,actionId)),db.update(r.code,(m,r)=>m.command(r,id,'action',{action:'fold'},version,actionId))]);
  const end=await db.update(r.code);assert.equal(end.room.phase,'complete');
  assert.equal((await db.profile(a)).stats.hands,1);assert.equal((await db.profile(b)).stats.hands,1);
  assert.equal(end.room.players.reduce((n,p)=>n+p.stack,0),4000);
  env.close();
});

test('hosted blackjack survives restart; private response hides dealer hole card',async()=>{
  const env=binding(),db=new Database(env),p=await db.guest('Alex'),r=await db.create(p,{mode:'phones',game:'blackjack'});
  await db.heartbeat(r.code,p,randomUUID());let result=await db.update(r.code);
  result=await db.update(r.code,(m,r)=>m.command(r,p.id,'start',{},result.room.version,randomUUID()));
  if(result.room.phase==='playing') {
    assert.equal(result.manager.view(result.room,p.id).blackjack.dealer[1],null);
    const cards=JSON.stringify(result.room.bj.players[0].hands[0].cards);
    result=await new Database(env).update(r.code);assert.equal(JSON.stringify(result.room.bj.players[0].hands[0].cards),cards);
    result=await db.update(r.code,(m,r)=>m.command(r,p.id,'action',{action:'stand'},result.room.version,randomUUID()));
  }
  assert.equal(result.room.phase,'complete');assert.equal((await db.profile(p)).stats.blackjackHands,1);env.close();
});

test('hosted heartbeat expiry grants grace, then folds and permits host recovery',async()=>{
  let now=100000;const env=binding(),db=new Database(env,()=>now),a=await db.guest('Alex'),b=await db.guest('Mia'),r=await db.create(a,{mode:'phones'});
  await db.update(r.code,(m,r)=>m.join(r,b));const ids=[randomUUID(),randomUUID()];
  await db.heartbeat(r.code,a,ids[0]);await db.heartbeat(r.code,b,ids[1]);let state=await db.update(r.code);
  state=await db.update(r.code,(m,r)=>m.command(r,a.id,'start',{},state.room.version,randomUUID()));
  now+=13000;await db.heartbeat(r.code,b,ids[1]);state=await db.update(r.code);assert.equal(state.room.phase,'playing');assert.equal(state.room.players.find(p=>p.id===a.id).offlineSince,112000);
  now+=30001;await db.heartbeat(r.code,b,ids[1]);state=await db.update(r.code);
  assert.equal(state.room.phase,'complete');assert.equal(state.room.players.find(p=>p.id===a.id).seated,false);
  state=await db.update(r.code,(m,r)=>m.command(r,b.id,'claim-host',{},state.room.version,randomUUID()));assert.equal(state.room.hostId,b.id);env.close();
});
