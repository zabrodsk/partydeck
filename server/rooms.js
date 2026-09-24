import Poker from 'poker-ts';
import { randomInt } from 'node:crypto';
import { Blackjack, value } from './blackjack.js';

const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const toCard = c => c.rank + ({spades:'S',hearts:'H',diamonds:'D',clubs:'C'})[c.suit];
const safeName = name => String(name || '').trim().slice(0, 28) || 'Partydeck';
const rankingNames = ['High card','Pair','Two pair','Three of a kind','Straight','Flush','Full house','Four of a kind','Straight flush','Royal flush'];
export const achievements = [
  ['first-pot','First pot','Win your first poker pot.'],['full-house','Full house','Win a showdown with a full house.'],
  ['straight-flush','Straight flush','Win a showdown with a straight flush.'],['natural','Natural','Win with a two-card blackjack.'],
  ['twenty-one','Twenty-one','Win with 21 on three or more cards.'],['mixed-table','Mixed table','Play both games.'],
  ['game-night','Game night','Play with at least three people.'],['regular','Regular','Play five different sessions.'],
];

export class RoomManager {
  constructor(store, { graceMs = 30000, now = () => Date.now() } = {}) {
    this.store = store; this.rooms = new Map(); this.graceMs = graceMs; this.now = now;
    for (const data of store.rooms()) {
      if (data.phase === 'closed') continue;
      const interrupted = data.phase === 'playing';
      const r = {...data, engine:null, bj:null, connections:new Map(), displays:new Set(), seen:new Set()};
      for (const p of r.players) { if (interrupted && r.handStart?.[p.id] !== undefined) p.stack = r.handStart[p.id]; p.offlineSince = now(); p.lastAction = ''; }
      r.phase = 'lobby'; r.paused = true; r.board=[]; r.pot=0; r.revealed={}; r.privateCards={};
      r.notice = interrupted ? 'The server restarted. The unfinished hand was cancelled and all its chips returned.' : 'Room restored. Rejoin to continue.';
      r.version++; this.rooms.set(r.code,r); this.persist(r);
    }
  }
  persist(r) {
    const {engine,bj,connections,displays,seen,privateCards,...snapshot}=r;
    this.store.saveRoom(r.code,snapshot);
  }
  get(code) { const r=this.rooms.get(String(code).toUpperCase()); if(!r) throw Error('That room could not be found.'); return r; }
  create(player, options={}) {
    if ([...this.rooms.values()].filter(r=>(r.creatorId||r.hostId)===player.id && r.phase!=='closed').length>=5) throw Error('End an existing room before creating another.');
    let code; do { code=Array.from({length:6},()=>codeChars[randomInt(codeChars.length)]).join(''); } while(this.rooms.has(code));
    const r={code,name:safeName(options.name),hostId:player.id,game:options.game==='blackjack'?'blackjack':'poker',mode:options.mode==='phones'?'phones':'shared',phase:'lobby',paused:false,version:0,handNumber:0,button:-1,players:[],board:[],pot:0,results:[],revealed:{},privateCards:{},handStart:{},rebuyRequests:[],notice:'',connections:new Map(),displays:new Set(),seen:new Set(),engine:null,bj:null};
    r.creatorId=player.id;
    if(options.displayOnly===true&&r.mode==='shared'){
      r.displayOnlySetup=true;
      r.hostId=null;this.rooms.set(code,r);this.persist(r);
    }else{this.rooms.set(code,r);this.join(r,player);}
    return r;
  }
  join(r,player) {
    if(r.phase==='closed') throw Error('This room has ended.');
    let p=r.players.find(p=>p.id===player.id);
    if(p?.seated) {if(!r.hostId){r.hostId=p.id;r.version++;this.persist(r);}return p;}
    if(r.players.filter(p=>p.seated).length>=8) throw Error('This table is full.');
    const seat=Array.from({length:8},(_,i)=>i).find(i=>!r.players.some(p=>p.seated&&p.seat===i));
    if(!p) {p={id:player.id,name:player.name,stack:2000,bet:20,seat,seated:true,offlineSince:this.now(),lastAction:'',pending:r.phase==='playing'}; r.players.push(p);}
    else {p.seated=true;p.seat=seat;p.pending=r.phase==='playing';p.offlineSince=this.now();}
    if(!r.hostId)r.hostId=p.id;
    r.version++;this.persist(r);return p;
  }
  connect(r, id, connection, display=false) {
    if(display) {
      // Upgrade unstarted rooms made by the old laptop-as-player flow.
      if(!r.creatorId&&r.mode==='shared'&&r.handNumber===0&&id===r.hostId){
        r.creatorId=id;r.displayOnlySetup=true;
        const previous=r.players.find(p=>p.id===id);if(previous)previous.seated=false;
        r.connections.delete(id);r.hostId=r.players.find(p=>p.seated&&r.connections.get(p.id)?.size)?.id??null;
        r.paused=false;r.notice='';
      }
      r.displays.add(connection);
    }
    else {const p=r.players.find(p=>p.id===id&&p.seated);if(!p)throw Error('Join the room first.');if(!r.connections.has(id))r.connections.set(id,new Set());r.connections.get(id).add(connection);p.offlineSince=null;if(!r.hostId)r.hostId=id;}
    r.version++;this.persist(r);
  }
  disconnect(r,id,connection,display=false) {
    if(display) {r.displays.delete(connection);if(r.mode==='shared'&&!r.displays.size&&r.phase==='playing'){r.paused=true;r.notice='Table display disconnected. Reconnect it or switch to phone-only mode.';}}
    else {r.connections.get(id)?.delete(connection);if(!r.connections.get(id)?.size){const p=r.players.find(p=>p.id===id);if(p)p.offlineSince=this.now();}}
    r.version++;this.persist(r);
  }
  host(r,id) {if(r.hostId!==id)throw Error('Only the host can do that.');}
  command(r,id,command,args={},expectedVersion,requestId) {
    if(typeof requestId!=='string'||requestId.length>100||requestId.length<8)throw Error('Missing action identifier.');
    const key=id+':'+requestId;if(r.seen.has(key))return;
    if(expectedVersion!==r.version)throw Error('The table changed. Please try again.');
    const p=r.players.find(p=>p.id===id&&p.seated);if(!p)throw Error('You no longer have a seat. Rejoin the room.');
    if(r.phase==='closed')throw Error('This room has ended.');
    if(command==='start') {this.host(r,id);this.start(r);}
    else if(command==='action') {if(r.phase!=='playing'||r.paused)throw Error('The game is not taking actions right now.');this.action(r,id,args.action,args.amount);}
    else if(command==='pause') {this.host(r,id);if(r.paused&&r.mode==='shared'&&!r.displays.size)throw Error('Reconnect the table display or switch to phone-only mode.');r.paused=!r.paused;r.notice=r.paused?'The host paused the table.':'';}
    else if(command==='mode') {this.host(r,id);if(!['shared','phones'].includes(args.mode))throw Error('Choose a display mode.');r.mode=args.mode;if(r.mode==='phones'){r.notice='';}else if(!r.displays.size&&r.phase==='playing')r.paused=true;}
    else if(command==='game') {this.host(r,id);if(r.phase==='playing')throw Error('Finish the hand before changing games.');if(!['poker','blackjack'].includes(args.game))throw Error('Choose a game.');r.game=args.game;r.phase='lobby';r.engine=null;r.bj=null;r.results=[];r.board=[];r.privateCards={};r.revealed={};}
    else if(command==='bet') {if(r.game!=='blackjack'||r.phase==='playing')throw Error('Set your bet between hands.');if(!Number.isSafeInteger(args.amount)||args.amount<2||args.amount%2||args.amount>p.stack)throw Error('Choose an even bet within your stack.');p.bet=args.amount;}
    else if(command==='rebuy-request') {if(!r.rebuyRequests.includes(id))r.rebuyRequests.push(id);}
    else if(command==='rebuy') {this.host(r,id);if(r.phase==='playing')throw Error('Rebuys are available between hands.');const target=r.players.find(x=>x.id===args.playerId&&x.seated);if(!target)throw Error('Player not found.');if(target.stack>=2000)throw Error('That player already has a full stack.');target.stack=2000;target.bet=Math.min(target.bet,2000);r.rebuyRequests=r.rebuyRequests.filter(x=>x!==target.id);}
    else if(command==='transfer') {this.host(r,id);const target=r.players.find(x=>x.id===args.playerId&&x.seated&&r.connections.get(x.id)?.size);if(!target)throw Error('Choose a connected player.');r.hostId=target.id;}
    else if(command==='claim-host') {const host=r.players.find(x=>x.id===r.hostId);if(r.connections.get(r.hostId)?.size||host?.offlineSince==null||this.now()-host.offlineSince<this.graceMs)throw Error('The host can still reconnect.');r.hostId=id;r.notice='Host controls transferred.';}
    else if(command==='leave') {if(r.phase==='playing')throw Error('Leave between hands so your chips can settle.');p.seated=false;r.rebuyRequests=r.rebuyRequests.filter(x=>x!==id);if(r.hostId===id){const next=r.players.find(x=>x.seated&&r.connections.get(x.id)?.size);if(next)r.hostId=next.id;else r.phase='closed';}}
    else if(command==='end') {this.host(r,id);if(r.phase==='playing')throw Error('Finish the hand before ending the session.');r.phase='closed';r.notice='Session complete.';}
    else throw Error('Unknown table action.');
    r.version++;r.seen.add(key);if(r.seen.size>500)r.seen.delete(r.seen.values().next().value);this.persist(r);
  }
  start(r) {
    if(r.phase==='playing')throw Error('A hand is already running.');
    if(r.paused)throw Error('Resume the table first.');
    if(r.mode==='shared'&&!r.displays.size)throw Error('Open the shared table display, or choose phone-only mode.');
    const participants=r.players.filter(p=>p.seated&&r.connections.get(p.id)?.size&&p.stack>=(r.game==='poker'?1:2));
    if(participants.length<(r.game==='poker'?2:1))throw Error(r.game==='poker'?'At least two connected players need chips.':'A connected player needs chips.');
    r.handNumber++;r.lastEvent=null;r.results=[];r.board=[];r.revealed={};r.privateCards={};r.pot=0;r.notice='';r.handStart={};
    for(const p of r.players){p.pending=false;p.lastAction='';}
    for(const p of participants)r.handStart[p.id]=p.stack;
    r.phase='playing';
    if(r.game==='poker') {
      const engine=new Poker.Table({smallBlind:10,bigBlind:20},8);r.engine=engine;r.bj=null;
      for(const p of participants)engine.sitDown(p.seat,p.stack);
      const eligible=participants.map(p=>p.seat).sort((a,b)=>a-b);r.button=eligible.find(s=>s>r.button)??eligible[0];
      engine.startHand(r.button);r.button=engine.button();
      for(const p of participants)r.privateCards[p.id]=(engine.holeCards()[p.seat]??[]).map(toCard);
      this.advancePoker(r);
    } else {
      r.engine=null;r.bj=new Blackjack(participants.map(p=>({id:p.id,stack:p.stack,bet:Math.max(2,Math.min(p.bet,p.stack-p.stack%2))})));
      this.syncBlackjack(r);if(r.bj.phase==='complete')this.finishBlackjack(r);
    }
  }
  activeId(r) {if(r.phase!=='playing')return null;if(r.game==='blackjack')return r.bj?.activePlayer?.id??null;return r.players.find(p=>p.seated&&p.seat===r.engine?.playerToAct())?.id??null;}
  action(r,id,action,amount) {
    if(this.activeId(r)!==id)throw Error('Wait for your turn.');
    const p=r.players.find(p=>p.id===id);
    if(r.game==='poker') {
      const legal=r.engine.legalActions();if(!legal.actions.includes(action))throw Error('That action is not available.');
      if(['raise','bet'].includes(action)&&(!Number.isSafeInteger(amount)||amount<legal.chipRange.min||amount>legal.chipRange.max))throw Error('Choose a bet within the allowed range.');
      r.engine.actionTaken(action,['bet','raise'].includes(action)?amount:undefined);
      p.lastAction=action==='fold'?'Folded':action==='check'?'Checked':action==='call'?'Called':`${action==='raise'?'Raised to':'Bet'} ${amount}`;
      this.advancePoker(r);
    } else {r.bj.act(id,action);p.lastAction=action==='stand'?'Stood':action==='double'?'Doubled':action==='split'?'Split':'Hit';this.syncBlackjack(r);if(r.bj.phase==='complete')this.finishBlackjack(r);}
    r.lastEvent={playerId:p.id,name:p.name,action:p.lastAction};
  }
  advancePoker(r) {
    const e=r.engine;
    for(let i=0;i<6&&e.isHandInProgress()&&!e.isBettingRoundInProgress();i++) {
      if(!e.areBettingRoundsCompleted())e.endBettingRound();
      if(e.areBettingRoundsCompleted()) {
        r.board=e.communityCards().map(toCard);const pots=e.pots();
        // The engine includes an unmatched wager in its last pot. It returns
        // those chips correctly, but that refund is not a win or a reveal.
        const committed=r.players.filter(p=>r.handStart[p.id]!==undefined).map(p=>({seat:p.seat,amount:r.handStart[p.id]-(e.seats()[p.seat]?.stack??0)})).sort((a,b)=>b.amount-a.amount);
        const uncalled=Math.max(0,committed[0].amount-(committed[1]?.amount??0));
        const potSize=k=>pots[k].size-(k===pots.length-1?uncalled:0);
        r.pot=pots.reduce((n,p)=>n+p.size,0)-uncalled;
        const uncontested=pots.length===1&&pots[0].eligiblePlayers.length===1;
        e.showdown();const winners=e.winners();
        if(uncontested) {const p=r.players.find(p=>p.seat===pots[0].eligiblePlayers[0]&&r.handStart[p.id]!==undefined);r.results=[{id:p.id,name:p.name,amount:potSize(0),label:'Wins the pot'}];}
        else for(let k=0;k<winners.length;k++) {
          if(potSize(k)===0)continue;
          const contested=pots[k].eligiblePlayers.length>1,odd=potSize(k)%winners[k].length;
          const clockwise=winners[k].map(w=>w[0]).sort((a,b)=>((a-r.button+7)%8)-((b-r.button+7)%8));
          for(const [seat,hand,hole] of winners[k]) {const p=r.players.find(p=>p.seat===seat&&r.handStart[p.id]!==undefined);if(contested)r.revealed[p.id]=hole.map(toCard);r.results.push({id:p.id,name:p.name,amount:Math.floor(potSize(k)/winners[k].length)+(clockwise.indexOf(seat)<odd?1:0),label:contested?rankingNames[hand.ranking]:'Wins side pot',ranking:contested?hand.ranking:undefined});}
        }
        this.syncPoker(r);this.finish(r);return;
      }
    }
    this.syncPoker(r);r.board=e.communityCards().map(toCard);r.pot=e.pots().reduce((sum,p)=>sum+p.size,0)+e.seats().reduce((sum,p)=>sum+(p?.betSize??0),0);
  }
  syncPoker(r) {const seats=r.engine.seats();for(const p of r.players)if(r.handStart[p.id]!==undefined){p.stack=seats[p.seat]?.stack??0;p.currentBet=seats[p.seat]?.betSize??0;}}
  syncBlackjack(r) {for(const p of r.bj.players){const member=r.players.find(m=>m.id===p.id);member.stack=p.stack;member.currentBet=p.hands.reduce((n,h)=>n+h.bet,0);}}
  finishBlackjack(r) {r.results=r.bj.players.flatMap(p=>p.hands.map(h=>({id:p.id,name:r.players.find(x=>x.id===p.id).name,amount:h.returned-h.bet,label:h.result,rank21:value(h.cards).total===21&&h.cards.length>=3,result:h.result})));this.finish(r);}
  finish(r) {
    r.phase='complete';const count=Object.keys(r.handStart).length;
    if(r.game==='poker') {const before=Object.values(r.handStart).reduce((a,b)=>a+b,0),after=r.players.filter(p=>r.handStart[p.id]!==undefined).reduce((a,p)=>a+p.stack,0);if(before!==after)throw Error('Chip conservation failed.');}
    this.store.db.exec('BEGIN');
    try {
      for(const id of Object.keys(r.handStart))this.store.stats(id,s=>{
        s.hands++;s[r.game==='poker'?'pokerHands':'blackjackHands']++;if(!s.sessions.includes(r.code))s.sessions.push(r.code);
        const won=r.results.filter(x=>x.id===id&&(r.game==='poker'||['win','blackjack'].includes(x.result)));if(won.length)s.wins++;
        const award=a=>{if(!s.achievements.includes(a))s.achievements.push(a);};
        if(r.game==='poker'&&won.length)award('first-pot');if(won.some(x=>x.ranking===6))award('full-house');if(won.some(x=>x.ranking>=8))award('straight-flush');
        if(won.some(x=>x.result==='blackjack'))award('natural');if(won.some(x=>x.rank21))award('twenty-one');if(s.pokerHands&&s.blackjackHands)award('mixed-table');if(count>=3)award('game-night');if(s.sessions.length>=5)award('regular');
      });
      for(const p of r.players)if(p.offlineSince!==null&&this.now()-p.offlineSince>=this.graceMs)p.seated=false;
      if(!r.connections.get(r.hostId)?.size){r.paused=true;r.notice='The host is disconnected. Reconnect or take over between hands.';}
      this.persist(r);this.store.db.exec('COMMIT');
    }catch(e){this.store.db.exec('ROLLBACK');throw e;}
  }
  tick() {
    const changed=[];
    for(const r of this.rooms.values()) {
      if(r.phase==='closed')continue;let did=false;
      for(const p of r.players)if(p.seated&&p.offlineSince!==null&&this.now()-p.offlineSince>=this.graceMs){
        if(r.phase!=='playing'){p.seated=false;did=true;}
        else if(!r.paused&&this.activeId(r)===p.id){const action=r.game==='poker'?(r.engine.legalActions().actions.includes('check')?'check':'fold'):'stand';this.action(r,p.id,action);did=true;}
      }
      if(did){r.version++;this.persist(r);changed.push(r);}
    }return changed;
  }
  view(r,viewerId,display=false) {
    const p=display?null:r.players.find(p=>p.id===viewerId);
    const publicTable=display||r.mode==='phones';
    const activeId=this.activeId(r);
    let legal={actions:[]};
    if(p?.seated&&activeId===viewerId&&r.phase==='playing'&&!r.paused){
      if(r.game==='poker'){legal=r.engine.legalActions();const seats=r.engine.seats();legal={...legal,call:Math.min(p.stack,Math.max(...seats.map(s=>s?.betSize??0))-(seats[p.seat]?.betSize??0))};}
      else legal={actions:r.bj.legal()};
    }
    const bj=r.bj?.publicView();
    return {code:r.code,name:r.name,hostId:r.hostId,game:r.game,mode:r.mode,phase:r.phase,paused:r.paused,version:r.version,handNumber:r.handNumber,notice:r.notice,displayConnected:r.displays.size>0,graceMs:this.graceMs,serverTime:this.now(),
      players:r.players.filter(x=>x.seated||x.id===viewerId).map(x=>({id:x.id,name:x.name,seat:x.seat,stack:x.stack,bet:x.currentBet??0,seated:x.seated,pending:x.pending,connected:!!r.connections.get(x.id)?.size,offlineSince:x.offlineSince,lastAction:x.lastAction,hasCards:r.handStart[x.id]!==undefined&&r.phase!=='lobby',cards:publicTable?r.revealed[x.id]??null:undefined})),
      stage:r.phase==='complete'?'Complete':r.game==='blackjack'?'Blackjack':r.board.length===5?'River':r.board.length===4?'Turn':r.board.length===3?'Flop':'Pre-flop',lastEvent:r.lastEvent??null,
      board:publicTable?r.board:[],pot:publicTable?r.pot:null,activeId,button:r.button,results:r.results,rebuyRequests:p?.id===r.hostId?r.rebuyRequests:[],
      blackjack:publicTable?bj:null,
      me:p?{handDelta:r.phase==='complete'&&r.handStart[p.id]!==undefined?p.stack-r.handStart[p.id]:null,id:p.id,pending:p.pending,seated:p.seated,stack:p.stack,bet:p.bet,cards:r.game==='poker'?(r.privateCards[p.id]??[]):[],hands:r.game==='blackjack'?bj?.players.find(x=>x.id===p.id)?.hands??[]:[],activeHand:r.bj?.handIndex??0,legal,isHost:p.id===r.hostId}:null};
  }
}
