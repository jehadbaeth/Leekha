import { describe, expect, it } from 'vitest';
import { computeMatchResult, newMatch, startRound, defaultConfig, cardPoints, makeDeck, selectNextDealer, Card } from '../src/index.js';
import { c, cfg } from './helpers.js';

describe('bust and match end', () => {
  it('no one busts below target', () => {
    const r = computeMatchResult([50, 60, 70, 20], 201);
    expect(r.over).toBe(false);
  });

  it('busts at exactly 201', () => {
    const r = computeMatchResult([201, 0, 0, 0], 201);
    expect(r.over).toBe(true);
    expect(r.losingTeam).toBe(0);
    expect(r.bustSeat).toBe(0);
  });

  it('single team bust: the team of the busted player loses', () => {
    const r = computeMatchResult([210, 50, 60, 40], 201); // seat 0, team 0
    expect(r.over).toBe(true);
    expect(r.losingTeam).toBe(0);
    expect(r.bustSeat).toBe(0);
  });

  it('both teams cross target: higher individual score loses', () => {
    // seat0 (team0)=205, seat1 (team1)=210 -> team1 loses
    const r = computeMatchResult([205, 210, 20, 20], 201);
    expect(r.over).toBe(true);
    expect(r.losingTeam).toBe(1);
    expect(r.bustSeat).toBe(1);
  });

  it('equal cross-team busts fall through to team totals', () => {
    // seat0=205 (team0), seat1=205 (team1); team0 total = 205+30=235, team1 total = 205+10=215
    const r = computeMatchResult([205, 205, 30, 10], 201);
    expect(r.over).toBe(true);
    expect(r.losingTeam).toBe(0);
  });

  it('equal cross-team busts and equal team totals trigger sudden death (not over)', () => {
    const r = computeMatchResult([205, 205, 15, 15], 201);
    expect(r.over).toBe(false);
  });

  it('same team double bust: that team loses, bustSeat is the higher of the two', () => {
    const r = computeMatchResult([210, 50, 220, 40], 201); // seats 0 & 2 both team 0
    expect(r.over).toBe(true);
    expect(r.losingTeam).toBe(0);
    expect(r.bustSeat).toBe(2);
  });
});

describe('round total invariant', () => {
  it('exactly 50 points exist per round', () => {
    const total = makeDeck().reduce((sum, card) => sum + cardPoints(card), 0);
    expect(total).toBe(50);
  });
});

describe('dealer selection', () => {
  it('round 1 belongs to whoever is dealt the 7 of hearts, and the dealer leads trick 1', () => {
    for (const seed of ['seed-a', 'seed-b', 'seed-c']) {
      const m = startRound(newMatch(defaultConfig, seed));
      const sevenHolder = m.round.hands.findIndex((h) => h.some((card) => card.suit === 'H' && card.rank === 7));
      expect(m.dealer).toBe(sevenHolder);
      expect(m.round.currentTrick.leader).toBe(m.dealer);
    }
  });

  it('starting a round enters passing phase with 13 cards each', () => {
    const m = startRound(newMatch(cfg(), 'seed-x'));
    expect(m.phase).toBe('passing');
    for (const hand of m.round.hands) expect(hand.length).toBe(13);
  });

  it('the biggest eater deals next', () => {
    const dealer = selectNextDealer([10, 30, 5, 5], [[], [], [], []], 0);
    expect(dealer).toBe(1);
  });

  it('the K♣ eater breaks a points tie', () => {
    const eatenCards: Card[][] = [[c('C', 13)], [c('H', 5)], [], []];
    const dealer = selectNextDealer([20, 20, 5, 5], eatenCards, 2);
    expect(dealer).toBe(0);
  });

  it('cascades to the Q♠ eater when the K♣ eater is not among the tied', () => {
    const eatenCards: Card[][] = [[c('S', 12)], [c('D', 10)], [c('C', 13)], []];
    // seats 0 and 1 tied on points; seat 2 (K♣ eater) is not tied, so cascade to Q♠ eater = seat 0
    const dealer = selectNextDealer([20, 20, 5, 5], eatenCards, 3);
    expect(dealer).toBe(0);
  });

  it('cascades further to the 10♦ eater and finally to proximity to the previous dealer', () => {
    const eatenCards: Card[][] = [[c('H', 5)], [c('D', 10)], [c('H', 6)], []];
    const dealer = selectNextDealer([20, 20, 5, 5], eatenCards, 3);
    expect(dealer).toBe(1); // seat 1 ate the 10♦
  });
});
