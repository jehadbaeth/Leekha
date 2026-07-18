import { isKingOfHearts, isQueen, type Card, type TrixSeatView } from '@leekha/trix';

/** Guarded means: we don't also hold the ace of hearts (which would eventually force us to capture our own K of hearts), and we hold enough hearts to duck with. */
function isGuardedKingOfHearts(hand: Card[]): boolean {
  const hasAce = hand.some((c) => c.suit === 'H' && c.rank === 14);
  const heartsHeld = hand.filter((c) => c.suit === 'H').length;
  return !hasAce && heartsHeld >= 2;
}

/** Guarded means: we don't also hold the ace/king of that suit (which would eventually force us to capture our own queen), and we hold enough of the suit to duck with. */
function isGuardedQueen(hand: Card[], suit: Card['suit']): boolean {
  const hasTopper = hand.some((c) => c.suit === suit && (c.rank === 13 || c.rank === 14));
  const suitHeld = hand.filter((c) => c.suit === suit).length;
  return !hasTopper && suitHeld >= 2;
}

/**
 * Conservative doubling (SPEC 4.3): usually decline. Only expose a guarded
 * honor -- one we are unlikely to be forced to capture ourselves later.
 */
export function chooseExpose(view: TrixSeatView): Card | null {
  for (const card of view.exposable) {
    if (isKingOfHearts(card) && isGuardedKingOfHearts(view.hand)) return card;
    if (isQueen(card) && isGuardedQueen(view.hand, card.suit)) return card;
  }
  return null;
}
