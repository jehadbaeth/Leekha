import { readFileSync } from 'node:fs';
import {
  newMatch, startRound, commitPass, playCard, viewFor,
  Card, Seat, MatchState, RulesConfig, rngFromSeed,
} from '@leekha/engine';
import { choosePlay, perfectInfoBest } from '@leekha/bots';

const path = process.argv[2] ?? new URL('../../../latest.json', import.meta.url).pathname;
const raw = JSON.parse(readFileSync(path, 'utf8'));
const config = raw.config as RulesConfig;
const moveLog = raw.moveLog as any[];

function ck(c: Card) { return `${c.suit}${c.rank}`; }

function reconstructUntil(stopBeforeIdx: number): MatchState {
  let m: MatchState = newMatch(config, raw.seed);
  for (let i = 0; i < stopBeforeIdx; i++) {
    while (m.phase === 'roundEnd') m = startRound(m);
    const a = moveLog[i];
    if (a.type === 'pass') m = commitPass(m, a.seat, a.cards);
    else m = playCard(m, a.seat, a.card).state;
  }
  while (m.phase === 'roundEnd') m = startRound(m);
  return m;
}

const idxs = (process.argv.slice(3).map(Number).filter((n) => !Number.isNaN(n)));
const targets = idxs.length > 0 ? idxs : [71, 164, 182, 349, 409];
const opts = { noise: 0, rng: () => 0.5 };
const policy = { noise: 8, rng: rngFromSeed('audit'), endgameCounting: false };

for (const idx of targets) {
  const a = moveLog[idx];
  const m = reconstructUntil(idx);
  const view = viewFor(m, a.seat);
  const trueHands = ([0, 1, 2, 3] as Seat[]).map((s) => m.round.hands[s].slice());
  const partner = ((a.seat + 2) % 4) as Seat;
  console.log(`\n--- idx ${idx} r${view.roundIndex} t${view.trickNumber} seat${a.seat} played ${ck(a.card)}`);
  console.log(`scores ${view.scores.join('/')} me=${view.scores[a.seat]} partner=${view.scores[partner]}`);
  console.log(`hand ${view.hand.map(ck).join(' ')}`);
  console.log(`legal ${(view.legal ?? []).map(ck).join(' ')}`);
  console.log(`trick ${JSON.stringify(view.currentTrick.plays.map((p: any) => `${p.seat}:${ck(p.card)}`))}`);
  try {
    console.log(`heuristic ${ck(choosePlay(view, opts))}`);
  } catch (e: any) {
    console.log(`heuristic err ${e.message}`);
  }
  const oracle = perfectInfoBest(view, trueHands, policy);
  console.log(`oracle ${ck(oracle.best)}`);
  for (const [k, v] of [...oracle.scoreByCard.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6)) {
    console.log(`  ${k}: ${v.toFixed(2)}`);
  }
}
