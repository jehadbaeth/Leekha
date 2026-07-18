import { describe, expect, it } from 'vitest';
import {
  actingSeat,
  chooseContract,
  defaultTrixConfig,
  expose,
  newMatch,
  pass,
  play,
  viewFor,
  type TrixMatchState,
  type TrixRulesConfig,
} from '@leekha/trix';
import { makeTrixBot } from '../src/index.js';

// Deterministic RNG so any failure reproduces from its seed.
function mkRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sameCard = (a: { suit: string; rank: number }, b: { suit: string; rank: number }) =>
  a.suit === b.suit && a.rank === b.rank;

/** Drives a full match using the bot for EVERY seat, asserting every action is legal at the point it's taken. */
function playFullMatchWithBots(config: TrixRulesConfig, seed: string, rng: () => number): TrixMatchState {
  const bot = makeTrixBot(rng);
  let state = newMatch(config, seed);
  let guard = 0;

  while (state.phase !== 'done' && guard < 8000) {
    guard++;
    const seat = actingSeat(state);
    if (seat === null) break;
    const view = viewFor(state, seat);

    if (state.phase === 'selecting') {
      const choice = bot.chooseContract(view);
      expect(choice.length).toBeGreaterThan(0);
      for (const c of choice) expect(view.choosableContracts).toContain(c);
      state = chooseContract(state, seat, choice).state;
      continue;
    }

    if (state.phase === 'exposing') {
      const card = bot.chooseExpose(view);
      if (card === null) {
        state = pass(state, seat).state;
      } else {
        expect(view.exposable.some((c) => sameCard(c, card))).toBe(true);
        state = expose(state, seat, card).state;
      }
      continue;
    }

    if (state.phase === 'trick') {
      const card = bot.choosePlay(view);
      expect(view.legal).not.toBeNull();
      expect(view.legal!.some((c) => sameCard(c, card))).toBe(true);
      state = play(state, seat, card).state;
      continue;
    }

    if (state.phase === 'layout') {
      if (bot.shouldPass(view)) {
        expect(view.legal === null || view.legal.length === 0).toBe(true);
        state = pass(state, seat).state;
      } else {
        const card = bot.choosePlay(view);
        expect(view.legal).not.toBeNull();
        expect(view.legal!.some((c) => sameCard(c, card))).toBe(true);
        state = play(state, seat, card).state;
      }
      continue;
    }

    throw new Error(`unexpected phase: ${state.phase}`);
  }

  expect(guard).toBeLessThan(8000); // no deadlock / infinite loop
  return state;
}

describe('trix-bots — legality over many full matches', () => {
  for (const partnership of [false, true]) {
    for (const complex of [false, true]) {
      it(`bots only ever act legally and every match completes (partnership=${partnership}, complex=${complex})`, () => {
        const config: TrixRulesConfig = { ...defaultTrixConfig, partnership, complex };
        for (let n = 0; n < 25; n++) {
          const state = playFullMatchWithBots(config, `bots-${partnership}-${complex}-${n}`, mkRng(5000 + n));
          expect(state.phase).toBe('done');
          expect(state.result).toBeDefined();
        }
      });
    }
  }
});
