export interface EmoteDef {
  id: string;
  glyph: string;
  en: string;
  ar: string;
}

/** SPEC.md section 7.5.11: 6-8 quick, localized emotes, no free text chat. */
export const EMOTES: EmoteDef[] = [
  { id: 'nice', glyph: '👍', en: 'Nice!', ar: 'حلو!' },
  { id: 'haha', glyph: '😂', en: 'Haha', ar: 'هههه' },
  { id: 'wow', glyph: '😮', en: 'Wow', ar: 'واو' },
  { id: 'oops', glyph: '😅', en: 'Oops', ar: 'أوبس' },
  { id: 'fire', glyph: '🔥', en: 'On fire', ar: 'نار' },
  { id: 'thanks', glyph: '🙏', en: 'Thanks partner', ar: 'شكراً يا شريك' },
  { id: 'ugh', glyph: '😤', en: 'Ugh', ar: 'يي' },
  { id: 'gg', glyph: '🤝', en: 'Good game', ar: 'لعبة حلوة' },
];

export const EMOTE_BY_ID: Record<string, EmoteDef> = Object.fromEntries(EMOTES.map((e) => [e.id, e]));
