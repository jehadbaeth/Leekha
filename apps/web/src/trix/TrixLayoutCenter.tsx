import { useLayoutEffect, useRef, useState } from 'react';
import type { Card, Rank, Seat, Suit, SuitLayout, TrixSeatView } from '@leekha/trix';
import { pick } from '../settings';
import { CardFace } from '../components/CardFace';
import { SUIT_ORDER, SUIT_SYMBOL, suitColorClass, SEAT_NAMES } from './trixLabels';

// The Fan-Tan (Trex layout) tableau: FOUR VERTICAL COLUMNS, one per suit.
// Per the user's rule, each column shows only the cards that matter, not the
// whole run: the HIGH honors that have been played (Q, then K, then A) stacked,
// and the single LAST (lowest) card played on the low side. The opening Jack is
// only shown while it is the sole card (so you can tell the column is open);
// once anything is played on either side it's dropped. No gap "⋮" marker.

// The board is four suit columns. Rather than a fixed tiny card (which left the
// tableau marooned in a sea of empty felt), the card width scales to fill the
// available width: four columns + gaps span most of the center, so the board —
// the important thing in Trex — is actually prominent. Clamped so it neither
// overflows a ~320px phone nor grows absurd on a wide shell.
const COLS = 4;
const COL_GAP = 4; // gap-1 between columns
const MIN_CARD_W = 34;
const MAX_CARD_W = 60;
function cardWidthFor(containerW: number): number {
  if (!containerW) return MIN_CARD_W;
  const usable = containerW - 16 - (COLS - 1) * COL_GAP; // px-2 padding + inter-column gaps
  return Math.max(MIN_CARD_W, Math.min(MAX_CARD_W, Math.floor(usable / COLS)));
}
const OVERLAP_RATIO = 0.44; // vertical peek of each buried card, as a fraction of card width

interface Column {
  opened: boolean; // the jack has been laid (column is in play)
  cards: Rank[]; // what to actually render, top to bottom: A/K/Q played, then the single lowest played card
}

function columnFor(s: SuitLayout): Column {
  if (s.up === null) return { opened: false, cards: [] };
  const highs: Rank[] = [];
  for (let r = s.up; r >= 12; r--) highs.push(r as Rank); // A, K, Q that are down (NOT the jack)
  const low = s.down !== null && s.down < 11 ? (s.down as Rank) : null; // lowest played card, 2..10
  // Only the jack so far: show it alone so the open column reads as open.
  if (highs.length === 0 && low === null) return { opened: true, cards: [11 as Rank] };
  return { opened: true, cards: low !== null ? [...highs, low] : highs };
}

const PLACE_EN = ['1st', '2nd', '3rd', '4th'];
const PLACE_AR = ['الأول', 'الثاني', 'الثالث', 'الرابع'];

export function TrixLayoutCenter({
  view,
  language = 'en',
  names = SEAT_NAMES,
  fourColor = false,
}: {
  view: TrixSeatView;
  language?: 'en' | 'ar';
  names?: Record<Seat, string>;
  fourColor?: boolean;
}) {
  const t = (en: string, ar: string) => pick(language, en, ar);
  const PLACE = language === 'ar' ? PLACE_AR : PLACE_EN;

  const rootRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setContainerW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const CARD_W = cardWidthFor(containerW);
  const cardH = Math.round(CARD_W * 1.4);
  const OVERLAP = Math.round(CARD_W * OVERLAP_RATIO);

  return (
    <div ref={rootRef} className="w-full flex flex-col items-center gap-2 px-2 max-h-full overflow-y-auto">
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
      <div dir="ltr" className="flex items-start justify-center gap-1">
        {SUIT_ORDER.map((suit) => {
          const { opened, cards } = columnFor(view.layout[suit]);
          const bury = { marginTop: -(cardH - OVERLAP) }; // overlap the card above, leaving a rank strip
          return (
            <div key={suit} className="flex flex-col items-center gap-1">
              <div className={`text-sm font-bold leading-none ${suitColorClass(suit)} bg-white rounded px-1`}>
                {SUIT_SYMBOL[suit]}
              </div>
              {!opened ? (
                <div
                  className="rounded-md border border-dashed border-emerald-600/60 flex items-center justify-center text-emerald-500/60 text-[9px] text-center px-0.5"
                  style={{ width: CARD_W, height: cardH }}
                >
                  {t('play J', 'العب الولد')}
                </div>
              ) : (
                // The played honors (Q/K/A) stacked, then the single lowest card
                // played — no gap marker, no full run, no jack once play has moved on.
                <div className="flex flex-col items-center">
                  {cards.map((r, i) => (
                    <div key={r} className="rounded" style={i === 0 ? undefined : bury}>
                      <CardFace card={{ suit, rank: r }} width={CARD_W} fourColor={fourColor} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
