import { useState } from 'react';
import type { Card } from '@leekha/engine';
import { CardFace } from './CardFace';
import { cardKey, sortHand } from '../cardDisplay';
import { pick, type Settings } from '../settings';

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
    <div className="absolute inset-0 flex flex-col items-center justify-end pb-4 pointer-events-none">
      <div className="pointer-events-auto flex flex-col items-center gap-3 w-full px-4">
        {!committed ? (
          <>
            <div className="bg-emerald-900/90 rounded-xl px-4 py-2 text-center">
              <div className="font-semibold text-amber-200">{t(`Pass 3 cards to ${recipientName} →`, `مرّر 3 أوراق إلى ${recipientName} ←`)}</div>
              <div className="text-xs text-emerald-200 mt-1">{t(`${selected.length}/3 selected`, `${selected.length}/3 مختارة`)}</div>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5 max-w-md">
              {sortHand(hand).map((card) => {
                const isSel = selected.some((c) => cardKey(c) === cardKey(card));
                return (
                  <button
                    key={cardKey(card)}
                    onClick={() => toggle(card)}
                    className={`transition-transform ${isSel ? '-translate-y-3' : ''}`}
                  >
                    <CardFace card={card} size="md" fourColor={fourColor} />
                  </button>
                );
              })}
            </div>
            <button
              disabled={selected.length !== 3}
              onClick={() => onConfirm(selected as [Card, Card, Card])}
              className="rounded-lg px-6 py-2 bg-amber-400 disabled:opacity-30 text-emerald-950 font-semibold"
            >
              {t('Confirm', 'تأكيد')}
            </button>
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
    </div>
  );
}
