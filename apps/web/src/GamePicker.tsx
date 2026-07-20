import { useEffect, useState } from 'react';
import { defaultTrixConfig, type TrixRulesConfig } from '@leekha/trix';
import { pick, type Settings } from './settings';
import { randomFunName } from './names';
import type { AuthedUser } from './net/api';

export type GameChoice =
  | { game: 'leekha' }
  | { game: 'trix'; config: TrixRulesConfig; online?: boolean };

/**
 * The landing screen: your identity/account (global across games) plus the game
 * choice — Leekha, Trix, or Trix Complex. Picking a game leads into that game's
 * flow; accounts, name, and language live here because they are shared, not
 * Leekha-specific (fixing the old "pick Leekha, then log in" ordering).
 */
export function GamePicker({
  settings,
  onUpdateSettings,
  user,
  onAuth,
  onLogout,
  onChoose,
  onSettings,
}: {
  settings: Settings;
  onUpdateSettings: (patch: Partial<Settings>) => void;
  user: AuthedUser | null;
  onAuth: () => void;
  onLogout: () => void;
  onChoose: (c: GameChoice) => void;
  onSettings: () => void;
}) {
  const L = settings.language;
  const t = (en: string, ar: string) => pick(L, en, ar);
  const [name, setName] = useState(settings.displayName);
  useEffect(() => {
    if (!name && settings.displayName) setName(settings.displayName);
  }, [settings.displayName]); // eslint-disable-line react-hooks/exhaustive-deps

  function commitName() {
    const finalName = name.trim() || randomFunName(L);
    if (finalName !== name) setName(finalName);
    onUpdateSettings({ displayName: finalName });
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center px-6 py-8 gap-5 bg-felt-950">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-white">{t('Choose a game', 'اختر لعبة')}</h1>
        <p className="text-emerald-200 mt-1 text-sm">{t('Trick games for four players', 'ألعاب ورق لأربعة لاعبين')}</p>
      </div>

      <div className="w-full max-w-xs flex flex-col gap-4">
        {/* Global identity: one name across every game. */}
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-emerald-200">{t('Display name', 'الاسم')}</span>
          <div className="flex gap-2">
            <input
              className="flex-1 min-w-0 rounded-lg px-3 py-2 text-slate-900 bg-white"
              value={name}
              placeholder={t('Your name', 'اسمك')}
              maxLength={20}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
            />
            <button
              type="button"
              className="shrink-0 rounded-lg bg-emerald-800 hover:bg-emerald-700 px-3 text-lg active:scale-95 transition"
              title={t('Surprise me', 'اسم عشوائي')}
              onClick={() => {
                const next = randomFunName(L);
                setName(next);
                onUpdateSettings({ displayName: next });
              }}
            >
              🎲
            </button>
          </div>
        </label>

        <button
          className="rounded-2xl bg-amber-400 hover:bg-amber-300 text-emerald-950 font-bold py-5 text-xl shadow-md active:scale-[0.98] transition"
          onClick={() => {
            commitName();
            onChoose({ game: 'leekha' });
          }}
        >
          {t('Leekha', 'ليخة')}
          <span className="block text-xs font-medium text-emerald-900/80 mt-0.5">{t('The Idlib variant', 'نسخة إدلب')}</span>
        </button>

        <TrixCard
          settings={settings}
          complex={false}
          onPlay={(config) => { commitName(); onChoose({ game: 'trix', config }); }}
          onPlayOnline={(config) => { commitName(); onChoose({ game: 'trix', config, online: true }); }}
        />
        <TrixCard
          settings={settings}
          complex={true}
          onPlay={(config) => { commitName(); onChoose({ game: 'trix', config }); }}
          onPlayOnline={(config) => { commitName(); onChoose({ game: 'trix', config, online: true }); }}
        />

        {/* Global account + language. */}
        <div className="flex justify-center text-xs text-emerald-300 mt-1">
          {user ? (
            <span>
              {t('Signed in as', 'مسجل الدخول باسم')} {user.displayName} ·{' '}
              <button className="underline" onClick={onLogout}>
                {t('Log out', 'تسجيل الخروج')}
              </button>
            </span>
          ) : (
            <button className="underline" onClick={onAuth}>
              {t('Log in / Register', 'تسجيل الدخول / إنشاء حساب')}
            </button>
          )}
        </div>
        <div className="flex justify-center gap-2">
          <button
            className="text-xs px-3 py-1.5 rounded-full border border-emerald-300 text-emerald-100"
            onClick={() => onUpdateSettings({ language: L === 'en' ? 'ar' : 'en' })}
          >
            {L === 'en' ? 'العربية' : 'English'}
          </button>
          <button
            className="text-xs px-3 py-1.5 rounded-full border border-emerald-300 text-emerald-100"
            onClick={onSettings}
          >
            {t('⚙ Settings', '⚙ الإعدادات')}
          </button>
        </div>
      </div>
    </div>
  );
}

function TrixCard({
  settings,
  complex,
  onPlay,
  onPlayOnline,
}: {
  settings: Settings;
  complex: boolean;
  onPlay: (config: TrixRulesConfig) => void;
  onPlayOnline: (config: TrixRulesConfig) => void;
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
      <div className="flex gap-2 flex-wrap">
        <div className="flex rounded-full overflow-hidden border border-emerald-600 text-xs">
          <button
            className={`px-3 py-1.5 ${partnership ? 'bg-amber-400 text-emerald-950 font-semibold' : 'text-emerald-200'}`}
            onClick={() => setPartnership(true)}
          >
            {t('Partners', 'زوجي')}
          </button>
          <button
            className={`px-3 py-1.5 ${!partnership ? 'bg-amber-400 text-emerald-950 font-semibold' : 'text-emerald-200'}`}
            onClick={() => setPartnership(false)}
          >
            {t('Solo', 'فردي')}
          </button>
        </div>
        <button
          className={`text-xs rounded-full px-3 py-1.5 border ${doubling ? 'bg-amber-400 text-emerald-950 border-amber-400 font-semibold' : 'bg-transparent text-emerald-200 border-emerald-600'}`}
          onClick={() => setDoubling((d) => !d)}
        >
          {t('Doubling', 'مضاعفة')} {doubling ? '✓' : '✕'}
        </button>
      </div>
      <div className="flex gap-2">
        <button
          className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 active:scale-[0.98] transition"
          onClick={() => onPlay({ ...defaultTrixConfig, complex, partnership, doubling })}
        >
          {t('Play vs bots', 'العب ضد البوتات')}
        </button>
        <button
          className="flex-1 rounded-xl bg-sky-700 hover:bg-sky-600 text-white font-semibold py-2.5 active:scale-[0.98] transition"
          onClick={() => onPlayOnline({ ...defaultTrixConfig, complex, partnership, doubling })}
        >
          {t('Play online', 'العب أونلاين')}
        </button>
      </div>
    </div>
  );
}
