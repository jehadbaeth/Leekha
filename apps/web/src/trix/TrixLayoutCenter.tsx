import type { Card, Rank, Seat, Suit, SuitLayout, TrixSeatView } from '@leekha/trix';
import { pick } from '../settings';
import { CardFace } from '../components/CardFace';
import { SUIT_ORDER, SUIT_SYMBOL, suitColorClass, SEAT_NAMES } from './trixLabels';

// The Fan-Tan (Trex layout) tableau: FOUR VERTICAL COLUMNS, one per suit. The
// HIGH side is shown in full (A / K / Q down to the Jack anchor at the top) since
// it is at most four cards. The LOW side is a long run (up to nine cards) so it is
// collapsed to just its FRONTIER — the single last-placed (lowest) card — with a
// gap marker for the implied run. This keeps every column at most five cards tall
// so the towers can never grow off-screen or cover the avatars.

const CARD_W = 40;
const OVERLAP = 17; // vertical peek of each buried card

interface Column {
  highs: Rank[]; // A..J, top to bottom (Jack last); [] if not opened
  low: Rank | null; // single frontier card below the jack, null if none/only-jack
  gap: boolean; // true when cards are skipped between the jack and the low frontier
}

function columnFor(s: SuitLayout): Column {
  if (s.up === null) return { highs: [], low: null, gap: false };
  const highs: Rank[] = [];
  for (let r = s.up; r >= 11; r--) highs.push(r as Rank); // A,K,Q,...,J
  const low = s.down !== null && s.down < 11 ? (s.down as Rank) : null;
  return { highs, low, gap: low !== null && low < 10 };
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
          const { highs, low, gap } = columnFor(view.layout[suit]);
          const bury = { marginTop: -(cardH - OVERLAP) }; // overlap the card above, leaving a rank strip
          return (
            <div key={suit} className="flex flex-col items-center gap-1">
              <div className={`text-sm font-bold leading-none ${suitColorClass(suit)} bg-white rounded px-1`}>
                {SUIT_SYMBOL[suit]}
              </div>
              {highs.length === 0 ? (
                <div
                  className="rounded-md border border-dashed border-emerald-600/60 flex items-center justify-center text-emerald-500/60 text-[9px] text-center px-0.5"
                  style={{ width: CARD_W, height: cardH }}
                >
                  {t('play J', 'العب الشايب')}
                </div>
              ) : (
                // A short flex column: high honors down to the jack overlap into a
                // strip; the single low frontier card (if any) sits below, after a
                // gap marker when ranks are skipped.
                <div className="flex flex-col items-center">
                  {highs.map((r, i) => {
                    const isJack = r === 11;
                    return (
                      <div key={r} className={`rounded ${isJack ? 'ring-2 ring-amber-400' : ''}`} style={i === 0 ? undefined : bury}>
                        <CardFace card={{ suit, rank: r }} width={CARD_W} fourColor={fourColor} />
                      </div>
                    );
                  })}
                  {low !== null &&
                    (gap ? (
                      <>
                        <div className="text-emerald-300/70 text-xs leading-none my-0.5">⋮</div>
                        <div className="rounded">
                          <CardFace card={{ suit, rank: low }} width={CARD_W} fourColor={fourColor} />
                        </div>
                      </>
                    ) : (
                      <div className="rounded" style={bury}>
                        <CardFace card={{ suit, rank: low }} width={CARD_W} fourColor={fourColor} />
                      </div>
                    ))}
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
