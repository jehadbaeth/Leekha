import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Card, MatchResult, Seat, SeatView } from '@leekha/engine';
import { nextSeat, partnerOf, prevSeat, teamOf } from '@leekha/engine';
import { CardFace } from './CardFace';
import { Avatar, type PresenceStatus } from './Avatar';
import { Flag } from './Flag';
import { PassingPanel } from './PassingPanel';
import { RoundSummary } from './RoundSummary';
import { MatchEnd } from './MatchEnd';
import { cardKey, cardName, isLeekha, sortHand } from '../cardDisplay';
import { illegalReason, isForcedDumpSituation, undercutMarkerCard } from '../legality';
import { pick, type Settings } from '../settings';
import { isBigCard, playCardSound, trickEndSound, roundEndSound, gameOverSound, emoteSound, dealSound, vibrate } from '../sound';
import { EMOTES, EMOTE_BY_ID } from '../emotes';
import { useRoomShare } from '../roomShare';
import { fanLayout, needsTwoStories } from '../fanLayout';
import { avatarGapForContainer, avatarSizeForContainer, cardHeightForWidth, cardWidthForContainer, trickCardWidthForCircle, trickCircleForContainer } from '../tableScale';

// Online events arrive as ServerMessage (type 'game.trickEnd') while local
// events arrive as engine GameEvent (type 'trickEnd'); accept either spelling.
function isEventType(type: string, suffix: 'played' | 'trickEnd' | 'roundEnd' | 'gameOver'): boolean {
  return type === suffix || type === `game.${suffix === 'gameOver' ? 'over' : suffix}`;
}

/** Localized country name from a 2-letter code, falling back to the raw code where Intl lacks the region (or the browser lacks Intl.DisplayNames). */
function regionName(cc: string, language: 'en' | 'ar'): string {
  try {
    return new Intl.DisplayNames([language], { type: 'region' }).of(cc.toUpperCase()) ?? cc;
  } catch {
    return cc;
  }
}

interface FrozenTrick {
  leader: Seat;
  plays: { seat: Seat; card: Card; forced: boolean }[];
  winner: Seat;
  points: number;
}

/**
 * The core table screen (SPEC.md section 7.2). It only ever consumes a
 * SeatView plus a handful of transient bits (passesApplied, passProgress,
 * matchResult) that a MatchState-backed local match and a socket-backed
 * online match can both produce — see useGame.ts and useOnlineGame.ts. This
 * keeps GameTable itself framework/transport agnostic, per CLAUDE.md's rule
 * that clients only ever consume SeatView.
 *
 * "You" are not assumed to be seat 0: online, view.seat can be any of 0-3, so
 * every screen position (bottom/right/top/left) is computed relative to it,
 * per SPEC.md 7.2 ("the local player is always at the bottom regardless of
 * seat number").
 */
export function GameTable({
  view,
  names,
  events,
  clearEvent,
  passesApplied,
  passProgress,
  matchResult,
  presence,
  turnDeadline,
  emotes,
  onEmote,
  rematchVotes,
  spectator,
  spectators,
  countries,
  claimableSeats,
  onClaimSeat,
  settings,
  onCommitPass,
  onPlayCard,
  onAdvanceRound,
  roundAutoAdvances,
  onRematch,
  onHome,
  roomCode,
  hudOverride,
  centerOverride,
  bottomOverride,
  overlayOverride,
  seatSubline,
  suppressCaptureSounds,
  seatExposed,
}: {
  view: SeatView;
  names: Record<Seat, string>;
  events: { id: number; event: { type: string } }[];
  clearEvent: (id: number) => void;
  passesApplied: boolean;
  passProgress: boolean[];
  matchResult?: MatchResult;
  presence?: Record<Seat, PresenceStatus>;
  turnDeadline?: { seat: Seat; deadline: number | null } | null;
  /** Online only (SPEC.md 7.5.11): the most recent emote id per seat, keyed with a timestamp so repeats retrigger. */
  emotes?: Record<Seat, { id: string; ts: number } | null>;
  onEmote?: (id: string) => void;
  /** Online only: who has voted to play again once the match ends, and who still needs to (bots are never counted). Absent for local play, where a rematch is a single unilateral click. */
  rematchVotes?: { seatsVoted: Seat[]; seatsNeeded: Seat[] } | null;
  /** Online only: this socket holds no seat (SPEC.md 11) — view.seat is a fixed, fictitious 0 with hand/legal always blanked, so the hand tray, passing panel, and rematch vote UI must all stay out of the way. */
  spectator?: boolean;
  /** Online only: how many seatless watchers the room has and, aggregated, which countries they connect from. */
  spectators?: { count: number; countries: Record<string, number> } | null;
  /** Online only: ISO 3166-1 alpha-2 per seat (from room.state), shown as a flag next to each player's name. */
  countries?: Partial<Record<Seat, string | null>>;
  /** Online only: bot-controlled seats a human with no seat can claim, shown as the sidelines list (SPEC.md 11). */
  claimableSeats?: Seat[];
  onClaimSeat?: (seat: Seat) => void;
  settings: Settings;
  onCommitPass: (cards: [Card, Card, Card]) => void;
  onPlayCard: (card: Card) => void;
  onAdvanceRound: () => void;
  /** Online only: the server advances rounds on its own timer, so the round summary shows a "starting shortly" note instead of a Continue button that would do nothing. */
  roundAutoAdvances?: boolean;
  onRematch: () => void;
  onHome: () => void;
  /** Online only: lets the room-code share button render inside the game screen too, not just the pre-game Lobby (SPEC.md 7.1 item 2). */
  roomCode?: string | null;
  // Game-agnostic seams (SPEC-TRIX: one shared table, rule engines differ).
  // All optional; when omitted the table renders EXACTLY as Leekha always has,
  // so Leekha parity is preserved by construction. Trix supplies these to reuse
  // the same avatars, hand fan, trick circle, emotes, and sounds.
  hudOverride?: ReactNode; // replaces the HUD strip content
  centerOverride?: ReactNode; // replaces the trick circle (e.g. Trix Fan-Tan board)
  bottomOverride?: ReactNode; // replaces the hand tray / passing panel region
  overlayOverride?: ReactNode; // replaces the round-summary / match-end overlay
  seatSubline?: (seat: Seat) => number; // replaces each avatar's round-score line (e.g. Trix tally)
  suppressCaptureSounds?: boolean; // skip the Leekha capture/round/game sound stings (a game with its own or no sounds)
  seatExposed?: Partial<Record<Seat, Card[]>>; // small face-up cards shown in front of a seat, visible to all (Trix doubled honors + revealed 2s)
}) {
  const t = (en: string, ar: string) => pick(settings.language, en, ar);
  const mySeat = view.seat;
  const rightSeat = nextSeat(mySeat);
  const topSeat = partnerOf(mySeat);
  const leftSeat = prevSeat(mySeat);

  const turnSeatOf = (trick: { leader: Seat; plays: unknown[] }): Seat =>
    (((trick.leader as number) + trick.plays.length) % 4) as Seat;

  const [raised, setRaised] = useState<Card | null>(null);
  const [reasonToast, setReasonToast] = useState<string | null>(null);
  const [showLastTrick, setShowLastTrick] = useState(false);
  const [showMemo, setShowMemo] = useState(false);
  const [frozenTrick, setFrozenTrick] = useState<FrozenTrick | null>(null);
  const [receivedReveal, setReceivedReveal] = useState(false);
  const wasPassesApplied = useRef(false);
  const revealTimer = useRef<number | null>(null);
  const freezeTimer = useRef<number | null>(null);
  const autoPlayedTrick = useRef<string | null>(null);
  const [visibleEmotes, setVisibleEmotes] = useState<Partial<Record<Seat, { anim: string; caption: string; ts: number }>>>({});
  const [showEmotePicker, setShowEmotePicker] = useState(false);
  const [showSpectators, setShowSpectators] = useState(false);
  const [pendingPlay, setPendingPlay] = useState(false);
  const pendingPlayRef = useRef(false);
  const pendingPlayTimer = useRef<number | null>(null);
  const [dealFx, setDealFx] = useState(false);
  const [dealStarted, setDealStarted] = useState(false);
  // The hand fan sizes itself to the tray's real width (see the hand-tray
  // comment below), so the tray element has to be measured; a callback ref
  // (not useRef) makes the measuring effect re-run when the tray mounts and
  // unmounts across phases, which a plain ref would never signal.
  const [trayEl, setTrayEl] = useState<HTMLDivElement | null>(null);
  const [trayW, setTrayW] = useState(0);
  // Avatars and the trick circle need a width too, but they're mounted in
  // every phase (including passing, when the hand tray above isn't), so they
  // can't piggyback on trayW -- this measures the outer table container
  // itself instead, which is always present.
  const [tableEl, setTableEl] = useState<HTMLDivElement | null>(null);
  const [tableW, setTableW] = useState(0);
  useLayoutEffect(() => {
    if (!tableEl) return;
    const measure = () => setTableW(tableEl.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(tableEl);
    return () => ro.disconnect();
  }, [tableEl]);
  const avatarSize = avatarSizeForContainer(tableW);
  // Sticky per-round row assignment for the two-story hand: each card is
  // pinned to a row when the round's hand first appears and keeps that row
  // until the round ends, so playing a card never reshuffles which row the
  // others live in (recomputing the split every render did exactly that,
  // and cards visibly jumping rows after every play was one of the original
  // complaints about the old two-row tray). The map is rebuilt only when a
  // card shows up that it doesn't know -- i.e. at a new deal.
  const handRowsRef = useRef<Map<string, 0 | 1>>(new Map());
  useLayoutEffect(() => {
    if (!trayEl) return;
    const measure = () => setTrayW(trayEl.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(trayEl);
    return () => ro.disconnect();
  }, [trayEl]);
  const { copied: codeCopied, share: shareRoom } = useRoomShare(roomCode ?? null, settings.language);

  const turn = view.phase === 'playing' ? turnSeatOf(view.currentTrick) : null;
  const isMyTurn = turn === mySeat && !!view.legal && !pendingPlay;

  // Once a play is sent, block further plays until the turn actually moves on
  // (locally that's near-instant; online it waits out the round trip to the
  // server). Without this, a second tap/drag during that window — or a second
  // finger dragging a different card at the same time, whose gesture handler
  // captured isMyTurn/legal from before the first play landed — could queue
  // up a second play attempt before the UI has any sign the first one landed.
  // pendingPlayRef is checked and set synchronously so two calls arriving in
  // the same tick can't both slip through; the state copy just drives render.
  // A short timeout is a safety net in case the play is silently rejected and
  // the turn never moves, so the hand doesn't lock up for good.
  function submitPlay(card: Card) {
    if (pendingPlayRef.current) return;
    pendingPlayRef.current = true;
    setPendingPlay(true);
    if (pendingPlayTimer.current) window.clearTimeout(pendingPlayTimer.current);
    pendingPlayTimer.current = window.setTimeout(() => {
      pendingPlayRef.current = false;
      setPendingPlay(false);
    }, 2000);
    onPlayCard(card);
  }

  useEffect(() => {
    pendingPlayRef.current = false;
    setPendingPlay(false);
    if (pendingPlayTimer.current) {
      window.clearTimeout(pendingPlayTimer.current);
      pendingPlayTimer.current = null;
    }
  }, [turn]);

  // Show each incoming emote as a big sticker pop above its seat for ~2.5s (SPEC.md 7.5.11).
  // This effect re-runs whenever ANY seat's ts changes (it has to, since a single
  // effect can't have a per-seat dependency list), so it must only act on seats
  // whose ts is actually new since last processed — otherwise every still-truthy
  // entry in `emotes` (which never resets to null once a seat has ever fired) gets
  // replayed alongside the real new one: its sound replays, and if its own display
  // window had already elapsed, its sticker pops again as a "ghost" of an emote
  // that was sent long ago, whenever anyone else fires a fresh one.
  const lastEmoteTsRef = useRef<Record<Seat, number>>({ 0: 0, 1: 0, 2: 0, 3: 0 });
  useEffect(() => {
    if (!emotes) return;
    const timers: number[] = [];
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      const e = emotes[seat];
      if (!e || e.ts === lastEmoteTsRef.current[seat]) continue;
      lastEmoteTsRef.current[seat] = e.ts;
      const def = EMOTE_BY_ID[e.id];
      if (!def) continue;
      setVisibleEmotes((prev) => ({ ...prev, [seat]: { anim: def.anim, caption: t(def.en, def.ar), ts: e.ts } }));
      if (settings.sound) emoteSound(e.id);
      timers.push(
        window.setTimeout(() => {
          setVisibleEmotes((prev) => ({ ...prev, [seat]: undefined }));
        }, 2500),
      );
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emotes ? ([0, 1, 2, 3] as Seat[]).map((s) => emotes[s]?.ts ?? 0).join(',') : '', settings.sound, settings.language]);

  // Detect the moment a pass gets applied, to show the "you received" reveal briefly.
  useEffect(() => {
    if (passesApplied && !wasPassesApplied.current) {
      setReceivedReveal(true);
      revealTimer.current = window.setTimeout(() => setReceivedReveal(false), 3000);
    }
    wasPassesApplied.current = passesApplied;
    return () => {
      if (revealTimer.current) window.clearTimeout(revealTimer.current);
    };
  }, [passesApplied]);

  // Reset per-round local UI state.
  useEffect(() => {
    setRaised(null);
    setReasonToast(null);
    setShowLastTrick(false);
  }, [view.roundIndex]);

  // A quick, cosmetic "cards flying out" flourish whenever a fresh hand has
  // just been dealt. The hand is already fully playable underneath it, so
  // this never blocks input; it just self-dismisses well under 2s. The
  // cleanup resets dealFx itself (not just the timer) so that React 18
  // StrictMode's dev-only mount->cleanup->mount double-invoke on the very
  // first round can't cancel the hide timer and leave the overlay stuck
  // on screen with nothing left to dismiss it.
  useEffect(() => {
    if (settings.reducedMotion) return;
    setDealFx(true);
    setDealStarted(false);
    const raf = requestAnimationFrame(() => setDealStarted(true));
    if (settings.sound) {
      [0, 1, 2, 3].forEach((i) => window.setTimeout(() => dealSound(i), i * 90));
    }
    const doneTimer = window.setTimeout(() => setDealFx(false), 950);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(doneTimer);
      setDealFx(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.roundIndex]);

  // Sound + haptics for card plays, trick ends, and round/game endings
  // (SPEC.md section 7.5.6: distinct sting for Q♠/K♣/10♦ tricks).
  useEffect(() => {
    for (const item of events) {
      const type = item.event.type;
      if (isEventType(type, 'played')) {
        if (settings.sound) playCardSound();
        if (settings.haptics) vibrate(8);
      } else if (isEventType(type, 'trickEnd')) {
        // The trick-capture ("eating") sting and the round/game stings are
        // Leekha-tuned (a special sound for Q♠/K♣/10♦). A game can opt out of
        // them via suppressCaptureSounds while still getting the card-play click
        // and the trick-freeze pause.
        const ev = item.event as unknown as { cards: { card: Card }[] };
        const big = ev.cards?.some((p) => isBigCard(p.card)) ?? false;
        if (settings.sound && !suppressCaptureSounds) trickEndSound(big);
        if (settings.haptics) vibrate(big ? [20, 40, 20] : 15);
      } else if (isEventType(type, 'roundEnd')) {
        if (settings.sound && !suppressCaptureSounds) roundEndSound();
        if (settings.haptics) vibrate([15, 30, 15, 30]);
      } else if (isEventType(type, 'gameOver')) {
        const ev = item.event as unknown as { losingTeam: 0 | 1 };
        const won = ev.losingTeam !== teamOf(mySeat);
        if (settings.sound && !suppressCaptureSounds) gameOverSound(won);
        if (settings.haptics) vibrate(won ? [30, 50, 30, 50, 30] : [60]);
      }
    }
  }, [events, settings.sound, settings.haptics, mySeat, suppressCaptureSounds]);

  // Freeze the completed trick on screen briefly, highlighting the winner.
  useEffect(() => {
    const trickEndEvents = events.filter((e) => isEventType(e.event.type, 'trickEnd'));
    for (const item of trickEndEvents) {
      const ev = item.event as unknown as { winner: Seat; points: number };
      const completed = view.playedCards[view.playedCards.length - 1];
      if (completed) {
        setFrozenTrick({ leader: completed[0]?.seat ?? 0, plays: completed, winner: ev.winner, points: ev.points });
        if (freezeTimer.current) window.clearTimeout(freezeTimer.current);
        const ms = settings.reducedMotion ? 50 : settings.trickPauseMs;
        freezeTimer.current = window.setTimeout(() => setFrozenTrick(null), ms);
      }
      clearEvent(item.id);
    }
    for (const item of events) {
      if (!isEventType(item.event.type, 'trickEnd')) clearEvent(item.id);
    }
  }, [events, clearEvent, view.playedCards, settings.reducedMotion, settings.trickPauseMs]);

  // Auto play when exactly one legal card and the setting is on.
  useEffect(() => {
    if (!settings.autoPlaySingleLegal) return;
    if (view.phase !== 'playing' || !isMyTurn || !view.legal) return;
    if (view.legal.length !== 1) return;
    const key = `${view.roundIndex}-${view.trickNumber}-${view.currentTrick.plays.length}`;
    if (autoPlayedTrick.current === key) return;
    autoPlayedTrick.current = key;
    submitPlay(view.legal[0]);
  }, [settings.autoPlaySingleLegal, isMyTurn, view]);

  function tapCard(card: Card) {
    if (view.phase !== 'playing' || !isMyTurn || !view.legal) return;
    const legal = view.legal.some((c) => cardKey(c) === cardKey(card));
    if (!legal) {
      setReasonToast(illegalReason(view.hand, view.currentTrick, view.config, card, settings.language));
      window.setTimeout(() => setReasonToast(null), 2200);
      return;
    }
    if (!settings.confirmBeforePlay) {
      submitPlay(card);
      setRaised(null);
      return;
    }
    if (raised && cardKey(raised) === cardKey(card)) {
      submitPlay(card);
      setRaised(null);
    } else {
      setRaised(card);
    }
  }

  // Mobile-first alternative to tap-then-confirm: drag a card up past the
  // throw threshold to play it in one gesture. A pointerdown that never
  // crosses the movement threshold falls back to tapCard's existing
  // tap/tap-to-confirm behavior, so mouse users are unaffected.
  const DRAG_THROW_THRESHOLD = 56;
  function onCardPointerDown(e: React.PointerEvent<HTMLButtonElement>, card: Card, legal: boolean) {
    const el = e.currentTarget;
    const startY = e.clientY;
    // The fan's rotate/lift lives in this same inline transform, so an aborted
    // drag has to restore it verbatim -- clearing it would leave the card
    // sitting straight and flat until the next unrelated re-render.
    const baseTransform = el.style.transform;
    const baseZ = el.style.zIndex;
    el.setPointerCapture(e.pointerId);
    let dragging = false;

    function onMove(ev: PointerEvent) {
      const dy = startY - ev.clientY;
      if (!dragging && Math.abs(dy) > 6) dragging = true;
      if (!dragging) return;
      const lift = Math.max(0, dy);
      el.style.transition = 'none';
      el.style.zIndex = '30';
      el.style.transform = `translateY(${-lift}px) scale(${1 + Math.min(lift, 60) / 300})`;
    }

    function onUp(ev: PointerEvent) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const dy = startY - ev.clientY;
      el.style.transition = 'transform 150ms ease, opacity 150ms ease';
      if (dragging && dy > DRAG_THROW_THRESHOLD && legal && isMyTurn) {
        el.style.transform = 'translateY(-160px) scale(0.85)';
        el.style.opacity = '0';
        submitPlay(card);
        setRaised(null);
      } else {
        el.style.transform = baseTransform;
        el.style.zIndex = baseZ;
        if (!dragging) tapCard(card);
      }
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  const dealer = view.dealer;
  const passRecipient = names[nextSeat(mySeat)];

  const dangerFor = (s: Seat) => view.scores[s] >= view.config.targetScore - 30;
  const deadlineFor = (s: Seat) => (turnDeadline?.seat === s ? turnDeadline.deadline : null);

  const trickPlays = frozenTrick ? frozenTrick.plays : view.currentTrick.plays;
  const winnerSeatForHighlight = frozenTrick?.winner ?? null;

  const lastCompletedTrick = view.playedCards[view.playedCards.length - 1] ?? null;

  // Small face-up cards shown in front of a seat, visible to everyone (Trix
  // doubled honors and revealed 2s). Rendered next to each avatar / the hand.
  const exposedFor = (seat: Seat) => {
    const cards = seatExposed?.[seat];
    if (!cards || cards.length === 0) return null;
    return (
      <div className="flex gap-0.5 justify-center flex-wrap max-w-[7rem]">
        {cards.map((c, i) => (
          <CardFace key={`${c.suit}${c.rank}-${i}`} card={c} width={22} fourColor={settings.fourColorDeck} />
        ))}
      </div>
    );
  };

  const myPassedMemo = view.youPassed;
  const forcedDumpActive = isMyTurn ? isForcedDumpSituation(view.hand, view.currentTrick, view.config) : false;
  const undercutCard = frozenTrick ? null : undercutMarkerCard(view.currentTrick, view.config);

  function posFor(seat: Seat): 'bottom-0 left-1/2 -translate-x-1/2' | 'right-0 top-1/2 -translate-y-1/2' | 'top-0 left-1/2 -translate-x-1/2' | 'left-0 top-1/2 -translate-y-1/2' {
    if (seat === mySeat) return 'bottom-0 left-1/2 -translate-x-1/2';
    if (seat === rightSeat) return 'right-0 top-1/2 -translate-y-1/2';
    if (seat === topSeat) return 'top-0 left-1/2 -translate-x-1/2';
    return 'left-0 top-1/2 -translate-y-1/2';
  }

  return (
    // The inner flex column is a separate element from the `@container` box
    // below: a container query can't target the element establishing the
    // container itself (self-referential queries are disallowed), so
    // `@[900px]:justify-center` -- which needs to react to the container's own
    // width -- has to live one level down, on a child.
    <div className="@container relative h-full w-full overflow-y-auto overflow-x-hidden select-none">
    <div ref={setTableEl} className="relative h-full w-full flex flex-col @[900px]:justify-center bg-gradient-to-b from-felt-900 to-felt-950 select-none">
      {/* Deal flourish: four quick card bursts flying out from the center, purely
          cosmetic and non-blocking (the real hand underneath is already playable). */}
      {dealFx && (
        <div className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center">
          {(
            [
              ['bottom', 'translate(0px, 150px)'],
              ['right', 'translate(150px, 0px)'],
              ['top', 'translate(0px, -150px)'],
              ['left', 'translate(-150px, 0px)'],
            ] as const
          ).map(([dir, target], i) => (
            <div
              key={dir}
              className="absolute ease-out"
              style={{
                transitionProperty: 'transform, opacity',
                transitionDuration: '520ms',
                transitionDelay: `${i * 90}ms`,
                transform: dealStarted ? target : 'translate(0px, 0px)',
                opacity: dealStarted ? 0 : 1,
              }}
            >
              <div className="flex -space-x-6">
                <CardFace card={{ suit: 'S', rank: 2 }} size="sm" faceDown />
                <CardFace card={{ suit: 'S', rank: 2 }} size="sm" faceDown />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Top: partner. paddingBottom scales with avatarSize (not a fixed px/tier)
          so the gap to the trick circle grows continuously with the table
          instead of freezing at one distance past some breakpoint. */}
      <div className="flex flex-col items-center pt-3 @[900px]:pt-4 gap-0.5" style={{ paddingBottom: Math.round(avatarGapForContainer(avatarSize)) }}>
        <Avatar
          name={names[topSeat]}
          score={view.scores[topSeat]}
          roundScore={seatSubline ? seatSubline(topSeat) : view.eatenPoints[topSeat]}
          isTurn={turn === topSeat}
          isDealer={dealer === topSeat}
          danger={dangerFor(topSeat)}
          team={teamOf(topSeat)}
          presence={presence?.[topSeat]}
          country={countries ? (countries[topSeat] ?? null) : undefined}
          deadline={deadlineFor(topSeat)}
          emote={visibleEmotes[topSeat]}
          emoteDirection="down"
          size={avatarSize}
        />
        {exposedFor(topSeat)}
      </div>

      {/* Middle: left - trick area - right. dir="ltr" pins the seating
          geometry: under the Arabic UI's RTL direction a plain flex row
          reverses visually, which put the pass recipient (physically to
          your right, in every language) on the left of the screen. Seat
          positions are table geometry, not text. */}
      {/* max-w-[min(...,...cqw)]: bounds how far apart the two avatars can
          spread on a wide table, without freezing at a fixed px/rem value --
          cqw is relative to the @container box above, so it keeps scaling
          continuously with the shell instead of capping out and leaving the
          avatars pinned at a stale distance once the container outgrows one
          breakpoint tier. Without this, `justify-between` on a full-width row
          pushes both avatars all the way to the shell's edges on a big
          screen, which reads as a big empty stretch between them. Gated to
          the @[900px] tier only: below that (every phone, portrait or
          landscape) the cap was squeezing Sami/Rami in toward the trick
          circle instead of out toward the screen edges, which is exactly
          backwards from what a cramped phone screen needs -- there, plain
          `justify-between` on the full row width is what pushes them out. */}
      <div
        dir="ltr"
        className="flex-1 min-h-0 @[900px]:flex-none flex items-center justify-between px-2 @[900px]:px-10 @[900px]:py-4 mx-auto w-full @[900px]:max-w-[min(760px,78cqw)]"
      >
        <div className="flex flex-col items-center gap-0.5">
          <Avatar
            name={names[leftSeat]}
            score={view.scores[leftSeat]}
            roundScore={seatSubline ? seatSubline(leftSeat) : view.eatenPoints[leftSeat]}
            isTurn={turn === leftSeat}
            isDealer={dealer === leftSeat}
            danger={dangerFor(leftSeat)}
            team={teamOf(leftSeat)}
            presence={presence?.[leftSeat]}
            country={countries ? (countries[leftSeat] ?? null) : undefined}
            deadline={deadlineFor(leftSeat)}
            emote={visibleEmotes[leftSeat]}
            size={avatarSize}
          />
          {exposedFor(leftSeat)}
        </div>

        <div
          className="flex-1 min-h-0 min-w-0 flex flex-col items-center justify-center gap-1 relative"
          style={{
            minHeight: trickCircleForContainer(tableW) + 20,
            // A game override (Trix's board) wants all the width it can get, so
            // don't squeeze it with the avatar gap; the trick circle keeps it.
            marginInline: centerOverride ? 2 : Math.round(avatarGapForContainer(avatarSize) * 0.85),
          }}
        >
          {/* Continuous diameter, not the old @[480px]/@[900px] tiers: those
              froze at a fixed size past 900px container width, which is what
              left a big empty-looking disc on a wide desktop shell. A game with
              a centre override (Trix's board/doubling panel) gets a
              height-bounded, self-scrolling box so tall content can never grow
              the fixed-height table into a page scroll. */}
          {centerOverride ? (
            <div className="w-full max-h-full min-h-0 min-w-0 overflow-auto flex items-center justify-center">{centerOverride}</div>
          ) : (
          <div className="relative" style={{ width: trickCircleForContainer(tableW), height: trickCircleForContainer(tableW) }}>
            {/* The bounded playing surface: without it the trick's cards just
                float on the same flat felt as the rest of the table, so any
                leftover space around them reads as empty void rather than
                "table". A slightly lighter, inset-shadowed disc anchors the
                eye on a real play area. */}
            <div
              className="absolute inset-0 rounded-full bg-emerald-700/40 shadow-[inset_0_4px_20px_rgba(0,0,0,0.4)] pointer-events-none"
              style={{ margin: -Math.round(trickCircleForContainer(tableW) * 0.14) }}
            />
            {trickPlays.map((p) => {
              const pos = posFor(p.seat);
              const isWinner = winnerSeatForHighlight === p.seat;
              const isUndercutMarker = undercutCard && cardKey(undercutCard) === cardKey(p.card);
              return (
                <div key={p.seat} className={`absolute ${pos} flex flex-col items-center gap-0.5`}>
                  <div className={`relative ${isWinner ? 'ring-2 ring-amber-300 rounded-md' : ''}`}>
                    <CardFace card={p.card} width={trickCardWidthForCircle(trickCircleForContainer(tableW))} fourColor={settings.fourColorDeck} />
                    {isUndercutMarker && (
                      <span className="absolute -top-2 -right-2 text-[8px] bg-sky-500 text-white rounded-full px-1 font-bold">
                        {t('play under', 'العب أقل')}
                      </span>
                    )}
                  </div>
                  {p.forced && (
                    <span className="text-[9px] bg-red-600 text-white rounded px-1 font-bold animate-pulse">{t('forced', 'إجباري')}</span>
                  )}
                </div>
              );
            })}
            <div className="absolute inset-0 flex items-center justify-center text-emerald-700/40 text-xs pointer-events-none">
              {trickPlays.length === 0 ? '↺' : ''}
            </div>
          </div>
          )}
          {frozenTrick && frozenTrick.points > 0 && (
            <div className="text-amber-300 text-sm font-bold animate-bounce">+{frozenTrick.points} {names[frozenTrick.winner]}</div>
          )}
          {/* "You" have no avatar slot of your own (SPEC.md 7.2: you're always
              the hand at the bottom), so your own emote needs a pop of its own
              here or you'd tap the picker and see nothing happen at all. */}
          {visibleEmotes[mySeat] && (
            <div
              key={visibleEmotes[mySeat]!.ts}
              className="absolute -bottom-14 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-1 select-none pointer-events-none animate-emote-pop"
            >
              <img src={visibleEmotes[mySeat]!.anim} alt="" className="w-16 h-16 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]" />
              <span className="bg-black/75 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap">
                {visibleEmotes[mySeat]!.caption}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-0.5">
          <Avatar
            name={names[rightSeat]}
            score={view.scores[rightSeat]}
            roundScore={seatSubline ? seatSubline(rightSeat) : view.eatenPoints[rightSeat]}
            isTurn={turn === rightSeat}
            isDealer={dealer === rightSeat}
            danger={dangerFor(rightSeat)}
            team={teamOf(rightSeat)}
            presence={presence?.[rightSeat]}
            country={countries ? (countries[rightSeat] ?? null) : undefined}
            deadline={deadlineFor(rightSeat)}
            emote={visibleEmotes[rightSeat]}
            size={avatarSize}
          />
          {exposedFor(rightSeat)}
        </div>
      </div>

      {/* Emote button: right aligned, directly ABOVE the passed-cards memo
          chip (not squeezed between it and the HUD), still within easy
          thumb reach of the hand tray. The small negative top margin tucks it
          up toward the trick area's bottom edge without eating a whole row of
          layout height, and its picker opens UPWARD over the table so it never
          covers the hand. Keep this pull SMALL (-mt-3, not -mt-9): the button
          is right aligned, exactly the column the right-seat avatar's score
          sits in, so a larger negative margin rides up over that score on
          short (address-bar-reduced) phone heights. */}
      {onEmote && (
        <div dir="ltr" className="relative z-20 flex justify-end px-2 pb-1 -mt-3 pointer-events-none">
          <div className="relative pointer-events-auto">
            {showEmotePicker && (
              // w-max: an absolutely positioned box shrink-wraps to its
              // containing block -- here the 44px button wrapper -- which
              // would squash the grid to one column without it. The row is
              // pinned dir="ltr" (button bottom-right in every language),
              // so end-0 here resolves to right:0 and the panel grows
              // leftward, staying on screen.
              <div className="absolute bottom-full end-0 mb-2 w-max grid grid-cols-4 gap-1 bg-emerald-950 border border-emerald-700 rounded-xl p-2 shadow-lg">
                {EMOTES.map((e) => (
                  <button
                    key={e.id}
                    className="text-xl w-14 h-14 flex items-center justify-center rounded-lg hover:bg-emerald-800 whitespace-nowrap"
                    title={t(e.en, e.ar)}
                    onClick={() => {
                      onEmote(e.id);
                      setShowEmotePicker(false);
                    }}
                  >
                    {e.glyph}
                  </button>
                ))}
              </div>
            )}
            <button
              className="w-11 h-11 flex items-center justify-center text-2xl rounded-full bg-emerald-900/80 border border-emerald-700 shadow-lg active:scale-95"
              onClick={() => setShowEmotePicker((v) => !v)}
              aria-label={t('Emotes', 'الرموز التعبيرية')}
            >
              😊
            </button>
          </div>
        </div>
      )}

      {/* Passed memo chip: sits above the HUD strip, not below it, so it never
          crowds the hand tray underneath and clips the tops of the fanned cards. */}
      {myPassedMemo && (
        <div className="px-2 pb-1">
          <button
            className="w-full text-left bg-emerald-900/70 rounded-lg px-3 py-1.5 text-xs text-emerald-100"
            onClick={() => setShowMemo((v) => !v)}
          >
            {showMemo ? '▾' : '▸'}{' '}
            {t(
              `You passed to ${passRecipient}: ${myPassedMemo.map((c) => cardName(c)).join(', ')}`,
              `مرّرت إلى ${passRecipient}: ${myPassedMemo.map((c) => cardName(c, 'ar')).join('، ')}`,
            )}
          </button>
        </div>
      )}

      {/* HUD strip */}
      {hudOverride ?? (
      <div className="flex items-center justify-center gap-3 text-[11px] text-emerald-200 bg-emerald-950/60 py-1.5 px-2">
        <span
          className={`font-semibold px-1.5 rounded ${spectator ? 'text-amber-200' : dangerFor(mySeat) ? 'bg-red-600 text-white' : 'text-amber-200'}`}
        >
          {spectator
            ? t('👁 Watching', '👁 مشاهدة')
            : t(`You: ${view.eatenPoints[mySeat]} / ${view.scores[mySeat]}`, `أنت: ${view.eatenPoints[mySeat]} / ${view.scores[mySeat]}`)}
        </span>
        <span>&middot;</span>
        <span>{t(`Trick ${view.trickNumber}/13`, `اللفة ${view.trickNumber}/13`)}</span>
        <span>&middot;</span>
        <span>{t(`Target ${view.config.targetScore}`, `الطلوع ${view.config.targetScore}`)}</span>
        <span>&middot;</span>
        <span>{t(`Dealer: ${names[dealer]}`, `الموزّع: ${names[dealer]}`)}</span>
        {lastCompletedTrick && (
          <>
            <span>&middot;</span>
            <button className="underline" onClick={() => setShowLastTrick(true)}>
              {t('Last trick', 'اللفة الأخيرة')}
            </button>
          </>
        )}
      </div>
      )}

      {/* Top-left cluster: a way back to the first/home screen mid-game
          (previously only reachable once the match had fully ended, via
          MatchEnd's own "Back to Home" button — there was no way out of an
          in-progress game), plus the room-code share chip when online. Both
          hidden once MatchEnd is on screen so its own Back to Home isn't
          duplicated. */}
      {!(view.phase === 'gameOver' && matchResult?.over) && (
        // start-2 (not left-2): unlike the table seats (pinned physical), the
        // control cluster is chrome, and chrome belongs on the reading-start
        // side -- top-left in English, top-right in Arabic.
        <div className="absolute top-2 start-2 z-20 flex flex-col items-start gap-1">
          <div className="flex items-center gap-1">
            <button
              className="flex items-center justify-center w-9 h-9 bg-emerald-900/80 border border-emerald-700 rounded-full shadow-lg active:scale-95"
              onClick={() => {
                if (window.confirm(t('Leave this game and return to the home screen?', 'مغادرة اللعبة والعودة إلى الشاشة الرئيسية؟'))) {
                  onHome();
                }
              }}
              aria-label={t('Back to home', 'العودة للرئيسية')}
            >
              🏠
            </button>
            {roomCode && (
              <button
                className="flex items-center gap-1 bg-emerald-900/80 border border-emerald-700 rounded-full px-3 py-2 text-xs font-mono font-semibold shadow-lg active:scale-95"
                onClick={shareRoom}
                aria-label={t('Share room code', 'مشاركة رمز الغرفة')}
              >
                🔗 {roomCode}
              </button>
            )}
            {spectators && spectators.count > 0 && (
              <button
                className="flex items-center gap-1 bg-emerald-900/80 border border-emerald-700 rounded-full px-2.5 py-2 text-xs font-semibold shadow-lg active:scale-95"
                onClick={() => setShowSpectators((v) => !v)}
                aria-label={t('Spectators', 'المشاهدون')}
              >
                👁 {spectators.count}
              </button>
            )}
            {/* A game that replaces the HUD strip (Trix's hudOverride) loses the
                in-HUD "Last trick" button, so surface it here in the control
                cluster instead. Leekha keeps its in-HUD one (no hudOverride). */}
            {hudOverride && lastCompletedTrick && (
              <button
                className="flex items-center justify-center w-9 h-9 bg-emerald-900/80 border border-emerald-700 rounded-full shadow-lg active:scale-95"
                onClick={() => setShowLastTrick(true)}
                aria-label={t('Last trick', 'اللفة الأخيرة')}
              >
                🃏
              </button>
            )}
          </div>
          {codeCopied && (
            <span className="bg-black/75 text-white text-[10px] rounded-full px-2 py-0.5">{t('Copied!', 'تم النسخ!')}</span>
          )}
          {showSpectators && spectators && spectators.count > 0 && (
            <div className="bg-emerald-950/95 border border-emerald-700 rounded-xl px-3 py-2 shadow-lg flex flex-col gap-1.5 text-xs text-emerald-100">
              <span className="font-semibold text-emerald-300">
                {t(`${spectators.count} watching`, `${spectators.count} يشاهدون`)}
              </span>
              {Object.entries(spectators.countries)
                .sort((a, b) => b[1] - a[1])
                .map(([cc, n]) => (
                  <span key={cc} className="flex items-center gap-1.5">
                    <Flag country={cc} />
                    <span>{regionName(cc, settings.language)}</span>
                    {n > 1 && <span className="text-emerald-300">×{n}</span>}
                  </span>
                ))}
              {(() => {
                const known = Object.values(spectators.countries).reduce((a, b) => a + b, 0);
                const unknown = spectators.count - known;
                return unknown > 0 ? (
                  <span className="flex items-center gap-1.5">
                    <span>🌐</span>
                    <span>{t('Somewhere on Earth', 'من مكان ما')}</span>
                    {unknown > 1 && <span className="text-emerald-300">×{unknown}</span>}
                  </span>
                ) : null;
              })()}
            </div>
          )}
        </div>
      )}


      {/* Illegal reason toast */}
      {reasonToast && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-40 bg-red-700 text-white text-xs rounded-lg px-3 py-2 shadow-lg z-10">
          {reasonToast}
        </div>
      )}

      {/* Spectator's own seat: everyone else gets an Avatar around the trick
          area, but "you" normally have none there (the hand tray stands in
          for it) — an observer has no hand, so without this their own
          synthetic seat 0 would be the only player invisible on screen. */}
      {spectator && (
        <div className="flex justify-center pb-1" style={{ paddingTop: Math.round(avatarGapForContainer(avatarSize)) }}>
          <Avatar
            name={names[mySeat]}
            score={view.scores[mySeat]}
            roundScore={seatSubline ? seatSubline(mySeat) : view.eatenPoints[mySeat]}
            isTurn={turn === mySeat}
            isDealer={dealer === mySeat}
            danger={dangerFor(mySeat)}
            team={teamOf(mySeat)}
            presence={presence?.[mySeat]}
          country={countries ? (countries[mySeat] ?? null) : undefined}
            deadline={deadlineFor(mySeat)}
            size={avatarSize}
          />
        </div>
      )}

      {/* Sidelines: every bot-controlled seat a seatless human can claim, per
          SPEC.md 11's unified list (new joiners and idled-out players alike). */}
      {spectator && claimableSeats && claimableSeats.length > 0 && onClaimSeat && (
        <div className="px-2 pb-3 pt-1">
          <div className="text-[10px] text-emerald-300 mb-1 text-center">
            {t('Bot-controlled seats you can take:', 'مقاعد يتحكم بها الروبوت يمكنك أخذها:')}
          </div>
          <div className="flex gap-2 justify-center flex-wrap">
            {claimableSeats.map((s) => (
              <button
                key={s}
                className="flex items-center gap-1.5 bg-amber-400 text-emerald-950 rounded-lg px-3 py-1.5 text-xs font-semibold"
                onClick={() => onClaimSeat(s)}
              >
                🤖 {names[s]}
                <span className="underline">{t('Take seat', 'خذ المقعد')}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hand: one continuous fan that always fits the screen. Fixed per-card
          overlap margins made the fan's width grow with the hand size, so a
          full 13-card hand was wider than a phone and the excess either
          scrolled out of view or slid under the emote button; and drooping
          the outer cards BELOW the center pushed them past the tray's bottom
          edge where they were clipped. Instead the tray is measured and each
          card is placed absolutely: the spacing is computed so the whole
          hand spans exactly the available width (minus a reserved slot for
          the emote button), and the arc lifts the CENTER up from the
          baseline, so no card ever pokes below the tray. Order is the same
          sortHand() order as PassingPanel in every language. */}
      {/* Your own exposed cards (doubled honors / revealed 2s), shown just above
          your hand so you and everyone else can see them. */}
      {seatExposed?.[mySeat] && seatExposed[mySeat]!.length > 0 && (
        <div className="flex justify-center pb-0.5">{exposedFor(mySeat)}</div>
      )}
      {/* Game-specific bottom region (Trix contract-select / deal-recap) takes
          over the hand/passing slot when supplied; otherwise Leekha's hand fan
          and passing panel render exactly as before. */}
      {!spectator && bottomOverride && (
        <div className="shrink-0 min-h-0 max-h-[42%] overflow-y-auto w-full">{bottomOverride}</div>
      )}
      {!spectator && !bottomOverride && view.phase !== 'passing' && (
        // pb-3: the outermost cards rotate around their bottom-center, which
        // dips their lower corners up to ~10px below the layout box; the
        // padding is what keeps those corners on screen.
        <div className="pb-3 pt-1">
          {(() => {
            // Same sorted order in every language: the fan is positioned
            // absolutely (physically), and seating/pass direction don't
            // change with the UI language, so the hand shouldn't either.
            const sorted = sortHand(view.hand);
            // Pin each card's row for the whole round (see handRowsRef).
            if (sorted.some((c) => !handRowsRef.current.has(cardKey(c)))) {
              const m = new Map<string, 0 | 1>();
              const half = Math.ceil(sorted.length / 2);
              sorted.forEach((c, i) => m.set(cardKey(c), i < half ? 0 : 1));
              handRowsRef.current = m;
            }
            // Continuous sizing (tableScale.ts) driven by the tray's own
            // measured width, instead of frozen tiers.
            const cardW = cardWidthForContainer(trayW);
            const cardH = cardHeightForWidth(cardW);
            // Two stories or one is decided from the round's FULL hand size
            // (the row map's size), not the current count, so the layout
            // never flips mid-round as cards get played.
            const twoStory = trayW > 0 && needsTwoStories(handRowsRef.current.size, trayW, cardW, cardH);
            const rows = twoStory
              ? [
                  sorted.filter((c) => handRowsRef.current.get(cardKey(c)) === 0),
                  sorted.filter((c) => handRowsRef.current.get(cardKey(c)) === 1),
                ]
              : [sorted];
            // The back story peeks out above the front one by a bit under
            // half a card, enough to read the corner index and tap it.
            const rowOffset = twoStory ? Math.round(cardH * 0.55) : 0;
            const geos = rows.map((r) => fanLayout(r.length, trayW, cardW, cardH));
            const maxLiftAll = Math.max(...geos.map((g) => g.maxLift));
            const trayH = cardH + rowOffset + maxLiftAll + 24;
            // Once the front story empties, the back story slides down to the
            // baseline (via transform, so it animates) instead of hovering.
            const frontEmpty = twoStory && rows[1].length === 0;
            return (
              <div ref={setTrayEl} className="relative w-full" style={{ height: trayH }}>
                {/* Confirm floats ABOVE the fan instead of flowing below it:
                    rendered under the tray it added height mid-turn, which
                    overflowed small screens and made every single play a
                    scroll-down-to-confirm trip. Anchored to the tray's top
                    edge it tracks any card size, and a raised card's top
                    always stops ~6px below that edge (raise translate vs
                    trayH headroom), so the button never covers the card
                    being confirmed. It transiently overlaps the status strip
                    above, which beats pushing the layout around. */}
                {isMyTurn && settings.confirmBeforePlay && raised && (
                  <button
                    className="absolute left-1/2 -translate-x-1/2 z-[60] rounded-lg bg-amber-400 text-emerald-950 font-semibold px-5 py-1.5 text-sm shadow-lg"
                    style={{ top: -44 }}
                    onClick={() => {
                      submitPlay(raised);
                      setRaised(null);
                    }}
                  >
                    {t(`Play ${cardName(raised)}`, `العب ${cardName(raised, 'ar')}`)}
                  </button>
                )}
                {trayW > 0 &&
                  rows.map((rowCards, rowIdx) => {
                    const displayRow = rowCards;
                    const geo = geos[rowIdx];
                    const rowLift = twoStory && rowIdx === 0 && !frontEmpty ? rowOffset : 0;
                    return displayRow.map((card, i) => {
                      const legal =
                        view.phase !== 'playing' || !isMyTurn || !view.legal
                          ? true
                          : view.legal.some((c) => cardKey(c) === cardKey(card));
                      const isRaised = raised && cardKey(raised) === cardKey(card);
                      const justReceived = receivedReveal && view.youReceived?.some((c) => cardKey(c) === cardKey(card));
                      const pulseForced = forcedDumpActive && legal && isLeekha(card);
                      const liftPx = Math.max(0, geo.lift(i) + rowLift + (justReceived ? 8 : 0) - (!legal ? 3 : 0));
                      // The inline transform below always wins over any Tailwind transform
                      // utility class in the cascade, so every case that used to nudge the
                      // card (raised, illegal, just-received) has to fold into this one
                      // computed value instead of a separate translate-y-* class.
                      const transform = isRaised
                        ? `translateY(-${maxLiftAll + rowLift + 18}px)`
                        : `rotate(${geo.rotate(i)}deg) translateY(-${liftPx}px)`;
                      return (
                        <button
                          key={cardKey(card)}
                          disabled={view.phase !== 'playing' || !isMyTurn}
                          onPointerDown={(e) => onCardPointerDown(e, card, legal)}
                          style={{ left: geo.left(i), bottom: 0, zIndex: isRaised ? 50 : rowIdx * 20 + i, transform }}
                          className={`absolute origin-bottom touch-none transition-transform ${!legal ? 'grayscale-[65%] brightness-[0.72]' : ''} ${
                            justReceived ? 'ring-2 ring-amber-300 rounded-md' : ''
                          } ${pulseForced ? 'ring-2 ring-red-400 rounded-md animate-pulse' : ''}`}
                        >
                          <CardFace card={card} width={cardW} fourColor={settings.fourColorDeck} />
                        </button>
                      );
                    });
                  })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Passing picker: occupies the same flow slot as the hand tray above. */}
      {!spectator && !bottomOverride && view.phase === 'passing' && (
        <PassingPanel
          hand={view.hand}
          recipientName={passRecipient}
          committed={view.youPassed !== null}
          passProgress={passProgress}
          fourColor={settings.fourColorDeck}
          language={settings.language}
          onConfirm={onCommitPass}
        />
      )}

      {/* Game-specific overlay (Trix deal recap / match-over) replaces Leekha's
          round-summary and match-end overlays when supplied. */}
      {overlayOverride}

      {/* Round summary overlay */}
      {!overlayOverride && view.phase === 'roundEnd' && (
        <RoundSummary
          names={names}
          eaten={view.eatenPoints}
          totals={view.scores}
          eatenCards={view.eatenCards}
          target={view.config.targetScore}
          dealer={view.dealer}
          dealerReason={t(
            `${names[view.dealer]} ate ${view.eatenPoints[view.dealer]}, ${names[view.dealer]} deals next.`,
            `أكل ${names[view.dealer]} ${view.eatenPoints[view.dealer]}، ${names[view.dealer]} يوزّع تالياً.`,
          )}
          language={settings.language}
          onContinue={onAdvanceRound}
          autoAdvances={roundAutoAdvances}
        />
      )}

      {/* Match end overlay */}
      {!overlayOverride && view.phase === 'gameOver' && matchResult?.over && (
        <MatchEnd
          names={names}
          totals={view.scores}
          losingTeam={matchResult.losingTeam!}
          bustSeat={matchResult.bustSeat!}
          language={settings.language}
          mySeat={mySeat}
          rematchVotes={rematchVotes}
          hideRematch={spectator}
          onRematch={onRematch}
          onHome={onHome}
        />
      )}

      {/* Last trick modal */}
      {showLastTrick && lastCompletedTrick && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-20" onClick={() => setShowLastTrick(false)}>
          <div className="bg-emerald-950 border border-emerald-700 rounded-2xl p-5 flex flex-col items-center gap-3">
            <h3 className="text-white font-semibold">{t('Last trick', 'اللفة الأخيرة')}</h3>
            <div className="flex gap-2">
              {lastCompletedTrick.map((p) => (
                <div key={p.seat} className="flex flex-col items-center gap-1">
                  <CardFace card={p.card} size="lg" fourColor={settings.fourColorDeck} />
                  <span className="text-[10px] text-emerald-200">{names[p.seat]}</span>
                </div>
              ))}
            </div>
            <button className="text-xs underline text-emerald-200" onClick={() => setShowLastTrick(false)}>
              {t('Close', 'إغلاق')}
            </button>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
