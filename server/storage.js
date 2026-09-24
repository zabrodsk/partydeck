import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { dirname } from 'node:path';
const scrypt = promisify(scryptCb);
export const token = () => randomBytes(32).toString('hex');

export class Store {
  constructor(file = 'data/table.sqlite') {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT UNIQUE, password TEXT, stats TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, player_id TEXT NOT NULL, expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, snapshot TEXT NOT NULL, updated INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS identities (provider_id TEXT PRIMARY KEY, player_id TEXT NOT NULL UNIQUE);`);
  }
  player(id) { if (typeof id !== 'string') return null; const p = this.db.prepare('SELECT * FROM players WHERE id=?').get(id); if (!p) return null; return { id: p.id, name: p.name, username: p.username, authProvider: this.db.prepare('SELECT 1 FROM identities WHERE player_id=?').get(id)?'workos':null, stats: JSON.parse(p.stats) }; }
  create(name) { const id = token(); this.db.prepare('INSERT INTO players(id,name,stats) VALUES(?,?,?)').run(id, name, JSON.stringify({ hands: 0, pokerHands: 0, blackjackHands: 0, wins: 0, sessions: [], achievements: [] })); return this.player(id); }
  session(id) { const key = token(); this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(key, id, Date.now() + 30 * 864e5); return key; }
  resolve(key) { if (!key) return null; const row = this.db.prepare('SELECT player_id FROM sessions WHERE token=? AND expires>?').get(key, Date.now()); return row ? this.player(row.player_id) : null; }
  revoke(key) { if (typeof key !== 'string') return; this.db.prepare('DELETE FROM sessions WHERE token=?').run(key); }
  workosPlayer(user, guestId) {
    if(typeof user?.id!=='string'||!user.id.startsWith('user_'))throw Error('Invalid identity.');
    const existing=this.db.prepare('SELECT player_id FROM identities WHERE provider_id=?').get(user.id);
    if(existing)return this.player(existing.player_id);
    this.db.exec('BEGIN');
    try {
      const guest=guestId?this.player(guestId):null;
      const p=guest&&!guest.authProvider?guest:this.create((user.firstName||user.email?.split('@')[0]||'Player').slice(0,24));
      this.db.prepare('INSERT INTO identities(provider_id,player_id) VALUES(?,?)').run(user.id,p.id);
      this.db.prepare('DELETE FROM sessions WHERE player_id=?').run(p.id);
      this.db.exec('COMMIT');return this.player(p.id);
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  async register(id, username, password) {
    if (typeof username !== 'string') throw Error('Enter a username.');
    username = username.toLowerCase().trim();
    if (!/^[a-z0-9_]{3,24}$/.test(username)) throw Error('Use 3–24 letters, numbers or underscores.');
    if (typeof password !== 'string' || password.length < 10 || password.length > 128) throw Error('Use a password with 10–128 characters.');
    if (this.player(id)?.username||this.player(id)?.authProvider) throw Error('This profile is already saved.');
    const salt = randomBytes(16).toString('hex'); const hash = (await scrypt(password, salt, 64)).toString('hex');
    try { this.db.prepare('UPDATE players SET username=?,password=? WHERE id=?').run(username, salt + ':' + hash, id); } catch { throw Error('That username is already taken.'); }
    return this.player(id);
  }
  async login(username, password) {
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 128) throw Error('Check your username and password.');
    const p = this.db.prepare('SELECT id,password FROM players WHERE username=?').get(username.toLowerCase().trim());
    const [salt, hash] = (p?.password ?? 'invalid:' + '0'.repeat(128)).split(':');
    const input = await scrypt(password, salt, 64);
    if (!p || !timingSafeEqual(input, Buffer.from(hash, 'hex'))) throw Error('Check your username and password.');
    return this.player(p.id);
  }
  stats(id, update) { const p = this.player(id); if (!p) return; update(p.stats); this.db.prepare('UPDATE players SET stats=? WHERE id=?').run(JSON.stringify(p.stats), id); return p.stats; }
  saveRoom(code, snapshot) { this.db.prepare('INSERT OR REPLACE INTO rooms VALUES(?,?,?)').run(code, JSON.stringify(snapshot), Date.now()); }
  rooms() { return this.db.prepare('SELECT snapshot FROM rooms WHERE updated>?').all(Date.now() - 7 * 864e5).map(r => JSON.parse(r.snapshot)); }
  close() { this.db.close(); }
}
