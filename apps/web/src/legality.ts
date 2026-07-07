import type { Card, TrickState, RulesConfig } from '@leekha/engine';
import { isLeekha } from '@leekha/engine';
import { SUIT_NAME, SUIT_NAME_AR, leekhaBadge } from './cardDisplay';
import { pick, type Settings } from './settings';

function winningRank(trick: TrickState, led: Card['suit']): number {
  const ledPlays = trick.plays.filter((p) => p.card.suit === led);
  return Math.max(...ledPlays.map((p) => p.card.rank));
}

/**
 * Explains why a card the player tapped is not currently legal, mirroring the
 * branches of legalPlaysFor in packages/engine/src/legal.ts. Used only for
 * player-facing messaging; it never changes what is actually legal.
 */
export function illegalReason(
  hand: Card[],
  trick: TrickState,
  cfg: RulesConfig,
  card: Card,
  language: Settings['language'] = 'en',
): string {
  const t = (en: string, ar: string) => pick(language, en, ar);
  if (trick.plays.length === 0) return '';
  const led = trick.plays[0].card.suit;
  const followers = hand.filter((c) => c.suit === led);

  let base: Card[];
  let freeDiscard = false;

  if (followers.length > 0) {
    if (card.suit !== led) {
      return t(`You must follow ${SUIT_NAME[led].toLowerCase()}`, `يجب أن تلحق بـ ${SUIT_NAME_AR[led]}`);
    }
    const leekhaOfSuit = followers.filter(isLeekha);
    const forcedBySuit =
      cfg.forcedLeekhaDiscard && leekhaOfSuit.length > 0 && leekhaOfSuit[0].rank < winningRank(trick, led);
    if (forcedBySuit) {
      base = leekhaOfSuit;
      if (!isLeekha(card)) {
        const label = leekhaBadge(leekhaOfSuit[0]) ?? '';
        return t(`Leekha rule: you must play ${label}`, `قاعدة الليخة: يجب أن تلعب ${label}`);
      }
    } else {
      base = followers;
    }
  } else {
    const leekha = hand.filter(isLeekha);
    const mustDump = cfg.forcedLeekhaDiscard && leekha.length > 0;
    base = mustDump ? leekha : hand;
    freeDiscard = !mustDump;
    if (mustDump && !isLeekha(card)) {
      return t('Leekha rule: you must play 10♦, Q♠ or K♣', 'قاعدة الليخة: يجب أن تلعب 10♦ أو Q♠ أو K♣');
    }
  }

  const leekhasOnTrick = trick.plays.map((p) => p.card).filter(isLeekha);
  const undercutApplies =
    cfg.undercutRule !== 'off' && leekhasOnTrick.length > 0 && (!freeDiscard || cfg.undercutBindsDiscards);

  if (undercutApplies) {
    const ceiling =
      cfg.undercutRule === 'leekhaRank'
        ? Math.max(...leekhasOnTrick.map((c) => c.rank))
        : Math.max(...trick.plays.filter((p) => p.card.suit === led).map((p) => p.card.rank));
    const under = base.filter((c) => c.rank < ceiling);
    if (under.length > 0 && card.rank >= ceiling) {
      const topLeekha = leekhasOnTrick.sort((a, b) => b.rank - a.rank)[0];
      const label = topLeekha.suit === 'D' ? '10♦' : topLeekha.suit === 'S' ? 'Q♠' : 'K♣';
      return t(`Undercut rule: you must play below the ${label}`, `قاعدة اللعب تحت: يجب أن تلعب أقل من ${label}`);
    }
  }

  return t('That card is not legal right now', 'هذه الورقة غير مسموحة الآن');
}

/** True when the current player is forced to surrender a Leekha card right now, either by following suit with the led suit's own Leekha card or by dumping one while void. */
export function isForcedDumpSituation(hand: Card[], trick: TrickState, cfg: RulesConfig): boolean {
  if (trick.plays.length === 0) return false;
  const led = trick.plays[0].card.suit;
  const followers = hand.filter((c) => c.suit === led);
  if (followers.length === 0) {
    return cfg.forcedLeekhaDiscard && hand.some(isLeekha);
  }
  const leekhaOfSuit = followers.filter(isLeekha);
  return cfg.forcedLeekhaDiscard && leekhaOfSuit.length > 0 && leekhaOfSuit[0].rank < winningRank(trick, led);
}

/** The highest Leekha card currently lying on the trick, if the undercut rule is active for it. */
export function undercutMarkerCard(trick: TrickState, cfg: RulesConfig): Card | null {
  if (cfg.undercutRule === 'off') return null;
  const leekhas = trick.plays.map((p) => p.card).filter(isLeekha);
  if (leekhas.length === 0) return null;
  return leekhas.sort((a, b) => b.rank - a.rank)[0];
}
