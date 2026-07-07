import type { Card, RulesConfig, TrickState } from './types.js';
import { isLeekha } from './types.js';

function winningRank(trick: TrickState, led: Card['suit']): number {
  const ledPlays = trick.plays.filter((p) => p.card.suit === led);
  return Math.max(...ledPlays.map((p) => p.card.rank));
}

export function legalPlaysFor(hand: Card[], trick: TrickState, cfg: RulesConfig): Card[] {
  if (trick.plays.length === 0) return hand; // any lead
  const led = trick.plays[0].card.suit;
  let base = hand.filter((c) => c.suit === led); // must follow
  let freeDiscard = false;
  if (base.length === 0) {
    const leekha = hand.filter(isLeekha);
    if (cfg.forcedLeekhaDiscard && leekha.length > 0) {
      base = leekha; // forced dump
    } else {
      base = hand;
      freeDiscard = true; // free discard
    }
  }
  const leekhasOnTrick = trick.plays.map((p) => p.card).filter(isLeekha);
  const undercutApplies =
    cfg.undercutRule !== 'off' && leekhasOnTrick.length > 0 && (!freeDiscard || cfg.undercutBindsDiscards);
  if (undercutApplies) {
    const ceiling =
      cfg.undercutRule === 'leekhaRank'
        ? Math.max(...leekhasOnTrick.map((c) => c.rank))
        : winningRank(trick, led); // 'winningCard' variant
    const under = base.filter((c) => c.rank < ceiling);
    if (under.length > 0) base = under; // "unless they have nothing lower"
  }
  return base;
}

export function isForcedDump(hand: Card[], trick: TrickState, cfg: RulesConfig, played: Card): boolean {
  if (trick.plays.length === 0) return false;
  const led = trick.plays[0].card.suit;
  const followers = hand.filter((c) => c.suit === led);
  if (followers.length > 0) return false; // could follow suit, not forced
  if (played.suit === led) return false;
  const leekha = hand.filter(isLeekha);
  return cfg.forcedLeekhaDiscard && leekha.length > 0 && isLeekha(played);
}
