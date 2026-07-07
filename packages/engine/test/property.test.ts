import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  newMatch,
  startRound,
  commitPass,
  legalPlays,
  playCard,
  viewFor,
  defaultConfig,
  MatchState,
  Seat,
} from '../src/index.js';

function turnSeatFromView(m: MatchState): Seat | null {
  for (const s of [0, 1, 2, 3] as Seat[]) {
    if (viewFor(m, s).legal !== null) return s;
  }
  return null;
}

function playRandomRound(seed: string, pick: (n: number) => number): { finalState: MatchState; allPlayed: number } {
  let m = startRound(newMatch(defaultConfig, seed));

  // Everyone passes 3 arbitrary cards (first 3 in hand) — order of commit doesn't matter for legality.
  for (const s of [0, 1, 2, 3] as Seat[]) {
    const hand = m.round.hands[s];
    m = commitPass(m, s, hand.slice(0, 3));
  }

  let allPlayed = 0;
  while (m.phase === 'playing') {
    const seat = turnSeatFromView(m)!;
    const legal = legalPlays(m, seat);
    expect(legal.length).toBeGreaterThan(0);
    const card = legal[pick(legal.length)];
    const { state } = playCard(m, seat, card);
    m = state;
    allPlayed++;
  }
  return { finalState: m, allPlayed };
}

describe('property: random legal play through a full round', () => {
  it('every card is played exactly once, eaten totals sum to 50, moves stay legal', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), fc.nat(9999), (seed, salt) => {
        let counter = salt;
        const pick = (n: number) => {
          counter = (counter * 1103515245 + 12345) & 0x7fffffff;
          return counter % n;
        };
        const { finalState, allPlayed } = playRandomRound(`${seed}-${salt}`, pick);
        expect(allPlayed).toBe(52);
        expect(finalState.phase === 'roundEnd' || finalState.phase === 'gameOver').toBe(true);
        const total = finalState.round.eatenPoints.reduce((a, b) => a + b, 0);
        expect(total).toBe(50);
      }),
      { numRuns: 200 },
    );
  });

  it('viewFor never leaks another seat\'s hand or an uncommitted pass', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 20 }), (seed) => {
        const m = startRound(newMatch(defaultConfig, seed));
        for (const viewer of [0, 1, 2, 3] as Seat[]) {
          const view = viewFor(m, viewer);
          expect(view.hand).toEqual(m.round.hands[viewer]);
          // no other seat's hand appears anywhere in the view
          for (const other of [0, 1, 2, 3] as Seat[]) {
            if (other === viewer) continue;
            const otherHand = m.round.hands[other];
            const serialized = JSON.stringify(view);
            for (const card of otherHand) {
              // a card in another seat's hand may coincidentally match nothing on the (empty) table yet
              expect(serialized).not.toContain(`"suit":"${card.suit}","rank":${card.rank}`);
            }
          }
          expect(view.youPassed).toBeNull();
          expect(view.youReceived).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });
});
