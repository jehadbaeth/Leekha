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
} from '@leekha/trix';
import { makeTrixBot } from '../src/index.js';

describe('trix-bots — full bots-only match sanity', () => {
  it('produces a valid result with zero-sum final scores (solo)', () => {
    const bot = makeTrixBot(() => 0.42);
    const config = { ...defaultTrixConfig, partnership: false };
    let state = newMatch(config, 'sanity-seed-solo');
    let guard = 0;
    while (state.phase !== 'done' && guard < 8000) {
      guard++;
      const seat = actingSeat(state);
      if (seat === null) break;
      const view = viewFor(state, seat);
      if (state.phase === 'selecting') {
        state = chooseContract(state, seat, bot.chooseContract(view)).state;
      } else if (state.phase === 'exposing') {
        const card = bot.chooseExpose(view);
        state = card ? expose(state, seat, card).state : pass(state, seat).state;
      } else if (state.phase === 'trick') {
        state = play(state, seat, bot.choosePlay(view)).state;
      } else if (state.phase === 'layout') {
        state = bot.shouldPass(view) ? pass(state, seat).state : play(state, seat, bot.choosePlay(view)).state;
      }
    }

    expect(state.phase).toBe('done');
    expect(state.result).toBeDefined();
    expect(state.result!.scores.reduce((a, b) => a + b, 0)).toBe(0);
    expect(state.result!.winnerSeat).toBeDefined();
  });

  it('produces a valid result with zero-sum team scores (partnership)', () => {
    const bot = makeTrixBot(() => 0.17);
    const config = { ...defaultTrixConfig, partnership: true };
    let state = newMatch(config, 'sanity-seed-partnership');
    let guard = 0;
    while (state.phase !== 'done' && guard < 8000) {
      guard++;
      const seat = actingSeat(state);
      if (seat === null) break;
      const view = viewFor(state, seat);
      if (state.phase === 'selecting') {
        state = chooseContract(state, seat, bot.chooseContract(view)).state;
      } else if (state.phase === 'exposing') {
        const card = bot.chooseExpose(view);
        state = card ? expose(state, seat, card).state : pass(state, seat).state;
      } else if (state.phase === 'trick') {
        state = play(state, seat, bot.choosePlay(view)).state;
      } else if (state.phase === 'layout') {
        state = bot.shouldPass(view) ? pass(state, seat).state : play(state, seat, bot.choosePlay(view)).state;
      }
    }

    expect(state.phase).toBe('done');
    expect(state.result).toBeDefined();
    expect(state.result!.scores.reduce((a, b) => a + b, 0)).toBe(0);
    expect(state.result!.teamScores).toBeDefined();
    const [team0, team1] = state.result!.teamScores!;
    expect(team0 + team1).toBe(0);
    expect(state.result!.winnerTeam).toBeDefined();
  });
});
