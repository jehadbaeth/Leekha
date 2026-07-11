import {
  Card,
  RulesConfig,
  Seat,
  SeatView,
  TrickPlay,
  TrickState,
  cardPoints,
  isLeekha,
  legalPlaysFor,
  isForcedDump,
  nextSeat,
  teamOf,
} from '@leekha/engine';
import { choosePlay as heuristicChoosePlay, HeuristicOptions } from './heuristic.js';
import { buildTracker } from './tracker.js';

const SEATS: Seat[] = [0, 1, 2, 3];

function cardKey(c: Card): string {
  return `${c.suit}${c.rank}`;
}

function handSizesFromView(view: SeatView): [number, number, number, number] {
  const played: [number, number, number, number] = [0, 0, 0, 0];
  for (const trick of view.playedCards) for (const p of trick) played[p.seat]++;
  for (const p of view.currentTrick.plays) played[p.seat]++;
  return played.map((n) => 13 - n) as [number, number, number, number];
}

/**
 * Sample one plausible assignment of the unseen cards to the three hidden hands,
 * respecting known-passed cards, proven voids and Leekha-absence proofs. Falls back
 * to a constraint-free constructive placement for any card that cannot legally land
 * anywhere late in the round, per SPEC.md Section 13.3 item 1.
 */
export function sampleWorld(view: SeatView, rng: () => number): Card[][] {
  const tracker = buildTracker(view);
  const handSizes = handSizesFromView(view);
  const hands: Card[][] = [[], [], [], []];
  hands[view.seat] = view.hand.slice();

  const need: [number, number, number, number] = [...handSizes] as [number, number, number, number];
  need[view.seat] = 0;

  let pool = tracker.unseen.slice();

  // Place cards this seat knows for certain (the 3 it passed right).
  for (const [key, seat] of tracker.knownHeldBy) {
    const idx = pool.findIndex((c) => cardKey(c) === key);
    if (idx === -1) continue;
    if (need[seat] <= 0) continue;
    hands[seat].push(pool[idx]);
    pool.splice(idx, 1);
    need[seat]--;
  }

  // Shuffle remaining pool (Fisher-Yates with the injected rng for determinism/testability).
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const leftover: Card[] = [];
  for (const card of pool) {
    const eligible = SEATS.filter((s) => {
      if (s === view.seat || need[s] <= 0) return false;
      if (tracker.voids.get(s)?.has(card.suit)) return false;
      if (isLeekha(card) && tracker.noLeekha.has(s)) return false;
      return true;
    });
    if (eligible.length === 0) {
      leftover.push(card);
      continue;
    }
    const seat = eligible[Math.floor(rng() * eligible.length)];
    hands[seat].push(card);
    need[seat]--;
  }

  // Constructive fallback: constraints could not be honored for these cards (typical
  // late in the round when hands are nearly full of proven voids); place them on any
  // seat with remaining capacity, ignoring soft constraints.
  for (const card of leftover) {
    const seat = SEATS.find((s) => s !== view.seat && need[s] > 0);
    if (seat === undefined) continue;
    hands[seat].push(card);
    need[seat]--;
  }

  return hands;
}

interface RolloutResult {
  eatenPoints: [number, number, number, number];
}

function simulateRound(
  hands: Card[][],
  startTrick: TrickState,
  startEaten: [number, number, number, number],
  cfg: RulesConfig,
  view: SeatView,
  firstMove: { seat: Seat; card: Card } | null,
  policyOpts: HeuristicOptions,
): RolloutResult {
  const localHands = hands.map((h) => h.slice());
  let trick: TrickState = { leader: startTrick.leader, plays: startTrick.plays.slice() };
  const eaten = startEaten.slice() as [number, number, number, number];
  const playedCards: TrickPlay[][] = view.playedCards.slice();
  let tricksCompleted = playedCards.length;

  const turnSeat = () => {
    let s = trick.leader;
    for (let i = 0; i < trick.plays.length; i++) s = nextSeat(s);
    return s;
  };

  let firstMoveTaken = false;
  let guard = 0;
  while (tricksCompleted < 13 && guard < 60) {
    guard++;
    const seat = turnSeat();
    let card: Card;
    if (firstMove && !firstMoveTaken && seat === firstMove.seat) {
      card = firstMove.card;
      firstMoveTaken = true;
    } else {
      const legal = legalPlaysFor(localHands[seat], trick, cfg);
      const synthetic: SeatView = {
        seat,
        hand: localHands[seat],
        phase: 'playing',
        dealer: view.dealer,
        roundIndex: view.roundIndex,
        trickNumber: tricksCompleted + 1,
        currentTrick: trick,
        playedCards,
        eatenPoints: eaten,
        eatenCards: [[], [], [], []],
        scores: view.scores,
        youPassed: null,
        youReceived: null,
        legal,
        config: cfg,
      };
      card = heuristicChoosePlay(synthetic, policyOpts);
    }

    const forced = isForcedDump(localHands[seat], trick, cfg, card);
    localHands[seat] = localHands[seat].filter((c) => cardKey(c) !== cardKey(card));
    trick = { leader: trick.leader, plays: [...trick.plays, { seat, card, forced }] };

    if (trick.plays.length === 4) {
      const led = trick.plays[0].card.suit;
      let winner = trick.plays[0];
      for (const p of trick.plays.slice(1)) if (p.card.suit === led && p.card.rank > winner.card.rank) winner = p;
      const points = trick.plays.reduce((sum, p) => sum + cardPoints(p.card), 0);
      eaten[winner.seat] += points;
      playedCards.push(trick.plays);
      tricksCompleted++;
      trick = { leader: winner.seat, plays: [] };
    }
  }

  return { eatenPoints: eaten };
}

function utility(view: SeatView, projectedScores: [number, number, number, number], roundEaten: [number, number, number, number]): number {
  const myTeam = teamOf(view.seat);
  const oppTeam = myTeam === 0 ? 1 : 0;
  const target = view.config.targetScore;

  const teamSeats = (team: 0 | 1) => SEATS.filter((s) => teamOf(s) === team);
  const bust = (team: 0 | 1) => (teamSeats(team).some((s) => projectedScores[s] >= target) ? 1 : 0);
  const maxScore = (team: 0 | 1) => Math.max(...teamSeats(team).map((s) => projectedScores[s]));
  const roundPts = (team: 0 | 1) => teamSeats(team).reduce((sum: number, s) => sum + roundEaten[s], 0);

  const usBust = bust(myTeam);
  const oppBust = bust(oppTeam);
  const usMaxScoreRisk = maxScore(myTeam);
  const oppMaxScoreRisk = maxScore(oppTeam);
  const usRoundPts = roundPts(myTeam);
  const oppRoundPts = roundPts(oppTeam);

  return 100 * (oppBust - usBust) + (oppMaxScoreRisk - usMaxScoreRisk) + 0.1 * (oppRoundPts - usRoundPts);
}

/**
 * Evaluation-harness oracle: what would this seat's own search utility say is
 * best if the three hidden hands were replaced with the true deal instead of
 * sampled worlds? Reuses the exact rollout/utility machinery chooseSearchPlay
 * uses, just against one fixed (true) world instead of many sampled ones, so
 * a mismatch between this and the seat's actual choice under uncertainty is a
 * real, comparable "blunder" rather than an artifact of a different scorer.
 */
export function perfectInfoBest(
  view: SeatView,
  trueHands: Card[][],
  policyOpts: HeuristicOptions,
): { best: Card; scoreByCard: Map<string, number> } {
  const legal = view.legal;
  if (!legal || legal.length === 0) throw new Error('perfectInfoBest called when it is not this seat\'s turn');

  const scoreByCard = new Map<string, number>();
  let best = legal[0];
  let bestScore = -Infinity;
  for (const candidate of legal) {
    const fullHands = trueHands.map((h) => h.slice());
    fullHands[view.seat] = view.hand;
    const { eatenPoints } = simulateRound(
      fullHands,
      view.currentTrick,
      view.eatenPoints,
      view.config,
      view,
      { seat: view.seat, card: candidate },
      policyOpts,
    );
    const projected = view.scores.map((s, i) => s + eatenPoints[i]) as [number, number, number, number];
    const score = utility(view, projected, eatenPoints);
    scoreByCard.set(cardKey(candidate), score);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return { best, scoreByCard };
}

export interface SearchOptions {
  rng: () => number;
  /** Total rollouts to spend across all candidate moves; divided evenly per candidate. */
  totalRollouts: number;
}

export function chooseSearchPlay(view: SeatView, opts: SearchOptions): Card {
  const legal = view.legal;
  if (!legal || legal.length === 0) throw new Error('chooseSearchPlay called when it is not this seat\'s turn');
  if (legal.length === 1) return legal[0];

  const worldsPerCandidate = Math.max(4, Math.floor(opts.totalRollouts / legal.length));
  const worlds: Card[][][] = [];
  for (let i = 0; i < worldsPerCandidate; i++) worlds.push(sampleWorld(view, opts.rng));

  const policyOpts: HeuristicOptions = { noise: 8, rng: opts.rng };

  let best = legal[0];
  let bestScore = -Infinity;
  for (const candidate of legal) {
    let total = 0;
    for (const hands of worlds) {
      const fullHands = hands.slice();
      fullHands[view.seat] = view.hand;
      const { eatenPoints } = simulateRound(
        fullHands,
        view.currentTrick,
        view.eatenPoints,
        view.config,
        view,
        { seat: view.seat, card: candidate },
        policyOpts,
      );
      const projected = view.scores.map((s, i) => s + eatenPoints[i]) as [number, number, number, number];
      total += utility(view, projected, eatenPoints);
    }
    const mean = total / worlds.length;
    if (mean > bestScore) {
      bestScore = mean;
      best = candidate;
    }
  }
  return best;
}
