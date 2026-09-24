import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';

export const players=sqliteTable('players',{id:text('id').primaryKey(),name:text('name').notNull(),username:text('username').unique(),password:text('password')});
export const sessions=sqliteTable('sessions',{token:text('token').primaryKey(),playerId:text('player_id').notNull(),expires:integer('expires').notNull()},t=>[index('sessions_expiry').on(t.expires)]);
export const rooms=sqliteTable('rooms',{code:text('code').primaryKey(),state:text('state').notNull(),revision:integer('revision').notNull(),commitToken:text('commit_token').notNull(),creatorId:text('creator_id').notNull(),closed:integer('closed').notNull(),updated:integer('updated').notNull()},t=>[index('rooms_owner').on(t.creatorId,t.closed),index('rooms_updated').on(t.updated)]);
export const presence=sqliteTable('presence',{roomCode:text('room_code').notNull(),clientId:text('client_id').notNull(),playerId:text('player_id'),display:integer('display').notNull(),lastSeen:integer('last_seen').notNull()},t=>[primaryKey({columns:[t.roomCode,t.clientId]}),index('presence_expiry').on(t.lastSeen)]);
export const handResults=sqliteTable('hand_results',{id:text('id').primaryKey(),playerId:text('player_id').notNull(),stats:text('stats').notNull()},t=>[index('results_player').on(t.playerId)]);
export const rateLimits=sqliteTable('rate_limits',{key:text('key').primaryKey(),count:integer('count').notNull(),expires:integer('expires').notNull()},t=>[index('limits_expiry').on(t.expires)]);
