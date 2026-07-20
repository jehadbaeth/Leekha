import { randomFunName } from './names';

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
  /** Automatically join the room's voice lobby on entering an online room (still asks for the mic once). */
  voiceAutoJoin: boolean;
  /**
   * Local vs-bots difficulty. Hard runs the sampled-world search bot in a Web
   * Worker (useGame.ts). Insane ("Oracle") sees every hand and plays the
   * perfect-information best move: it cheats on information, not on the rules.
   */
  botDifficulty: 'easy' | 'medium' | 'hard' | 'insane';
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
  voiceAutoJoin: false,
  botDifficulty: 'hard',
};

export function loadSettings(): Settings {
  let loaded: Settings;
  try {
    const raw = localStorage.getItem(KEY);
    loaded = raw ? { ...defaultSettings, ...JSON.parse(raw) } : { ...defaultSettings };
  } catch {
    loaded = { ...defaultSettings };
  }
  // Fill (and persist) a fun handle here rather than in a React effect, so it's
  // already present the moment the socket reads settings for its handshake --
  // otherwise the very first telemetry session records an empty name.
  if (!loaded.displayName.trim()) {
    loaded.displayName = randomFunName(loaded.language);
    saveSettings(loaded);
  }
  return loaded;
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
