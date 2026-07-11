import { readFileSync } from 'node:fs';
import {
  newMatch,
  startRound,
  commitPass,
  playCard,
  viewFor,
  rngFromSeed,
  Card,
  LoggedAction,
  MatchState,
  RulesConfig,
  Seat,
} from '@leekha/engine';
import { chooseSearchPlay, perfectInfoBest } from '@leekha/bots';

interface BlunderReport {
  seed: string;
  config: RulesConfig;
  seat: Seat;
  trickNumber: number;
  chosen: string;
  best: string;
  gap: number;
  moveLog: LoggedAction[];
}

function cardStr(c: Card): string {
  return `${c.suit}${c.rank}`;
}

/**
 * Deals from the seed and replays the exact logged pass/play actions, dealing
 * each next round the same way newMatch/startRound already do. Since the deal
 * itself is a pure function of the seed and moveLog only records real
 * decisions (never RNG draws), this reconstructs the true, hidden hands at
 * the flagged position exactly, without needing the live bot RNG stream.
 */
function reconstruct(seed: string, config: RulesConfig, moveLog: LoggedAction[]): MatchState {
  let m: MatchState = newMatch(config, seed);
  for (const action of moveLog) {
    while (m.phase === 'roundEnd') m = startRound(m);
    if (action.type === 'pass') {
      m = commitPass(m, action.seat, action.cards);
    } else {
      m = playCard(m, action.seat, action.card).state;
    }
  }
  while (m.phase === 'roundEnd') m = startRound(m);
  return m;
}

function main() {
  const path = process.argv.slice(2).find((a) => a !== '--');
  const raw = path ? readFileSync(path, 'utf8') : readFileSync(0, 'utf8');
  const report: BlunderReport = JSON.parse(raw.trim().replace(/^\[BOT_BLUNDER\]\s*/, ''));

  const m = reconstruct(report.seed, report.config, report.moveLog);
  const view = viewFor(m, report.seat);

  console.log(`\nReconstructed position — seed=${report.seed} seat=${report.seat} trick=${report.trickNumber}`);
  console.log(`Hand: ${view.hand.map(cardStr).join(' ')}`);
  console.log(`Legal: ${(view.legal ?? []).map(cardStr).join(' ')}`);
  console.log(`Current trick: ${JSON.stringify(view.currentTrick)}`);
  console.log(`Scores going in: ${view.scores.join('/')}`);
  console.log(`Flagged: chose ${report.chosen}, oracle preferred ${report.best} (gap ${report.gap.toFixed(2)})`);

  const trueHands = ([0, 1, 2, 3] as Seat[]).map((s) => m.round.hands[s]);
  const oracle = perfectInfoBest(view, trueHands, { noise: 8, rng: rngFromSeed(`${report.seed}:replay-oracle`) });
  console.log('\nOracle score by candidate (true hands, single rollout each):');
  for (const [key, score] of [...oracle.scoreByCard.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key}: ${score.toFixed(2)}`);
  }

  const liveChoice = chooseSearchPlay(view, { rng: rngFromSeed(`${report.seed}:replay-live`), totalRollouts: 320 });
  console.log(`\nRe-running chooseSearchPlay now (fresh sampled worlds): ${cardStr(liveChoice)}`);
  console.log('');
}

main();
