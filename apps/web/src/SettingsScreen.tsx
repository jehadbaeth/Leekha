import type { Settings } from './settings';

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className="w-full flex items-center justify-between gap-4 py-3 border-b border-emerald-800 text-left"
      onClick={() => onChange(!value)}
    >
      <span>
        <span className="block text-sm text-white">{label}</span>
        {hint && <span className="block text-xs text-emerald-300 mt-0.5">{hint}</span>}
      </span>
      <span
        className={`w-11 h-6 rounded-full flex-shrink-0 relative transition ${value ? 'bg-amber-400' : 'bg-emerald-800'}`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`}
        />
      </span>
    </button>
  );
}

export function SettingsScreen({
  settings,
  onUpdate,
  onBack,
}: {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
  onBack: () => void;
}) {
  return (
    <div className="min-h-full bg-felt-950 text-white px-6 py-8">
      <button className="text-sm underline text-emerald-200 mb-6" onClick={onBack}>
        ← Back
      </button>
      <h2 className="text-2xl font-bold mb-4">Settings</h2>

      <div className="max-w-md">
        <div className="flex items-center justify-between py-3 border-b border-emerald-800">
          <span className="text-sm">Language</span>
          <div className="flex gap-2">
            <button
              className={`px-3 py-1 rounded-full text-sm ${settings.language === 'en' ? 'bg-amber-400 text-emerald-950' : 'bg-emerald-800'}`}
              onClick={() => onUpdate({ language: 'en' })}
            >
              English
            </button>
            <button
              className={`px-3 py-1 rounded-full text-sm ${settings.language === 'ar' ? 'bg-amber-400 text-emerald-950' : 'bg-emerald-800'}`}
              onClick={() => onUpdate({ language: 'ar' })}
            >
              العربية
            </button>
          </div>
        </div>

        <Toggle
          label="Confirm before playing a card"
          hint="Tap to raise a card, tap again to confirm. Turn off for single-tap play."
          value={settings.confirmBeforePlay}
          onChange={(v) => onUpdate({ confirmBeforePlay: v })}
        />
        <Toggle
          label="Auto play when only one legal card"
          hint="Skips the confirm step when you have no real choice."
          value={settings.autoPlaySingleLegal}
          onChange={(v) => onUpdate({ autoPlaySingleLegal: v })}
        />
        <Toggle label="Four color deck" value={settings.fourColorDeck} onChange={(v) => onUpdate({ fourColorDeck: v })} />
        <Toggle label="Sound" value={settings.sound} onChange={(v) => onUpdate({ sound: v })} />
        <Toggle label="Haptics" value={settings.haptics} onChange={(v) => onUpdate({ haptics: v })} />
        <Toggle label="Reduced motion" value={settings.reducedMotion} onChange={(v) => onUpdate({ reducedMotion: v })} />
      </div>
    </div>
  );
}
