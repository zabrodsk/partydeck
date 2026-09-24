import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Blackjack, value } from '../server/blackjack.js';
test('aces downgrade and soft totals stay correct', () => { assert.deepEqual(value(['AS','AH','9S']), {total:21,soft:true}); assert.equal(value(['AS','AH','9S','KS']).total,21); });
test('natural pays 3:2 and dealer natural pushes it', () => {
  const game = new Blackjack([{id:'a',stack:2000,bet:100}], ['AS','9S','KH','8S']);
  assert.equal(game.phase,'complete'); assert.equal(game.players[0].stack,2150);
  const push = new Blackjack([{id:'a',stack:2000,bet:100}], ['AS','AH','KH','TS']); assert.equal(push.players[0].stack,2000);
});
test('dealer stands on soft 17, equal totals push', () => { const g = new Blackjack([{id:'a',stack:1000,bet:100}], ['TS','AH','7S','6S','KC']); g.act('a','stand'); assert.equal(g.dealer.length,2); assert.equal(g.players[0].stack,1000); });
test('double costs another bet and draws exactly once', () => { const g = new Blackjack([{id:'a',stack:1000,bet:100}], ['5S','9H','6S','8H','TS']); g.act('a','double'); assert.equal(g.players[0].stack,1200); assert.equal(g.players[0].hands[0].cards.length,3); });
test('split aces draw once and cannot pay a natural bonus', () => { const g = new Blackjack([{id:'a',stack:1000,bet:100}], ['AS','9H','AH','8H','KS','TC']); g.act('a','split'); assert.equal(g.phase,'complete'); assert.equal(g.players[0].stack,1200); assert.equal(g.players[0].hands.length,2); });
test('wrong player, invalid split, overbet and odd bet are rejected', () => { const g = new Blackjack([{id:'a',stack:1000,bet:100}], ['2S','9H','8S','8H']); assert.throws(()=>g.act('b','hit')); assert.throws(()=>g.act('a','split')); assert.throws(()=>new Blackjack([{id:'a',stack:10,bet:20}])); assert.throws(()=>new Blackjack([{id:'a',stack:100,bet:3}])); });
test('dealer hole card is hidden until settlement', () => { const g = new Blackjack([{id:'a',stack:1000,bet:100}], ['TS','9H','7S','8H']); assert.deepEqual(g.publicView().dealer,['9H',null]); g.act('a','stand'); assert.deepEqual(g.publicView().dealer,['9H','8H']); });
test('multiple players take independent turns and settle individually', () => { const g = new Blackjack([{id:'a',stack:1000,bet:100},{id:'b',stack:1000,bet:100}], ['TS','9S','TH','8S','7S','7H','KS']); g.act('a','stand'); assert.equal(g.activePlayer.id,'b'); g.act('b','hit'); assert.equal(g.phase,'complete'); assert.equal(g.players[0].stack,1100); assert.equal(g.players[1].stack,900); });
