import { Card, Seat, SeatView, isLeekha, cardPoints, teamOf } from '@leekha/engine';

/**
 * FROZEN copy of packages/bots/src/heuristic.ts's choosePlay as it stood
 * before the Leekha-awareness rework (commit 8eb0716 and earlier), kept
 * verbatim so abtest.ts can pit the current policy against the old one on
 * duplicate deals. Do not "fix" bugs here — being the old behavior is the
 * point. Passing is not frozen; both sides use the live choosePass so the
 * duel isolates play-policy changes only.
 */

function cardKey(c: Card): string {
  return `${c.suit}${c.rank}`;
}

function suitCount(hand: Card[], suit: Card['suit']): number {
  return hand.filter((c) => c.suit === suit).length;
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

export function frozenChoosePlay(view: SeatView): Card {
  const legal = view.legal;
  if (!legal || legal.length === 0) throw new Error('frozenChoosePlay called when it is not this seat\'s turn');
  if (legal.length === 1) return legal[0];

  const trick = view.currentTrick;
  const allLeekha = legal.every(isLeekha);

  if (trick.plays.length > 0 && allLeekha) {
    const winning = winningRankOnTrick(view);
    const opponentWinning = winning ? teamOf(winning.seat) !== teamOf(view.seat) : true;
    const sorted = [...legal].sort((a, b) => a.rank - b.rank);
    return opponentWinning ? sorted[sorted.length - 1] : sorted[0];
  }

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

  const led = trick.plays[0].card.suit;
  const followingLed = legal.every((c) => c.suit === led);
  if (followingLed) {
    const winning = winningRankOnTrick(view)!;
    const partnerWinning = teamOf(winning.seat) === teamOf(view.seat);
    const pointsOnTrick = trick.plays.reduce((sum, p) => sum + cardPoints(p.card), 0) > 0;

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
    if (under.length > 0) return under[0];
    return [...legal].sort((a, b) => a.rank - b.rank)[0];
  }

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
