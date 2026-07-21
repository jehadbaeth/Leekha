import { makeDeck, cardEquals, removeCard, containsCard } from './cards.js';
import { legalPlaysFor, isForcedDump } from './legal.js';
import { rngFromSeed, shuffle } from './rng.js';
import {
  Card,
  GameEvent,
  IllegalAction,
  MatchResult,
  MatchState,
  RoundState,
  RulesConfig,
  Seat,
  SeatView,
  nextSeat,
  prevSeat,
  teamOf,
  cardPoints,
} from './types.js';

function emptyRound(): RoundState {
  return {
    hands: [[], [], [], []],
    passes: [null, null, null, null],
    passesApplied: false,
    trickNumber: 1,
    currentTrick: { leader: 0, plays: [] },
    playedCards: [],
    eatenPoints: [0, 0, 0, 0],
    eatenCards: [[], [], [], []],
  };
}

export function newMatch(config: RulesConfig, seed: string): MatchState {
  // Placeholder only: startRound overwrites the round-1 dealer with whoever
  // is dealt the 7 of hearts. Kept seed-derived so the pre-deal state stays
  // deterministic per seed.
  const rng = rngFromSeed(`${seed}:dealer0`);
  const dealer = Math.floor(rng() * 4) as Seat;
  return {
    config,
    scores: [0, 0, 0, 0],
    dealer,
    roundIndex: 0,
    phase: 'roundEnd', // ready for startRound to deal round 1
    round: emptyRound(),
    seed,
    moveLog: [],
  };
}

export function startRound(m: MatchState): MatchState {
  if (m.phase !== 'roundEnd') {
    throw new IllegalAction('bad-phase', 'Cannot start a round unless the previous one has ended');
  }
  const nextRoundIndex = m.roundIndex + 1;
  const rng = rngFromSeed(`${m.seed}:round${nextRoundIndex}`);
  const deck = shuffle(makeDeck(), rng);
  const hands: Card[][] = [[], [], [], []];
  for (let i = 0; i < 52; i++) {
    hands[i % 4].push(deck[i]);
  }
  // Round 1 of every match (and rematch): whoever was DEALT the 7 of hearts
  // owns the round -- they are the dealer and lead the first trick. From
  // round 2 on, the dealer chosen at the previous round's end (biggest
  // eater, K-club tiebreak; see selectNextDealer) leads. In both cases the
  // dealer plays the first hand personally; the seat to their right merely
  // serves the cards, which has no mechanical effect in an app.
  const dealer =
    nextRoundIndex === 1
      ? (hands.findIndex((h) => h.some((c) => c.suit === 'H' && c.rank === 7)) as Seat)
      : m.dealer;
  const leader = dealer;
  return {
    ...m,
    dealer,
    roundIndex: nextRoundIndex,
    phase: 'passing',
    round: {
      hands,
      passes: [null, null, null, null],
      passesApplied: false,
      trickNumber: 1,
      currentTrick: { leader, plays: [] },
      playedCards: [],
      eatenPoints: [0, 0, 0, 0],
      eatenCards: [[], [], [], []],
    },
  };
}

export function commitPass(m: MatchState, seat: Seat, cards: Card[]): MatchState {
  if (m.phase !== 'passing') throw new IllegalAction('bad-phase', 'Not in the passing phase');
  if (m.round.passes[seat] !== null) throw new IllegalAction('already-committed', 'Pass already committed for this seat');
  if (cards.length !== 3) throw new IllegalAction('bad-count', 'Must pass exactly 3 cards');
  const hand = m.round.hands[seat];
  for (const c of cards) {
    if (!containsCard(hand, c)) throw new IllegalAction('not-in-hand', 'Cannot pass a card you do not hold');
  }
  const uniqueCount = new Set(cards.map((c) => `${c.suit}${c.rank}`)).size;
  if (uniqueCount !== 3) throw new IllegalAction('duplicate-cards', 'Cannot pass the same card twice');

  const passes = m.round.passes.slice() as (Card[] | null)[];
  passes[seat] = cards;
  const moveLog = [...m.moveLog, { type: 'pass' as const, seat, cards }];

  const allCommitted = passes.every((p) => p !== null);
  if (!allCommitted) {
    return { ...m, moveLog, round: { ...m.round, passes } };
  }

  // Apply the pass: everyone gives 3 cards to nextSeat (right), based on pre-pass hands.
  const hands = m.round.hands.map((h) => h.slice());
  for (let s = 0 as Seat; s < 4; s++) {
    const sent = passes[s]!;
    hands[s] = hands[s].filter((c) => !sent.some((sc) => cardEquals(sc, c)));
  }
  for (let s = 0 as Seat; s < 4; s++) {
    const sent = passes[s]!;
    const recipient = nextSeat(s);
    hands[recipient] = [...hands[recipient], ...sent];
  }

  return {
    ...m,
    moveLog,
    phase: 'playing',
    round: { ...m.round, hands, passes, passesApplied: true },
  };
}

export function legalPlays(m: MatchState, seat: Seat): Card[] {
  return legalPlaysFor(m.round.hands[seat], m.round.currentTrick, m.config);
}

function turnSeat(m: MatchState): Seat {
  const { leader, plays } = m.round.currentTrick;
  let s = leader;
  for (let i = 0; i < plays.length; i++) s = nextSeat(s);
  return s;
}

function trickWinner(trick: { leader: Seat; plays: { seat: Seat; card: Card }[] }): Seat {
  const led = trick.plays[0].card.suit;
  let winner = trick.plays[0];
  for (const p of trick.plays.slice(1)) {
    if (p.card.suit === led && p.card.rank > winner.card.rank) winner = p;
  }
  return winner.seat;
}

export function selectNextDealer(eatenPoints: [number, number, number, number], eatenCards: Card[][], prevDealer: Seat): Seat {
  const max = Math.max(...eatenPoints);
  const tied = ([0, 1, 2, 3] as Seat[]).filter((s) => eatenPoints[s] === max);
  if (tied.length === 1) return tied[0];

  const holdsK = (s: Seat) => eatenCards[s].some((c) => c.suit === 'C' && c.rank === 13);
  const holdsQ = (s: Seat) => eatenCards[s].some((c) => c.suit === 'S' && c.rank === 12);
  const holdsD = (s: Seat) => eatenCards[s].some((c) => c.suit === 'D' && c.rank === 10);

  const k = tied.find(holdsK);
  if (k !== undefined) return k;
  const q = tied.find(holdsQ);
  if (q !== undefined) return q;
  const d = tied.find(holdsD);
  if (d !== undefined) return d;

  let s = nextSeat(prevDealer);
  for (let i = 0; i < 4; i++) {
    if (tied.includes(s)) return s;
    s = nextSeat(s);
  }
  return tied[0];
}

export function computeMatchResult(
  scores: [number, number, number, number],
  target: number,
  partnership = true,
): MatchResult {
  const busted = ([0, 1, 2, 3] as Seat[]).filter((s) => scores[s] >= target);
  if (busted.length === 0) return { over: false };

  if (!partnership) {
    // Every seat for itself: the single highest-scoring busted player loses and
    // the other three win. A tie for the worst score can't name one loser, so --
    // mirroring the partnership cross-tie rule -- we play one more round as
    // sudden death rather than declaring a shared loss.
    const worst = Math.max(...busted.map((s) => scores[s]));
    const losers = busted.filter((s) => scores[s] === worst);
    if (losers.length !== 1) return { over: false };
    return { over: true, losingTeam: undefined, bustSeat: losers[0] };
  }

  const teamHighest = (team: 0 | 1): { score: number; seat?: Seat } => {
    let best = -Infinity;
    let bestSeat: Seat | undefined;
    for (const s of busted) {
      if (teamOf(s) === team && scores[s] > best) {
        best = scores[s];
        bestSeat = s;
      }
    }
    return { score: best, seat: bestSeat };
  };

  const h0 = teamHighest(0);
  const h1 = teamHighest(1);

  if (h0.seat === undefined) return { over: true, losingTeam: 1, bustSeat: h1.seat };
  if (h1.seat === undefined) return { over: true, losingTeam: 0, bustSeat: h0.seat };

  if (h0.score > h1.score) return { over: true, losingTeam: 0, bustSeat: h0.seat };
  if (h1.score > h0.score) return { over: true, losingTeam: 1, bustSeat: h1.seat };

  const t0total = scores[0] + scores[2];
  const t1total = scores[1] + scores[3];
  if (t0total > t1total) return { over: true, losingTeam: 0, bustSeat: h0.seat };
  if (t1total > t0total) return { over: true, losingTeam: 1, bustSeat: h1.seat };

  // Exact tie on highest individual score and on team totals: sudden death, play on.
  return { over: false };
}

export function playCard(m: MatchState, seat: Seat, card: Card): { state: MatchState; events: GameEvent[] } {
  if (m.phase !== 'playing') throw new IllegalAction('bad-phase', 'Not in the playing phase');
  if (turnSeat(m) !== seat) throw new IllegalAction('not-your-turn', 'It is not this seat\'s turn');
  const hand = m.round.hands[seat];
  if (!containsCard(hand, card)) throw new IllegalAction('not-in-hand', 'Cannot play a card you do not hold');
  const legal = legalPlaysFor(hand, m.round.currentTrick, m.config);
  if (!legal.some((c) => cardEquals(c, card))) {
    throw new IllegalAction('illegal-card', 'That card is not legal to play right now');
  }

  const forced = isForcedDump(hand, m.round.currentTrick, m.config, card);
  const newHand = removeCard(hand, card);
  const hands = m.round.hands.slice();
  hands[seat] = newHand;

  const plays = [...m.round.currentTrick.plays, { seat, card, forced }];
  const events: GameEvent[] = [{ type: 'played', seat, card, forced }];
  const moveLog = [...m.moveLog, { type: 'play' as const, seat, card }];

  if (plays.length < 4) {
    return {
      state: {
        ...m,
        moveLog,
        round: { ...m.round, hands, currentTrick: { ...m.round.currentTrick, plays } },
      },
      events,
    };
  }

  // Trick complete.
  const trick = { leader: m.round.currentTrick.leader, plays };
  const winner = trickWinner(trick);
  const points = plays.reduce((sum, p) => sum + cardPoints(p.card), 0);

  const eatenPoints = m.round.eatenPoints.slice() as [number, number, number, number];
  eatenPoints[winner] += points;
  const eatenCards = m.round.eatenCards.map((c) => c.slice());
  eatenCards[winner].push(...plays.map((p) => p.card));
  const playedCards = [...m.round.playedCards, plays];

  events.push({ type: 'trickEnd', winner, points, cards: plays });

  if (m.round.trickNumber < 13) {
    return {
      state: {
        ...m,
        moveLog,
        round: {
          ...m.round,
          hands,
          trickNumber: m.round.trickNumber + 1,
          currentTrick: { leader: winner, plays: [] },
          playedCards,
          eatenPoints,
          eatenCards,
        },
      },
      events,
    };
  }

  // Round complete: 13th trick just resolved.
  const totalEaten = eatenPoints.reduce((a, b) => a + b, 0);
  if (totalEaten !== 50) {
    throw new Error(`Invariant violated: round eaten points summed to ${totalEaten}, expected 50`);
  }

  const scores = m.scores.slice() as [number, number, number, number];
  for (let s = 0; s < 4; s++) scores[s] += eatenPoints[s];

  const result = computeMatchResult(scores, m.config.targetScore, m.config.partnership);
  const roundState: RoundState = {
    ...m.round,
    hands,
    playedCards,
    eatenPoints,
    eatenCards,
    currentTrick: { leader: winner, plays: [] },
  };

  if (result.over) {
    events.push({ type: 'gameOver', losingTeam: result.losingTeam ?? null, bustSeat: result.bustSeat!, totals: scores });
    return {
      state: { ...m, moveLog, scores, phase: 'gameOver', round: roundState, result },
      events,
    };
  }

  const nextDealer = m.config.dealerSelection === 'biggestEater' ? selectNextDealer(eatenPoints, eatenCards, m.dealer) : nextSeat(m.dealer);
  events.push({ type: 'roundEnd', eaten: eatenPoints, totals: scores, nextDealer });

  return {
    state: { ...m, moveLog, scores, phase: 'roundEnd', dealer: nextDealer, round: roundState },
    events,
  };
}

export function matchResult(m: MatchState): MatchResult {
  return m.result ?? { over: m.phase === 'gameOver' };
}

export function viewFor(m: MatchState, seat: Seat): SeatView {
  const isMyTurn = m.phase === 'playing' && turnSeat(m) === seat;
  return {
    seat,
    hand: m.round.hands[seat],
    phase: m.phase,
    dealer: m.dealer,
    roundIndex: m.roundIndex,
    trickNumber: m.round.trickNumber,
    currentTrick: m.round.currentTrick,
    playedCards: m.round.playedCards,
    eatenPoints: m.round.eatenPoints,
    eatenCards: m.round.eatenCards,
    scores: m.scores,
    youPassed: m.round.passes[seat],
    youReceived: m.round.passesApplied ? m.round.passes[prevSeat(seat)] : null,
    legal: isMyTurn ? legalPlays(m, seat) : null,
    config: m.config,
  };
}

