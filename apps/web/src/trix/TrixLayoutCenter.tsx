import type { Rank, Seat, Suit, SuitLayout, TrixSeatView } from '@leekha/trix';
import { pick } from '../settings';
import { SUIT_ORDER, SUIT_SYMBOL, rankLabel, suitColorClass, SEAT_NAMES } from './trixLabels';

// The Fan-Tan (Trex layout) tableau, rendered into the shared GameTable's centre
// slot. Each suit is ONE continuous low->high run with the jack as the anchor:
// cards build down toward 2 on the left and up toward the ace on the right, the
// way the physical game lays out. The player's hand + tap-to-play come from
// GameTable's own hand fan; this only shows the board and the Pass control.

/** The full placed run for a suit, low (down toward 2) to high (up toward A), jack in the middle. */
function sequenceFor(s: SuitLayout): Rank[] {
  if (s.up === null) return []; // suit not opened yet (no jack down)
  const seq: Rank[] = [];
  if (s.down !== null && s.down < 11) {
    for (let r = s.down; r <= 10; r++) seq.push(r as Rank); // 2..10 side, ascending
  }
  for (let r = 11; r <= s.up; r++) seq.push(r as Rank); // J, Q, K, A side
  return seq;
}

function Chip({ rank, suit, anchor }: { rank: Rank; suit: Suit; anchor?: boolean }) {
  return (
    <div
      className={`shrink-0 w-6 h-8 rounded bg-white border flex flex-col items-center justify-center leading-none ${
        anchor ? 'border-amber-400 ring-1 ring-amber-300' : 'border-black/10'
      } ${suitColorClass(suit)}`}
    >
      <span className="text-[11px] font-bold">{rankLabel(rank)}</span>
      <span className="text-[9px]">{SUIT_SYMBOL[suit]}</span>
    </div>
  );
}

const PLACE_EN = ['1st', '2nd', '3rd', '4th'];
const PLACE_AR = ['الأول', 'الثاني', 'الثالث', 'الرابع'];

export function TrixLayoutCenter({
  view,
  onPass,
  language = 'en',
  names = SEAT_NAMES,
}: {
  view: TrixSeatView;
  onPass: () => void;
  language?: 'en' | 'ar';
  names?: Record<Seat, string>;
}) {
  const t = (en: string, ar: string) => pick(language, en, ar);
  const PLACE = language === 'ar' ? PLACE_AR : PLACE_EN;
  const isMyTurn = view.turn === view.seat;
  return (
    <div className="w-full max-w-sm flex flex-col items-stretch gap-1.5 px-2 max-h-full overflow-y-auto">
      {view.finished.length > 0 && (
        <div className="flex items-center justify-center gap-1.5 text-[10px] text-amber-200 flex-wrap">
          {view.finished.map((seat, i) => (
            <span key={seat} className="bg-emerald-950/70 rounded-full px-2 py-0.5">
              {PLACE[i] ?? `${i + 1}`} {names[seat]}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-1">
        {SUIT_ORDER.map((suit) => {
          const seq = sequenceFor(view.layout[suit]);
          return (
            <div key={suit} className="flex items-center gap-1.5">
              <div className={`shrink-0 w-6 text-center text-sm font-bold rounded bg-white ${suitColorClass(suit)}`}>
                {SUIT_SYMBOL[suit]}
              </div>
              <div className="flex-1 min-w-0 overflow-x-auto">
                {seq.length === 0 ? (
                  <span className="text-emerald-400/60 text-[10px] leading-8">
                    {t(`not opened — the ${SUIT_SYMBOL[suit]} jack opens it`, `مغلقة — يفتحها شايب ${SUIT_SYMBOL[suit]}`)}
                  </span>
                ) : (
                  <div className="flex gap-0.5 w-max">
                    {seq.map((r) => (
                      <Chip key={r} rank={r} suit={suit} anchor={r === 11} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {isMyTurn && view.canPass && (
        <button
          onClick={onPass}
          className="self-center mt-0.5 text-xs font-semibold bg-amber-400 text-emerald-950 rounded-full px-4 py-1.5 shadow active:scale-95"
        >
          {t('Pass (no legal card)', 'مرّر (لا ورقة صالحة)')}
        </button>
      )}
    </div>
  );
}
