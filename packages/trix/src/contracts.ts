// Pure per-contract logic: legality, trick resolution, and scoring. No state
// machine here (that is engine.ts) -- just the rules of each contract.
import type { Card, Contract, Layout, Seat, Suit, TrickPlay } from './types.js';

/** Fixed total points each contract distributes across the table in one deal. The five sum to zero. */
export const CONTRACT_TOTAL: Record<Contract, number> = {
  kingOfHearts: -75,
  diamonds: -130,
  queens: -100,
  slaps: -195,
  trix: 500,
};

export const isDiamond = (c: Card): boolean => c.suit === 'D';
export const isQueen = (c: Card): boolean => c.rank === 12;
export const isKingOfHearts = (c: Card): boolean => c.suit === 'H' && c.rank === 13;
const isHeart = (c: Card): boolean => c.suit === 'H';

/** Cards a seat may expose/double for the given active contracts (before the first lead). */
export function exposableCards(hand: Card[], contracts: Contract[]): Card[] {
  const out: Card[] = [];
  if (contracts.includes('kingOfHearts')) out.push(...hand.filter(isKingOfHearts));
  if (contracts.includes('queens')) out.push(...hand.filter(isQueen));
  return out;
}

// --- Trick contracts ---

/**
 * Legal plays for a trick-taking contract. Follow the led suit if you can;
 * otherwise anything. Variant (off by default, see RulesConfig
 * `restrictKingOfHeartsLead`): when a King-of-Hearts contract is active you may
 * not LEAD a heart unless your hand is nothing but hearts. The mainstream game
 * has no such restriction — leading hearts to smoke out the King is a core
 * tactic — so this only applies when the caller opts in.
 */
export function trickLegalPlays(
  hand: Card[],
  trick: TrickPlay[],
  contracts: Contract[],
  restrictKingOfHeartsLead = false,
): Card[] {
  if (trick.length === 0) {
    // Leading.
    if (restrictKingOfHeartsLead && contracts.includes('kingOfHearts')) {
      const nonHearts = hand.filter((c) => !isHeart(c));
      if (nonHearts.length > 0) return nonHearts; // can't lead a heart while holding non-hearts
    }
    return hand.slice();
  }
  const led = trick[0].card.suit;
  const following = hand.filter((c) => c.suit === led);
  return following.length > 0 ? following : hand.slice();
}

/** Winner of a completed trick: highest card of the led suit. */
export function trickWinner(trick: TrickPlay[]): Seat {
  const led = trick[0].card.suit;
  let best = trick[0];
  for (const p of trick) {
    if (p.card.suit === led && p.card.rank > best.card.rank) best = p;
  }
  return best.seat;
}

// --- Trix layout contract (Fan Tan) ---

export function emptyLayout(): Layout {
  return {
    S: { up: null, down: null },
    H: { up: null, down: null },
    D: { up: null, down: null },
    C: { up: null, down: null },
  };
}

/** Whether a single card is legal to lay on the current layout. */
export function isLayoutLegal(card: Card, layout: Layout): boolean {
  if (card.rank === 11) return layout[card.suit].up === null; // a jack opens its suit (only if not already open)
  const s = layout[card.suit];
  if (s.up === null) return false; // suit not opened yet
  if (card.rank === s.up + 1 && s.up < 14) return true; // one above the up-run
  if (s.down !== null && card.rank === s.down - 1 && s.down > 2) return true; // one below the down-run
  return false;
}

export function layoutLegalPlays(hand: Card[], layout: Layout): Card[] {
  return hand.filter((c) => isLayoutLegal(c, layout));
}

/** Returns a NEW layout with the card applied. Assumes the card is legal. */
export function applyLayout(layout: Layout, card: Card): Layout {
  const next: Layout = {
    S: { ...layout.S },
    H: { ...layout.H },
    D: { ...layout.D },
    C: { ...layout.C },
  };
  const s = next[card.suit];
  if (card.rank === 11) {
    s.up = 11;
    s.down = 11;
  } else if (s.up !== null && card.rank === s.up + 1) {
    s.up = card.rank;
  } else {
    s.down = card.rank;
  }
  return next;
}

// --- Scoring ---

/**
 * Scores a completed trick-taking deal. `captured[seat]` are the cards that seat
 * won across the deal; `tricksWon[seat]` is how many tricks it took; `exposed`
 * lists doubled honors and who exposed (held) them.
 *
 * Zero-sum note: each contract's per-seat scores sum to that contract's fixed
 * total (see CONTRACT_TOTAL). Doubling preserves the total (an exposed K heart
 * is capturer −150 / holder +75 = −75; an exposed queen is −50 / +25 = −25).
 *
 * Doubling simplification (v1): the holder's bonus always goes to the holder,
 * even in the rare "holder captures own exposed honor" case, where pagat instead
 * pays the bonus to that trick's leader. This keeps the total exact; the leader
 * nuance is a TODO.
 */
export function scoreTrickDeal(
  contracts: Contract[],
  captured: [Card[], Card[], Card[], Card[]],
  tricksWon: [number, number, number, number],
  exposed: { seat: Seat; card: Card }[],
): [number, number, number, number] {
  const scores: [number, number, number, number] = [0, 0, 0, 0];
  const seatWith = (pred: (c: Card) => boolean): Seat | null => {
    for (const s of [0, 1, 2, 3] as Seat[]) if (captured[s].some(pred)) return s;
    return null;
  };
  const isExposed = (pred: (c: Card) => boolean): { seat: Seat } | undefined =>
    exposed.find((e) => pred(e.card));

  if (contracts.includes('kingOfHearts')) {
    const capturer = seatWith(isKingOfHearts);
    if (capturer !== null) {
      const exp = isExposed(isKingOfHearts);
      if (exp) {
        scores[capturer] += -150;
        scores[exp.seat] += 75;
      } else {
        scores[capturer] += -75;
      }
    }
  }
  if (contracts.includes('diamonds')) {
    for (const s of [0, 1, 2, 3] as Seat[]) scores[s] += -10 * captured[s].filter(isDiamond).length;
  }
  if (contracts.includes('queens')) {
    // Each of the four queens scored individually so a doubled queen can differ.
    for (const suit of ['S', 'H', 'D', 'C'] as Suit[]) {
      const q: Card = { suit, rank: 12 };
      const capturer = seatWith((c) => c.suit === suit && c.rank === 12);
      if (capturer === null) continue;
      const exp = isExposed((c) => c.suit === suit && c.rank === 12);
      if (exp) {
        scores[capturer] += -50;
        scores[exp.seat] += 25;
      } else {
        scores[capturer] += -25;
      }
      void q;
    }
  }
  if (contracts.includes('slaps')) {
    for (const s of [0, 1, 2, 3] as Seat[]) scores[s] += -15 * tricksWon[s];
  }
  return scores;
}

/** Scores the trix layout deal from finish order: +200/+150/+100/+50 to 1st..4th out. */
export function scoreLayoutDeal(finished: Seat[]): [number, number, number, number] {
  const payout = [200, 150, 100, 50];
  const scores: [number, number, number, number] = [0, 0, 0, 0];
  finished.forEach((seat, place) => {
    scores[seat] += payout[place] ?? 0;
  });
  return scores;
}
