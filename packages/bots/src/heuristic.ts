import { Card, Seat, SeatView, isLeekha, cardPoints, teamOf } from '@leekha/engine';
import { buildTracker } from './tracker.js';

function cardKey(c: Card): string {
  return `${c.suit}${c.rank}`;
}

function suitCount(hand: Card[], suit: Card['suit']): number {
  return hand.filter((c) => c.suit === suit).length;
}

function lowerInSuit(hand: Card[], card: Card): number {
  return hand.filter((c) => c.suit === card.suit && c.rank < card.rank).length;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface HeuristicOptions {
  noise: number; // 0 = deterministic best pick (Medium-ish), higher = more random (Easy)
  rng: () => number;
}

function passWeight(hand: Card[], card: Card, hasAnyLeekha: boolean): number {
  const lower = lowerInSuit(hand, card);
  let w = 0;

  if (card.suit === 'C' && card.rank === 13) {
    w = lower <= 2 ? 95 : 55;
  } else if (card.suit === 'S' && card.rank === 12) {
    w = lower <= 2 ? 85 : 50;
  } else if (card.suit === 'S' && (card.rank === 14 || card.rank === 13)) {
    w = lower === 0 ? 60 : lower >= 2 ? 15 : lerp(60, 15, 0.5);
  } else if (card.suit === 'H' && (card.rank === 14 || card.rank === 13 || card.rank === 12)) {
    w = 30;
  } else if (card.suit === 'D' && card.rank === 10) {
    w = 35;
  } else if (card.suit === 'C' && card.rank === 14) {
    w = lower >= 1 ? 10 : 80;
  } else {
    w = card.rank; // mild preference to unload high spot cards over low ones
  }

  const sideSuitSize = suitCount(hand, card.suit);
  if (sideSuitSize <= 2 && !isLeekha(card)) {
    w += hasAnyLeekha ? 5 : 25;
  }
  return w;
}

export function choosePass(view: SeatView, opts: HeuristicOptions): [Card, Card, Card] {
  const hand = view.hand;
  const hasAnyLeekha = hand.some(isLeekha);
  const scored = hand.map((card) => ({ card, weight: passWeight(hand, card, hasAnyLeekha) + opts.rng() * opts.noise }));
  scored.sort((a, b) => b.weight - a.weight);
  return [scored[0].card, scored[1].card, scored[2].card];
}

function winningRankOnTrick(view: SeatView): { seat: Seat; rank: number } | null {
  const plays = view.currentTrick.plays;
  if (plays.length === 0) return null;
  const led = plays[0].card.suit;
  let best = plays[0];
  for (const p of plays.slice(1)) if (p.card.suit === led && p.card.rank > best.card.rank) best = p;
  return { seat: best.seat, rank: best.card.rank };
}

function isCardSeen(view: SeatView, card: Card): boolean {
  if (view.hand.some((c) => cardKey(c) === cardKey(card))) return true;
  for (const trick of view.playedCards) if (trick.some((p) => cardKey(p.card) === cardKey(card))) return true;
  if (view.currentTrick.plays.some((p) => cardKey(p.card) === cardKey(card))) return true;
  return false;
}

export function choosePlay(view: SeatView, opts: HeuristicOptions): Card {
  const legal = view.legal;
  if (!legal || legal.length === 0) throw new Error('choosePlay called when it is not this seat\'s turn');
  if (legal.length === 1) return legal[0];

  const tracker = buildTracker(view);
  void tracker; // reserved for endgame counting and chase heuristics beyond this baseline

  const trick = view.currentTrick;
  const allLeekha = legal.every(isLeekha);

  // 1. Forced dump with a choice among Leekha cards.
  if (trick.plays.length > 0 && allLeekha) {
    const winning = winningRankOnTrick(view);
    const opponentWinning = winning ? teamOf(winning.seat) !== teamOf(view.seat) : true;
    const sorted = [...legal].sort((a, b) => a.rank - b.rank);
    return opponentWinning ? sorted[sorted.length - 1] : sorted[0];
  }

  // 3. Leading.
  if (trick.plays.length === 0) {
    const kingClubsSeen = isCardSeen(view, { suit: 'C', rank: 13 });
    const queenSpadesSeen = isCardSeen(view, { suit: 'S', rank: 12 });
    const lowClubs = legal.filter((c) => c.suit === 'C').sort((a, b) => a.rank - b.rank);
    if (!kingClubsSeen && lowClubs.length > 0) return lowClubs[0];
    const lowSpades = legal.filter((c) => c.suit === 'S').sort((a, b) => a.rank - b.rank);
    if (!queenSpadesSeen && lowSpades.length > 0) return lowSpades[0];

    const bySuitCount = new Map<string, number>();
    for (const c of view.hand) bySuitCount.set(c.suit, (bySuitCount.get(c.suit) ?? 0) + 1);
    const bestSuit = [...bySuitCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const ofBestSuit = legal.filter((c) => c.suit === bestSuit).sort((a, b) => a.rank - b.rank);
    if (ofBestSuit.length > 0) return ofBestSuit[0];
    return [...legal].sort((a, b) => a.rank - b.rank)[0];
  }

  // Following with cards of the led suit (or an undercut-narrowed winner set).
  const led = trick.plays[0].card.suit;
  const followingLed = legal.every((c) => c.suit === led);
  if (followingLed) {
    const winning = winningRankOnTrick(view)!;
    const partnerWinning = teamOf(winning.seat) === teamOf(view.seat);
    const pointsOnTrick = trick.plays.reduce((sum, p) => sum + cardPoints(p.card), 0) > 0;

    // Rescue: partner is winning a dangerous trick and badly needs help. Take it as cheaply as legal allows.
    if (partnerWinning && pointsOnTrick) {
      const partnerScore = view.scores[winning.seat];
      const myScore = view.scores[view.seat];
      const dangerThreshold = view.config.targetScore - 30;
      if (partnerScore >= dangerThreshold && myScore <= partnerScore - 40) {
        const winners = legal.filter((c) => c.rank > winning.rank).sort((a, b) => a.rank - b.rank);
        if (winners.length > 0) return winners[0];
      }
    }

    const under = legal.filter((c) => c.rank < winning.rank).sort((a, b) => b.rank - a.rank);
    if (under.length > 0) return under[0]; // duck as high as possible while staying under
    return [...legal].sort((a, b) => a.rank - b.rank)[0]; // forced to win: do it as cheaply as possible
  }

  // 5. Free discard (void, no Leekha in hand at all).
  const queenSpadesSeen = isCardSeen(view, { suit: 'S', rank: 12 });
  if (!queenSpadesSeen) {
    const bareHonors = legal
      .filter((c) => c.suit === 'S' && (c.rank === 14 || c.rank === 13))
      .filter((c) => suitCount(view.hand, 'S') <= 2)
      .sort((a, b) => b.rank - a.rank);
    if (bareHonors.length > 0) return bareHonors[0];
  }
  const hearts = legal.filter((c) => c.suit === 'H').sort((a, b) => b.rank - a.rank);
  if (hearts.length > 0) return hearts[0];
  return [...legal].sort((a, b) => b.rank - a.rank)[0];
}

export interface Bot {
  choosePass(view: SeatView): [Card, Card, Card];
  choosePlay(view: SeatView): Card;
}

export function makeHeuristicBot(level: 'easy' | 'medium', rng: () => number = Math.random): Bot {
  const noise = level === 'easy' ? 40 : 8;
  const opts: HeuristicOptions = { noise, rng };
  return {
    choosePass: (view) => choosePass(view, opts),
    choosePlay: (view) => choosePlay(view, opts),
  };
}
