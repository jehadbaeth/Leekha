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
  // Classic corner layout: rank with the suit right under it in the top-left
  // (and mirrored bottom-right), plus a big center pip. The corner pairing is
  // what keeps a fanned hand readable -- when cards overlap, the top-left
  // sliver is all that shows, and a suit that only lives in the card's
  // center (as before) is invisible on every covered card.
  return (
    <div
      key={cardKey(card)}
      className={`card-face ${dims} rounded-md bg-white ${suitColor(card.suit, fourColor)} flex flex-col justify-between px-1 py-0.5 flex-shrink-0 select-none`}
    >
      <div className="leading-none font-bold flex flex-col items-start">
        <span>{rankLabel(card.rank)}</span>
        <span className="text-[0.75em] leading-none">{SUIT_SYMBOL[card.suit]}</span>
      </div>
      <div className="leading-none text-center text-[1.5em]">{SUIT_SYMBOL[card.suit]}</div>
      <div className="leading-none font-bold self-end rotate-180 flex flex-col items-start">
        <span>{rankLabel(card.rank)}</span>
        <span className="text-[0.75em] leading-none">{SUIT_SYMBOL[card.suit]}</span>
      </div>
    </div>
  );
}
