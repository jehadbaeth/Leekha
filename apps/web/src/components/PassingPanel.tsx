import { useLayoutEffect, useState } from 'react';
import type { Card } from '@leekha/engine';
import { CardFace } from './CardFace';
import { cardKey, sortHand } from '../cardDisplay';
import { fanLayout, needsTwoStories } from '../fanLayout';
import { pick, type Settings } from '../settings';
import { cardHeightForWidth, cardWidthForContainer } from '../tableScale';

export function PassingPanel({
  hand,
  recipientName,
  committed,
  passProgress,
  fourColor,
  language,
  onConfirm,
}: {
  hand: Card[];
  recipientName: string;
  committed: boolean;
  passProgress: boolean[];
  fourColor: boolean;
  language: Settings['language'];
  onConfirm: (cards: [Card, Card, Card]) => void;
}) {
  const t = (en: string, ar: string) => pick(language, en, ar);
  const [selected, setSelected] = useState<Card[]>([]);
  // Same measured-fan approach as GameTable's hand tray (see fanLayout):
  // the callback ref re-arms the measurement when the picker mounts.
  const [trayEl, setTrayEl] = useState<HTMLDivElement | null>(null);
  const [trayW, setTrayW] = useState(0);
  useLayoutEffect(() => {
    if (!trayEl) return;
    const measure = () => setTrayW(trayEl.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(trayEl);
    return () => ro.disconnect();
  }, [trayEl]);

  function toggle(card: Card) {
    if (committed) return;
    setSelected((prev) => {
      const exists = prev.some((c) => cardKey(c) === cardKey(card));
      if (exists) return prev.filter((c) => cardKey(c) !== cardKey(card));
      if (prev.length >= 3) return prev;
      return [...prev, card];
    });
  }

  return (
    // Normal flow, not an absolute overlay: it sits in the exact same flex
    // slot the play-phase hand tray occupies (see GameTable.tsx), so it
    // stacks above the memo chip and HUD strip instead of floating over the
    // whole table on a fixed bottom offset -- the previous absolute
    // positioning bottom-anchored to the *container's* edge, which stopped
    // matching where the HUD strip actually landed once bigger cards made
    // this content taller, and the two started overlapping.
    <div className="flex flex-col items-center gap-2 w-full px-4 pb-2 pt-1">
      {!committed ? (
          <>
            {/* Confirm lives up here in the instruction chip, above the fan,
                not below it: below the cards it was the one control that
                could sit off-screen on a phone, making every pass a scroll
                trip (same complaint as the play-phase confirm). Always
                rendered (disabled until 3 picked) so enabling it never
                shifts the layout. */}
            <div className="bg-emerald-900/90 rounded-xl px-4 py-1.5 flex items-center gap-4">
              <div className="text-center">
                {/* Both arrows point right: the recipient physically sits to
                    your right in every language (seating is pinned LTR). */}
                <div className="font-semibold text-amber-200">{t(`Pass 3 cards to ${recipientName} →`, `مرّر 3 أوراق إلى ${recipientName} →`)}</div>
                <div className="text-xs text-emerald-200 mt-1">{t(`${selected.length}/3 selected`, `${selected.length}/3 مختارة`)}</div>
              </div>
              <button
                disabled={selected.length !== 3}
                onClick={() => onConfirm(selected as [Card, Card, Card])}
                className="rounded-lg px-5 py-1.5 bg-amber-400 disabled:opacity-30 text-emerald-950 font-semibold"
              >
                {t('Confirm', 'تأكيد')}
              </button>
            </div>
            {/* The picker uses the same fan layout as the play-phase hand
                tray (same fanLayout/needsTwoStories, same sortHand order,
                same order in every language), so the hand a player studies while
                passing looks and reads exactly like the hand they'll then
                play from. The hand is static for the whole phase, so a
                simple midpoint split is stable here -- no sticky map needed. */}
            {(() => {
              // Same sorted order in every language, matching the play-phase
              // hand tray (seating and pass direction are language-agnostic).
              const sorted = sortHand(hand);
              // Same continuous sizing as GameTable's hand tray (tableScale.ts),
              // so the passing picker matches the play-phase hand at every
              // container width instead of jumping between fixed tiers.
              const CW = cardWidthForContainer(trayW);
              const CH = cardHeightForWidth(CW);
              const twoStory = trayW > 0 && needsTwoStories(sorted.length, trayW, CW, CH);
              const half = Math.ceil(sorted.length / 2);
              const rows = twoStory ? [sorted.slice(0, half), sorted.slice(half)] : [sorted];
              const rowOffset = twoStory ? Math.round(CH * 0.55) : 0;
              const geos = rows.map((r) => fanLayout(r.length, trayW, CW, CH));
              const maxLiftAll = Math.max(...geos.map((g) => g.maxLift));
              const trayH = CH + rowOffset + maxLiftAll + 24;
              return (
                <div ref={setTrayEl} className="relative w-full" style={{ height: trayH }}>
                  {trayW > 0 &&
                    rows.map((rowCards, rowIdx) => {
                      const displayRow = rowCards;
                      const geo = geos[rowIdx];
                      const rowLift = twoStory && rowIdx === 0 ? rowOffset : 0;
                      return displayRow.map((card, i) => {
                        const isSel = selected.some((c) => cardKey(c) === cardKey(card));
                        const lift = geo.lift(i) + rowLift + (isSel ? 14 : 0);
                        return (
                          <button
                            key={cardKey(card)}
                            onClick={() => toggle(card)}
                            style={{
                              left: geo.left(i),
                              bottom: 0,
                              zIndex: rowIdx * 20 + i,
                              transform: `rotate(${geo.rotate(i)}deg) translateY(-${lift}px)`,
                            }}
                            className={`absolute origin-bottom transition-transform ${isSel ? 'ring-2 ring-amber-300 rounded-md' : ''}`}
                          >
                            <CardFace card={card} width={CW} fourColor={fourColor} />
                          </button>
                        );
                      });
                    })}
                </div>
              );
            })()}
          </>
        ) : (
          <div className="bg-emerald-900/90 rounded-xl px-4 py-3 text-center flex flex-col gap-2">
            <div className="text-emerald-100 text-sm">{t('Waiting for the table…', 'بانتظار بقية الطاولة…')}</div>
            <div className="flex justify-center gap-3">
              {passProgress.map((done, i) => (
                <span
                  key={i}
                  className={`w-3 h-3 rounded-full ${done ? 'bg-amber-400' : 'bg-emerald-700'}`}
                  title={done ? t('ready', 'جاهز') : t('thinking', 'يفكر')}
                />
              ))}
            </div>
          </div>
        )}
    </div>
  );
}
