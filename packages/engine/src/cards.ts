import type { Card, Suit } from './types.js';

export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) {
      deck.push({ suit, rank: rank as Card['rank'] });
    }
  }
  return deck;
}

export function cardEquals(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

export function removeCard(hand: Card[], card: Card): Card[] {
  const idx = hand.findIndex((c) => cardEquals(c, card));
  if (idx === -1) return hand;
  const next = hand.slice();
  next.splice(idx, 1);
  return next;
}

export function containsCard(hand: Card[], card: Card): boolean {
  return hand.some((c) => cardEquals(c, card));
}
