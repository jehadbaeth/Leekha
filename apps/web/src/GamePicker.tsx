import { useState } from 'react';
import { defaultTrixConfig, type TrixRulesConfig } from '@leekha/trix';
import { pick, type Settings } from './settings';

export type GameChoice = { game: 'leekha' } | { game: 'trix'; config: TrixRulesConfig };

/**
 * Entry screen: choose Leekha, Trix, or Trix Complex. Trix and Trix Complex each
 * carry a solo/partner toggle (default partner) and a doubling toggle (default
 * on). This is the one new top-level screen; Leekha's flow is unchanged behind
 * the 'leekha' choice. See SPEC-TRIX.md D0/D2.
 */
export function GamePicker({ settings, onChoose }: { settings: Settings; onChoose: (c: GameChoice) => void }) {
  const t = (en: string, ar: string) => pick(settings.language, en, ar);
  return (
    <div className="min-h-full flex flex-col items-center justify-center px-6 py-8 gap-6 bg-felt-950">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-white">{t('Choose a game', 'اختر لعبة')}</h1>
        <p className="text-emerald-200 mt-1 text-sm">{t('Trick games for four players', 'ألعاب ورق لأربعة لاعبين')}</p>
      </div>

      <div className="w-full max-w-xs flex flex-col gap-4">
        <button
          className="rounded-2xl bg-amber-400 hover:bg-amber-300 text-emerald-950 font-bold py-5 text-xl shadow-md active:scale-[0.98] transition"
          onClick={() => onChoose({ game: 'leekha' })}
        >
          {t('Leekha', 'ليخة')}
          <span className="block text-xs font-medium text-emerald-900/80 mt-0.5">{t('The Idlib variant', 'نسخة إدلب')}</span>
        </button>

        <TrixCard settings={settings} complex={false} onPlay={(config) => onChoose({ game: 'trix', config })} />
        <TrixCard settings={settings} complex={true} onPlay={(config) => onChoose({ game: 'trix', config })} />
      </div>
    </div>
  );
}

function TrixCard({
  settings,
  complex,
  onPlay,
}: {
  settings: Settings;
  complex: boolean;
  onPlay: (config: TrixRulesConfig) => void;
}) {
  const t = (en: string, ar: string) => pick(settings.language, en, ar);
  const [partnership, setPartnership] = useState(true);
  const [doubling, setDoubling] = useState(true);
  const title = complex ? t('Trix Complex', 'تركس كومبلكس') : t('Trix', 'تركس');
  const sub = complex
    ? t('Combine contracts in one deal', 'ادمج المشاريع في جولة واحدة')
    : t('Five contracts, four kingdoms', 'خمسة مشاريع، أربع ممالك');

  return (
    <div className="rounded-2xl bg-emerald-800/80 border border-emerald-600 p-4 flex flex-col gap-3">
      <div>
        <div className="text-lg font-bold text-white">{title}</div>
        <div className="text-xs text-emerald-200">{sub}</div>
      </div>
      <div className="flex gap-2">
        <Seg
          options={[
            [t('Partners', 'زوجي'), partnership],
            [t('Solo', 'فردي'), !partnership],
          ]}
          onLeft={() => setPartnership(true)}
          onRight={() => setPartnership(false)}
        />
        <button
          className={`text-xs rounded-full px-3 py-1.5 border ${doubling ? 'bg-amber-400 text-emerald-950 border-amber-400 font-semibold' : 'bg-transparent text-emerald-200 border-emerald-600'}`}
          onClick={() => setDoubling((d) => !d)}
          title={t('Doubling / exposing honors', 'مضاعفة / كشف الأوراق')}
        >
          {t('Doubling', 'مضاعفة')} {doubling ? '✓' : '✕'}
        </button>
      </div>
      <button
        className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 active:scale-[0.98] transition"
        onClick={() => onPlay({ ...defaultTrixConfig, complex, partnership, doubling })}
      >
        {t('Play', 'العب')}
      </button>
    </div>
  );
}

function Seg({
  options,
  onLeft,
  onRight,
}: {
  options: [string, boolean][];
  onLeft: () => void;
  onRight: () => void;
}) {
  return (
    <div className="flex rounded-full overflow-hidden border border-emerald-600 text-xs">
      <button
        className={`px-3 py-1.5 ${options[0][1] ? 'bg-amber-400 text-emerald-950 font-semibold' : 'text-emerald-200'}`}
        onClick={onLeft}
      >
        {options[0][0]}
      </button>
      <button
        className={`px-3 py-1.5 ${options[1][1] ? 'bg-amber-400 text-emerald-950 font-semibold' : 'text-emerald-200'}`}
        onClick={onRight}
      >
        {options[1][0]}
      </button>
    </div>
  );
}
