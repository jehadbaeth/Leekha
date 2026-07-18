import type { Card, Rank, Seat, SuitLayout, TrixSeatView } from '@leekha/trix';
import { CardFace } from '../components/CardFace';
import { SEAT_NAMES, SUIT_ORDER, SUIT_SYMBOL, cardKey, rankLabel, suitColorClass } from './trixLabels';

const HUMAN_SEAT: Seat = 0;

const PLACE_LABEL = ['1st', '2nd', '3rd', '4th'];

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

function RunChip({ rank, suit }: { rank: Rank; suit: keyof typeof SUIT_SYMBOL }) {
  return (
    <div className={`w-8 h-10 rounded bg-white border border-black/10 flex flex-col items-center justify-center text-xs font-bold ${suitColorClass(suit)}`}>
      <span>{rankLabel(rank)}</span>
      <span className="text-[10px]">{SUIT_SYMBOL[suit]}</span>
    </div>
  );
}

export function TrixLayoutBoard({
  view,
  onPlay,
  onPass,
}: {
  view: TrixSeatView;
  onPlay: (card: Card) => void;
  onPass: () => void;
}) {
  const isMyTurn = view.turn === HUMAN_SEAT;
  const legalKeys = new Set((view.legal ?? []).map(cardKey));

  return (
    <div className="flex flex-col h-full w-full bg-gradient-to-b from-felt-900 to-felt-950">
      <div className="flex items-center justify-center gap-2 py-1.5 px-2 bg-emerald-950/60 text-emerald-100 text-xs font-semibold">
        <span>Trix (Fan-Tan)</span>
        <span className="text-emerald-300 font-normal">
          {view.hand.length} card{view.hand.length === 1 ? '' : 's'} left
        </span>
      </div>

      {/* Finish order badges */}
      {view.finished.length > 0 && (
        <div className="flex items-center justify-center gap-2 py-1 text-[11px] text-amber-200">
          {view.finished.map((seat, i) => (
            <span key={seat} className="bg-emerald-950/70 rounded-full px-2 py-0.5">
              {PLACE_LABEL[i] ?? `${i + 1}th`} {SEAT_NAMES[seat]}
            </span>
          ))}
        </div>
      )}

      {/* Four suit columns */}
      <div className="flex-1 grid grid-cols-2 gap-3 p-3 overflow-y-auto content-start">
        {SUIT_ORDER.map((suit) => {
          const { up, down } = runsFor(view.layout[suit]);
          return (
            <div key={suit} className="bg-emerald-950/40 rounded-lg p-2 flex flex-col items-center gap-1">
              <div className={`text-sm font-bold ${suitColorClass(suit)} bg-white rounded px-1.5`}>{SUIT_SYMBOL[suit]}</div>
              <div className="flex gap-0.5 flex-wrap justify-center min-h-[2.5rem]">
                {up.length === 0 ? (
                  <span className="text-emerald-400/60 text-[11px] self-center">not opened</span>
                ) : (
                  up.map((r) => <RunChip key={`up-${r}`} rank={r} suit={suit} />)
                )}
              </div>
              {down.length > 0 && (
                <div className="flex gap-0.5 flex-wrap justify-center border-t border-emerald-800 pt-1">
                  {down.map((r) => (
                    <RunChip key={`down-${r}`} rank={r} suit={suit} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Human hand + pass */}
      <div className="border-t border-emerald-950/60 bg-emerald-950/30 pt-2 pb-3 px-2">
        <div className="flex items-center justify-center gap-3 mb-1">
          <span className="text-[11px] text-emerald-200">
            {isMyTurn ? 'Your turn — tap a highlighted card' : `Waiting for ${SEAT_NAMES[view.turn ?? 0]}...`}
          </span>
          {isMyTurn && view.canPass && (
            <button
              onClick={onPass}
              className="text-xs font-semibold bg-amber-400 text-emerald-950 rounded-full px-3 py-1 shadow"
            >
              Pass
            </button>
          )}
        </div>
        <div className="flex overflow-x-auto -space-x-4 px-2 py-1 justify-center">
          {view.hand.map((card) => {
            const legal = !isMyTurn || legalKeys.size === 0 || legalKeys.has(cardKey(card));
            const canTap = isMyTurn && legalKeys.has(cardKey(card));
            return (
              <button
                key={cardKey(card)}
                disabled={!canTap}
                onClick={() => canTap && onPlay(card)}
                className={`flex-shrink-0 transition-transform ${canTap ? 'hover:-translate-y-2' : ''} ${
                  !legal ? 'grayscale-[65%] brightness-[0.72]' : ''
                }`}
              >
                <CardFace card={card} size="md" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
