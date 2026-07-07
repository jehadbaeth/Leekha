import {
  newMatch,
  startRound,
  commitPass,
  playCard,
  viewFor,
  defaultConfig,
  Seat,
  Card,
  isLeekha,
  teamOf,
  partnerOf,
  GameEvent,
} from '@leekha/engine';
import { makeHeuristicBot, Bot } from '@leekha/bots';

function parseArgs(argv: string[]): { matches: number } {
  const idx = argv.indexOf('--matches');
  const matches = idx >= 0 ? parseInt(argv[idx + 1], 10) : 200;
  return { matches: Number.isFinite(matches) && matches > 0 ? matches : 200 };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
  return { mean, p90: percentile(sorted, 90), min: sorted[0] ?? 0, max: sorted[sorted.length - 1] ?? 0 };
}

function randomSeed(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function runMatch(bots: Bot[]) {
  let m = startRound(newMatch(defaultConfig, randomSeed()));

  const metrics = {
    rounds: 0,
    forcedPlays: 0,
    forcedLandedOnPartner: 0,
    forcedTricks: 0,
    kingClubHolderAfterPassEatsIt: 0,
    kingClubEatenRounds: 0,
    selfEatenLeekha: 0,
    leekhaTricks: 0,
    dealerTeamsInOrder: [] as (0 | 1)[],
  };

  while (m.phase !== 'gameOver') {
    if (m.phase === 'roundEnd') m = startRound(m);
    metrics.rounds++;
    metrics.dealerTeamsInOrder.push(teamOf(m.dealer));

    for (const seat of [0, 1, 2, 3] as Seat[]) {
      const view = viewFor(m, seat);
      const pass = bots[seat].choosePass(view);
      m = commitPass(m, seat, pass);
    }

    const kingClubHolder = ([0, 1, 2, 3] as Seat[]).find((s) => m.round.hands[s].some((c) => c.suit === 'C' && c.rank === 13));

    let trickPlays: { seat: Seat; card: Card; forced: boolean }[] = [];
    let guard = 0;
    while (m.phase === 'playing' && guard < 200) {
      guard++;
      const seat = ([0, 1, 2, 3] as Seat[]).find((s) => viewFor(m, s).legal !== null)!;
      const view = viewFor(m, seat);
      const card = bots[seat].choosePlay(view);
      const { state, events } = playCard(m, seat, card);
      m = state;
      trickPlays.push({ seat, card, forced: (events.find((e) => e.type === 'played') as any)?.forced ?? false });

      const trickEnd = events.find((e) => e.type === 'trickEnd') as Extract<GameEvent, { type: 'trickEnd' }> | undefined;
      if (trickEnd) {
        const forcedInTrick = trickPlays.filter((p) => p.forced);
        metrics.forcedPlays += forcedInTrick.length;
        if (forcedInTrick.length > 0) {
          metrics.forcedTricks++;
          if (forcedInTrick.some((p) => partnerOf(p.seat) === trickEnd.winner)) metrics.forcedLandedOnPartner++;
        }
        const leekhaPlays = trickPlays.filter((p) => isLeekha(p.card));
        if (leekhaPlays.length > 0) {
          metrics.leekhaTricks++;
          const winnerPlay = trickPlays.find((p) => p.seat === trickEnd.winner)!;
          if (isLeekha(winnerPlay.card)) metrics.selfEatenLeekha++;
        }
        if (leekhaPlays.some((p) => p.card.suit === 'C' && p.card.rank === 13)) {
          metrics.kingClubEatenRounds++;
          if (kingClubHolder !== undefined && trickEnd.winner === kingClubHolder) metrics.kingClubHolderAfterPassEatsIt++;
        }
        trickPlays = [];
      }
    }
  }

  const maxDealerStreak = (() => {
    let longest = 1;
    let current = 1;
    for (let i = 1; i < metrics.dealerTeamsInOrder.length; i++) {
      if (metrics.dealerTeamsInOrder[i] === metrics.dealerTeamsInOrder[i - 1]) current++;
      else current = 1;
      longest = Math.max(longest, current);
    }
    return longest;
  })();

  return { m, metrics, maxDealerStreak };
}

function main() {
  const { matches } = parseArgs(process.argv.slice(2));
  // All four seats run the same policy so the win-rate-by-seat metric is a pure
  // symmetry check on the engine and dealing, not a measure of bot skill.
  const bots: Bot[] = [0, 1, 2, 3].map(() => makeHeuristicBot('medium'));

  const roundsPerMatch: number[] = [];
  const winsByTeam: [number, number] = [0, 0];
  const winsBySeat: [number, number, number, number] = [0, 0, 0, 0];
  let totalForced = 0;
  let totalRounds = 0;
  let forcedTricks = 0;
  let forcedLandedOnPartner = 0;
  let kingClubEatenRounds = 0;
  let kingClubHolderEatsIt = 0;
  let leekhaTricks = 0;
  let selfEatenLeekha = 0;
  const dealerStreaks: number[] = [];

  for (let i = 0; i < matches; i++) {
    const { m, metrics, maxDealerStreak } = runMatch(bots);
    roundsPerMatch.push(metrics.rounds);
    totalForced += metrics.forcedPlays;
    totalRounds += metrics.rounds;
    forcedTricks += metrics.forcedTricks;
    forcedLandedOnPartner += metrics.forcedLandedOnPartner;
    kingClubEatenRounds += metrics.kingClubEatenRounds;
    kingClubHolderEatsIt += metrics.kingClubHolderAfterPassEatsIt;
    leekhaTricks += metrics.leekhaTricks;
    selfEatenLeekha += metrics.selfEatenLeekha;
    dealerStreaks.push(maxDealerStreak);

    if (m.result?.over) {
      const losingTeam = m.result.losingTeam!;
      const winningTeam = losingTeam === 0 ? 1 : 0;
      winsByTeam[winningTeam]++;
      for (const s of [0, 1, 2, 3] as Seat[]) if (teamOf(s) === winningTeam) winsBySeat[s]++;
    }
  }

  const roundStats = stats(roundsPerMatch);
  const secondsPerMatch = (rounds: number) => rounds * 13 * (defaultConfig.timers.playMs / 1000 + 1.2) + rounds * 5;

  console.log(`\nLeekha (Idlib variant) self-play soak — ${matches} matches\n`);
  console.log('Rounds per match:');
  console.log(`  mean ${roundStats.mean.toFixed(1)}  p90 ${roundStats.p90}  min ${roundStats.min}  max ${roundStats.max}`);
  console.log('Estimated match length at realistic pacing (min):');
  console.log(`  mean ${(secondsPerMatch(roundStats.mean) / 60).toFixed(1)}  p90 ${(secondsPerMatch(roundStats.p90) / 60).toFixed(1)}`);
  console.log(`Forced dump frequency: ${(totalForced / totalRounds).toFixed(2)} per round`);
  console.log(
    `Forced dump lands on the dumper's partner's trick: ${((forcedLandedOnPartner / Math.max(1, forcedTricks)) * 100).toFixed(1)}% of forced tricks`,
  );
  console.log(
    `K♣ eaten by the post-pass holder vs. others: ${((kingClubHolderEatsIt / Math.max(1, kingClubEatenRounds)) * 100).toFixed(1)}% holder / ${(100 - (kingClubHolderEatsIt / Math.max(1, kingClubEatenRounds)) * 100).toFixed(1)}% others (n=${kingClubEatenRounds})`,
  );
  console.log(
    `Undercut forces a Leekha back onto the player who played it (self-eaten Leekha): ${((selfEatenLeekha / Math.max(1, leekhaTricks)) * 100).toFixed(1)}% of Leekha tricks`,
  );
  console.log('Win rate by seat (should be symmetric, ~25% each):');
  for (const s of [0, 1, 2, 3] as Seat[]) console.log(`  seat ${s}: ${((winsBySeat[s] / matches) * 100).toFixed(1)}%`);
  console.log('Win rate by team:');
  console.log(`  team 0 (seats 0,2): ${((winsByTeam[0] / matches) * 100).toFixed(1)}%`);
  console.log(`  team 1 (seats 1,3): ${((winsByTeam[1] / matches) * 100).toFixed(1)}%`);
  const dealerStreakStats = stats(dealerStreaks);
  console.log('Dealer streak lengths (consecutive rounds the same team deals):');
  console.log(`  mean ${dealerStreakStats.mean.toFixed(1)}  p90 ${dealerStreakStats.p90}  max ${dealerStreakStats.max}`);
  console.log('');
}

main();
