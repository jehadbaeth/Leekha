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
  GameEvent,
} from '@leekha/engine';
import { makeHeuristicBot, Bot } from '@leekha/bots';
import { frozenChoosePlay } from './abtest-frozen-heuristic.js';

/**
 * A/B duel: the CURRENT heuristic play policy (side A) versus the FROZEN
 * pre-rework policy (side B), on duplicate deals (same seed dealt twice with
 * the sides swapped across seats), exactly like duel.ts. Both sides share
 * the live choosePass, so the score isolates the play-policy change.
 *
 *   pnpm --filter tools-sim exec tsx src/abtest.ts --deals 400
 */

function botPair(rng: () => number): { current: Bot; frozen: Bot } {
  const current = makeHeuristicBot('medium', rng);
  return {
    current,
    frozen: {
      choosePass: (view) => current.choosePass(view),
      choosePlay: (view) => frozenChoosePlay(view),
    },
  };
}

function playOneRound(seed: string, currentSeats: Set<Seat>): [number, number, number, number] {
  const botRng = rngFromSeed(`${seed}:bots`);
  const { current, frozen } = botPair(botRng);
  const botFor = (s: Seat) => (currentSeats.has(s) ? current : frozen);

  let m: MatchState = newMatch(defaultConfig, seed);
  m = startRound(m);
  for (const seat of [0, 1, 2, 3] as Seat[]) {
    m = commitPass(m, seat, botFor(seat).choosePass(viewFor(m, seat)));
  }
  let lastEvents: GameEvent[] = [];
  let guard = 0;
  while (m.phase === 'playing' && guard < 260) {
    guard++;
    const seat = ([0, 1, 2, 3] as Seat[]).find((s) => viewFor(m, s).legal !== null);
    if (seat === undefined) break;
    const { state, events } = playCard(m, seat, botFor(seat).choosePlay(viewFor(m, seat)));
    m = state;
    lastEvents = events;
  }
  const roundEnd = lastEvents.find((e): e is Extract<GameEvent, { type: 'roundEnd' }> => e.type === 'roundEnd');
  const gameOver = lastEvents.find((e): e is Extract<GameEvent, { type: 'gameOver' }> => e.type === 'gameOver');
  const eaten = roundEnd?.eaten ?? (gameOver ? (gameOver.totals as [number, number, number, number]) : null);
  if (!eaten) throw new Error(`round ${seed} did not finish`);
  return eaten;
}

function main() {
  const idx = process.argv.indexOf('--deals');
  const deals = idx >= 0 ? parseInt(process.argv[idx + 1], 10) : 300;
  let advantage = 0; // positive = current policy eats fewer points than frozen
  let currentBetter = 0;
  let frozenBetter = 0;
  for (let i = 0; i < deals; i++) {
    const seed = `abtest${i}`;
    const r1 = playOneRound(seed, new Set<Seat>([0, 2]));
    const r2 = playOneRound(seed, new Set<Seat>([1, 3]));
    const pairAdv = (r1[1] + r1[3] - (r1[0] + r1[2])) + (r2[0] + r2[2] - (r2[1] + r2[3]));
    advantage += pairAdv;
    if (pairAdv > 0) currentBetter++;
    else if (pairAdv < 0) frozenBetter++;
  }
  console.log(`Duplicate deals: ${deals}`);
  console.log(`Net point advantage for CURRENT policy: ${advantage} (${(advantage / deals).toFixed(2)} per duplicate pair)`);
  console.log(`Pairs won on points: current ${currentBetter}, frozen ${frozenBetter}, even ${deals - currentBetter - frozenBetter}`);
}

main();
