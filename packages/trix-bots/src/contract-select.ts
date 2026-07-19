import { TRICK_CONTRACTS, type Contract, type TrixSeatView } from '@leekha/trix';
import { contractDanger } from './danger.js';

/**
 * Contract-selection heuristic for when this bot owns the kingdom.
 *
 * Trix Complex: the whole point of the variant is that the four penalty
 * contracts (King of Hearts, Diamonds, Queens, Slaps) are played together as
 * one combined deal, with Trix (the layout race) played on its own. So under
 * Complex the bot combines every remaining trick contract into a single deal,
 * exactly as a human owner would; a bot owner that quietly picked one contract
 * at a time turned every Complex kingdom back into plain Trix.
 *
 * Simple Trix: pick the single contract this hand is safest for (slaps when
 * loaded with low cards, trix when loaded with jacks/sequences, and avoid
 * diamonds/queens/kingOfHearts when loaded with the cards they penalize).
 */
export function chooseContract(view: TrixSeatView): Contract[] {
  const choosable = view.choosableContracts ?? [];
  if (choosable.length === 0) return [];

  if (view.config.complex) {
    const trickRemaining = choosable.filter((c) => TRICK_CONTRACTS.includes(c));
    if (trickRemaining.length > 0) return trickRemaining; // combined penalty deal
    return choosable.includes('trix') ? ['trix'] : [choosable[0]];
  }

  let best = choosable[0];
  let bestDanger = contractDanger(view.hand, best);
  for (const c of choosable.slice(1)) {
    const d = contractDanger(view.hand, c);
    if (d < bestDanger) {
      best = c;
      bestDanger = d;
    }
  }
  return [best];
}
