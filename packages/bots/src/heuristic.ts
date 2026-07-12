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
  const trick = view.currentTrick;
  const partner = ((view.seat + 2) % 4) as Seat;
  const myTeam = teamOf(view.seat);
  const allLeekha = legal.every(isLeekha);

  const winning = winningRankOnTrick(view);
  const partnerPlayed = trick.plays.some((p) => p.seat === partner);
  // The current winner can only be displaced by seats still to play; once the
  // partner has played (or the winner holds the ace of the led suit, which
  // nothing can beat), a trick currently won by an opponent is guaranteed to
  // stay on their side -- the window where dumping a Leekha is safe.
  const opponentLocked =
    winning !== null && teamOf(winning.seat) !== myTeam && (partnerPlayed || winning.rank === 14);

  // 1. Forced dump with a choice among Leekha cards.
  if (trick.plays.length > 0 && allLeekha) {
    const opponentWinning = winning ? teamOf(winning.seat) !== myTeam : true;
    const sorted = [...legal].sort((a, b) => cardPoints(a) - cardPoints(b));
    return opponentWinning ? sorted[sorted.length - 1] : sorted[0];
  }

  // 3. Leading.
  if (trick.plays.length === 0) {
    const hand = view.hand;
    const myLeekhaSuits = new Set(hand.filter(isLeekha).map((c) => c.suit));
    const opponents = ([0, 1, 2, 3] as Seat[]).filter((s) => teamOf(s) !== myTeam);
    // An opponent proven void in a suit and not proven Leekha-free can
    // talyeekh onto anything we lead there.
    const riskySuit = (suit: Card['suit']) =>
      opponents.some((o) => tracker.voids.get(o)?.has(suit) && !tracker.noLeekha.has(o));

    // Hunt: low clubs while K♣ is unseen (and not ours -- holding it counts
    // as seen), then low spades while Q♠ is unseen, per SPEC 13.2.
    const kingClubsSeen = isCardSeen(view, { suit: 'C', rank: 13 });
    const queenSpadesSeen = isCardSeen(view, { suit: 'S', rank: 12 });
    const lowClubs = legal.filter((c) => c.suit === 'C').sort((a, b) => a.rank - b.rank);
    if (!kingClubsSeen && lowClubs.length > 0 && !riskySuit('C')) return lowClubs[0];
    const lowSpades = legal.filter((c) => c.suit === 'S').sort((a, b) => a.rank - b.rank);
    if (!queenSpadesSeen && lowSpades.length > 0 && !riskySuit('S')) return lowSpades[0];

    // Chase what we passed: the 3 cards we handed the pass recipient (always
    // an opponent) are known until seen. If one of them is dangerous, keep
    // leading that suit from below -- every round strips one of their guards
    // and eventually flushes the Leekha or honor out onto someone else.
    for (const [key, holder] of tracker.knownHeldBy) {
      if (teamOf(holder) === myTeam) continue;
      const suit = key[0] as Card['suit'];
      const rank = Number(key.slice(1));
      const dangerous = isLeekha({ suit, rank } as Card) || rank >= 13;
      if (!dangerous || riskySuit(suit)) continue;
      const flushers = legal.filter((c) => c.suit === suit && c.rank < rank).sort((a, b) => a.rank - b.rank);
      if (flushers.length > 0) return flushers[0];
    }

    // Holding a Leekha: burn the shortest side suit to develop a void. That
    // both signals the short suit to the partner and opens the talyeekh
    // window; leading from the longest suit (or worse, from the Leekha's own
    // suit) just keeps us following forever with a bomb in hand.
    const suitsInHand = [...new Set(hand.map((c) => c.suit))];
    if (myLeekhaSuits.size > 0) {
      const candidates = suitsInHand
        .filter((s) => !myLeekhaSuits.has(s) && !riskySuit(s))
        .sort((a, b) => suitCount(hand, a) - suitCount(hand, b));
      for (const s of candidates) {
        const ofSuit = legal.filter((c) => c.suit === s).sort((a, b) => a.rank - b.rank);
        if (ofSuit.length > 0) return ofSuit[0];
      }
    }

    // Default: lowest of the longest suit that is neither risky nor home to
    // our own Leekha; fall back through the exclusions if nothing qualifies.
    const bySize = suitsInHand.sort((a, b) => suitCount(hand, b) - suitCount(hand, a));
    const pick = (pred: (s: Card['suit']) => boolean): Card | null => {
      for (const s of bySize.filter(pred)) {
        const ofSuit = legal.filter((c) => c.suit === s).sort((a, b) => a.rank - b.rank);
        if (ofSuit.length > 0) return ofSuit[0];
      }
      return null;
    };
    return (
      pick((s) => !myLeekhaSuits.has(s) && !riskySuit(s)) ??
      pick((s) => !myLeekhaSuits.has(s)) ??
      [...legal].sort((a, b) => a.rank - b.rank)[0]
    );
  }

  // Following with cards of the led suit (or an undercut-narrowed winner set).
  const led = trick.plays[0].card.suit;
  const followingLed = legal.every((c) => c.suit === led);
  if (followingLed) {
    const win = winning!;
    const partnerWinning = teamOf(win.seat) === myTeam;
    const pointsOnTrick = trick.plays.reduce((sum, p) => sum + cardPoints(p.card), 0) > 0;

    // Rescue: partner is winning a dangerous trick and badly needs help. Take it as cheaply as legal allows.
    if (partnerWinning && pointsOnTrick) {
      const partnerScore = view.scores[win.seat];
      const myScore = view.scores[view.seat];
      const dangerThreshold = view.config.targetScore - 30;
      if (partnerScore >= dangerThreshold && myScore <= partnerScore - 40) {
        const winners = legal.filter((c) => c.rank > win.rank).sort((a, b) => a.rank - b.rank);
        if (winners.length > 0) return winners[0];
      }
    }

    const under = legal.filter((c) => c.rank < win.rank);
    if (under.length > 0) {
      // Talyeekh by following: sliding our own Leekha under a trick the
      // opponents are guaranteed to take is the best move in the game.
      const leekhaUnder = under.filter(isLeekha).sort((a, b) => cardPoints(b) - cardPoints(a));
      if (opponentLocked && leekhaUnder.length > 0) return leekhaUnder[0];
      // Duck as high as possible -- but never spend a Leekha as a mere duck
      // (it would gift the points to whoever wins, very possibly the
      // partner) unless it is literally the only card under.
      const safeUnder = under.filter((c) => !isLeekha(c));
      const pool = safeUnder.length > 0 ? safeUnder : under;
      return [...pool].sort((a, b) => b.rank - a.rank)[0];
    }
    // Forced to win: cheapest winner that isn't a Leekha (winning with Q♠
    // means eating Q♠); a Leekha only if nothing else is legal.
    const winners = [...legal].sort((a, b) => a.rank - b.rank);
    return winners.find((c) => !isLeekha(c)) ?? winners[0];
  }

  // 5. Void discard. With forcedLeekhaDiscard on, a hand holding a Leekha is
  // usually forced into branch 1 instead; this branch still sees Leekha cards
  // under rule variants, so it has to handle them deliberately rather than
  // (as before) falling through to "highest card" and hitting the partner.
  const leekhas = legal.filter(isLeekha).sort((a, b) => cardPoints(b) - cardPoints(a));
  if (opponentLocked && leekhas.length > 0) return leekhas[0]; // talyeekh
  const partnerWinningNow = winning !== null && teamOf(winning.seat) === myTeam;
  const nonLeekha = legal.filter((c) => !isLeekha(c));
  const discardPool = nonLeekha.length > 0 ? nonLeekha : legal;
  if (partnerWinningNow) {
    // Partner is taking this trick: don't gift them points. Junk the highest
    // zero-point card, preferring the shortest suit to grow another void.
    const zeroPoint = discardPool.filter((c) => cardPoints(c) === 0);
    const junk = zeroPoint.length > 0 ? zeroPoint : discardPool;
    return [...junk].sort(
      (a, b) => suitCount(view.hand, a.suit) - suitCount(view.hand, b.suit) || b.rank - a.rank,
    )[0];
  }
  const queenSpadesSeen = isCardSeen(view, { suit: 'S', rank: 12 });
  if (!queenSpadesSeen) {
    const bareHonors = discardPool
      .filter((c) => c.suit === 'S' && (c.rank === 14 || c.rank === 13))
      .filter((c) => suitCount(view.hand, 'S') <= 2)
      .sort((a, b) => b.rank - a.rank);
    if (bareHonors.length > 0) return bareHonors[0];
  }
  const hearts = discardPool.filter((c) => c.suit === 'H').sort((a, b) => b.rank - a.rank);
  if (hearts.length > 0) return hearts[0];
  return [...discardPool].sort((a, b) => b.rank - a.rank)[0];
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
