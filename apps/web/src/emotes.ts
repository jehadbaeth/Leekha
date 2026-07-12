export interface EmoteDef {
  id: string;
  glyph: string;
  /** Animated sticker played big above the sender's avatar when this emote fires. */
  anim: string;
  en: string;
  ar: string;
}

/**
 * SPEC.md section 7.5.11: quick, localized emotes, no free text chat.
 * Glyph combos and captions are our own — deliberately playful table-talk in
 * the spirit of Levantine card-app banter (donkey, rooster "good morning" for
 * the slow player, the GOAT...), not copies of any other app's art.
 * The `anim` artwork is Google's openly-licensed Noto Emoji Animation set
 * (Apache 2.0) and every sound is a real recording (Mixkit free license /
 * Kenney CC0) — see public/CREDITS.txt.
 */
export const EMOTES: EmoteDef[] = [
  // Row 1: compliments
  { id: 'nice', glyph: '👏😏', anim: '/emotes/nice.webp', en: 'Shatir!', ar: 'شاطر!' },
  { id: 'haha', glyph: '🤣', anim: '/emotes/haha.webp', en: 'Dying laughing', ar: 'ضحكتني' },
  { id: 'wow', glyph: '🤯', anim: '/emotes/wow.webp', en: 'Whoaaa', ar: 'يا سلام!' },
  { id: 'gg', glyph: '🤝😎', anim: '/emotes/gg.webp', en: 'GG!', ar: 'لعبة حلوة' },
  // Row 2: drama
  { id: 'cry', glyph: '😭', anim: '/emotes/cry.webp', en: 'Have mercy', ar: 'حرام عليك' },
  { id: 'angry', glyph: '😡', anim: '/emotes/angry.webp', en: 'Enough!', ar: 'طفح الكيل!' },
  { id: 'oops', glyph: '🙈', anim: '/emotes/oops.webp', en: 'Oopsie', ar: 'يي غلطة' },
  { id: 'kiss', glyph: '😘', anim: '/emotes/kiss.webp', en: 'Muah!', ar: 'بوسة' },
  // Row 3: taunts
  { id: 'fire', glyph: '🔥😤', anim: '/emotes/fire.webp', en: 'On fire', ar: 'نار نار' },
  { id: 'clown', glyph: '🤡', anim: '/emotes/clown.webp', en: 'Clown move', ar: 'حركة مهرج' },
  { id: 'popcorn', glyph: '😏🍿', anim: '/emotes/popcorn.webp', en: 'Watch and learn', ar: 'تفرّج وتعلّم' },
  { id: 'finger', glyph: '🖕', anim: '/emotes/finger.webp', en: 'Take that!', ar: 'كُل هوا!' },
  // Row 4: the barnyard
  { id: 'donkey', glyph: '🫏', anim: '/emotes/donkey.webp', en: 'Donkey move!', ar: 'يا حمار!' },
  { id: 'rooster', glyph: '🐓', anim: '/emotes/rooster.webp', en: 'Good morning!', ar: 'صباح الخير!' },
  { id: 'sleep', glyph: '😴', anim: '/emotes/sleep.webp', en: 'Wake up, your turn', ar: 'يالله نمنا!' },
  { id: 'goat', glyph: '🐐', anim: '/emotes/goat.webp', en: 'The GOAT', ar: 'أسطورة!' },
];

export const EMOTE_BY_ID: Record<string, EmoteDef> = Object.fromEntries(EMOTES.map((e) => [e.id, e]));
