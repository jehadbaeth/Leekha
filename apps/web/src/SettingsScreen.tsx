import { pick, TRICK_PAUSE_PRESETS_MS, type Settings } from './settings';
import { BackButton } from './components/buttons';

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className="w-full flex items-center justify-between gap-4 py-2.5 border-b border-emerald-800 text-left"
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
    <div className="min-h-full bg-felt-950 text-white px-6 py-6">
      <BackButton label={t('Back', 'رجوع')} onClick={onBack} />
      <h2 className="text-2xl font-bold mt-4 mb-3">{t('Settings', 'الإعدادات')}</h2>

      <div className="max-w-md">
        <div className="flex items-center justify-between py-2.5 border-b border-emerald-800">
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
        <Toggle
          label={t('Auto-join voice', 'الانضمام التلقائي للصوت')}
          hint={t('Open the mic automatically when you enter an online room.', 'افتح الميكروفون تلقائياً عند دخول غرفة عبر الإنترنت.')}
          value={settings.voiceAutoJoin}
          onChange={(v) => onUpdate({ voiceAutoJoin: v })}
        />

        <div className="py-2.5 border-b border-emerald-800">
          <span className="block text-sm text-white">{t('Bot difficulty', 'مستوى الروبوتات')}</span>
          <span className="block text-xs text-emerald-300 mt-0.5 mb-2">
            {t(
              'For local games against bots. Oracle sees every hand (it cheats).',
              'للألعاب المحلية ضد الروبوتات. العرّاف يرى كل الأوراق (يغش).',
            )}
          </span>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['easy', 'Easy', 'سهل'],
                ['medium', 'Medium', 'متوسط'],
                ['hard', 'Hard', 'صعب'],
                ['insane', 'Oracle', 'العرّاف'],
              ] as const
            ).map(([level, en, ar]) => (
              <button
                key={level}
                className={`px-3.5 py-1.5 rounded-full text-sm font-medium ${settings.botDifficulty === level ? 'bg-amber-400 text-emerald-950' : 'bg-emerald-800 text-emerald-100'}`}
                onClick={() => onUpdate({ botDifficulty: level })}
              >
                {t(en, ar)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between py-2.5 border-b border-emerald-800">
          <span>
            <span className="block text-sm text-white">{t('Trick pause', 'مدة توقف اللفة')}</span>
            <span className="block text-xs text-emerald-300 mt-0.5">
              {t('How long the finished trick stays on screen before clearing.', 'مدة بقاء اللفة المكتملة على الشاشة قبل مسحها.')}
            </span>
          </span>
          <select
            className="bg-emerald-800 text-white text-sm rounded-lg px-2 py-1.5"
            value={settings.trickPauseMs}
            onChange={(e) => onUpdate({ trickPauseMs: Number(e.target.value) })}
          >
            {TRICK_PAUSE_PRESETS_MS.map((ms) => (
              <option key={ms} value={ms}>
                {t(`${ms / 1000}s`, `${ms / 1000} ث`)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
