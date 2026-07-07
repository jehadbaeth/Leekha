import { useState } from 'react';
import type { Settings } from './settings';

export function Home({
  settings,
  onUpdateSettings,
  onPlayVsBots,
  onHowToPlay,
  onSettings,
}: {
  settings: Settings;
  onUpdateSettings: (patch: Partial<Settings>) => void;
  onPlayVsBots: () => void;
  onHowToPlay: () => void;
  onSettings: () => void;
}) {
  const [name, setName] = useState(settings.displayName);

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
            onBlur={() => onUpdateSettings({ displayName: name.trim() })}
          />
        </label>

        <button
          className="rounded-xl bg-amber-400 hover:bg-amber-300 text-emerald-950 font-semibold py-3 text-lg shadow-md active:scale-[0.98] transition"
          onClick={() => {
            onUpdateSettings({ displayName: name.trim() });
            onPlayVsBots();
          }}
        >
          Play vs Bots
        </button>

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

      <p className="text-emerald-300/70 text-xs text-center max-w-xs">
        Online rooms are coming soon. For now, play instantly against three bots, right in your browser.
      </p>
    </div>
  );
}
