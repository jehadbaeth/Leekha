export interface EmoteDef {
  id: string;
  glyph: string;
  /** Animated sticker played big above the sender's avatar when this emote fires. */
  anim: string;
  en: string;
  ar: string;
}

/**
 * SPEC.md section 7.5.11: 6-8 quick, localized emotes, no free text chat.
 * Glyph combos and captions are our own — deliberately playful table-talk in
 * the spirit of Levantine card-app banter, not copies of any other app's art.
 * The `anim` artwork is Google's openly-licensed Noto Emoji Animation set
 * (Apache 2.0), not any other app's proprietary stickers — see public/CREDITS.txt.
 */
export const EMOTES: EmoteDef[] = [
  { id: 'nice', glyph: '👏😏', anim: '/emotes/nice.webp', en: 'Shatir!', ar: 'شاطر!' },
  { id: 'haha', glyph: '🤣', anim: '/emotes/haha.webp', en: 'Dying laughing', ar: 'ضحكتني' },
  { id: 'wow', glyph: '🤯', anim: '/emotes/wow.webp', en: 'Whoaaa', ar: 'يا سلام!' },
  { id: 'oops', glyph: '🙈', anim: '/emotes/oops.webp', en: 'Oopsie', ar: 'يي غلطة' },
  { id: 'fire', glyph: '🔥😤', anim: '/emotes/fire.webp', en: 'On fire', ar: 'نار نار' },
  { id: 'thanks', glyph: '🙏😅', anim: '/emotes/thanks.webp', en: 'Thanks partner', ar: 'شكراً يا شريك' },
  { id: 'ugh', glyph: '😩', anim: '/emotes/ugh.webp', en: 'Ughhh', ar: 'قهرتوني' },
  { id: 'gg', glyph: '🤝😎', anim: '/emotes/gg.webp', en: 'GG!', ar: 'لعبة حلوة' },
  { id: 'clown', glyph: '🤡', anim: '/emotes/clown.webp', en: 'Clown move', ar: 'حركة مهرج' },
  { id: 'popcorn', glyph: '😏🍿', anim: '/emotes/popcorn.webp', en: 'Watch and learn', ar: 'تفرّج وتعلّم' },
];

export const EMOTE_BY_ID: Record<string, EmoteDef> = Object.fromEntries(EMOTES.map((e) => [e.id, e]));
