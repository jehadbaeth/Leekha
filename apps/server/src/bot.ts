import { makeHeuristicBot } from '@leekha/bots';
import type { BotLevel } from './types.js';

// Tier 2 (search based "hard") ships in Phase 3; until then hard bots fall back to medium.
export function botForLevel(level: BotLevel, rng?: () => number) {
  const effective = level === 'hard' ? 'medium' : level;
  return makeHeuristicBot(effective, rng);
}
