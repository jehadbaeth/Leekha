import type { Card, Suit } from '@leekha/engine';
import { isLeekha } from '@leekha/engine';
import type { Settings } from './settings';

export const SUIT_SYMBOL: Record<Suit, string> = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
};

export const SUIT_NAME: Record<Suit, string> = {
  S: 'Spades',
  H: 'Hearts',
  D: 'Diamonds',
  C: 'Clubs',
};

export const SUIT_NAME_AR: Record<Suit, string> = {
  S: 'البستوني',
  H: 'الهارت',
  D: 'الديناري',
  C: 'الشبة',
};

export function rankLabel(rank: Card['rank']): string {
  if (rank === 14) return 'A';
  if (rank === 13) return 'K';
  if (rank === 12) return 'Q';
  if (rank === 11) return 'J';
  return String(rank);
}

export function rankFullName(rank: Card['rank']): string {
  if (rank === 14) return 'Ace';
  if (rank === 13) return 'King';
  if (rank === 12) return 'Queen';
  if (rank === 11) return 'Jack';
  return String(rank);
}

export function rankFullNameAr(rank: Card['rank']): string {
  if (rank === 14) return 'الآس';
  if (rank === 13) return 'الشايب';
  if (rank === 12) return 'البنت';
  if (rank === 11) return 'الولد';
  return String(rank);
}

export function cardName(c: Card, language: Settings['language'] = 'en'): string {
  if (language === 'ar') return `${rankFullNameAr(c.rank)} ${SUIT_NAME_AR[c.suit]}`;
  return `${rankFullName(c.rank)} of ${SUIT_NAME[c.suit]}`;
}

export function cardKey(c: Card): string {
  return `${c.suit}${c.rank}`;
}

const HAND_SUIT_ORDER: Suit[] = ['S', 'H', 'D', 'C'];

export function sortHand(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const suitDiff = HAND_SUIT_ORDER.indexOf(a.suit) - HAND_SUIT_ORDER.indexOf(b.suit);
    if (suitDiff !== 0) return suitDiff;
    return b.rank - a.rank; // Ace high to 2 low within each suit
  });
}

export function suitColor(suit: Suit, fourColor: boolean): string {
  if (fourColor) {
    if (suit === 'S') return 'text-slate-900 dark:text-slate-100';
    if (suit === 'C') return 'text-emerald-600';
    if (suit === 'H') return 'text-rose-600';
    return 'text-sky-600';
  }
  return suit === 'H' || suit === 'D' ? 'text-rose-600' : 'text-slate-900';
}

export function leekhaBadge(c: Card): string | null {
  if (c.suit === 'D' && c.rank === 10) return '10♦';
  if (c.suit === 'S' && c.rank === 12) return 'Q♠';
  if (c.suit === 'C' && c.rank === 13) return 'K♣';
  return null;
}

export { isLeekha };
