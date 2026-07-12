import type { Card } from '@leekha/engine';
import { rankLabel, SUIT_SYMBOL, suitColor, cardKey } from '../cardDisplay';

export function CardFace({
  card,
  size = 'md',
  fourColor = false,
  faceDown = false,
}: {
  card: Card;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  fourColor?: boolean;
  faceDown?: boolean;
}) {
  const dims =
    size === 'sm'
      ? 'w-8 h-11 text-xs'
      : size === 'lg'
        ? 'w-11 h-16 text-sm @[480px]:w-16 @[480px]:h-24 @[480px]:text-xl'
        : size === 'xl'
          ? 'w-14 h-20 text-base @[480px]:w-20 @[480px]:h-28 @[480px]:text-2xl'
          : 'w-12 h-16 text-base';
  if (faceDown) {
    return (
      <div
        className={`card-face ${dims} rounded-md bg-gradient-to-br from-emerald-700 to-emerald-900 border border-emerald-950 flex-shrink-0`}
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
  // fan's bottom edge.
  return (
    <div
      key={cardKey(card)}
      className={`card-face relative ${dims} rounded-md bg-white ${suitColor(card.suit, fourColor)} flex-shrink-0 select-none`}
    >
      <div className="absolute top-0.5 left-1 leading-none font-bold flex flex-col items-center gap-y-0.5">
        <span>{rankLabel(card.rank)}</span>
        <span className="text-[0.7em] leading-none">{SUIT_SYMBOL[card.suit]}</span>
      </div>
      <div className="absolute inset-0 flex items-center justify-center pt-[0.5em] text-[1.5em] leading-none">
        {SUIT_SYMBOL[card.suit]}
      </div>
    </div>
  );
}
