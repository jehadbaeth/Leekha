import { useState } from 'react';
import { pick, type Settings } from './settings';
import { login, register, ApiError, type AuthedUser } from './net/api';

export function AuthScreen({
  settings,
  onBack,
  onAuthed,
}: {
  settings: Settings;
  onBack: () => void;
  onAuthed: (user: AuthedUser) => void;
}) {
  const t = (en: string, ar: string) => pick(settings.language, en, ar);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState(settings.displayName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function errorMessage(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.code === 'invalid-credentials') return t('Wrong email or password.', 'البريد الإلكتروني أو كلمة المرور غير صحيحة.');
      if (err.code === 'email-taken') return t('That email is already registered.', 'هذا البريد الإلكتروني مسجل بالفعل.');
      if (err.code === 'invalid-input') return t('Please check your email and use a password of at least 8 characters.', 'يرجى التحقق من البريد الإلكتروني واستخدام كلمة مرور من 8 أحرف على الأقل.');
      if (err.code === 'rate-limited') return t('Too many attempts. Try again in a minute.', 'محاولات كثيرة جدًا. حاول مرة أخرى بعد دقيقة.');
    }
    return t('Something went wrong. Please try again.', 'حدث خطأ ما. يرجى المحاولة مرة أخرى.');
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const user = mode === 'login' ? await login(email, password) : await register(email, password, displayName.trim());
      onAuthed(user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-full bg-felt-950 text-white px-6 py-8 flex flex-col items-center">
      <div className="w-full max-w-xs">
        <button className="text-sm underline text-emerald-200 mb-6" onClick={onBack}>
          {t('← Back', '→ رجوع')}
        </button>

        <h2 className="text-2xl font-bold mb-1">{mode === 'login' ? t('Log In', 'تسجيل الدخول') : t('Register', 'إنشاء حساب')}</h2>
        <p className="text-emerald-300 text-sm mb-6">
          {t('Optional — save your match history across devices.', 'اختياري — احفظ سجل مبارياتك عبر أجهزتك.')}
        </p>

        <div className="flex flex-col gap-3">
          {mode === 'register' && (
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-emerald-200">{t('Display name', 'الاسم')}</span>
              <input
                className="rounded-lg px-3 py-2 text-slate-900 bg-white"
                value={displayName}
                maxLength={24}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-emerald-200">{t('Email', 'البريد الإلكتروني')}</span>
            <input
              className="rounded-lg px-3 py-2 text-slate-900 bg-white"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-emerald-200">{t('Password', 'كلمة المرور')}</span>
            <input
              className="rounded-lg px-3 py-2 text-slate-900 bg-white"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            className="rounded-xl bg-amber-400 hover:bg-amber-300 text-emerald-950 font-semibold py-3 text-lg shadow-md active:scale-[0.98] transition disabled:opacity-50"
            disabled={busy || !email || !password || (mode === 'register' && !displayName.trim())}
            onClick={submit}
          >
            {mode === 'login' ? t('Log In', 'تسجيل الدخول') : t('Create Account', 'إنشاء الحساب')}
          </button>

          <button
            className="text-sm underline text-emerald-100"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
          >
            {mode === 'login'
              ? t("Don't have an account? Register", 'ليس لديك حساب؟ إنشاء حساب')
              : t('Already have an account? Log in', 'لديك حساب بالفعل؟ تسجيل الدخول')}
          </button>
        </div>
      </div>
    </div>
  );
}
