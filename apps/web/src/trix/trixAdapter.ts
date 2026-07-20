import { defaultConfig, type Card as LeekhaCard, type SeatView } from '@leekha/engine';
import { isDiamond, isQueen, isKingOfHearts, type Contract, type Seat, type TrixSeatView } from '@leekha/trix';

// Maps a Trix SeatView into the SeatView shape Leekha's shared GameTable
// consumes, so Trix reuses the exact same avatars, hand fan, trick circle,
// emotes, and sounds. Trix-specific chrome (contract banner, layout board,
// contract picker, deal recap) rides on GameTable's seam overrides instead.
// A tuned config keeps Leekha-only markers (undercut, forced dump, danger)
// switched off, and the phase is pinned to 'playing' so the table stays in its
// in-game layout; Trix's own phase drives which seam overrides are supplied.

export function trixToSeatView(tv: TrixSeatView, playedCards: { seat: Seat; card: unknown }[][] = []): SeatView {
  // GameTable reads "whose turn" as (currentTrick.leader + plays.length) % 4.
  // In a trick contract the real trick already yields the right seat; in every
  // other Trix phase (layout/selecting/exposing) there is no trick, so encode
  // the acting seat as the leader with no plays, so the turn highlight and the
  // hand-fan interactivity land on the correct player.
  const currentTrick =
    tv.phase === 'trick'
      ? {
          leader: tv.currentTrick.leader,
          plays: tv.currentTrick.plays.map((p) => ({ seat: p.seat, card: p.card as unknown as LeekhaCard, forced: false })),
        }
      : { leader: (tv.turn ?? tv.kingdomOwner) as Seat, plays: [] };
  return {
    seat: tv.seat,
    hand: tv.hand as unknown as LeekhaCard[],
    phase: 'playing',
    dealer: tv.kingdomOwner,
    // GameTable keys its deal flourish + per-round UI reset on roundIndex. Use a
    // per-DEAL signal (kingdom + contracts already spent this kingdom), not the
    // raw kingdomIndex, which only changes once every ~5 deals.
    roundIndex: tv.kingdomIndex * 10 + tv.contractsSpent.length,
    trickNumber: Math.max(1, tv.trickNumber),
    currentTrick,
    // Completed tricks this deal, so GameTable's trick-freeze pause and
    // "last trick" review work (both read view.playedCards).
    playedCards: playedCards.map((trick) => trick.map((p) => ({ seat: p.seat, card: p.card as unknown as LeekhaCard, forced: false }))),
    eatenPoints: [0, 0, 0, 0],
    eatenCards: [[], [], [], []],
    // In partnership, each avatar shows the TEAM's cumulative score (both
    // partners share it), not the individual's — that's the score that matters.
    scores: tv.config.partnership
      ? ([0, 1, 2, 3].map((s) => tv.scores[(s % 2) as 0 | 1] + tv.scores[((s % 2) + 2) as 2 | 3]) as [number, number, number, number])
      : tv.scores,
    youPassed: null,
    youReceived: null,
    legal: (tv.legal as unknown as LeekhaCard[] | null) ?? null,
    config: { ...defaultConfig, targetScore: 999999, undercutRule: 'off', forcedLeekhaDiscard: false },
  };
}

/** Per-seat tally shown under each avatar (the count of penalty units captured this deal, or tricks won for Slaps). */
export function trixSeatTally(tv: TrixSeatView, seat: Seat): number {
  const contracts = tv.contracts;
  let n = 0;
  if (contracts.includes('slaps')) n += tv.tricksWon[seat];
  if (contracts.includes('diamonds')) n += tv.captured[seat].filter(isDiamond).length;
  if (contracts.includes('queens')) n += tv.captured[seat].filter(isQueen).length;
  if (contracts.includes('kingOfHearts')) n += tv.captured[seat].filter(isKingOfHearts).length;
  return n;
}

const CONTRACT_LABEL: Record<Contract, string> = {
  kingOfHearts: 'King of Hearts',
  diamonds: 'Diamonds',
  queens: 'Queens',
  slaps: 'Slaps',
  trix: 'Trix',
};

export function contractLabel(c: Contract): string {
  return CONTRACT_LABEL[c];
}
