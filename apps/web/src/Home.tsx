import { useState } from 'react';
import type { Settings } from './settings';

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
}: {
  settings: Settings;
  onUpdateSettings: (patch: Partial<Settings>) => void;
  onPlayVsBots: () => void;
  onCreateRoom: (name: string) => void;
  onJoinRoom: (name: string, code: string) => void;
  onHowToPlay: () => void;
  onSettings: () => void;
  joinError?: string | null;
  /** Pre-fills the join code field when a player opens a shared room link (?join=CODE). */
  initialJoinCode?: string;
}) {
  const [name, setName] = useState(settings.displayName);
  const [joinCode, setJoinCode] = useState(initialJoinCode ?? '');
  const [showJoin, setShowJoin] = useState(!!initialJoinCode);

  function commitName() {
    onUpdateSettings({ displayName: name.trim() });
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center px-6 py-10 gap-8 bg-felt-950">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-white">Leekha</h1>
        <p className="text-emerald-200 mt-1 text-sm">The Idlib variant &middot; ليخة</p>
      </div>

      <div className="w-full max-w-xs flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-emerald-200">Display name</span>
          <input
            className="rounded-lg px-3 py-2 text-slate-900 bg-white"
            value={name}
            placeholder="Guest"
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
          />
        </label>

        <button
          className="rounded-xl bg-amber-400 hover:bg-amber-300 text-emerald-950 font-semibold py-3 text-lg shadow-md active:scale-[0.98] transition"
          onClick={() => {
            commitName();
            onPlayVsBots();
          }}
        >
          Play vs Bots
        </button>

        <button
          className="rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-semibold py-3 text-lg shadow-md active:scale-[0.98] transition"
          onClick={() => {
            commitName();
            onCreateRoom(name.trim());
          }}
        >
          Create Room
        </button>

        {!showJoin ? (
          <button
            className="rounded-xl border border-emerald-500 text-emerald-100 font-semibold py-3 text-lg active:scale-[0.98] transition"
            onClick={() => setShowJoin(true)}
          >
            Join Room
          </button>
        ) : (
          <div className="flex flex-col gap-2 bg-emerald-950/60 border border-emerald-700 rounded-xl p-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-emerald-200">Room code</span>
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
                Join
              </button>
              <button className="rounded-lg border border-emerald-600 text-emerald-100 px-3 py-2" onClick={() => setShowJoin(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="flex gap-3 justify-center text-sm">
          <button className="underline text-emerald-100" onClick={onHowToPlay}>
            How to Play
          </button>
          <span className="text-emerald-400">&middot;</span>
          <button className="underline text-emerald-100" onClick={onSettings}>
            Settings
          </button>
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
