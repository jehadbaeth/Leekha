import { Card, MatchState, RulesConfig, Seat, defaultConfig, newMatch, startRound } from '../src/index.js';

export function cfg(overrides: Partial<RulesConfig> = {}): RulesConfig {
  return { ...defaultConfig, ...overrides };
}

export function c(suit: Card['suit'], rank: Card['rank']): Card {
  return { suit, rank };
}

/** Build a match already in the 'playing' phase with the given hands, bypassing dealing/passing. */
export function matchWithHands(hands: [Card[], Card[], Card[], Card[]], config: RulesConfig = cfg(), dealer: Seat = 3): MatchState {
  let m = newMatch(config, 'test-seed');
  m = { ...m, dealer };
  m = startRound(m);
  return {
    ...m,
    phase: 'playing',
    round: {
      ...m.round,
      hands: hands.map((h) => h.slice()),
      passesApplied: true,
      currentTrick: { leader: ((dealer + 1) % 4) as Seat, plays: [] },
    },
  };
}
