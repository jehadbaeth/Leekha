import { makeHeuristicBot, chooseSearchPlay, type Bot } from '@leekha/bots';
import type { BotLevel } from './types.js';

// Tier 2 (SPEC.md Section 13.3) samples plausible worlds and rolls each out with
// the Tier 1 policy; it only covers the play phase, so "hard" reuses the medium
// heuristic for passing.
const SEARCH_ROLLOUT_BUDGET = 320;

export function botForLevel(level: BotLevel, rng: () => number = Math.random): Bot {
  if (level === 'hard') {
    const passFallback = makeHeuristicBot('medium', rng);
    return {
      choosePass: (view) => passFallback.choosePass(view),
      choosePlay: (view) => chooseSearchPlay(view, { rng, totalRollouts: SEARCH_ROLLOUT_BUDGET }),
    };
  }
  return makeHeuristicBot(level, rng);
}
