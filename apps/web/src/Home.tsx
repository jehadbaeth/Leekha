import { useEffect, useState } from 'react';
import { pick, type Settings } from './settings';
import type { AuthedUser } from './net/api';
import type { PublicRoom } from '@leekha/protocol';
import { PillButton } from './components/buttons';
import { randomFunName } from './names';

export function Home({
  settings,
  onUpdateSettings,
  onPlayVsBots,
  onCreateRoom,
  onJoinRoom,
  onHowToPlay,
  onSettings,
  joinError,
  initialJoinCode,
  user,
  onAuth,
  onLogout,
  onHistory,
  publicRooms,
  onRefreshPublicRooms,
}: {
  settings: Settings;
  onUpdateSettings: (patch: Partial<Settings>) => void;
  onPlayVsBots: () => void;
  onCreateRoom: (name: string, isPublic: boolean) => void;
  onJoinRoom: (name: string, code: string) => void;
  onHowToPlay: () => void;
  onSettings: () => void;
  joinError?: string | null;
  /** Pre-fills the join code field when a player opens a shared room link (?join=CODE). */
  initialJoinCode?: string;
  user: AuthedUser | null;
  onAuth: () => void;
  onLogout: () => void;
  onHistory: () => void;
  publicRooms: PublicRoom[];
  onRefreshPublicRooms: () => void;
}) {
  const [name, setName] = useState(settings.displayName);
  const [joinCode, setJoinCode] = useState(initialJoinCode ?? '');
  const [showJoin, setShowJoin] = useState(!!initialJoinCode);
  const [makePublic, setMakePublic] = useState(false);
  const L = settings.language;
  const t = (en: string, ar: string) => pick(L, en, ar);

  // Poll rather than a one-shot refresh on mount: a room created on another
  // device after this screen already loaded (the common case — you open
  // Home, then a friend creates a public room) would otherwise never show up
  // without an explicit tap of the Refresh button.
  useEffect(() => {
    onRefreshPublicRooms();
    const id = setInterval(onRefreshPublicRooms, 4000);
    return () => clearInterval(id);
  }, [onRefreshPublicRooms]);

  // Pick up the fun name App seeds into settings after the async settings load,
  // but never stomp what the player is actively typing.
  useEffect(() => {
    if (!name && settings.displayName) setName(settings.displayName);
  }, [settings.displayName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Blank is not allowed to persist: an empty field rerolls a fresh fun handle
  // rather than falling back to a shared "Guest", so players stay distinguishable.
  function commitName() {
    const finalName = name.trim() || randomFunName();
    if (finalName !== name) setName(finalName);
    onUpdateSettings({ displayName: finalName });
  }

  function shuffleName() {
    const next = randomFunName();
    setName(next);
    onUpdateSettings({ displayName: next });
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center px-6 py-8 gap-6 bg-felt-950">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-white">{t('Leekha', 'ليخة')}</h1>
        <p className="text-emerald-200 mt-1 text-sm">{t('The Idlib variant · ليخة', 'نسخة إدلب · Leekha')}</p>
      </div>

      <div className="w-full max-w-xs flex flex-col gap-4">
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
              aria-label={t('Random name', 'اسم عشوائي')}
              onClick={shuffleName}
            >
              🎲
            </button>
          </div>
        </label>

        <button
          className="rounded-xl bg-amber-400 hover:bg-amber-300 text-emerald-950 font-semibold py-3 text-lg shadow-md active:scale-[0.98] transition"
          onClick={() => {
            commitName();
            onPlayVsBots();
          }}
        >
          {t('Play vs Bots', 'العب ضد الروبوتات')}
        </button>

        <button
          className="rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-semibold py-3 text-lg shadow-md active:scale-[0.98] transition"
          onClick={() => {
            commitName();
            onCreateRoom(name.trim(), makePublic);
          }}
        >
          {t('Create Room', 'إنشاء غرفة')}
        </button>
        <label className="flex items-center gap-2 -mt-2 px-1 text-xs text-emerald-200">
          <input type="checkbox" checked={makePublic} onChange={(e) => setMakePublic(e.target.checked)} />
          {t('Public (listed below for anyone to join)', 'عامة (تظهر بالأسفل ليتمكن أي شخص من الانضمام)')}
        </label>

        <div className="flex flex-col gap-2 bg-emerald-950/60 border border-emerald-700 rounded-xl p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-emerald-200">{t('Public Rooms', 'الغرف العامة')}</span>
            <button className="text-xs underline text-emerald-200" onClick={onRefreshPublicRooms}>
              {t('Refresh', 'تحديث')}
            </button>
          </div>
          {publicRooms.length === 0 ? (
            <p className="text-xs text-emerald-300/80 py-1">
              {t('No public rooms right now.', 'لا توجد غرف عامة حالياً.')}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
              {publicRooms.map((room) => (
                <div key={room.code} className="flex items-center justify-between gap-2 bg-emerald-900/60 rounded-lg px-3 py-1.5">
                  <span className="text-sm text-white truncate">
                    {t(`${room.hostName}'s room`, `غرفة ${room.hostName}`)}{' '}
                    <span className="text-emerald-300">({room.seatsFilled}/4 · {room.targetScore})</span>
                  </span>
                  <button
                    className="shrink-0 rounded-lg bg-amber-400 text-emerald-950 text-xs font-semibold px-3 py-1"
                    onClick={() => {
                      commitName();
                      onJoinRoom(name.trim(), room.code);
                    }}
                  >
                    {t('Join', 'انضمام')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {!showJoin ? (
          <button
            className="rounded-xl border border-emerald-500 text-emerald-100 font-semibold py-3 text-lg active:scale-[0.98] transition"
            onClick={() => setShowJoin(true)}
          >
            {t('Join Room', 'الانضمام إلى غرفة')}
          </button>
        ) : (
          <div className="flex flex-col gap-2 bg-emerald-950/60 border border-emerald-700 rounded-xl p-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-emerald-200">{t('Room code', 'رمز الغرفة')}</span>
              <input
                className="rounded-lg px-3 py-2 text-slate-900 bg-white tracking-widest uppercase text-center font-mono text-lg"
                value={joinCode}
                placeholder="ABC123"
                maxLength={6}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              />
            </label>
            {joinError && <p className="text-red-400 text-xs text-center">{joinError}</p>}
            <div className="flex gap-2">
              <button
                className="flex-1 rounded-lg bg-amber-400 text-emerald-950 font-semibold py-2"
                disabled={joinCode.length !== 6}
                onClick={() => {
                  commitName();
                  onJoinRoom(name.trim(), joinCode);
                }}
              >
                {t('Join', 'انضمام')}
              </button>
              <button className="rounded-lg border border-emerald-600 text-emerald-100 px-3 py-2" onClick={() => setShowJoin(false)}>
                {t('Cancel', 'إلغاء')}
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-2 justify-center flex-wrap">
          <PillButton onClick={onHowToPlay}>{t('How to Play', 'طريقة اللعب')}</PillButton>
          <PillButton onClick={onSettings}>{t('Settings', 'الإعدادات')}</PillButton>
          {user && <PillButton onClick={onHistory}>{t('History', 'السجل')}</PillButton>}
        </div>

        <div className="flex justify-center text-xs text-emerald-300">
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

        <div className="flex justify-center mt-2">
          <button
            className="text-xs px-3 py-1.5 rounded-full border border-emerald-300 text-emerald-100"
            onClick={() => onUpdateSettings({ language: settings.language === 'en' ? 'ar' : 'en' })}
          >
            {settings.language === 'en' ? 'العربية' : 'English'}
          </button>
        </div>
      </div>
    </div>
  );
}
