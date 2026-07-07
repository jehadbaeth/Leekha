import type { Card } from '@leekha/engine';
import { rankLabel, SUIT_SYMBOL, suitColor, cardKey } from '../cardDisplay';

export function CardFace({
  card,
  size = 'md',
  fourColor = false,
  faceDown = false,
}: {
  card: Card;
  size?: 'sm' | 'md' | 'lg';
  fourColor?: boolean;
  faceDown?: boolean;
}) {
  const dims =
    size === 'sm'
      ? 'w-8 h-11 text-xs'
      : size === 'lg'
        ? 'w-11 h-16 text-sm @[480px]:w-16 @[480px]:h-24 @[480px]:text-xl'
        : 'w-12 h-16 text-base';
  if (faceDown) {
    return (
      <div
        className={`card-face ${dims} rounded-md bg-gradient-to-br from-emerald-700 to-emerald-900 border border-emerald-950 flex-shrink-0`}
      />
    );
  }
  return (
    <div
      key={cardKey(card)}
      className={`card-face ${dims} rounded-md bg-white ${suitColor(card.suit, fourColor)} flex flex-col justify-between px-1 py-0.5 flex-shrink-0 select-none`}
    >
      <div className="leading-none font-bold">{rankLabel(card.rank)}</div>
      <div className="leading-none text-center">{SUIT_SYMBOL[card.suit]}</div>
      <div className="leading-none font-bold self-end rotate-180">{rankLabel(card.rank)}</div>
    </div>
  );
}
