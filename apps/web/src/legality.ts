import type { Card, TrickState, RulesConfig } from '@leekha/engine';
import { isLeekha } from '@leekha/engine';
import { SUIT_NAME } from './cardDisplay';

/**
 * Explains why a card the player tapped is not currently legal, mirroring the
 * branches of legalPlaysFor in packages/engine/src/legal.ts. Used only for
 * player-facing messaging; it never changes what is actually legal.
 */
export function illegalReason(hand: Card[], trick: TrickState, cfg: RulesConfig, card: Card): string {
  if (trick.plays.length === 0) return '';
  const led = trick.plays[0].card.suit;
  const followers = hand.filter((c) => c.suit === led);

  if (followers.length > 0) {
    return `You must follow ${SUIT_NAME[led].toLowerCase()}`;
  }

  const leekha = hand.filter(isLeekha);
  const mustDump = cfg.forcedLeekhaDiscard && leekha.length > 0;
  const leekhasOnTrick = trick.plays.map((p) => p.card).filter(isLeekha);
  const freeDiscard = !mustDump;
  const undercutApplies =
    cfg.undercutRule !== 'off' && leekhasOnTrick.length > 0 && (!freeDiscard || cfg.undercutBindsDiscards);

  if (mustDump && !isLeekha(card)) {
    return 'Leekha rule: you must play 10♦, Q♠ or K♣';
  }

  if (undercutApplies) {
    const ceiling =
      cfg.undercutRule === 'leekhaRank'
        ? Math.max(...leekhasOnTrick.map((c) => c.rank))
        : Math.max(...trick.plays.filter((p) => p.card.suit === led).map((p) => p.card.rank));
    const base = mustDump ? leekha : hand;
    const under = base.filter((c) => c.rank < ceiling);
    if (under.length > 0 && card.rank >= ceiling) {
      const topLeekha = leekhasOnTrick.sort((a, b) => b.rank - a.rank)[0];
      const label = topLeekha.suit === 'D' ? '10♦' : topLeekha.suit === 'S' ? 'Q♠' : 'K♣';
      return `Undercut rule: you must play below the ${label}`;
    }
  }

  return 'That card is not legal right now';
}

/** True when a void player with no follow-suit cards is currently forced to dump a Leekha card. */
export function isForcedDumpSituation(hand: Card[], trick: TrickState, cfg: RulesConfig): boolean {
  if (trick.plays.length === 0) return false;
  const led = trick.plays[0].card.suit;
  const followers = hand.filter((c) => c.suit === led);
  if (followers.length > 0) return false;
  const leekha = hand.filter(isLeekha);
  return cfg.forcedLeekhaDiscard && leekha.length > 0;
}

/** The highest Leekha card currently lying on the trick, if the undercut rule is active for it. */
export function undercutMarkerCard(trick: TrickState, cfg: RulesConfig): Card | null {
  if (cfg.undercutRule === 'off') return null;
  const leekhas = trick.plays.map((p) => p.card).filter(isLeekha);
  if (leekhas.length === 0) return null;
  return leekhas.sort((a, b) => b.rank - a.rank)[0];
}
