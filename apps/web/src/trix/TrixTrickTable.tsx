import type { Card, Seat, TrixSeatView } from '@leekha/trix';
import { CardFace } from '../components/CardFace';
import { CONTRACT_LABEL, SEAT_NAMES, cardKey } from './trixLabels';

const HUMAN_SEAT: Seat = 0;
const RIGHT_SEAT: Seat = 1;
const TOP_SEAT: Seat = 2;
const LEFT_SEAT: Seat = 3;

function posClasses(seat: Seat): string {
  if (seat === HUMAN_SEAT) return 'bottom-0 left-1/2 -translate-x-1/2';
  if (seat === RIGHT_SEAT) return 'right-0 top-1/2 -translate-y-1/2';
  if (seat === TOP_SEAT) return 'top-0 left-1/2 -translate-x-1/2';
  return 'left-0 top-1/2 -translate-y-1/2';
}

/** Penalty/tally badges relevant to the active contract(s), shown under each seat's avatar. */
function tallyFor(view: TrixSeatView, seat: Seat): string[] {
  const badges: string[] = [];
  const captured = view.captured[seat];
  if (view.contracts.includes('kingOfHearts')) {
    if (captured.some((c) => c.suit === 'H' && c.rank === 13)) badges.push('K♥');
  }
  if (view.contracts.includes('diamonds')) {
    const n = captured.filter((c) => c.suit === 'D').length;
    if (n > 0) badges.push(`♦×${n}`);
  }
  if (view.contracts.includes('queens')) {
    const n = captured.filter((c) => c.rank === 12).length;
    if (n > 0) badges.push(`Q×${n}`);
  }
  if (view.contracts.includes('slaps')) {
    badges.push(`${view.tricksWon[seat]} tricks`);
  }
  return badges;
}

function SeatBadge({ view, seat, compact = false }: { view: TrixSeatView; seat: Seat; compact?: boolean }) {
  const isTurn = view.turn === seat;
  const isOwner = view.kingdomOwner === seat;
  const badges = tallyFor(view, seat);
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        className={`flex items-center justify-center rounded-full border-2 bg-emerald-900/80 shadow-lg ${
          isTurn ? 'border-amber-300' : 'border-emerald-700'
        } ${compact ? 'w-10 h-10 text-xs' : 'w-12 h-12 text-sm'} font-semibold text-emerald-50`}
      >
        {SEAT_NAMES[seat].slice(0, 2)}
      </div>
      <span className="text-[11px] text-emerald-100 font-medium">
        {SEAT_NAMES[seat]}
        {isOwner ? ' 👑' : ''}
      </span>
      {badges.length > 0 && (
        <div className="flex gap-1 flex-wrap justify-center max-w-[80px]">
          {badges.map((b) => (
            <span key={b} className="text-[10px] bg-emerald-950/80 text-emerald-100 rounded px-1">
              {b}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function TrixTrickTable({ view, onPlay }: { view: TrixSeatView; onPlay: (card: Card) => void }) {
  const isMyTurn = view.turn === HUMAN_SEAT;
  const legalKeys = new Set((view.legal ?? []).map(cardKey));

  return (
    <div className="flex flex-col h-full w-full bg-gradient-to-b from-felt-900 to-felt-950">
      {/* Contract banner */}
      <div className="flex items-center justify-center gap-2 py-1.5 px-2 bg-emerald-950/60 text-emerald-100 text-xs font-semibold">
        <span>{view.contracts.map((c) => CONTRACT_LABEL[c]).join(' + ')}</span>
        <span className="text-emerald-300 font-normal">· trick {view.trickNumber}/13</span>
      </div>

      {/* Seats + trick circle */}
      <div className="flex-1 flex flex-col items-center justify-between py-3 px-2 min-h-0">
        <SeatBadge view={view} seat={TOP_SEAT} />
        <div dir="ltr" className="flex-1 flex items-center justify-between w-full max-w-md">
          <SeatBadge view={view} seat={LEFT_SEAT} />
          <div className="relative w-36 h-36 flex-shrink-0">
            <div className="absolute inset-2 rounded-full bg-emerald-700/40 shadow-[inset_0_4px_20px_rgba(0,0,0,0.4)] pointer-events-none" />
            {view.currentTrick.plays.map((p) => (
              <div key={p.seat} className={`absolute ${posClasses(p.seat)}`}>
                <CardFace card={p.card} size="sm" />
              </div>
            ))}
            {view.currentTrick.plays.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-emerald-700/50 text-xs">↺</div>
            )}
          </div>
          <SeatBadge view={view} seat={RIGHT_SEAT} />
        </div>
        <SeatBadge view={view} seat={HUMAN_SEAT} compact />
      </div>

      {/* Human hand */}
      <div className="border-t border-emerald-950/60 bg-emerald-950/30 pt-2 pb-3 px-2">
        <div className="text-center text-[11px] text-emerald-200 mb-1 h-4">
          {isMyTurn ? 'Your turn — tap a highlighted card' : `Waiting for ${SEAT_NAMES[view.turn ?? 0]}...`}
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
