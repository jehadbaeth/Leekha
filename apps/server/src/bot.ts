import { makeHeuristicBot, chooseSearchPlay, perfectInfoBest, type Bot } from '@leekha/bots';
import { rngFromSeed, type Card, type MatchState, type Seat, type SeatView } from '@leekha/engine';
import type { BotLevel } from './types.js';

// Tier 2 (SPEC.md Section 13.3) samples plausible worlds and rolls each out with
// the Tier 1 policy; it only covers the play phase, so "hard" reuses the medium
// heuristic for passing.
const SEARCH_ROLLOUT_BUDGET = 320;

export function botForLevel(level: BotLevel, rng: () => number = Math.random): Bot {
  if (level === 'hard' || level === 'insane') {
    // Insane cheats on information, not on play choice: its plays are decided
    // by chooseOraclePlay at the server call site, which has the true hands.
    // The Bot returned here is the fallback if it is ever driven without them
    // (and it supplies the pass, which is heuristic, NOT cheated -- a perfect
    // information pass would be a separate routine). Passing reuses medium.
    const passFallback = makeHeuristicBot('medium', rng);
    return {
      choosePass: (view) => passFallback.choosePass(view),
      choosePlay: (view) => chooseSearchPlay(view, { rng, totalRollouts: SEARCH_ROLLOUT_BUDGET }),
    };
  }
  return makeHeuristicBot(level, rng);
}

/**
 * Oracle ("cheating") play: picks the strongest legal card given the TRUE
 * hands of all four seats. Reuses perfectInfoBest with the exact policy the
 * duel harness and blunder auditor already trust as "perfect-info best"
 * (noise 8 / endgameCounting off), so insane play stays consistent with that
 * oracle. The information advantage is the whole strength; the play choice
 * itself obeys every rule (it only ever ranks view.legal). Server-only: the
 * true hands never reach a client, so this stays out of packages/bots.
 */
export function chooseOraclePlay(match: MatchState, seat: Seat, view: SeatView): Card {
  const trueHands = ([0, 1, 2, 3] as Seat[]).map((s) => match.round.hands[s]);
  const oracleRng = rngFromSeed(
    `${match.seed}:oracle:${match.roundIndex}:${seat}:${view.trickNumber}:${view.currentTrick.plays.length}`,
  );
  return perfectInfoBest(view, trueHands, { noise: 8, rng: oracleRng, endgameCounting: false }).best;
}

function cardKey(c: Card): string {
  return `${c.suit}${c.rank}`;
}

// Below this gap the disagreement is just normal sampled-world noise, not
// worth a log line; above it the sampled-world search chose something the
// true deal scores meaningfully worse than an alternative it also had legal.
const BLUNDER_GAP_THRESHOLD = 20;

/**
 * Passive audit for live games: replays the same true-hands oracle the
 * tools/sim duel harness uses, so a hard bot's actual in-game decision can be
 * flagged the same way a harness blunder is. Never changes what gets played
 * (call this after the real decision is made). Logs a self-contained JSON
 * line — seed + config + the move log up to (not including) this decision —
 * that `pnpm replay` can feed straight back into the engine to reconstruct
 * the exact position and re-run the search against it.
 */
export function logHardBotBlunderIfAny(match: MatchState, seat: Seat, view: SeatView, chosen: Card): void {
  if (!view.legal || view.legal.length <= 1) return;
  const trueHands = ([0, 1, 2, 3] as Seat[]).map((s) => match.round.hands[s]);
  const oracleRng = rngFromSeed(
    `${match.seed}:oracle:${match.roundIndex}:${seat}:${view.trickNumber}:${view.currentTrick.plays.length}`,
  );
  const oracle = perfectInfoBest(view, trueHands, { noise: 8, rng: oracleRng, endgameCounting: false });
  const chosenKey = cardKey(chosen);
  const bestKey = cardKey(oracle.best);
  if (chosenKey === bestKey) return;
  const gap = (oracle.scoreByCard.get(bestKey) ?? 0) - (oracle.scoreByCard.get(chosenKey) ?? 0);
  if (gap <= BLUNDER_GAP_THRESHOLD) return;
  console.log(
    `[BOT_BLUNDER] ${JSON.stringify({
      seed: match.seed,
      config: match.config,
      seat,
      trickNumber: view.trickNumber,
      chosen: chosenKey,
      best: bestKey,
      gap: Number(gap.toFixed(2)),
      moveLog: match.moveLog,
    })}`,
  );
}
