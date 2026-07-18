import type { Contract, TrixSeatView } from '@leekha/trix';
import { contractDanger } from './danger.js';

/**
 * Contract-selection heuristic for when this bot owns the kingdom: pick the
 * contract this hand is safest for (slaps when loaded with low cards, trix
 * when loaded with jacks/sequences, and avoid diamonds/queens/kingOfHearts
 * when loaded with the cards they penalize).
 *
 * Combining trick contracts under Complex is optional per spec; v1 always
 * returns a single contract, which is always a valid (singleton) subset of
 * `view.choosableContracts`.
 */
export function chooseContract(view: TrixSeatView): Contract[] {
  const choosable = view.choosableContracts ?? [];
  if (choosable.length === 0) return [];

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
