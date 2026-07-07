export interface EmoteDef {
  id: string;
  glyph: string;
  en: string;
  ar: string;
}

/**
 * SPEC.md section 7.5.11: 6-8 quick, localized emotes, no free text chat.
 * Glyph combos and captions are our own — deliberately playful table-talk in
 * the spirit of Levantine card-app banter, not copies of any other app's art.
 */
export const EMOTES: EmoteDef[] = [
  { id: 'nice', glyph: '👏😏', en: 'Shatir!', ar: 'شاطر!' },
  { id: 'haha', glyph: '🤣', en: 'Dying laughing', ar: 'ضحكتني' },
  { id: 'wow', glyph: '🤯', en: 'Whoaaa', ar: 'يا سلام!' },
  { id: 'oops', glyph: '🙈', en: 'Oopsie', ar: 'يي غلطة' },
  { id: 'fire', glyph: '🔥😤', en: 'On fire', ar: 'نار نار' },
  { id: 'thanks', glyph: '🙏😅', en: 'Thanks partner', ar: 'شكراً يا شريك' },
  { id: 'ugh', glyph: '😩', en: 'Ughhh', ar: 'قهرتوني' },
  { id: 'gg', glyph: '🤝😎', en: 'GG!', ar: 'لعبة حلوة' },
  { id: 'clown', glyph: '🤡', en: 'Clown move', ar: 'حركة مهرج' },
  { id: 'popcorn', glyph: '😏🍿', en: 'Watch and learn', ar: 'تفرّج وتعلّم' },
];

export const EMOTE_BY_ID: Record<string, EmoteDef> = Object.fromEntries(EMOTES.map((e) => [e.id, e]));
