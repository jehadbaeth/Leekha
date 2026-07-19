import type { Card, Rank, Seat, Suit, SuitLayout, TrixSeatView } from '@leekha/trix';
import { pick } from '../settings';
import { CardFace } from '../components/CardFace';
import { SUIT_ORDER, SUIT_SYMBOL, suitColorClass, SEAT_NAMES } from './trixLabels';

// The Fan-Tan (Trex layout) tableau, modelled on how Trex apps actually draw it
// (see the reference the user supplied and pagat.com/compendium/trex.html): FOUR
// VERTICAL COLUMNS, one per suit. Each column is the placed run as an overlapping
// downward fan — highest card (up toward the ace) at the top, the JACK anchored
// in the middle, lowest card (down toward the 2) at the bottom. Buried cards show
// only their top rank strip; the bottom card is fully visible.

const CARD_W = 40;
const OVERLAP = 17; // vertical peek of each buried card

/** Placed ranks for a suit, highest first (top of the column) to lowest (bottom). */
function columnRanks(s: SuitLayout): Rank[] {
  if (s.up === null) return [];
  const out: Rank[] = [];
  for (let r = s.up; r >= (s.down !== null ? s.down : 11); r--) out.push(r as Rank);
  return out;
}

const PLACE_EN = ['1st', '2nd', '3rd', '4th'];
const PLACE_AR = ['الأول', 'الثاني', 'الثالث', 'الرابع'];

export function TrixLayoutCenter({
  view,
  onPass,
  language = 'en',
  names = SEAT_NAMES,
  fourColor = false,
}: {
  view: TrixSeatView;
  onPass: () => void;
  language?: 'en' | 'ar';
  names?: Record<Seat, string>;
  fourColor?: boolean;
}) {
  const t = (en: string, ar: string) => pick(language, en, ar);
  const PLACE = language === 'ar' ? PLACE_AR : PLACE_EN;
  const isMyTurn = view.turn === view.seat;
  const cardH = Math.round(CARD_W * 1.4);

  return (
    <div className="w-full flex flex-col items-center gap-2 px-2 max-h-full overflow-y-auto">
      {view.finished.length > 0 && (
        <div className="flex items-center justify-center gap-1.5 text-[10px] text-amber-200 flex-wrap">
          {view.finished.map((seat, i) => (
            <span key={seat} className="bg-emerald-950/70 rounded-full px-2 py-0.5">
              {PLACE[i] ?? `${i + 1}`} {names[seat]}
            </span>
          ))}
        </div>
      )}
      {/* dir=ltr keeps the suit columns in a stable order regardless of UI language. */}
      <div dir="ltr" className="flex items-start justify-center gap-2">
        {SUIT_ORDER.map((suit) => {
          const ranks = columnRanks(view.layout[suit]);
          const colH = ranks.length > 0 ? (ranks.length - 1) * OVERLAP + cardH : cardH;
          return (
            <div key={suit} className="flex flex-col items-center gap-1">
              <div className={`text-sm font-bold leading-none ${suitColorClass(suit)} bg-white rounded px-1`}>
                {SUIT_SYMBOL[suit]}
              </div>
              {ranks.length === 0 ? (
                <div
                  className="rounded-md border border-dashed border-emerald-600/60 flex items-center justify-center text-emerald-500/60 text-[9px] text-center px-0.5"
                  style={{ width: CARD_W, height: cardH }}
                >
                  {t('play J', 'العب الشايب')}
                </div>
              ) : (
                <div className="relative" style={{ width: CARD_W, height: colH }}>
                  {ranks.map((r, i) => {
                    const card: Card = { suit, rank: r };
                    const isJack = r === 11;
                    // Draw top→bottom; later (lower) cards sit on top so each shows its top strip.
                    return (
                      <div
                        key={r}
                        className={`absolute rounded ${isJack ? 'ring-2 ring-amber-400' : ''}`}
                        style={{ top: i * OVERLAP, zIndex: i }}
                      >
                        <CardFace card={card} width={CARD_W} fourColor={fourColor} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {isMyTurn && view.canPass && (
        <button
          onClick={onPass}
          className="self-center text-xs font-semibold bg-amber-400 text-emerald-950 rounded-full px-4 py-1.5 shadow active:scale-95"
        >
          {t('Pass (no legal card)', 'مرّر (لا ورقة صالحة)')}
        </button>
      )}
    </div>
  );
}
