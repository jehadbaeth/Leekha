import { describe, expect, it } from 'vitest';
import {
  newMatch,
  startRound,
  commitPass,
  playCard,
  viewFor,
  defaultConfig,
  Seat,
} from '@leekha/engine';
import { makeHeuristicBot } from '../src/index.js';

function seededRng(seed: number) {
  let a = seed;
  return () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return a / 0x7fffffff;
  };
}

describe('heuristic bot plays a full legal round', () => {
  it('completes 13 tricks with only legal moves and 50 points eaten', () => {
    const bots = ([0, 1, 2, 3] as Seat[]).map((s) => makeHeuristicBot(s % 2 === 0 ? 'easy' : 'medium', seededRng(s + 1)));
    let m = startRound(newMatch(defaultConfig, 'bots-seed'));

    for (const seat of [0, 1, 2, 3] as Seat[]) {
      const view = viewFor(m, seat);
      const pass = bots[seat].choosePass(view);
      m = commitPass(m, seat, pass);
    }
    expect(m.phase).toBe('playing');

    let guard = 0;
    while (m.phase === 'playing' && guard < 100) {
      guard++;
      const seat = ([0, 1, 2, 3] as Seat[]).find((s) => viewFor(m, s).legal !== null)!;
      const view = viewFor(m, seat);
      const card = bots[seat].choosePlay(view);
      expect(view.legal).toContainEqual(card);
      const { state } = playCard(m, seat, card);
      m = state;
    }

    expect(m.phase === 'roundEnd' || m.phase === 'gameOver').toBe(true);
    expect(m.round.eatenPoints.reduce((a, b) => a + b, 0)).toBe(50);
  });
});
