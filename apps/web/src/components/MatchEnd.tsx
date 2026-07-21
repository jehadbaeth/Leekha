import { useMemo } from 'react';
import type { Seat } from '@leekha/engine';
import { pick, type Settings } from '../settings';

const CONFETTI_COLORS = ['#fbbf24', '#f87171', '#34d399', '#60a5fa', '#c084fc', '#f472b6'];

/**
 * Deterministic-enough confetti: each piece's horizontal position, color,
 * size, and timing come from its own index rather than Math.random(), so the
 * burst doesn't reshuffle on unrelated re-renders (e.g. a vote count ticking
 * up) while still looking scattered.
 */
function Confetti({ count = 28 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const left = (i * 137.5) % 100; // golden-angle spread across the width
        const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        const size = 6 + ((i * 7) % 10);
        const duration = 2.2 + ((i * 13) % 16) / 10;
        const delay = ((i * 29) % 12) / 10;
        const rounded = i % 3 === 0;
        return { left, color, size, duration, delay, rounded, key: i };
      }),
    [count],
  );
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.key}
          className={`absolute top-0 animate-confetti-fall ${p.rounded ? 'rounded-full' : 'rounded-sm'}`}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * (p.rounded ? 1 : 1.6),
            backgroundColor: p.color,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

export function MatchEnd({
  names,
  totals,
  losingTeam,
  bustSeat,
  language,
  mySeat,
  rematchVotes,
  hideRematch,
  onRematch,
  onHome,
}: {
  names: Record<Seat, string>;
  totals: [number, number, number, number];
  /** null in an individual (non-partnership) game, where bustSeat is the sole loser. */
  losingTeam: 0 | 1 | null;
  bustSeat: Seat;
  language: Settings['language'];
  mySeat: Seat;
  /** Online only: vote progress toward a rematch (see GameTable.tsx). Absent for local play, where a rematch is a single unilateral click. */
  rematchVotes?: { seatsVoted: Seat[]; seatsNeeded: Seat[] } | null;
  /** Observers hold no seat to vote from (their mySeat here is a fixed synthetic 0), so the rematch button would be meaningless. */
  hideRematch?: boolean;
  onRematch: () => void;
  onHome: () => void;
}) {
  const t = (en: string, ar: string) => pick(language, en, ar);
  const seats: Seat[] = [0, 1, 2, 3];
  // Individual game (losingTeam null): the single busted seat loses and the
  // other three win. Partnership: the whole losing team loses.
  const losers = losingTeam === null ? [bustSeat] : seats.filter((s) => (s % 2 === 0 ? 0 : 1) === losingTeam);
  const winners = seats.filter((s) => !losers.includes(s));

  const isOnline = rematchVotes != null;
  const iVoted = isOnline && rematchVotes.seatsVoted.includes(mySeat);
  const voteCount = isOnline ? `${rematchVotes.seatsVoted.length}/${rematchVotes.seatsNeeded.length}` : null;

  return (
    <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-4 z-30">
      <div className="relative bg-emerald-950 border border-emerald-700 rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4 text-center overflow-hidden">
        <Confetti />
        <div className="relative z-10 flex flex-col gap-4">
          <div>
            <p className="text-4xl leading-none">🏆</p>
            <h2 className="text-2xl font-bold text-amber-300 mt-1">
              {t(`${winners.map((s) => names[s]).join(' & ')} win!`, `${winners.map((s) => names[s]).join(' و ')} يفوزان!`)}
            </h2>
          </div>
          <p className="text-emerald-100 text-sm">
            {t(
              `${names[bustSeat]} busted at ${totals[bustSeat]} points. ${losers.map((s) => names[s]).join(' & ')} ${losers.length > 1 ? 'lose' : 'loses'}.`,
              `${names[bustSeat]} تجاوز الحد عند ${totals[bustSeat]} نقطة. ${losers.map((s) => names[s]).join(' و ')} ${losers.length > 1 ? 'يخسران' : 'يخسر'}.`,
            )}
          </p>

          <div className="flex flex-col gap-1 text-sm bg-emerald-900/60 rounded-lg p-3">
            {seats.map((s) => (
              <div key={s} className="flex justify-between">
                <span>{names[s]}</span>
                <span>{totals[s]}</span>
              </div>
            ))}
          </div>

          <div className="flex gap-3 justify-center mt-2">
            {!hideRematch && (
              <button
                className="rounded-lg bg-amber-400 disabled:opacity-60 text-emerald-950 font-semibold px-4 py-2"
                onClick={onRematch}
                disabled={iVoted}
              >
                {isOnline
                  ? iVoted
                    ? t(`Waiting for others… (${voteCount})`, `بانتظار الآخرين… (${voteCount})`)
                    : t(`Play again (${voteCount})`, `العب مرة أخرى (${voteCount})`)
                  : t('Rematch', 'إعادة المباراة')}
              </button>
            )}
            <button className="rounded-lg bg-emerald-800 text-white px-4 py-2" onClick={onHome}>
              {t('Back to Home', 'العودة للرئيسية')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
