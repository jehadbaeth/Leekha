import { applyLayout, isLayoutLegal, type Card, type TrixSeatView } from '@leekha/trix';

const sameCard = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;

/** In the layout (trix), the engine only lets a seat pass when it has no legal play. */
export function shouldPass(view: TrixSeatView): boolean {
  return !view.legal || view.legal.length === 0;
}

/**
 * Trix layout heuristic: play the card that most "unblocks" the hand.
 * Jacks are weighted highest (they open a suit outright); otherwise prefer a
 * play that immediately makes another held card legal, so we keep the
 * initiative and empty our hand fastest, breaking ties toward suits we are
 * already deep in (so we aren't left stranded needing someone else's help).
 *
 * Partner awareness: Fan-Tan chains only ever grow -- once a suit is opened
 * nothing can be blocked from it -- so there is no direct way to help or
 * hinder a partner's hand from here, and TrixSeatView never reveals their
 * hand anyway. The substantive partner-aware logic lives in the
 * trick-avoidance policy (never dump a penalty on a partner's trick).
 */
export function chooseLayoutPlay(view: TrixSeatView): Card {
  const legal = view.legal;
  if (!legal || legal.length === 0) throw new Error('chooseLayoutPlay called with no legal plays; check shouldPass first');
  if (legal.length === 1) return legal[0];

  const hand = view.hand;
  let best = legal[0];
  let bestScore = -Infinity;
  for (const card of legal) {
    let score = card.rank === 11 ? 5 : 2;
    const after = applyLayout(view.layout, card);
    const unlocked = hand.filter(
      (c) => !sameCard(c, card) && !isLayoutLegal(c, view.layout) && isLayoutLegal(c, after),
    ).length;
    score += unlocked * 3;
    score -= hand.filter((c) => c.suit === card.suit).length * 0.05; // slight nudge to finish suits we're already deep in
    if (score > bestScore) {
      bestScore = score;
      best = card;
    }
  }
  return best;
}
