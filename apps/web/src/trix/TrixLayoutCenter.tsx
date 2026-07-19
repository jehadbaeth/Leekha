import type { Rank, Suit, SuitLayout, TrixSeatView } from '@leekha/trix';
import { SUIT_ORDER, SUIT_SYMBOL, rankLabel, suitColorClass, SEAT_NAMES } from './trixLabels';

// The Fan-Tan layout, rendered into the shared GameTable's centre slot (where
// Leekha shows its trick circle). The player's hand and its tap-to-play come
// from GameTable's own hand fan; this only shows the four suit runs and the
// Pass control for when there is no legal play.

function runsFor(s: SuitLayout): { up: Rank[]; down: Rank[] } {
  const up: Rank[] = [];
  const down: Rank[] = [];
  if (s.up !== null) {
    up.push(11 as Rank);
    for (let r = 12; r <= s.up; r++) up.push(r as Rank);
  }
  if (s.down !== null && s.down < 11) {
    for (let r = 10; r >= s.down; r--) down.push(r as Rank);
  }
  return { up, down };
}

function Chip({ rank, suit }: { rank: Rank; suit: Suit }) {
  return (
    <div className={`w-6 h-8 rounded bg-white border border-black/10 flex flex-col items-center justify-center leading-none ${suitColorClass(suit)}`}>
      <span className="text-[11px] font-bold">{rankLabel(rank)}</span>
      <span className="text-[9px]">{SUIT_SYMBOL[suit]}</span>
    </div>
  );
}

const PLACE = ['1st', '2nd', '3rd', '4th'];

export function TrixLayoutCenter({ view, onPass }: { view: TrixSeatView; onPass: () => void }) {
  const isMyTurn = view.turn === view.seat;
  return (
    <div className="w-full flex flex-col items-center gap-2 px-2">
      {view.finished.length > 0 && (
        <div className="flex items-center justify-center gap-1.5 text-[10px] text-amber-200 flex-wrap">
          {view.finished.map((seat, i) => (
            <span key={seat} className="bg-emerald-950/70 rounded-full px-2 py-0.5">
              {PLACE[i] ?? `${i + 1}th`} {SEAT_NAMES[seat]}
            </span>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 w-full max-w-xs">
        {SUIT_ORDER.map((suit) => {
          const { up, down } = runsFor(view.layout[suit]);
          return (
            <div key={suit} className="bg-emerald-950/40 rounded-lg p-1.5 flex flex-col items-center gap-1">
              <div className={`text-xs font-bold ${suitColorClass(suit)} bg-white rounded px-1`}>{SUIT_SYMBOL[suit]}</div>
              <div className="flex gap-0.5 flex-wrap justify-center min-h-[2rem]">
                {up.length === 0 ? (
                  <span className="text-emerald-400/60 text-[10px] self-center">—</span>
                ) : (
                  up.map((r) => <Chip key={`u${r}`} rank={r} suit={suit} />)
                )}
              </div>
              {down.length > 0 && (
                <div className="flex gap-0.5 flex-wrap justify-center border-t border-emerald-800 pt-1">
                  {down.map((r) => (
                    <Chip key={`d${r}`} rank={r} suit={suit} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {isMyTurn && view.canPass && (
        <button onClick={onPass} className="text-xs font-semibold bg-amber-400 text-emerald-950 rounded-full px-4 py-1.5 shadow active:scale-95">
          Pass (no legal card)
        </button>
      )}
    </div>
  );
}
