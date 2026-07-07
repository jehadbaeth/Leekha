import type { Seat } from '@leekha/engine';

export function MatchEnd({
  names,
  totals,
  losingTeam,
  bustSeat,
  onRematch,
  onHome,
}: {
  names: Record<Seat, string>;
  totals: [number, number, number, number];
  losingTeam: 0 | 1;
  bustSeat: Seat;
  onRematch: () => void;
  onHome: () => void;
}) {
  const seats: Seat[] = [0, 1, 2, 3];
  const losers = seats.filter((s) => (s % 2 === 0 ? 0 : 1) === losingTeam);
  const winners = seats.filter((s) => (s % 2 === 0 ? 0 : 1) !== losingTeam);

  return (
    <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-4 z-30">
      <div className="bg-emerald-950 border border-emerald-700 rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4 text-center">
        <h2 className="text-2xl font-bold text-amber-300">Match over</h2>
        <p className="text-emerald-100 text-sm">
          {names[bustSeat]} busted at {totals[bustSeat]} points.
        </p>
        <p className="text-white font-semibold">
          {winners.map((s) => names[s]).join(' & ')} win. {losers.map((s) => names[s]).join(' & ')} lose.
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
          <button className="rounded-lg bg-amber-400 text-emerald-950 font-semibold px-4 py-2" onClick={onRematch}>
            Rematch
          </button>
          <button className="rounded-lg bg-emerald-800 text-white px-4 py-2" onClick={onHome}>
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
