import type { CSSProperties } from 'react';
import type { Card } from '@leekha/engine';
import { rankLabel, SUIT_SYMBOL, suitColor, cardKey } from '../cardDisplay';
import { cardFontPxForWidth, cardHeightForWidth } from '../tableScale';

export function CardFace({
  card,
  size = 'md',
  width,
  fourColor = false,
  faceDown = false,
}: {
  card: Card;
  /** Legacy fixed tiers, still used by the deal-flourish animation and the
   * last-trick modal, which don't live in a measured container. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Continuous size in px, driven by the caller's measured container width
   * (see tableScale.ts). Anything on the actual table (hand tray, trick
   * area, passing picker) should pass this instead of `size`: a handful of
   * fixed tiers stops scaling the instant the container outgrows the
   * biggest one, which on a large monitor leaves the whole table looking
   * frozen at "laptop size" no matter how much wider the window gets. */
  width?: number;
  fourColor?: boolean;
  faceDown?: boolean;
}) {
  const fluidStyle: CSSProperties | undefined = width
    ? { width, height: cardHeightForWidth(width), fontSize: cardFontPxForWidth(width) }
    : undefined;
  const dims = width
    ? ''
    : size === 'sm'
      ? 'w-8 h-11 text-xs'
      : size === 'lg'
        ? 'w-11 h-16 text-sm'
        : size === 'xl'
          ? 'w-14 h-20 text-base'
          : 'w-12 h-16 text-base';
  const cardShadow = 'shadow-[0_1px_2px_rgba(0,0,0,0.3),0_8px_16px_-4px_rgba(0,0,0,0.35)]';
  if (faceDown) {
    return (
      <div
        style={fluidStyle}
        className={`${dims} ${cardShadow} rounded-md bg-gradient-to-br from-emerald-700 to-emerald-900 border border-emerald-950 flex-shrink-0`}
      />
    );
  }
  // Corner index layout: rank with the suit right under it in the top-left,
  // plus a big center pip. The corner pairing is what keeps a fanned hand
  // readable -- when cards overlap, the top-left sliver is all that shows,
  // and a suit that only lives in the card's center is invisible on every
  // covered card. Both pieces are absolutely positioned so they can never
  // stack up taller than the card and spill outside it, and there is
  // deliberately NO mirrored bottom-right index: in an overlapping fan those
  // inverted glyphs peek out from under every neighbor as noise along the
  // fan's bottom edge. Insets are in em, not px tiers, so they track
  // whatever font-size this card ends up at, fluid or legacy alike.
  return (
    <div
      key={cardKey(card)}
      style={fluidStyle}
      className={`relative ${dims} ${cardShadow} rounded-md bg-white border border-black/10 ${suitColor(card.suit, fourColor)} flex-shrink-0 select-none`}
    >
      <div className="absolute top-[0.1em] left-[0.15em] leading-none font-bold flex flex-col items-center gap-y-[0.05em]">
        <span>{rankLabel(card.rank)}</span>
        <span className="text-[0.7em] leading-none">{SUIT_SYMBOL[card.suit]}</span>
      </div>
      <div className="absolute inset-0 flex items-center justify-center pt-[0.5em] text-[1.5em] leading-none opacity-90">
        {SUIT_SYMBOL[card.suit]}
      </div>
    </div>
  );
}
