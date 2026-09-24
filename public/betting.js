// Poker amounts are totals for this betting round, including posted blinds.
export function bettingOptions(room, kind) {
  const me = room?.me;
  if (!me?.seated || me.pending || room.paused) return null;
  if (kind === 'blackjack') {
    if (room.game !== 'blackjack' || !['lobby', 'complete'].includes(room.phase)) return null;
    const max = Math.floor(me.stack / 2) * 2;
    if (max < 2) return null;
    return { kind, action: 'bet', min: 2, max, step: 2, committed: 0, stack: me.stack,
      initial: Math.max(2, Math.min(max, me.bet)),
      key: [room.code, room.game, room.phase, room.handNumber, me.stack, me.bet].join(':') };
  }
  const action = me.legal.actions.find(a => a === 'raise' || a === 'bet');
  const range = me.legal.chipRange;
  if (room.game !== 'poker' || room.phase !== 'playing' || room.activeId !== me.id || !action || !range) return null;
  const committed = room.players.find(p => p.id === me.id)?.bet || 0;
  return { kind, action, min: range.min, max: range.max, step: 1, committed, stack: me.stack, initial: range.min,
    key: [room.code, room.handNumber, room.stage, room.activeId, action, committed, me.stack, range.min, range.max].join(':') };
}

export function bettingAmounts(options, raw) {
  const amount = Number(raw);
  const valid = /^\d+$/.test(String(raw)) && Number.isSafeInteger(amount) && amount >= options.min && amount <= options.max && amount % options.step === 0;
  return { amount, valid, added: valid ? amount - options.committed : null,
    remaining: valid ? options.stack - (amount - options.committed) : null };
}

export function bettingPresets(options) {
  const values = options.kind === 'blackjack' ? [20, 50, 100, options.max] : [options.min, options.min * 2, options.min * 5, options.max];
  return [...new Set(values.map(v => Math.max(options.min, Math.min(options.max, v))))]
    .map(amount => ({ amount, label: amount === options.max ? 'All in' : options.kind === 'poker' && amount === options.min ? 'Min' : amount.toLocaleString('en-US') }));
}
