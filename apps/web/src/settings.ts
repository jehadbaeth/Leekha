export interface Settings {
  displayName: string;
  language: 'en' | 'ar';
  confirmBeforePlay: boolean;
  autoPlaySingleLegal: boolean;
  sound: boolean;
  haptics: boolean;
  reducedMotion: boolean;
  fourColorDeck: boolean;
}

const KEY = 'leekha.settings.v1';

export const defaultSettings: Settings = {
  displayName: '',
  language: 'en',
  confirmBeforePlay: true,
  autoPlaySingleLegal: false,
  sound: true,
  haptics: true,
  reducedMotion: false,
  fourColorDeck: false,
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
