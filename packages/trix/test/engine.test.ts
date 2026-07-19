import { describe, it, expect } from 'vitest';
import {
  newMatch,
  viewFor,
  actingSeat,
  chooseContract,
  play,
  pass,
  expose,
  CONTRACT_TOTAL,
  scoreTrickDeal,
  scoreLayoutDeal,
  isLayoutLegal,
  emptyLayout,
  applyLayout,
  defaultTrixConfig,
  type TrixMatchState,
  type TrixRulesConfig,
  type Contract,
  type Seat,
  type Card,
} from '../src/index.js';

// Deterministic RNG for the simulator's own random choices, so failures reproduce.
function mkRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(arr: T[], rng: () => number): T => arr[Math.floor(rng() * arr.length)];

interface DealCheck {
  contracts: Contract[];
  sum: number;
  expected: number;
}

/** Plays one full match with random-but-legal choices. Returns the final state and per-deal score checks. */
function playRandomMatch(config: TrixRulesConfig, seed: string, rng: () => number): { state: TrixMatchState; checks: DealCheck[] } {
  let state = newMatch(config, seed);
  const checks: DealCheck[] = [];
  let currentContracts: Contract[] = [];
  let guard = 0;

  while (state.phase !== 'done' && guard < 5000) {
    guard++;
    const seat = actingSeat(state);
    if (seat === null) break;
    const view = viewFor(state, seat);

    if (state.phase === 'selecting') {
      const choosable = view.choosableContracts!;
      // Occasionally combine trick contracts when Complex is on.
      let choice: Contract[];
      const trickOnes = choosable.filter((c) => c !== 'trix');
      if (config.complex && trickOnes.length >= 2 && rng() < 0.3) {
        choice = trickOnes.slice(0, 2);
      } else {
        choice = [pick(choosable, rng)];
      }
      currentContracts = choice;
      state = chooseContract(state, seat, choice).state;
      continue;
    }
    if (state.phase === 'exposing') {
      if (view.exposable.length > 0 && rng() < 0.5) {
        state = expose(state, seat, pick(view.exposable, rng)).state;
      } else {
        state = pass(state, seat).state;
      }
      continue;
    }
    if (state.phase === 'trick') {
      const legal = view.legal!;
      const r = play(state, seat, pick(legal, rng));
      state = r.state;
      recordDealEnd(r.events, currentContracts, checks);
      continue;
    }
    if (state.phase === 'layout') {
      const legal = view.legal ?? [];
      const r = legal.length > 0 ? play(state, seat, pick(legal, rng)) : pass(state, seat);
      state = r.state;
      recordDealEnd(r.events, currentContracts, checks);
      continue;
    }
  }
  expect(guard).toBeLessThan(5000); // no infinite loop / deadlock
  return { state, checks };
}

function recordDealEnd(events: { type: string; dealScores?: number[] }[], contracts: Contract[], checks: DealCheck[]) {
  for (const e of events) {
    if (e.type === 'dealEnd' && e.dealScores) {
      checks.push({
        contracts,
        sum: e.dealScores.reduce((a, b) => a + b, 0),
        expected: contracts.reduce((a, c) => a + CONTRACT_TOTAL[c], 0),
      });
    }
  }
}

describe('trix engine — full match invariants', () => {
  for (const partnership of [false, true]) {
    for (const complex of [false, true]) {
      it(`completes and stays contract-total exact (partnership=${partnership}, complex=${complex})`, () => {
        const config: TrixRulesConfig = { ...defaultTrixConfig, partnership, complex };
        for (let n = 0; n < 60; n++) {
          const { state, checks } = playRandomMatch(config, `m${partnership}${complex}${n}`, mkRng(1000 + n));
          expect(state.phase).toBe('done');
          expect(state.result).toBeDefined();
          // Every deal distributes exactly its contracts' fixed total.
          for (const c of checks) expect(c.sum).toBe(c.expected);
          // A finished match nets to zero across seats (five contracts sum to zero, x4 kingdoms).
          expect(state.scores.reduce((a, b) => a + b, 0)).toBe(0);
          // 20 deals in simple, fewer in complex (combined deals).
          expect(checks.length).toBeGreaterThanOrEqual(complex ? 12 : 20);
        }
      });
    }
  }
});

describe('trix engine — per-contract scoring', () => {
  const cap = (cards: Card[]): [Card[], Card[], Card[], Card[]] => [cards, [], [], []];
  it('king of hearts: capturer -75', () => {
    const s = scoreTrickDeal(['kingOfHearts'], cap([{ suit: 'H', rank: 13 }]), [1, 0, 0, 0], []);
    expect(s).toEqual([-75, 0, 0, 0]);
  });
  it('exposed king of hearts: capturer -150, holder +75 (nets -75)', () => {
    const s = scoreTrickDeal(['kingOfHearts'], cap([{ suit: 'H', rank: 13 }]), [1, 0, 0, 0], [{ seat: 2, card: { suit: 'H', rank: 13 } }]);
    expect(s[0]).toBe(-150);
    expect(s[2]).toBe(75);
    expect(s.reduce((a, b) => a + b, 0)).toBe(-75);
  });
  it('diamonds: -10 each, total -130 across the deck', () => {
    const all = ([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const).map((r) => ({ suit: 'D' as const, rank: r }));
    const s = scoreTrickDeal(['diamonds'], cap(all), [13, 0, 0, 0], []);
    expect(s[0]).toBe(-130);
  });
  it('queens: -25 each', () => {
    const s = scoreTrickDeal(['queens'], cap([{ suit: 'S', rank: 12 }, { suit: 'H', rank: 12 }]), [2, 0, 0, 0], []);
    expect(s[0]).toBe(-50);
  });
  it('slaps: -15 per trick, total -195', () => {
    const s = scoreTrickDeal(['slaps'], [[], [], [], []], [13, 0, 0, 0], []);
    expect(s[0]).toBe(-195);
  });
  it('trix layout: +200/+150/+100/+50 by finish order, total +500', () => {
    const s = scoreLayoutDeal([2, 0, 3, 1]);
    expect(s[2]).toBe(200);
    expect(s[0]).toBe(150);
    expect(s[3]).toBe(100);
    expect(s[1]).toBe(50);
    expect(s.reduce((a, b) => a + b, 0)).toBe(500);
  });
});

describe('trix engine — layout legality', () => {
  it('only jacks open a suit; then ±1 extensions are legal', () => {
    let layout = emptyLayout();
    expect(isLayoutLegal({ suit: 'S', rank: 10 }, layout)).toBe(false); // suit not open
    expect(isLayoutLegal({ suit: 'S', rank: 11 }, layout)).toBe(true); // jack opens
    layout = applyLayout(layout, { suit: 'S', rank: 11 });
    expect(isLayoutLegal({ suit: 'S', rank: 12 }, layout)).toBe(true); // Q above J
    expect(isLayoutLegal({ suit: 'S', rank: 10 }, layout)).toBe(true); // 10 below J
    expect(isLayoutLegal({ suit: 'S', rank: 13 }, layout)).toBe(false); // K needs Q first
    expect(isLayoutLegal({ suit: 'S', rank: 11 }, layout)).toBe(false); // jack already down
  });
});

describe('trix engine — doubling window reaches every honor holder', () => {
  const isQueen = (c: Card): boolean => c.rank === 12;

  // Regression for the reported "doubling phase won't let me double queens I
  // hold" bug. The real defect was upstream (a bot owner never combined, so
  // queens were never an active contract), but the exposing turn logic must
  // still be proven never to skip a NON-owner who holds the only honors. Drive
  // a combined all-four penalty deal with an all-pass policy and assert that
  // every seat holding an exposable honor gets an exposing turn with that honor
  // offered — including seats downstream of the kingdom owner.
  it('a non-owner holding queens is offered them before the window closes', () => {
    const config: TrixRulesConfig = { ...defaultTrixConfig, complex: true };
    let sawNonOwnerQueenOffered = false;

    for (let n = 0; n < 200; n++) {
      let state = newMatch(config, `expose-${n}`);
      const owner = state.kingdomOwner;
      state = chooseContract(state, owner, ['kingOfHearts', 'diamonds', 'queens', 'slaps']).state;
      if (state.phase !== 'exposing') continue; // nobody held an honor this deal

      // Which seats hold a queen at the start of the deal (from each own view).
      const queenHolders = ([0, 1, 2, 3] as Seat[]).filter((s) => viewFor(state, s).hand.some(isQueen));
      const offeredQueen = new Set<Seat>();

      let guard = 0;
      while (state.phase === 'exposing' && guard < 20) {
        guard++;
        const seat = actingSeat(state)!;
        const v = viewFor(state, seat);
        expect(v.turn).toBe(seat); // the acting seat always sees it as its own turn
        if (v.exposable.some(isQueen)) offeredQueen.add(seat);
        state = pass(state, seat).state; // everyone declines
      }
      expect(state.phase).toBe('trick'); // window closed cleanly

      // Every queen holder must have been offered their queen before the close.
      for (const s of queenHolders) expect(offeredQueen.has(s)).toBe(true);
      if (queenHolders.some((s) => s !== owner && offeredQueen.has(s))) sawNonOwnerQueenOffered = true;
    }

    // The non-owner path (turn must rotate past the owner) is actually exercised.
    expect(sawNonOwnerQueenOffered).toBe(true);
  });
});

describe('trix engine — no cheating', () => {
  it('viewFor only returns the requested seat\'s hand', () => {
    let state = newMatch(defaultTrixConfig, 'nc');
    state = chooseContract(state, state.kingdomOwner, ['slaps']).state;
    // exposing/trick phase now; every seat's view shows only its own 13 cards.
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      const v = viewFor(state, seat);
      expect(v.hand.length).toBe(13);
      expect(v.seat).toBe(seat);
    }
  });
});
