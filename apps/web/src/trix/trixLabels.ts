import type { Card, Contract, Seat, Suit } from '@leekha/trix';

/** English display names for the five contracts. */
export const CONTRACT_LABEL: Record<Contract, string> = {
  kingOfHearts: 'King of Hearts',
  diamonds: 'Diamonds',
  queens: 'Queens',
  slaps: 'Slaps',
  trix: 'Trix',
};

/** Arabic (Levantine Trix) contract names. */
export const CONTRACT_LABEL_AR: Record<Contract, string> = {
  kingOfHearts: 'الختيار',
  diamonds: 'الديناري',
  queens: 'البنات',
  slaps: 'اللطوش',
  trix: 'تركس',
};

export function contractName(c: Contract, lang: 'en' | 'ar'): string {
  return lang === 'ar' ? CONTRACT_LABEL_AR[c] : CONTRACT_LABEL[c];
}

/** Short label for chips/badges (kingdom progress, contract banner). */
export const CONTRACT_SHORT: Record<Contract, string> = {
  kingOfHearts: 'K♥',
  diamonds: '♦',
  queens: 'Q',
  slaps: 'Slaps',
  trix: 'Trix',
};

/** Arabic short chips. The card-symbol ones (K♥/♦/Q) read the same in any language; only the word-based two are translated. */
const CONTRACT_SHORT_AR: Record<Contract, string> = {
  kingOfHearts: 'K♥',
  diamonds: '♦',
  queens: 'Q',
  slaps: 'لطش',
  trix: 'تركس',
};

export function contractShort(c: Contract, lang: 'en' | 'ar'): string {
  return lang === 'ar' ? CONTRACT_SHORT_AR[c] : CONTRACT_SHORT[c];
}

export const SUIT_SYMBOL: Record<Suit, string> = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
};

export const SUIT_ORDER: Suit[] = ['S', 'H', 'D', 'C'];

export function rankLabel(rank: Card['rank']): string {
  if (rank === 14) return 'A';
  if (rank === 13) return 'K';
  if (rank === 12) return 'Q';
  if (rank === 11) return 'J';
  return String(rank);
}

export function cardKey(c: Card): string {
  return `${c.suit}${c.rank}`;
}

export function cardLabel(c: Card): string {
  return `${rankLabel(c.rank)}${SUIT_SYMBOL[c.suit]}`;
}

export function suitColorClass(suit: Suit): string {
  return suit === 'H' || suit === 'D' ? 'text-rose-600' : 'text-slate-900';
}

/** Default seat display names, human first. Mirrors Leekha's local bot naming. */
export const SEAT_NAMES: Record<Seat, string> = {
  0: 'You',
  1: 'Rami',
  2: 'Nour',
  3: 'Sami',
};

export function contractsLabel(contracts: Contract[]): string {
  return contracts.map((c) => CONTRACT_LABEL[c]).join(' + ');
}
