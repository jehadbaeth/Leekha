import { describe, expect, it } from 'vitest';
import { newMatch, startRound, commitPass, playCard, viewFor, defaultConfig, Seat } from '@leekha/engine';
import { makeHeuristicBot } from '../src/index.js';
import { chooseSearchPlay, sampleWorld } from '../src/search.js';

function seededRng(seed: number) {
  let a = seed;
  return () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return a / 0x7fffffff;
  };
}

describe('Tier 2 search bot', () => {
  it('always picks a legal card and completes a full round', () => {
    const rng = seededRng(7);
    const others = ([1, 2, 3] as Seat[]).map((s) => makeHeuristicBot('medium', seededRng(s + 10)));
    let m = startRound(newMatch(defaultConfig, 'search-seed'));

    for (const seat of [0, 1, 2, 3] as Seat[]) {
      const view = viewFor(m, seat);
      const pass = seat === 0 ? view.hand.slice(0, 3) as [any, any, any] : others[seat - 1].choosePass(view);
      m = commitPass(m, seat, pass);
    }
    expect(m.phase).toBe('playing');

    let guard = 0;
    while (m.phase === 'playing' && guard < 100) {
      guard++;
      const seat = ([0, 1, 2, 3] as Seat[]).find((s) => viewFor(m, s).legal !== null)!;
      const view = viewFor(m, seat);
      const card = seat === 0 ? chooseSearchPlay(view, { rng, totalRollouts: 40 }) : others[seat - 1].choosePlay(view);
      expect(view.legal).toContainEqual(card);
      const { state } = playCard(m, seat, card);
      m = state;
    }

    expect(m.phase === 'roundEnd' || m.phase === 'gameOver').toBe(true);
    expect(m.round.eatenPoints.reduce((a, b) => a + b, 0)).toBe(50);
  });

  it('decides the opening lead within the 300ms per-decision budget (SPEC.md 13.3.5)', () => {
    const rng = seededRng(11);
    const m = startRound(newMatch(defaultConfig, 'timing-seed'));
    const bot = makeHeuristicBot('medium', seededRng(2));
    let match = m;
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      match = commitPass(match, seat, bot.choosePass(viewFor(match, seat)));
    }
    const leader = ([0, 1, 2, 3] as Seat[]).find((s) => viewFor(match, s).legal !== null)!;
    const view = viewFor(match, leader);
    const started = performance.now();
    chooseSearchPlay(view, { rng, totalRollouts: 320 });
    expect(performance.now() - started).toBeLessThan(300);
  });

  it('samples worlds that respect known hand sizes and never reuse the acting seat cards', () => {
    const rng = seededRng(3);
    let m = startRound(newMatch(defaultConfig, 'sample-seed'));
    const bot = makeHeuristicBot('medium', seededRng(1));
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      const view = viewFor(m, seat);
      m = commitPass(m, seat, bot.choosePass(view));
    }
    // Play a few tricks so playedCards/currentTrick are non-trivial.
    for (let i = 0; i < 5; i++) {
      const seat = ([0, 1, 2, 3] as Seat[]).find((s) => viewFor(m, s).legal !== null)!;
      const view = viewFor(m, seat);
      const { state } = playCard(m, seat, bot.choosePlay(view));
      m = state;
    }

    const view = viewFor(m, 0);
    const world = sampleWorld(view, rng);
    const expectedSizes = [0, 1, 2, 3].map((seat) => {
      let played = 0;
      for (const trick of view.playedCards) for (const p of trick) if (p.seat === seat) played++;
      for (const p of view.currentTrick.plays) if (p.seat === seat) played++;
      return 13 - played;
    });
    for (const seat of [1, 2, 3]) {
      expect(world[seat].length).toBe(expectedSizes[seat]);
      for (const card of world[seat]) {
        expect(view.hand).not.toContainEqual(card);
      }
    }
  });
});
