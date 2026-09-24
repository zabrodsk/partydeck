import Poker from 'poker-ts';
import { RoomManager } from '../server/rooms.js';
import { Blackjack } from '../server/blackjack.js';

export const emptyStats = () => ({hands:0,pokerHands:0,blackjackHands:0,wins:0,sessions:[],achievements:[]});

// Poker-ts 1.5.0 has no public snapshot API. Keep its original shuffled deck
// and replay only accepted actions. The private adapter is pinned and tested.
function advance(engine) {
  while (engine.isHandInProgress() && !engine.isBettingRoundInProgress()) {
    if (!engine.areBettingRoundsCompleted()) engine.endBettingRound();
    if (engine.areBettingRoundsCompleted()) { engine.showdown(); break; }
  }
}
export function restorePoker(log) {
  const engine = new Poker.Table({smallBlind:10,bigBlind:20},8);
  for (const p of log.players) engine.sitDown(p.seat,p.stack);
  const deck = engine._table._deck;
  for (let i=0;i<52;i++) Object.assign(deck[i],log.deck[i]);
  deck.shuffle = () => {};
  engine.startHand(log.button);
  advance(engine);
  for (const [action,amount] of log.actions) { engine.actionTaken(action,amount ?? undefined); advance(engine); }
  return engine;
}

export class HostedRooms extends RoomManager {
  constructor(now=()=>Date.now()) {
    const events=[];
    super({rooms:()=>[],saveRoom:()=>{},db:{exec:()=>{}},stats:(id,update)=>{
      const stats=emptyStats(); update(stats); events.push({id,stats});
    }},{now});
    this.events=events;
  }
  start(r) {
    super.start(r);
    if(r.game==='poker') r.replay={
      players:r.players.filter(p=>r.handStart[p.id]!==undefined).map(p=>({seat:p.seat,stack:r.handStart[p.id]})),
      button:r.button,deck:Array.from(r.engine._table._deck,c=>({rank:c.rank,suit:c.suit})),actions:[],
    };
    else r.replay=null;
  }
  action(r,id,action,amount) {
    super.action(r,id,action,amount);
    if(r.game==='poker') r.replay.actions.push([action,amount ?? null]);
  }
  hydrate(data) {
    const r={...data,engine:data.replay?restorePoker(data.replay):null,
      bj:data.bj?Object.assign(Object.create(Blackjack.prototype),data.bj):null,
      connections:new Map(),displays:new Set(),seen:new Set(data.seen||[])};
    this.rooms.set(r.code,r);return r;
  }
  snapshot(r) {
    const {engine,connections,displays,seen,...data}=r;
    return {...data,seen:[...seen]};
  }
}

export const PRESENCE_TTL=12000;
export function presence(manager,r,rows,now) {
  const before=JSON.stringify([r.onlineIds||[],!!r.displayOnline]);
  r.connections=new Map();r.displays=new Set();
  for(const row of rows) if(row.last_seen+PRESENCE_TTL>now) {
    if(row.display)r.displays.add(row.client_id);
    else {if(!r.connections.has(row.player_id))r.connections.set(row.player_id,new Set());r.connections.get(row.player_id).add(row.client_id);}
  }
  for(const p of r.players) {
    if(r.connections.get(p.id)?.size)p.offlineSince=null;
    else if(p.offlineSince==null) {
      const last=Math.max(0,...rows.filter(x=>!x.display&&x.player_id===p.id).map(x=>x.last_seen));
      p.offlineSince=last?last+PRESENCE_TTL:now;
    }
  }
  r.onlineIds=[...r.connections.keys()].sort();r.displayOnline=!!r.displays.size;
  if(before!==JSON.stringify([r.onlineIds,r.displayOnline])) {
    if(!r.displayOnline&&r.mode==='shared'&&r.phase==='playing') {r.paused=true;r.notice='Table display disconnected. Reconnect it or switch to phone-only mode.';}
    r.version++;
  }
  manager.tick();
}
