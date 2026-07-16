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
  /**
   * Undercut proofs (SPEC 13.1 item 6), suit-wide form: seat -> suit ->
   * highest ceiling rank the seat has been proven to hold nothing below.
   * A follower who plays over a live Leekha's undercut ceiling was REQUIRED
   * to duck if they could, so playing over proves their remaining cards of
   * that suit are all at or above the ceiling. Proofs only tighten (a hand
   * never gains cards mid-round), hence max-rank per seat/suit.
   */
  ceilings: Map<Seat, Map<string, number>>;
  /**
   * Undercut proofs, specific-card form: seat -> card keys proven absent.
   * A forced dumper who dropped a Leekha at or above the ceiling held no
   * lower Leekha (the undercut filter would have forced the lower one), so
   * every Leekha below that ceiling is provably not in their hand.
   */
  provenNotHeld: Map<Seat, Set<string>>;
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
  const ceilings = new Map<Seat, Map<string, number>>();
  const provenNotHeld = new Map<Seat, Set<string>>();
  const recordCeiling = (seat: Seat, suit: string, rank: number) => {
    if (!ceilings.has(seat)) ceilings.set(seat, new Map());
    const bySuit = ceilings.get(seat)!;
    bySuit.set(suit, Math.max(bySuit.get(suit) ?? 0, rank));
  };
  const undercutRule = view.config.undercutRule;
  const allTricks = [...view.playedCards, view.currentTrick.plays.length > 0 ? view.currentTrick.plays : []].filter(
    (t) => t.length > 0,
  );
  for (const trick of allTricks) {
    if (trick.length === 0) continue;
    const led = trick[0].card.suit;
    // Replay the trick play by play so each undercut proof is judged against
    // the ceiling AS IT STOOD when that player acted, mirroring how the
    // engine's legalPlaysFor narrowed their choices at that moment.
    let winRank: number = trick[0].card.rank;
    const leekhaRanks: number[] = isLeekha(trick[0].card) ? [trick[0].card.rank] : [];
    for (let i = 1; i < trick.length; i++) {
      const play = trick[i];
      if (play.card.suit !== led) {
        if (!voids.has(play.seat)) voids.set(play.seat, new Set());
        voids.get(play.seat)!.add(led);
        if (!isLeekha(play.card)) noLeekha.add(play.seat);
      }
      if (undercutRule !== 'off' && leekhaRanks.length > 0) {
        const ceiling = undercutRule === 'leekhaRank' ? Math.max(...leekhaRanks) : winRank;
        if (play.card.suit === led && !play.forced && play.card.rank >= ceiling) {
          // Voluntarily played over a live undercut ceiling while following:
          // ducking was mandatory if possible, so nothing below remains.
          // Forced talyeekh follows are excluded -- the engine pinned that
          // exact card regardless of what else the hand held.
          recordCeiling(play.seat, led, ceiling);
        } else if (play.card.suit !== led && play.forced && isLeekha(play.card) && play.card.rank >= ceiling) {
          // Forced dump over the ceiling: the undercut filter would have
          // demanded a lower Leekha if they had one.
          for (const lk of [
            { suit: 'D', rank: 10 },
            { suit: 'S', rank: 12 },
            { suit: 'C', rank: 13 },
          ]) {
            if (lk.rank < ceiling) {
              if (!provenNotHeld.has(play.seat)) provenNotHeld.set(play.seat, new Set());
              provenNotHeld.get(play.seat)!.add(`${lk.suit}${lk.rank}`);
            }
          }
        }
      }
      if (play.card.suit === led) winRank = Math.max(winRank, play.card.rank);
      if (isLeekha(play.card)) leekhaRanks.push(play.card.rank);
    }
  }

  const danger = ([0, 1, 2, 3] as Seat[]).map((seat) => ({
    seat,
    score: view.scores[seat],
    distanceToTarget: view.config.targetScore - view.scores[seat],
  }));

  return { unseen, knownHeldBy, voids, noLeekha, ceilings, provenNotHeld, danger };
}
