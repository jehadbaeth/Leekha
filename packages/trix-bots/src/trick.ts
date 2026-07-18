// Trick-avoidance play policy, parameterized by whichever trick contract(s)
// are active in view.contracts (mirrors SPEC-TRIX.md section 13's "one
// trick-avoidance policy covers all four contracts plus Complex combos").
import {
  isDiamond,
  isKingOfHearts,
  isQueen,
  teamOf,
  type Card,
  type Contract,
  type Seat,
  type TrickPlay,
  type TrixSeatView,
} from '@leekha/trix';

const sameCard = (a: Card, b: Card): boolean => a.suit === b.suit && a.rank === b.rank;
const sortAsc = (cards: Card[]): Card[] => [...cards].sort((a, b) => a.rank - b.rank);
const sortDesc = (cards: Card[]): Card[] => [...cards].sort((a, b) => b.rank - a.rank);

/** Direct per-card penalty this card carries under the active contracts (0 for slaps, which penalizes the trick, not the card). */
function cardPenalty(card: Card, contracts: Contract[]): number {
  let p = 0;
  if (contracts.includes('kingOfHearts') && isKingOfHearts(card)) p += 75;
  if (contracts.includes('diamonds') && isDiamond(card)) p += 10;
  if (contracts.includes('queens') && isQueen(card)) p += 25;
  return p;
}

function byPenaltyDesc(cards: Card[], contracts: Contract[]): Card[] {
  return [...cards].sort((a, b) => cardPenalty(b, contracts) - cardPenalty(a, contracts));
}

/** Winner of the trick so far (partial or complete): highest card of the led suit among plays made. */
function currentWinner(plays: TrickPlay[]): { seat: Seat; rank: number } | null {
  if (plays.length === 0) return null;
  const led = plays[0].card.suit;
  let best = plays[0];
  for (const p of plays) if (p.card.suit === led && p.card.rank > best.card.rank) best = p;
  return { seat: best.seat, rank: best.card.rank };
}

/** Whether the trick so far already carries a penalty under the active contracts. Slaps penalizes every trick, win or not. */
function trickHasPenalty(plays: TrickPlay[], contracts: Contract[]): boolean {
  if (contracts.includes('slaps')) return true;
  return plays.some((p) => cardPenalty(p.card, contracts) > 0);
}

function isPartnerSeat(view: TrixSeatView, seat: Seat): boolean {
  return view.config.partnership && teamOf(seat) === teamOf(view.seat);
}

/** All cards played so far this deal: everything captured (resolved tricks) plus the trick in progress. Used to reason about unseen penalty cards. */
function allPlayedCards(view: TrixSeatView): Card[] {
  const out: Card[] = [];
  for (const seatCaptured of view.captured) out.push(...seatCaptured);
  out.push(...view.currentTrick.plays.map((p) => p.card));
  return out;
}

function isSeen(view: TrixSeatView, card: Card): boolean {
  if (view.hand.some((c) => sameCard(c, card))) return true;
  return allPlayedCards(view).some((c) => sameCard(c, card));
}

/**
 * How risky it is to LEAD this card: the penalty card itself is worst (we
 * could win our own lead and eat it); next worst is a card that outranks a
 * still-unseen penalty card in the same suit (K of hearts under kingOfHearts,
 * or a queen under queens) -- if that card gets forced into the trick, we
 * capture it. Diamonds needs no extra case: every diamond already carries a
 * direct penalty above, so leading any diamond is already discouraged.
 */
function leadDanger(view: TrixSeatView, card: Card, contracts: Contract[]): number {
  if (cardPenalty(card, contracts) > 0) return 1000;
  let risk = 0;
  if (contracts.includes('kingOfHearts') && card.suit === 'H' && card.rank > 13) {
    if (!isSeen(view, { suit: 'H', rank: 13 })) risk += 50;
  }
  if (contracts.includes('queens') && card.rank > 12) {
    if (!isSeen(view, { suit: card.suit, rank: 12 })) risk += 25;
  }
  return risk;
}

export function chooseTrickPlay(view: TrixSeatView): Card {
  const legal = view.legal;
  if (!legal || legal.length === 0) throw new Error('chooseTrickPlay called with no legal plays');
  if (legal.length === 1) return legal[0];

  const contracts = view.contracts;
  const plays = view.currentTrick.plays;

  // Leading: prefer the least dangerous card to open with (see leadDanger),
  // cheapest rank first among ties.
  if (plays.length === 0) {
    const ranked = [...legal].sort(
      (a, b) => leadDanger(view, a, contracts) - leadDanger(view, b, contracts) || a.rank - b.rank,
    );
    return ranked[0];
  }

  const winner = currentWinner(plays)!;
  const hasPenalty = trickHasPenalty(plays, contracts);
  const winnerIsPartner = isPartnerSeat(view, winner.seat);
  const led = plays[0].card.suit;
  const followingLed = legal.every((c) => c.suit === led);

  if (followingLed) {
    if (!hasPenalty) return sortAsc(legal)[0]; // nothing at stake on this trick yet: conserve high cards

    if (winnerIsPartner) {
      // Don't take a trick away from our own partner; stay under them if we can.
      const under = legal.filter((c) => c.rank < winner.rank);
      if (under.length > 0) return sortDesc(under)[0];
      return sortAsc(legal)[0]; // forced to overtake: take the cheapest overtake
    }

    // An opponent (or, solo, anyone) is winning a penalized trick: duck under them.
    const under = legal.filter((c) => c.rank < winner.rank);
    if (under.length > 0) return sortDesc(under)[0];
    return sortAsc(legal)[0]; // forced to win: take it as cheaply as possible
  }

  // Void in the led suit: a free discard, since it can never win this trick.
  // The opponent currently "winning" only stays winning if no later seat can
  // overtake -- and our own partner might be one of those later seats. Only
  // dump a penalty when the win is actually locked in for an opponent: our
  // partner has already played (so they can't be the one to overtake), we're
  // last to act (nobody's left to overtake), or the current winner holds the
  // top card of the led suit (nobody CAN overtake).
  const partnerAlreadyPlayed = plays.some((p) => isPartnerSeat(view, p.seat));
  const lastToAct = plays.length === 3;
  const winIsLocked = !winnerIsPartner && (partnerAlreadyPlayed || lastToAct || winner.rank === 14);
  if (hasPenalty && winIsLocked) {
    // Safe dump: an opponent will keep this trick no matter what, so shed our worst penalty card.
    const worst = byPenaltyDesc(legal, contracts)[0];
    if (cardPenalty(worst, contracts) > 0) return worst;
  }
  // Otherwise (partner winning, or nothing penalized yet): never dump a
  // penalty card here. Shed a safe high spot card instead.
  const safe = legal.filter((c) => cardPenalty(c, contracts) === 0);
  const pool = safe.length > 0 ? safe : legal;
  return sortDesc(pool)[0];
}
