import { readFileSync } from 'node:fs';
import {
  newMatch, startRound, commitPass, playCard, viewFor, legalPlaysFor,
  isLeekha, cardPoints, teamOf, nextSeat, Card, Seat, MatchState, RulesConfig,
} from '@leekha/engine';
import { choosePlay } from '@leekha/bots';
import { perfectInfoBest, chooseSearchPlay } from '@leekha/bots';
import { rngFromSeed } from '@leekha/engine';

const raw = JSON.parse(readFileSync(new URL('../../../match-SpA_0HVQcucXRGFg.json', import.meta.url), 'utf8'));
const config = raw.config as RulesConfig;
const seed = raw.seed as string;
const moveLog = raw.moveLog as any[];

function ck(c: Card) { return `${c.suit}${c.rank}`; }

function reconstructUntil(stopBeforeIdx: number): MatchState {
  let m: MatchState = newMatch(config, seed);
  for (let i = 0; i < stopBeforeIdx; i++) {
    while (m.phase === 'roundEnd') m = startRound(m);
    const a = moveLog[i];
    if (a.type === 'pass') m = commitPass(m, a.seat, a.cards);
    else m = playCard(m, a.seat, a.card).state;
  }
  while (m.phase === 'roundEnd') m = startRound(m);
  return m;
}

// Find interesting indices: lead leekha, or play leekha that eats itself while score > partner
const interesting: number[] = [];
let scores = [0,0,0,0];
let i = 0;
let round = 0;
while (i < moveLog.length) {
  while (i < moveLog.length && moveLog[i].type === 'pass') i++;
  if (i >= moveLog.length) break;
  round++;
  const start = i;
  const plays = [];
  while (i < moveLog.length && moveLog[i].type === 'play') { plays.push(moveLog[i]); i++; }
  for (let t = 0; t < 13; t++) {
    const trick = plays.slice(t*4, t*4+4);
    const led = trick[0].card.suit;
    let best = trick[0];
    for (const p of trick.slice(1)) if (p.card.suit === led && p.card.rank > best.card.rank) best = p;
    const pts = trick.reduce((s: number, p: any) => s + cardPoints(p.card), 0);
    for (let pos = 0; pos < 4; pos++) {
      const p = trick[pos];
      const absIdx = start + t*4 + pos;
      const partner = (p.seat + 2) % 4;
      if (isLeekha(p.card)) {
        const selfEat = best.seat === p.seat;
        const ahead = scores[p.seat] > scores[partner];
        if ((pos === 0) || (selfEat && ahead) || (selfEat && pts >= 10)) {
          interesting.push(absIdx);
        }
      }
    }
    scores[best.seat] += pts;
  }
}

console.log('Interesting move indices:', interesting.length);
const opts = { noise: 8, rng: rngFromSeed('audit'), endgameCounting: false };

for (const idx of interesting.slice(0, 25)) {
  const a = moveLog[idx];
  const m = reconstructUntil(idx);
  const view = viewFor(m, a.seat);
  const trueHands = ([0,1,2,3] as Seat[]).map(s => m.round.hands[s].slice());
  const legal = view.legal ?? [];
  const partner = ((a.seat + 2) % 4) as Seat;
  console.log('\n--- idx', idx, 'r', view.roundIndex, 't', view.trickNumber, 'seat', a.seat, 'played', ck(a.card));
  console.log('scores', view.scores.join('/'), 'partner', partner, 'my', view.scores[a.seat], 'p', view.scores[partner]);
  console.log('hand', view.hand.map(ck).join(' '));
  console.log('legal', legal.map(ck).join(' '));
  console.log('trick', JSON.stringify(view.currentTrick.plays.map((p: any) => `${p.seat}:${ck(p.card)}`)));
  const oracle = perfectInfoBest(view, trueHands, opts);
  console.log('oracle best', ck(oracle.best));
  const ranked = [...oracle.scoreByCard.entries()].sort((x,y)=>y[1]-x[1]).slice(0,6);
  for (const [k,v] of ranked) console.log(' ', k, v.toFixed(2));
  // heuristic choice
  try {
    const h = choosePlay(view, { noise: 0, rng: () => 0.5 });
    console.log('heuristic', ck(h));
  } catch (e: any) { console.log('heuristic err', e.message); }
}
