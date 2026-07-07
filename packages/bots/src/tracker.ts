import { Card, Seat, SeatView, isLeekha, nextSeat, makeDeck } from '@leekha/engine';

export interface Tracker {
  /** Cards not visible to this seat: not in own hand, not yet played to the table. */
  unseen: Card[];
  /** Cards known to be in a specific seat's hand even though not yet played (the pass). */
  knownHeldBy: Map<string, Seat>; // key = `${suit}${rank}`
  /** seat -> set of suits that seat is known void in. */
  voids: Map<Seat, Set<string>>;
  /** seat -> proven to hold no Leekha cards for the rest of the round. */
  noLeekha: Set<Seat>;
  /** seat -> cumulative score, distance to target. */
  danger: { seat: Seat; score: number; distanceToTarget: number }[];
}

function cardKey(c: Card): string {
  return `${c.suit}${c.rank}`;
}

export function buildTracker(view: SeatView): Tracker {
  const seen = new Set<string>(view.hand.map(cardKey));
  for (const trick of view.playedCards) for (const p of trick) seen.add(cardKey(p.card));
  for (const p of view.currentTrick.plays) seen.add(cardKey(p.card));

  const unseen = makeDeck().filter((c) => !seen.has(cardKey(c)));

  const knownHeldBy = new Map<string, Seat>();
  if (view.youPassed) {
    const recipient = nextSeat(view.seat);
    const playedKeys = new Set<string>();
    for (const trick of view.playedCards) for (const p of trick) playedKeys.add(cardKey(p.card));
    for (const p of view.currentTrick.plays) playedKeys.add(cardKey(p.card));
    for (const c of view.youPassed) {
      if (!playedKeys.has(cardKey(c))) knownHeldBy.set(cardKey(c), recipient);
    }
  }

  const voids = new Map<Seat, Set<string>>();
  const noLeekha = new Set<Seat>();
  const allTricks = [...view.playedCards, view.currentTrick.plays.length > 0 ? view.currentTrick.plays : []].filter(
    (t) => t.length > 0,
  );
  for (const trick of allTricks) {
    if (trick.length === 0) continue;
    const led = trick[0].card.suit;
    for (const play of trick) {
      if (play.card.suit !== led) {
        if (!voids.has(play.seat)) voids.set(play.seat, new Set());
        voids.get(play.seat)!.add(led);
        if (!isLeekha(play.card)) noLeekha.add(play.seat);
      }
    }
  }

  const danger = ([0, 1, 2, 3] as Seat[]).map((seat) => ({
    seat,
    score: view.scores[seat],
    distanceToTarget: view.config.targetScore - view.scores[seat],
  }));

  return { unseen, knownHeldBy, voids, noLeekha, danger };
}
