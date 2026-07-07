import type { Card, Seat } from '@leekha/engine';
import { leekhaBadge } from '../cardDisplay';

export function RoundSummary({
  names,
  eaten,
  totals,
  eatenCards,
  target,
  dealer,
  dealerReason,
  onContinue,
}: {
  names: Record<Seat, string>;
  eaten: [number, number, number, number];
  totals: [number, number, number, number];
  eatenCards: Card[][];
  target: number;
  dealer: Seat;
  dealerReason: string;
  onContinue: () => void;
}) {
  const seats: Seat[] = [0, 1, 2, 3];
  return (
    <div className="absolute inset-0 bg-black/70 flex items-center justify-center p-4 z-20">
      <div className="bg-emerald-950 border border-emerald-700 rounded-2xl p-5 w-full max-w-sm flex flex-col gap-4">
        <h2 className="text-xl font-bold text-white text-center">Round summary</h2>
        <div className="flex flex-col gap-2">
          {seats.map((s) => {
            const danger = totals[s] >= target - 30;
            const leekhas = eatenCards[s].map(leekhaBadge).filter(Boolean) as string[];
            return (
              <div key={s} className="flex items-center justify-between text-sm bg-emerald-900/60 rounded-lg px-3 py-2">
                <span className="text-emerald-100">{names[s]}</span>
                <span className="flex items-center gap-2">
                  <span className="text-amber-300">+{eaten[s]}</span>
                  {leekhas.map((l, i) => (
                    <span key={i} className="text-[10px] bg-amber-400 text-emerald-950 rounded px-1 font-bold">
                      {l}
                    </span>
                  ))}
                  <span className={`font-semibold ${danger ? 'text-red-400' : 'text-white'}`}>{totals[s]}</span>
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-emerald-200 text-center">{dealerReason}</p>
        <button className="rounded-lg bg-amber-400 text-emerald-950 font-semibold py-2.5" onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}
