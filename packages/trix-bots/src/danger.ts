// Hand-evaluation heuristics shared by contract selection and trick play: how
// dangerous each contract's penalty is for a given hand, and how favorable a
// hand is for the trix layout race. Pure functions of Card[] only -- no
// engine/match state, so these are safe to reuse from any phase.
import { isDiamond, isQueen, type Card, type Contract, type Suit } from '@leekha/trix';

const isHeart = (c: Card): boolean => c.suit === 'H';

/** Higher hearts are more dangerous under King of Hearts: they risk winning a heart trick that contains K of hearts. */
export function heartsDanger(hand: Card[]): number {
  return hand.filter(isHeart).reduce((sum, c) => sum + Math.max(0, c.rank - 9), 0);
}

/** More, and higher, diamonds are more likely to be captured while following suit. */
export function diamondsDanger(hand: Card[]): number {
  return hand.filter(isDiamond).reduce((sum, c) => sum + (c.rank >= 10 ? c.rank - 9 : 0.3), 0);
}

/** Aces/kings threaten to capture the queen led in their own suit; holding queens adds a little risk too. */
export function queensDanger(hand: Card[]): number {
  const highCards = hand.filter((c) => c.rank === 13 || c.rank === 14).length;
  const queensHeld = hand.filter(isQueen).length;
  return highCards * 2 + queensHeld;
}

/** More low cards / fewer top cards means fewer tricks won, which is what slaps penalizes. */
export function slapsDanger(hand: Card[]): number {
  const highCards = hand.filter((c) => c.rank >= 12).length;
  const lowCards = hand.filter((c) => c.rank <= 7).length;
  return highCards * 2 - lowCards * 0.5;
}

/** How good a hand is for the trix race: jacks held (each opens a suit), plus runs already connected to them. */
export function trixFavorability(hand: Card[]): number {
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  let score = 0;
  for (const suit of suits) {
    const ranks: number[] = hand.filter((c) => c.suit === suit).map((c) => c.rank);
    const has = (r: number) => ranks.includes(r);
    if (!has(11)) {
      score -= ranks.length * 0.1; // cards with no jack to build from are stuck until someone else opens the suit
      continue;
    }
    score += 3;
    let up = 11;
    while (has(up + 1)) {
      score += 1;
      up++;
    }
    let down = 11;
    while (has(down - 1)) {
      score += 1;
      down--;
    }
  }
  return score;
}

/** Lower is safer for a trick-avoidance contract; used to rank choosable contracts against each other. */
export function contractDanger(hand: Card[], contract: Contract): number {
  switch (contract) {
    case 'kingOfHearts':
      return heartsDanger(hand);
    case 'diamonds':
      return diamondsDanger(hand);
    case 'queens':
      return queensDanger(hand);
    case 'slaps':
      return slapsDanger(hand);
    case 'trix':
      return -trixFavorability(hand); // negative danger = favorable
  }
}
