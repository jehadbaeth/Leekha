import type { Seat } from '@leekha/engine';
import { pick, type Settings } from '../settings';

export function MatchEnd({
  names,
  totals,
  losingTeam,
  bustSeat,
  language,
  onRematch,
  onHome,
}: {
  names: Record<Seat, string>;
  totals: [number, number, number, number];
  losingTeam: 0 | 1;
  bustSeat: Seat;
  language: Settings['language'];
  onRematch: () => void;
  onHome: () => void;
}) {
  const t = (en: string, ar: string) => pick(language, en, ar);
  const seats: Seat[] = [0, 1, 2, 3];
  const losers = seats.filter((s) => (s % 2 === 0 ? 0 : 1) === losingTeam);
  const winners = seats.filter((s) => (s % 2 === 0 ? 0 : 1) !== losingTeam);

  return (
    <div className="absolute inset-0 bg-black/80 flex items-center justify-center p-4 z-30">
      <div className="bg-emerald-950 border border-emerald-700 rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4 text-center">
        <h2 className="text-2xl font-bold text-amber-300">{t('Match over', 'انتهت المباراة')}</h2>
        <p className="text-emerald-100 text-sm">
          {t(
            `${names[bustSeat]} busted at ${totals[bustSeat]} points.`,
            `${names[bustSeat]} تجاوز الحد عند ${totals[bustSeat]} نقطة.`,
          )}
        </p>
        <p className="text-white font-semibold">
          {t(
            `${winners.map((s) => names[s]).join(' & ')} win. ${losers.map((s) => names[s]).join(' & ')} lose.`,
            `${winners.map((s) => names[s]).join(' و ')} يفوزان. ${losers.map((s) => names[s]).join(' و ')} يخسران.`,
          )}
        </p>

        <div className="flex flex-col gap-1 text-sm bg-emerald-900/60 rounded-lg p-3">
          {seats.map((s) => (
            <div key={s} className="flex justify-between">
              <span>{names[s]}</span>
              <span>{totals[s]}</span>
            </div>
          ))}
        </div>

        <div className="flex gap-3 justify-center mt-2">
          <button className="rounded-lg bg-amber-400 text-emerald-950 font-semibold px-4 py-2" onClick={onRematch}>
            {t('Rematch', 'إعادة المباراة')}
          </button>
          <button className="rounded-lg bg-emerald-800 text-white px-4 py-2" onClick={onHome}>
            {t('Back to Home', 'العودة للرئيسية')}
          </button>
        </div>
      </div>
    </div>
  );
}
