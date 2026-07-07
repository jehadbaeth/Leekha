import type { Seat } from '@leekha/engine';

export function Avatar({
  name,
  score,
  isTurn,
  isDealer,
  danger,
  team,
  compact = false,
}: {
  name: string;
  score: number;
  isTurn: boolean;
  isDealer: boolean;
  danger: boolean;
  team: 0 | 1;
  seat?: Seat;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center gap-0.5 ${compact ? '' : ''}`}>
      <div
        className={`relative w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold border-2 ${
          team === 0 ? 'bg-sky-700 border-sky-400' : 'bg-rose-700 border-rose-400'
        } ${isTurn ? 'ring-2 ring-amber-300 ring-offset-2 ring-offset-felt-950 animate-pulse' : ''}`}
      >
        {name.slice(0, 1).toUpperCase()}
        {isDealer && (
          <span className="absolute -bottom-1 -right-1 text-[10px] bg-amber-400 text-emerald-950 rounded-full px-1 font-bold">
            D
          </span>
        )}
      </div>
      <span className="text-[11px] text-emerald-100 max-w-[64px] truncate">{name}</span>
      <span className={`text-xs font-semibold px-1.5 rounded ${danger ? 'bg-red-600 text-white' : 'text-amber-200'}`}>
        {score}
      </span>
    </div>
  );
}
