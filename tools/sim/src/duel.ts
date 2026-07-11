import {
  newMatch,
  startRound,
  commitPass,
  playCard,
  viewFor,
  defaultConfig,
  rngFromSeed,
  MatchState,
  Seat,
  Card,
  GameEvent,
} from '@leekha/engine';
import { makeHeuristicBot, chooseSearchPlay, perfectInfoBest, Bot, HeuristicOptions } from '@leekha/bots';

// Same shape as apps/server/src/bot.ts's botForLevel: kept independent so
// tools-sim doesn't need to depend on apps/server, but must be kept in sync
// with it by hand if that file's rollout budget or fallback policy changes.
type Level = 'easy' | 'medium' | 'hard';
const SEARCH_ROLLOUT_BUDGET = 320;

function botForLevel(level: Level, rng: () => number): Bot {
  if (level === 'hard') {
    const passFallback = makeHeuristicBot('medium', rng);
    return {
      choosePass: (view) => passFallback.choosePass(view),
      choosePlay: (view) => chooseSearchPlay(view, { rng, totalRollouts: SEARCH_ROLLOUT_BUDGET }),
    };
  }
  return makeHeuristicBot(level, rng);
}

function cardKey(c: Card): string {
  return `${c.suit}${c.rank}`;
}

interface Blunder {
  seed: string;
  seat: Seat;
  trickNumber: number;
  chosen: string;
  best: string;
  gap: number;
}

interface RoundOutcome {
  eaten: [number, number, number, number];
  losingTeam: (0 | 1) | null;
}

/**
 * Plays exactly one dealt round to completion with a fixed level-per-seat
 * assignment. Given the same seed, the deal and dealer are always identical
 * (engine.ts derives both purely from the seed string), so calling this twice
 * with the seats' levels swapped is a genuine duplicate-deal comparison: both
 * policies get to play the exact same 52 cards from the exact same seats,
 * just once each, which cancels the luck of the deal instead of averaging
 * over it.
 */
function playOneRound(
  seed: string,
  startScores: [number, number, number, number],
  levelBySeat: [Level, Level, Level, Level],
  blunders: Blunder[] | null,
): RoundOutcome {
  const botRng = rngFromSeed(`${seed}:bots`);
  const bots = levelBySeat.map((lvl) => botForLevel(lvl, botRng)) as [Bot, Bot, Bot, Bot];

  let m: MatchState = newMatch(defaultConfig, seed);
  m = { ...m, scores: startScores };
  m = startRound(m);

  for (const seat of [0, 1, 2, 3] as Seat[]) {
    const view = viewFor(m, seat);
    const pass = bots[seat].choosePass(view);
    m = commitPass(m, seat, pass);
  }

  let lastEvents: GameEvent[] = [];
  let guard = 0;
  while ((m.phase === 'playing' || m.phase === 'passing') && guard < 260) {
    guard++;
    const seat = ([0, 1, 2, 3] as Seat[]).find((s) => viewFor(m, s).legal !== null);
    if (seat === undefined) break;
    const view = viewFor(m, seat);

    // The real decision is always made first, from the shared bot RNG stream,
    // so an oracle check never perturbs actual gameplay: --blunders must be a
    // passive audit, not something that changes which cards get played.
    const card: Card = bots[seat].choosePlay(view);
    if (blunders && levelBySeat[seat] === 'hard' && view.legal && view.legal.length > 1) {
      const trueHands: Card[][] = ([0, 1, 2, 3] as Seat[]).map((s) => m.round.hands[s]);
      // Independent RNG so the oracle's own rollout noise can't draw from (and
      // thus perturb) the stream the real bots are playing from.
      const oracleRng = rngFromSeed(`${seed}:oracle:${seat}:${view.trickNumber}:${view.currentTrick.plays.length}`);
      const policyOpts: HeuristicOptions = { noise: 8, rng: oracleRng };
      const oracle = perfectInfoBest(view, trueHands, policyOpts);
      const chosenKey = cardKey(card);
      const bestKey = cardKey(oracle.best);
      if (chosenKey !== bestKey) {
        const gap = (oracle.scoreByCard.get(bestKey) ?? 0) - (oracle.scoreByCard.get(chosenKey) ?? 0);
        if (gap > 0.01) {
          blunders.push({ seed, seat, trickNumber: view.trickNumber, chosen: chosenKey, best: bestKey, gap });
        }
      }
    }

    const { state, events } = playCard(m, seat, card);
    m = state;
    lastEvents = events;
  }

  const roundEnd = lastEvents.find((e): e is Extract<GameEvent, { type: 'roundEnd' }> => e.type === 'roundEnd');
  const gameOver = lastEvents.find((e): e is Extract<GameEvent, { type: 'gameOver' }> => e.type === 'gameOver');

  if (roundEnd) return { eaten: roundEnd.eaten, losingTeam: null };
  if (gameOver) {
    const eaten = gameOver.totals.map((t, i) => t - startScores[i]) as [number, number, number, number];
    return { eaten, losingTeam: gameOver.losingTeam };
  }
  throw new Error(`round ${seed} did not reach roundEnd or gameOver (guard hit)`);
}

interface DuelStats {
  seedsRun: number;
  pointAdvantageForA: number; // summed over all seeds; positive = A concedes fewer points than B
  aWinsOnBust: number;
  bWinsOnBust: number;
  noBust: number;
}

function runDuel(seeds: string[], levelA: Level, levelB: Level, startScores: [number, number, number, number], blunders: Blunder[] | null): DuelStats {
  const stats: DuelStats = { seedsRun: 0, pointAdvantageForA: 0, aWinsOnBust: 0, bWinsOnBust: 0, noBust: 0 };

  for (const seed of seeds) {
    // Trial 1: seats {0,2} = A, seats {1,3} = B.
    const r1 = playOneRound(seed, startScores, [levelA, levelB, levelA, levelB], blunders);
    // Trial 2: same seed (same deal, same dealer), levels swapped across seats.
    const r2 = playOneRound(seed, startScores, [levelB, levelA, levelB, levelA], blunders);

    const aEaten1 = r1.eaten[0] + r1.eaten[2];
    const bEaten1 = r1.eaten[1] + r1.eaten[3];
    const aEaten2 = r2.eaten[1] + r2.eaten[3];
    const bEaten2 = r2.eaten[0] + r2.eaten[2];

    // Fewer eaten points is better in a trick-avoidance game, so A's advantage
    // is how many more points B ate than A did, summed across both sittings.
    stats.pointAdvantageForA += (bEaten1 - aEaten1) + (bEaten2 - aEaten2);

    if (r1.losingTeam !== null) {
      if (r1.losingTeam === 0) stats.bWinsOnBust++;
      else stats.aWinsOnBust++;
    } else {
      stats.noBust++;
    }
    if (r2.losingTeam !== null) {
      if (r2.losingTeam === 0) stats.aWinsOnBust++;
      else stats.bWinsOnBust++;
    } else {
      stats.noBust++;
    }

    stats.seedsRun++;
  }

  return stats;
}

function parseArgs(argv: string[]) {
  const get = (flag: string, fallback: string) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : fallback;
  };
  return {
    deals: parseInt(get('--deals', '300'), 10),
    a: get('--a', 'hard') as Level,
    b: get('--b', 'medium') as Level,
    seedPrefix: get('--seed-prefix', 'duel'),
    blunders: argv.includes('--blunders'),
  };
}

function report(label: string, startScores: [number, number, number, number], stats: DuelStats, levelA: Level, levelB: Level) {
  const target = defaultConfig.targetScore;
  console.log(`\n--- ${label} (starting scores ${startScores.join('/')}, target ${target}) ---`);
  console.log(`Duplicate deals played: ${stats.seedsRun} (each dealt twice, sides swapped)`);
  console.log(
    `Net points conceded advantage for ${levelA}: ${stats.pointAdvantageForA.toFixed(1)} ` +
      `(${(stats.pointAdvantageForA / stats.seedsRun).toFixed(2)} per duplicate pair; positive = ${levelA} eats fewer points than ${levelB})`,
  );
  const bustPairs = stats.aWinsOnBust + stats.bWinsOnBust;
  console.log(
    `Rounds that ended the match on the spot: ${bustPairs} of ${stats.seedsRun * 2} sittings ` +
      `(${levelA} on the winning side ${stats.aWinsOnBust}, ${levelB} on the winning side ${stats.bWinsOnBust}, no bust ${stats.noBust})`,
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const seeds = Array.from({ length: args.deals }, (_, i) => `${args.seedPrefix}${i}`);
  const target = defaultConfig.targetScore;

  console.log(`\nLeekha bot duel — ${args.a} vs ${args.b}, ${args.deals} duplicate deals\n`);

  const blunders: Blunder[] | null = args.blunders ? [] : null;

  const neutral = runDuel(seeds, args.a, args.b, [0, 0, 0, 0], blunders);
  report('Neutral (fresh match, nobody in danger)', [0, 0, 0, 0], neutral, args.a, args.b);

  // One side already close to busting, the other safe: tests whether either
  // policy actually plays differently when the danger is real, since that is
  // exactly the situation SPEC.md says "the bots must model" and the current
  // search utility's bust term is a hard cliff rather than a graded signal.
  const dangerScores: [number, number, number, number] = [
    target - 20,
    Math.round(target * 0.35),
    target - 20,
    Math.round(target * 0.35),
  ];
  const danger = runDuel(seeds, args.a, args.b, dangerScores, blunders);
  report('Danger zone (seats 0,2 close to busting)', dangerScores, danger, args.a, args.b);

  if (blunders) {
    blunders.sort((x, y) => y.gap - x.gap);
    console.log(`\n--- Blunder log (hard-bot decisions where the true deal disagreed with the sampled-world choice) ---`);
    console.log(`Total flagged: ${blunders.length} across ${seeds.length * 4} sittings (neutral + danger scenarios)`);
    for (const b of blunders.slice(0, 15)) {
      console.log(
        `  seed=${b.seed} seat=${b.seat} trick=${b.trickNumber} chose ${b.chosen} but ${b.best} scored ${b.gap.toFixed(2)} higher with all hands revealed`,
      );
    }
  }
  console.log('');
}

main();
