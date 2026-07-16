import { describe, expect, it } from 'vitest';
import { Card, Seat, SeatView, defaultConfig, isLeekha } from '@leekha/engine';
import { choosePlay } from '../src/heuristic.js';
import { buildTracker } from '../src/tracker.js';

/**
 * Named scenario tests, one per observed real-game blunder (see the bot
 * improvement plan). Each hand-builds a SeatView so the exact situation is
 * pinned forever, rather than hoping a random full-round test wanders into
 * it. All use noise 0 so the rule cascade is deterministic.
 */

const c = (suit: Card['suit'], rank: number): Card => ({ suit, rank });
const opts = { noise: 0, rng: () => 0.5 };

function view(overrides: Partial<SeatView> & { seat: Seat; hand: Card[] }): SeatView {
  return {
    phase: 'playing',
    dealer: 0,
    roundIndex: 0,
    trickNumber: 1,
    currentTrick: { leader: overrides.seat, plays: [] },
    playedCards: [],
    eatenPoints: [0, 0, 0, 0],
    eatenCards: [[], [], [], []],
    scores: [0, 0, 0, 0],
    youPassed: null,
    youReceived: null,
    legal: overrides.hand,
    config: defaultConfig,
    ...overrides,
  };
}

describe('lead scenarios from real-game blunders', () => {
  it('does not chase a suit whose own Leekha it still holds', () => {
    // Passed A♣ away but kept K♣: leading low clubs to flush the ace burns
    // this hand's own club cover and leaves K♣ the boss club it will
    // eventually eat itself.
    const v = view({
      seat: 0,
      trickNumber: 2,
      // Trick 1: all followed spades (no voids inferred), Q♠ seen so the
      // spade hunt is off, and seat 0 won so it leads now.
      playedCards: [
        [
          { seat: 1, card: c('S', 2), forced: false },
          { seat: 2, card: c('S', 5), forced: false },
          { seat: 3, card: c('S', 12), forced: false },
          { seat: 0, card: c('S', 13), forced: false },
        ],
      ],
      currentTrick: { leader: 0, plays: [] },
      eatenPoints: [13, 0, 0, 0],
      eatenCards: [[c('S', 12)], [], [], []],
      hand: [
        c('C', 13), c('C', 3), c('C', 4), c('C', 6),
        c('D', 2), c('D', 7), c('D', 11),
        c('H', 3), c('H', 8), c('H', 14),
        c('S', 7), c('S', 10),
      ],
      youPassed: [c('C', 14), c('H', 12), c('D', 5)],
    });
    v.legal = v.hand;
    const card = choosePlay(v, opts);
    expect(card.suit).not.toBe('C');
  });

  it('never leads a Leekha when a non-Leekha lead is legal (chase flusher path)', () => {
    // Passed A♠ away, kept Q♠/K♠: the "flush the passed honor" logic must
    // not pick Q♠ itself as the low flushing card.
    const v = view({
      seat: 0,
      trickNumber: 2,
      playedCards: [
        [
          { seat: 1, card: c('H', 10), forced: false },
          { seat: 2, card: c('H', 12), forced: false },
          { seat: 3, card: c('H', 13), forced: false },
          { seat: 0, card: c('H', 14), forced: false },
        ],
      ],
      currentTrick: { leader: 0, plays: [] },
      eatenPoints: [4, 0, 0, 0],
      hand: [
        c('S', 12), c('S', 13),
        c('H', 3), c('H', 4), c('H', 6), c('H', 9), c('H', 11),
        c('D', 2), c('D', 5), c('D', 6), c('D', 7), c('D', 8),
      ],
      youPassed: [c('S', 14), c('C', 2), c('C', 3)],
    });
    v.legal = v.hand;
    const card = choosePlay(v, opts);
    expect(isLeekha(card)).toBe(false);
  });

  it('never leads a Leekha when a non-Leekha lead is legal (fallback path)', () => {
    // Every suit held contains one of this hand's own Leekha cards, so the
    // old lowest-rank-overall fallback picked 10♦ (rank 10 sorts lowest).
    const v = view({
      seat: 0,
      hand: [c('D', 10), c('D', 11), c('S', 12), c('C', 13), c('C', 14)],
    });
    const card = choosePlay(v, opts);
    expect(isLeekha(card)).toBe(false);
  });

  it('does not chase 1-point heart honors it passed away', () => {
    // Passed A♥: flushing it out is worth 1 point at best and wastes the
    // lead. The chase must be reserved for Leekha threats (K♣/Q♠ suits).
    const v = view({
      seat: 0,
      hand: [
        c('H', 2), c('H', 5), c('H', 9), c('H', 10), c('H', 11),
        c('D', 3), c('D', 4), c('D', 6), c('D', 8), c('D', 11), c('D', 12), c('D', 13), c('D', 14),
      ],
      youPassed: [c('H', 14), c('C', 2), c('S', 2)],
    });
    const card = choosePlay(v, opts);
    expect(card.suit).not.toBe('H');
  });
});

describe('follow scenarios from real-game blunders', () => {
  it('burns a liability winner as last actor on a pointless trick', () => {
    // Last to play on a 0-point spade trick while Q♠ is still out: winning
    // with A♠ here is free and unloads a card that would otherwise be
    // forced to eat the queen later. Always ducking (the old behavior)
    // keeps the liability and wastes the safe exit.
    const v = view({
      seat: 0,
      trickNumber: 1,
      currentTrick: {
        leader: 1,
        plays: [
          { seat: 1, card: c('S', 4), forced: false },
          { seat: 2, card: c('S', 7), forced: false },
          { seat: 3, card: c('S', 9), forced: false },
        ],
      },
      hand: [
        c('S', 2), c('S', 14),
        c('H', 3), c('H', 6),
        c('D', 4), c('D', 8), c('D', 11),
        c('C', 2), c('C', 5), c('C', 9),
      ],
      legal: [c('S', 2), c('S', 14)],
    });
    const card = choosePlay(v, opts);
    expect(card).toEqual(c('S', 14));
  });
});

describe('endgame counting', () => {
  it('cashes a stranded certain winner in the last tricks instead of hunting', () => {
    // Trick 12, holding a BARE A♦ with 10♦ already gone: nothing left can
    // beat it, nothing bad can land on it, and with no low diamond beside it
    // there is no ducking out of it later anyway. The old code led 8♣ here
    // to keep hunting K♣.
    const v = view({
      seat: 0,
      trickNumber: 12,
      playedCards: [
        [
          { seat: 3, card: c('D', 13), forced: false },
          { seat: 0, card: c('D', 4), forced: false },
          { seat: 1, card: c('D', 10), forced: true },
          { seat: 2, card: c('D', 6), forced: false },
        ],
      ],
      currentTrick: { leader: 0, plays: [] },
      hand: [c('D', 14), c('C', 8), c('C', 4), c('H', 11)],
    });
    v.legal = v.hand;
    const card = choosePlay(v, opts);
    expect(card).toEqual(c('D', 14));
  });

  it('does not cash a certain winner that still has duck cover', () => {
    // Same certain A♦, but 3♦ sits beside it: keeping the pair preserves the
    // option to duck a diamond trick later, which is worth more than the
    // free trick (winning it would force this hand to lead again).
    const v = view({
      seat: 0,
      trickNumber: 12,
      playedCards: [
        [
          { seat: 3, card: c('D', 13), forced: false },
          { seat: 0, card: c('D', 4), forced: false },
          { seat: 1, card: c('D', 10), forced: true },
          { seat: 2, card: c('D', 6), forced: false },
        ],
      ],
      currentTrick: { leader: 0, plays: [] },
      hand: [c('D', 14), c('D', 3), c('C', 8), c('H', 11)],
    });
    v.legal = v.hand;
    const card = choosePlay(v, opts);
    expect(card).not.toEqual(c('D', 14));
  });

  it('does not cash a certain winner whose suit Leekha is still out', () => {
    // Bare A♦ but 10♦ has NOT been played: cashing it would catch the
    // forced 10♦ from whoever holds it. The bot must not take that trick.
    const v = view({
      seat: 0,
      trickNumber: 12,
      currentTrick: { leader: 0, plays: [] },
      hand: [c('D', 14), c('C', 8), c('C', 4), c('H', 11)],
    });
    const card = choosePlay(v, opts);
    expect(card).not.toEqual(c('D', 14));
  });
});

describe('tracker undercut proofs', () => {
  it('records a ceiling for a follower who played over a live Leekha', () => {
    // s1 put K♣ on the trick (undercut ceiling 13 under the default
    // leekhaRank rule); s2 then followed clubs with the A♣ voluntarily,
    // proving s2 held no club below 13 at that moment.
    const v = view({
      seat: 0,
      trickNumber: 2,
      playedCards: [
        [
          { seat: 0, card: c('C', 5), forced: false },
          { seat: 1, card: c('C', 13), forced: false },
          { seat: 2, card: c('C', 14), forced: false },
          { seat: 3, card: c('C', 2), forced: false },
        ],
      ],
      currentTrick: { leader: 2, plays: [] },
      hand: [
        c('S', 3), c('S', 6), c('S', 9),
        c('H', 2), c('H', 7), c('H', 10),
        c('D', 2), c('D', 5), c('D', 8), c('D', 11),
        c('C', 3), c('C', 7),
      ],
    });
    const tracker = buildTracker(v);
    expect(tracker.ceilings.get(2)?.get('C')).toBe(13);
    // s3 ducked under the ceiling: no proof about s3.
    expect(tracker.ceilings.get(3)?.get('C')).toBeUndefined();
  });

  it('records proven-not-held Leekhas for a forced dump over the ceiling', () => {
    // K♣ live on the trick (ceiling 13); s3, void of clubs, was forced to
    // dump a Leekha and surrendered... K♣ is on the trick so the only dump
    // ABOVE a 13 ceiling is impossible among Leekhas except equal rank --
    // use Q♠ ceiling instead: s1 played Q♠ (ceiling 12), s3 force-dumped
    // K♣ (14 >= 12), proving s3 holds no 10♦ (rank 10 < 12) now.
    const v = view({
      seat: 0,
      trickNumber: 2,
      playedCards: [
        [
          { seat: 0, card: c('S', 5), forced: false },
          { seat: 1, card: c('S', 12), forced: false },
          { seat: 2, card: c('S', 13), forced: false },
          { seat: 3, card: c('C', 13), forced: true },
        ],
      ],
      currentTrick: { leader: 2, plays: [] },
      hand: [
        c('S', 3), c('S', 6), c('S', 9),
        c('H', 2), c('H', 7), c('H', 10),
        c('D', 2), c('D', 5), c('D', 8), c('D', 11),
        c('C', 3), c('C', 7),
      ],
    });
    const tracker = buildTracker(v);
    expect(tracker.provenNotHeld.get(3)?.has('D10')).toBe(true);
  });
});
