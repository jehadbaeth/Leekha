export interface Settings {
  displayName: string;
  language: 'en' | 'ar';
  confirmBeforePlay: boolean;
  autoPlaySingleLegal: boolean;
  sound: boolean;
  haptics: boolean;
  reducedMotion: boolean;
  fourColorDeck: boolean;
  /** How long a finished trick stays frozen on screen before clearing, in ms (see the freeze effect in GameTable.tsx). */
  trickPauseMs: number;
  /** Local vs-bots difficulty. Hard runs the sampled-world search bot in a Web Worker (useGame.ts). */
  botDifficulty: 'easy' | 'medium' | 'hard';
}

const KEY = 'leekha.settings.v1';

/** Presets for the "how long does a finished trick stay on screen" setting, in ms. */
export const TRICK_PAUSE_PRESETS_MS = [500, 900, 1500, 2500];

export const defaultSettings: Settings = {
  displayName: '',
  language: 'en',
  confirmBeforePlay: true,
  autoPlaySingleLegal: false,
  sound: true,
  haptics: true,
  reducedMotion: false,
  fourColorDeck: false,
  trickPauseMs: 900,
  botDifficulty: 'hard',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultSettings };
    const parsed = JSON.parse(raw);
    return { ...defaultSettings, ...parsed };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore storage failures (private mode, quota, etc.)
  }
}

/** Picks the Arabic string when the language setting is 'ar', English otherwise (SPEC.md 15 Phase 4: full RTL). */
export function pick(lang: Settings['language'], en: string, ar: string): string {
  return lang === 'ar' ? ar : en;
}
