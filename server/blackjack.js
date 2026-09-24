import { randomInt } from 'node:crypto';

export const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
export const suits = ['S', 'H', 'D', 'C'];
export function shoe(decks = 6) {
  const cards = Array.from({ length: decks }, () => suits.flatMap(s => ranks.map(r => r + s))).flat();
  for (let i = cards.length - 1; i > 0; i--) { const j = randomInt(i + 1); [cards[i], cards[j]] = [cards[j], cards[i]]; }
  return cards;
}
export function value(cards) {
  let total = 0, aces = 0;
  for (const c of cards) { const r = c.slice(0, -1); if (r === 'A') { total += 11; aces++; } else total += ['T', 'J', 'Q', 'K'].includes(r) ? 10 : Number(r); }
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}
const natural = h => !h.split && h.cards.length === 2 && value(h.cards).total === 21;

export class Blackjack {
  constructor(participants, cards = shoe()) {
    if (!participants.length || participants.length > 8) throw Error('Blackjack needs 1–8 players.');
    this.deck = [...cards]; this.dealer = []; this.phase = 'playing'; this.playerIndex = 0; this.handIndex = 0;
    this.players = participants.map(p => {
      if (!Number.isSafeInteger(p.bet) || p.bet < 2 || p.bet % 2 || p.bet > p.stack) throw Error('Choose an even bet within your stack.');
      return { id: p.id, startStack: p.stack, stack: p.stack - p.bet, hands: [{ cards: [], bet: p.bet, split: false, status: 'playing' }] };
    });
    for (let round = 0; round < 2; round++) { for (const p of this.players) p.hands[0].cards.push(this.draw()); this.dealer.push(this.draw()); }
    if (value(this.dealer).total === 21) this.settle();
    else { for (const p of this.players) if (natural(p.hands[0])) p.hands[0].status = 'stand'; this.advance(); }
  }
  draw() { if (!this.deck.length) throw Error('The shoe is empty.'); return this.deck.shift(); }
  get activePlayer() { return this.phase === 'playing' ? this.players[this.playerIndex] : null; }
  get activeHand() { return this.activePlayer?.hands[this.handIndex]; }
  legal() {
    const p = this.activePlayer, h = this.activeHand;
    if (!h) return [];
    const actions = ['hit', 'stand'];
    if (h.cards.length === 2 && p.stack >= h.bet && !h.splitAces) actions.push('double');
    if (h.cards.length === 2 && h.cards[0][0] === h.cards[1][0] && p.stack >= h.bet && p.hands.length < 4 && !h.splitAces) actions.push('split');
    return actions;
  }
  act(id, action) {
    const p = this.activePlayer, h = this.activeHand;
    if (!p || p.id !== id) throw Error('Wait for your turn.');
    if (!this.legal().includes(action)) throw Error('That action is not available.');
    if (action === 'stand') h.status = 'stand';
    if (action === 'hit' || action === 'double') {
      if (action === 'double') { p.stack -= h.bet; h.bet *= 2; }
      h.cards.push(this.draw());
      const n = value(h.cards).total;
      if (n > 21) h.status = 'bust'; else if (n === 21 || action === 'double') h.status = 'stand';
    }
    if (action === 'split') {
      p.stack -= h.bet; const card = h.cards.pop(); const aces = card[0] === 'A';
      h.split = true; h.splitAces = aces; h.cards.push(this.draw());
      const next = { cards: [card, this.draw()], bet: h.bet, split: true, splitAces: aces, status: 'playing' };
      if (aces || value(h.cards).total === 21) h.status = 'stand';
      if (aces || value(next.cards).total === 21) next.status = 'stand';
      p.hands.splice(this.handIndex + 1, 0, next);
    }
    this.advance();
  }
  advance() {
    while (this.playerIndex < this.players.length) {
      const p = this.players[this.playerIndex];
      while (this.handIndex < p.hands.length && p.hands[this.handIndex].status !== 'playing') this.handIndex++;
      if (this.handIndex < p.hands.length) return;
      this.playerIndex++; this.handIndex = 0;
    }
    if (this.players.some(p => p.hands.some(h => h.status !== 'bust' && !natural(h)))) {
      while (value(this.dealer).total < 17) this.dealer.push(this.draw());
    }
    this.settle();
  }
  settle() {
    this.phase = 'complete'; const dealer = value(this.dealer).total; const dealerNatural = dealer === 21 && this.dealer.length === 2;
    for (const p of this.players) for (const h of p.hands) {
      const total = value(h.cards).total;
      let multiplier = 0, result = 'loss';
      if (total > 21) result = 'bust';
      else if (natural(h) && dealerNatural) { result = 'push'; multiplier = 1; }
      else if (natural(h)) { result = 'blackjack'; multiplier = 2.5; }
      else if (!dealerNatural && (dealer > 21 || total > dealer)) { result = 'win'; multiplier = 2; }
      else if (!dealerNatural && total === dealer) { result = 'push'; multiplier = 1; }
      h.result = result; h.returned = h.bet * multiplier; h.status = 'complete'; p.stack += h.returned;
    }
  }
  publicView() {
    return { phase: this.phase, dealer: this.phase === 'complete' ? this.dealer : [this.dealer[0], null],
      activeId: this.activePlayer?.id ?? null, activeHand: this.handIndex,
      players: this.players.map(p => ({ id: p.id, stack: p.stack, hands: p.hands.map(h => ({ cards: h.cards, bet: h.bet, total: value(h.cards).total, result: h.result, status: h.status })) })) };
  }
}
