import { pick, type Settings } from './settings';

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
        className={`w-11 h-6 p-0.5 rounded-full flex-shrink-0 flex items-center transition-colors ${value ? 'justify-end bg-amber-400' : 'justify-start bg-emerald-800'}`}
      >
        <span className="w-5 h-5 rounded-full bg-white" />
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
  const t = (en: string, ar: string) => pick(settings.language, en, ar);
  return (
    <div className="min-h-full bg-felt-950 text-white px-6 py-8">
      <button className="text-sm underline text-emerald-200 mb-6" onClick={onBack}>
        {t('← Back', '→ رجوع')}
      </button>
      <h2 className="text-2xl font-bold mb-4">{t('Settings', 'الإعدادات')}</h2>

      <div className="max-w-md">
        <div className="flex items-center justify-between py-3 border-b border-emerald-800">
          <span className="text-sm">{t('Language', 'اللغة')}</span>
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
          label={t('Confirm before playing a card', 'تأكيد قبل لعب الورقة')}
          hint={t(
            'Tap to raise a card, tap again to confirm. Turn off for single-tap play.',
            'اضغط لرفع الورقة، واضغط مرة أخرى للتأكيد. أوقف هذا الخيار للعب بضغطة واحدة.',
          )}
          value={settings.confirmBeforePlay}
          onChange={(v) => onUpdate({ confirmBeforePlay: v })}
        />
        <Toggle
          label={t('Auto play when only one legal card', 'اللعب التلقائي عند وجود ورقة قانونية واحدة')}
          hint={t('Skips the confirm step when you have no real choice.', 'يتخطى خطوة التأكيد عندما لا يوجد خيار حقيقي.')}
          value={settings.autoPlaySingleLegal}
          onChange={(v) => onUpdate({ autoPlaySingleLegal: v })}
        />
        <Toggle
          label={t('Four color deck', 'أوراق بأربعة ألوان')}
          value={settings.fourColorDeck}
          onChange={(v) => onUpdate({ fourColorDeck: v })}
        />
        <Toggle label={t('Sound', 'الصوت')} value={settings.sound} onChange={(v) => onUpdate({ sound: v })} />
        <Toggle label={t('Haptics', 'الاهتزاز')} value={settings.haptics} onChange={(v) => onUpdate({ haptics: v })} />
        <Toggle
          label={t('Reduced motion', 'تقليل الحركة')}
          value={settings.reducedMotion}
          onChange={(v) => onUpdate({ reducedMotion: v })}
        />
      </div>
    </div>
  );
}
