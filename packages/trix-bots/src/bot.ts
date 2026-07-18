import type { Card, Contract, TrixSeatView } from '@leekha/trix';
import { chooseContract } from './contract-select.js';
import { chooseExpose } from './expose.js';
import { chooseTrickPlay } from './trick.js';
import { chooseLayoutPlay, shouldPass as shouldPassLayout } from './layout.js';

export interface TrixBot {
  chooseContract(view: TrixSeatView): Contract[];
  chooseExpose(view: TrixSeatView): Card | null;
  choosePlay(view: TrixSeatView): Card;
  shouldPass(view: TrixSeatView): boolean;
}

/**
 * Heuristic Trix bot. Consumes only the seat view -- never the full match
 * state -- so it can never see hidden hands (enforced by
 * test/no-cheating.test.ts).
 *
 * `rng` is accepted for interface symmetry with Leekha's bots and so future
 * randomized tie-breaks (an "easy" noisy tier, say) can be added without an
 * API change; v1's heuristics are fully deterministic and don't call it.
 */
export function makeTrixBot(rng: () => number = Math.random): TrixBot {
  void rng;
  return {
    chooseContract,
    chooseExpose,
    choosePlay: (view) => (view.phase === 'layout' ? chooseLayoutPlay(view) : chooseTrickPlay(view)),
    shouldPass: (view) => (view.phase === 'layout' ? shouldPassLayout(view) : false),
  };
}
