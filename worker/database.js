import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { achievements } from '../server/rooms.js';
import { HostedRooms, presence, emptyStats } from './room-state.js';

const scrypt=promisify(scryptCallback);
const token=()=>randomBytes(32).toString('hex');
const digest=s=>createHash('sha256').update(s).digest('hex');
export class HttpError extends Error {constructor(message,status=400){super(message);this.status=status;}}

export class Database {
  constructor(binding,now=()=>Date.now()) {this.db=binding;this.now=now;}
  async identity(key) {
    if(!key)return null;
    return this.db.prepare('SELECT p.id,p.name,p.username FROM players p JOIN sessions s ON s.player_id=p.id WHERE s.token=? AND s.expires>?').bind(digest(key),this.now()).first();
  }
  async profile(p) {
    if(!p)return null;
    const rows=(await this.db.prepare('SELECT stats FROM hand_results WHERE player_id=?').bind(p.id).all()).results;
    const stats=emptyStats(),sessions=new Set(),awards=new Set();
    for(const row of rows){const s=JSON.parse(row.stats);for(const key of ['hands','pokerHands','blackjackHands','wins'])stats[key]+=s[key]||0;for(const room of s.sessions)sessions.add(room);for(const a of s.achievements)awards.add(a);}
    if(stats.pokerHands&&stats.blackjackHands)awards.add('mixed-table');if(sessions.size>=5)awards.add('regular');
    return {...p,stats:{...stats,sessions:sessions.size,achievements:[...awards]},achievements};
  }
  async guest(name) {
    if(typeof name!=='string'||!name.trim()||name.trim().length>24)throw new HttpError('Enter a nickname of up to 24 characters.');
    const p={id:token(),name:name.trim(),username:null};
    await this.db.prepare('INSERT INTO players(id,name) VALUES(?,?)').bind(p.id,p.name).run();return p;
  }
  async session(id) {
    const key=token();await this.db.prepare('INSERT INTO sessions(token,player_id,expires) VALUES(?,?,?)').bind(digest(key),id,this.now()+30*864e5).run();return key;
  }
  async revoke(key) {if(key)await this.db.prepare('DELETE FROM sessions WHERE token=?').bind(digest(key)).run();}
  async register(p,username,password) {
    if(typeof username!=='string')throw new HttpError('Enter a username.');
    username=username.toLowerCase().trim();
    if(!/^[a-z0-9_]{3,24}$/.test(username))throw new HttpError('Use 3–24 letters, numbers or underscores.');
    if(typeof password!=='string'||password.length<10||password.length>128)throw new HttpError('Use a password with 10–128 characters.');
    if(p.username)throw new HttpError('This profile is already saved.');
    const salt=randomBytes(16).toString('hex'),hash=(await scrypt(password,salt,64)).toString('hex');
    try {
      const result=await this.db.prepare('UPDATE players SET username=?,password=? WHERE id=? AND username IS NULL').bind(username,salt+':'+hash,p.id).run();
      if(!result.meta.changes)throw new HttpError('This profile is already saved.');
    } catch(e) {if(/UNIQUE/.test(e.message))throw new HttpError('That username is already taken.');throw e;}
    return {...p,username};
  }
  async login(username,password) {
    if(typeof username!=='string'||typeof password!=='string'||password.length>128)throw new HttpError('Check your username and password.');
    const p=await this.db.prepare('SELECT id,name,username,password FROM players WHERE username=?').bind(username.toLowerCase().trim()).first();
    const [salt,hash]=(p?.password||'invalid:'+ '0'.repeat(128)).split(':');
    const input=await scrypt(password,salt,64);
    if(!p||!timingSafeEqual(input,Buffer.from(hash,'hex')))throw new HttpError('Check your username and password.');
    return {id:p.id,name:p.name,username:p.username};
  }
  async rate(ip,route,max=120) {
    const bucket=Math.floor(this.now()/60000),key=digest(ip+':'+route+':'+bucket);
    const row=await this.db.prepare('INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key,(bucket+2)*60000).first();
    if(row.count>max)throw new HttpError('Too many requests. Please wait a minute.',429);
  }
  async cleanup() {
    await this.db.batch([
      this.db.prepare('DELETE FROM rate_limits WHERE expires<?').bind(this.now()),
      this.db.prepare('DELETE FROM sessions WHERE expires<?').bind(this.now()),
      this.db.prepare('DELETE FROM presence WHERE last_seen<?').bind(this.now()-864e5),
      this.db.prepare('DELETE FROM rooms WHERE updated<?').bind(this.now()-7*864e5),
    ]);
  }
  async room(code) {
    const row=await this.db.prepare('SELECT * FROM rooms WHERE code=? AND updated>?').bind(code,this.now()-7*864e5).first();
    if(!row)throw new HttpError('That room could not be found.',404);return row;
  }
  async create(p,options) {
    const manager=new HostedRooms(this.now),r=manager.create(p,options),state=JSON.stringify(manager.snapshot(r));
    // The quota check and insert are one statement, even across Workers.
    const result=await this.db.prepare(`INSERT INTO rooms(code,state,revision,commit_token,creator_id,closed,updated)
      SELECT ?,?,0,?,?,0,? WHERE (SELECT COUNT(*) FROM rooms WHERE creator_id=? AND closed=0 AND updated>?)<5`)
      .bind(r.code,state,randomUUID(),p.id,this.now(),p.id,this.now()-7*864e5).run();
    if(!result.meta.changes)throw new HttpError('End an existing room before creating another.');return r;
  }
  async heartbeat(code,p,client,display=false) {
    if(!/^[a-f0-9-]{36}$/.test(client||''))throw new HttpError('Invalid connection. Refresh the page.');
    // Player ID comes only from the authenticated cookie, never the request body.
    const owner=display?'display':p.id,key=owner+':'+client;
    await this.db.prepare(`INSERT INTO presence(room_code,client_id,player_id,display,last_seen)
      VALUES(?,?,?,?,?) ON CONFLICT(room_code,client_id) DO UPDATE SET last_seen=excluded.last_seen
      WHERE presence.last_seen<?`).bind(code,key,display?null:p.id,display?1:0,this.now(),this.now()-4000).run();
  }
  async disconnect(code,p,client,display=false) {
    const owner=display?'display':p.id;
    await this.db.prepare('DELETE FROM presence WHERE room_code=? AND client_id=?').bind(code,owner+':'+client).run();
  }
  async update(code,mutate=()=>{}) {
    for(let attempt=0;attempt<6;attempt++) {
      const row=await this.room(code),manager=new HostedRooms(this.now);let r=manager.hydrate(JSON.parse(row.state));
      const online=(await this.db.prepare('SELECT * FROM presence WHERE room_code=?').bind(code).all()).results;
      presence(manager,r,online,this.now());
      const beforeMutation=JSON.stringify(manager.snapshot(r)),eventCount=manager.events.length;
      let error;try{mutate(manager,r);}catch(e){error=e;r=manager.hydrate(JSON.parse(beforeMutation));manager.events.length=eventCount;}
      const state=JSON.stringify(manager.snapshot(r));
      if(state===row.state){if(error)throw error;return {manager,room:r};}
      const commit=randomUUID();
      const statements=[this.db.prepare('UPDATE rooms SET state=?,revision=revision+1,commit_token=?,closed=?,updated=? WHERE code=? AND revision=?')
        .bind(state,commit,r.phase==='closed'?1:0,this.now(),code,row.revision)];
      for(const event of manager.events) statements.push(this.db.prepare(`INSERT OR IGNORE INTO hand_results(id,player_id,stats)
        SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM rooms WHERE code=? AND commit_token=?)`)
        .bind(code+':'+r.handNumber+':'+event.id,event.id,JSON.stringify(event.stats),code,commit));
      const results=await this.db.batch(statements);
      if(results[0].meta.changes){if(error)throw error;return {manager,room:r};}
    }
    throw new HttpError('The table is busy. Please try again.',409);
  }
}
