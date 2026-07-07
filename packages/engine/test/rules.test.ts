import { describe, expect, it } from 'vitest';
import { legalPlaysFor, TrickState } from '../src/index.js';
import { c, cfg, matchWithHands } from './helpers.js';
import { playCard } from '../src/engine.js';

function trick(leader: 0 | 1 | 2 | 3, plays: { seat: 0 | 1 | 2 | 3; card: ReturnType<typeof c>; forced?: boolean }[]): TrickState {
  return { leader, plays: plays.map((p) => ({ ...p, forced: p.forced ?? false })) };
}

describe('following suit', () => {
  it('must follow suit when able', () => {
    const hand = [c('H', 5), c('H', 9), c('S', 3)];
    const t = trick(0, [{ seat: 0, card: c('H', 2) }]);
    const legal = legalPlaysFor(hand, t, cfg());
    expect(legal).toEqual([c('H', 5), c('H', 9)]);
  });

  it('leader may lead anything including hearts on trick 1', () => {
    const hand = [c('H', 5), c('S', 3), c('C', 13)];
    const legal = legalPlaysFor(hand, trick(0, []), cfg());
    expect(legal).toEqual(hand);
  });
});

describe('forced dump', () => {
  it('fires with exactly one leekha card', () => {
    const hand = [c('D', 10), c('C', 4), c('H', 2)];
    const t = trick(0, [{ seat: 0, card: c('S', 5) }]); // void in spades
    const legal = legalPlaysFor(hand, t, cfg());
    expect(legal).toEqual([c('D', 10)]);
  });

  it('offers a choice among two leekha cards', () => {
    const hand = [c('D', 10), c('S', 12), c('H', 2)];
    const t = trick(0, [{ seat: 0, card: c('C', 5) }]);
    const legal = legalPlaysFor(hand, t, cfg());
    expect(legal.sort((a, b) => a.rank - b.rank)).toEqual([c('D', 10), c('S', 12)]);
  });

  it('offers a choice among all three leekha cards', () => {
    const hand = [c('D', 10), c('S', 12), c('C', 13)]; // void in hearts entirely
    const t = trick(0, [{ seat: 0, card: c('H', 5) }]);
    const legal = legalPlaysFor(hand, t, cfg());
    expect(legal.sort((a, b) => a.rank - b.rank)).toEqual([c('D', 10), c('S', 12), c('C', 13)]);
  });

  it('fires on trick 1', () => {
    const hands: [ReturnType<typeof c>[], ReturnType<typeof c>[], ReturnType<typeof c>[], ReturnType<typeof c>[]] = [
      [c('S', 2)],
      [c('D', 10), c('H', 3)],
      [c('S', 4)],
      [c('S', 5)],
    ];
    let m = matchWithHands(hands as any);
    const r1 = playCard(m, 0, c('S', 2));
    m = r1.state;
    const legal = legalPlaysFor(m.round.hands[1], m.round.currentTrick, m.config);
    expect(legal).toEqual([c('D', 10)]);
  });

  it('void with no leekha may discard anything', () => {
    const hand = [c('H', 2), c('C', 4), c('D', 3)];
    const t = trick(0, [{ seat: 0, card: c('S', 5) }]);
    const legal = legalPlaysFor(hand, t, cfg());
    expect(legal.length).toBe(3);
  });

  it('Q♠ is not forced while nothing on the trick yet beats it', () => {
    const hand = [c('S', 12), c('S', 3)];
    const t = trick(0, [{ seat: 0, card: c('S', 5) }]); // 5 doesn't beat the queen
    const legal = legalPlaysFor(hand, t, cfg());
    expect(legal.sort((a, b) => a.rank - b.rank)).toEqual([c('S', 3), c('S', 12)]);
  });

  it('Q♠ is forced (talyeekh) once a higher spade already beats it on the trick', () => {
    const hand = [c('S', 12), c('S', 3)];
    const t = trick(0, [{ seat: 0, card: c('S', 14) }]); // ace already beats the queen
    const legal = legalPlaysFor(hand, t, cfg());
    expect(legal).toEqual([c('S', 12)]);
  });

  it('K♣ can be held back on a low club lead instead of winning the trick with it', () => {
    const hand = [c('C', 13), c('C', 4)];
    const t = trick(0, [{ seat: 0, card: c('C', 2) }]); // 2 doesn't beat the king
    const legal = legalPlaysFor(hand, t, cfg());
    expect(legal.sort((a, b) => a.rank - b.rank)).toEqual([c('C', 4), c('C', 13)]);
  });

  it('K♣ is forced out once the A♣ already beats it on the trick', () => {
    const hand = [c('C', 13), c('C', 4)];
    const t = trick(0, [{ seat: 0, card: c('C', 14) }]); // ace already beats the king
    const legal = legalPlaysFor(hand, t, cfg());
    expect(legal).toEqual([c('C', 13)]);
  });
});

describe('trick resolution', () => {
  it('off suit cards never win', () => {
    const hands: any = [[c('S', 5)], [c('S', 2)], [c('C', 14)], [c('S', 9)]];
    let m = matchWithHands(hands, cfg(), 3);
    let res = playCard(m, 0, c('S', 5));
    res = playCard(res.state, 1, c('S', 2));
    res = playCard(res.state, 2, c('C', 14));
    res = playCard(res.state, 3, c('S', 9));
    const trickEnd = res.events.find((e) => e.type === 'trickEnd') as any;
    expect(trickEnd.winner).toBe(3); // S9 beats S5/S2, the off-suit ace of clubs cannot win
  });

  it('K♣ eaten by following a club lead, even under the A♣', () => {
    const hands: any = [[c('C', 2)], [c('C', 13)], [c('C', 3)], [c('C', 14)]];
    let m = matchWithHands(hands, cfg(), 3);
    let res = playCard(m, 0, c('C', 2));
    res = playCard(res.state, 1, c('C', 13));
    res = playCard(res.state, 2, c('C', 3));
    res = playCard(res.state, 3, c('C', 14));
    const trickEnd = res.events.find((e) => e.type === 'trickEnd') as any;
    expect(trickEnd.winner).toBe(3);
    expect(trickEnd.points).toBe(14);
  });

  it('forced talyeekh follow is tagged forced, a free follow is not', () => {
    const hands: any = [[c('S', 14)], [c('S', 12), c('S', 3)], [c('S', 9)], [c('S', 2)]];
    let m = matchWithHands(hands, cfg(), 3);
    const events: any[] = [];
    let res = playCard(m, 0, c('S', 14)); // ace led, already beats the queen
    events.push(...res.events);
    res = playCard(res.state, 1, c('S', 12)); // forced: ace already beats the Q♠
    events.push(...res.events);
    res = playCard(res.state, 2, c('S', 9)); // free follow: no leekha involved
    events.push(...res.events);
    res = playCard(res.state, 3, c('S', 2));
    events.push(...res.events);
    const played = events.filter((e) => e.type === 'played') as any[];
    expect(played[1].forced).toBe(true);
    expect(played[2].forced).toBe(false);
  });

  it('two players can be forced on the same trick', () => {
    const hands: any = [[c('S', 5)], [c('D', 10), c('H', 2)], [c('C', 13), c('H', 3)], [c('S', 9)]];
    let m = matchWithHands(hands, cfg(), 3);
    const events: any[] = [];
    let res = playCard(m, 0, c('S', 5));
    events.push(...res.events);
    res = playCard(res.state, 1, c('D', 10));
    events.push(...res.events);
    res = playCard(res.state, 2, c('C', 13));
    events.push(...res.events);
    res = playCard(res.state, 3, c('S', 9));
    events.push(...res.events);
    const played = events.filter((e) => e.type === 'played') as any[];
    expect(played[1].forced).toBe(true);
    expect(played[2].forced).toBe(true);
  });

  it('winner receives the sum of all points in the trick', () => {
    const hands: any = [[c('S', 5)], [c('H', 4)], [c('D', 10)], [c('S', 9)]];
    let m = matchWithHands(hands, cfg(), 3);
    let res = playCard(m, 0, c('S', 5));
    res = playCard(res.state, 1, c('H', 4));
    res = playCard(res.state, 2, c('D', 10));
    res = playCard(res.state, 3, c('S', 9));
    const trickEnd = res.events.find((e) => e.type === 'trickEnd') as any;
    expect(trickEnd.winner).toBe(3);
    expect(trickEnd.points).toBe(11); // 1 heart + 10 diamond, both off-suit dumps
  });
});

describe('undercut rule', () => {
  it('a follower must duck beneath a leekha on the trick', () => {
    const hand = [c('S', 14), c('S', 5)];
    const t = trick(0, [{ seat: 0, card: c('S', 12) }]); // Q♠ led/on trick
    const legal = legalPlaysFor(hand, t, cfg());
    expect(legal).toEqual([c('S', 5)]);
  });

  it('a follower whose led-suit cards all outrank it plays over and wins the option', () => {
    const hand = [c('S', 14), c('S', 13)];
    const t = trick(0, [{ seat: 0, card: c('S', 12) }]);
    const legal = legalPlaysFor(hand, t, cfg());
    expect(legal.sort((a, b) => a.rank - b.rank)).toEqual([c('S', 13), c('S', 14)]);
  });

  it('a forced dumper must pick the leekha below the trick\'s highest leekha', () => {
    const hand = [c('D', 10), c('C', 13)];
    const t = trick(0, [{ seat: 0, card: c('S', 12) }]); // led spades, dumper void, Q♠ already down
    const legal = legalPlaysFor(hand, t, cfg());
    expect(legal).toEqual([c('D', 10)]); // K♣(13) not < Q♠(12), 10♦ is
  });

  it('a free discard stays unconstrained by default', () => {
    const hand = [c('H', 14), c('C', 4)];
    const t = trick(0, [{ seat: 0, card: c('S', 12) }]);
    const legal = legalPlaysFor(hand, t, cfg());
    expect(legal.length).toBe(2);
  });

  it('a heart-only trick triggers no undercut', () => {
    const hand = [c('H', 14), c('H', 2)];
    const t = trick(0, [{ seat: 0, card: c('H', 5) }]);
    const legal = legalPlaysFor(hand, t, cfg());
    expect(legal.length).toBe(2);
  });

  it('with two leekha cards on the trick the highest sets the ceiling', () => {
    // Jack of clubs (11) sits between the two leekha ranks (10 and 13): it only
    // ducks under the trick if the ceiling is the higher leekha (K♣=13), not the lower (10♦=10).
    const hand = [c('C', 11), c('C', 2)]; // led clubs, following suit
    const t = trick(0, [
      { seat: 0, card: c('C', 13) }, // K♣, highest leekha on trick
      { seat: 1, card: c('D', 10) }, // off suit dump, the lower leekha
    ]);
    const legal = legalPlaysFor(hand, t, cfg());
    expect(legal.sort((a, b) => a.rank - b.rank)).toEqual([c('C', 2), c('C', 11)]);
  });
});
