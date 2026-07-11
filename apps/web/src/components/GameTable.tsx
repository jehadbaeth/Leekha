import { useEffect, useRef, useState } from 'react';
import type { Card, MatchResult, Seat, SeatView } from '@leekha/engine';
import { nextSeat, partnerOf, prevSeat, teamOf } from '@leekha/engine';
import { CardFace } from './CardFace';
import { Avatar, type PresenceStatus } from './Avatar';
import { PassingPanel } from './PassingPanel';
import { RoundSummary } from './RoundSummary';
import { MatchEnd } from './MatchEnd';
import { cardKey, cardName, isLeekha, sortHand } from '../cardDisplay';
import { illegalReason, isForcedDumpSituation, undercutMarkerCard } from '../legality';
import { pick, type Settings } from '../settings';
import { isBigCard, playCardSound, trickEndSound, roundEndSound, gameOverSound, emoteSound, dealSound, vibrate } from '../sound';
import { EMOTES, EMOTE_BY_ID } from '../emotes';
import { useRoomShare } from '../roomShare';

// Online events arrive as ServerMessage (type 'game.trickEnd') while local
// events arrive as engine GameEvent (type 'trickEnd'); accept either spelling.
function isEventType(type: string, suffix: 'played' | 'trickEnd' | 'roundEnd' | 'gameOver'): boolean {
  return type === suffix || type === `game.${suffix === 'gameOver' ? 'over' : suffix}`;
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
  claimableSeats,
  onClaimSeat,
  settings,
  onCommitPass,
  onPlayCard,
  onAdvanceRound,
  onRematch,
  onHome,
  roomCode,
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
  /** Online only: bot-controlled seats a human with no seat can claim, shown as the sidelines list (SPEC.md 11). */
  claimableSeats?: Seat[];
  onClaimSeat?: (seat: Seat) => void;
  settings: Settings;
  onCommitPass: (cards: [Card, Card, Card]) => void;
  onPlayCard: (card: Card) => void;
  onAdvanceRound: () => void;
  onRematch: () => void;
  onHome: () => void;
  /** Online only: lets the room-code share button render inside the game screen too, not just the pre-game Lobby (SPEC.md 7.1 item 2). */
  roomCode?: string | null;
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
  const [pendingPlay, setPendingPlay] = useState(false);
  const pendingPlayRef = useRef(false);
  const pendingPlayTimer = useRef<number | null>(null);
  const [dealFx, setDealFx] = useState(false);
  const [dealStarted, setDealStarted] = useState(false);
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
        const ev = item.event as unknown as { cards: { card: Card }[] };
        const big = ev.cards?.some((p) => isBigCard(p.card)) ?? false;
        if (settings.sound) trickEndSound(big);
        if (settings.haptics) vibrate(big ? [20, 40, 20] : 15);
      } else if (isEventType(type, 'roundEnd')) {
        if (settings.sound) roundEndSound();
        if (settings.haptics) vibrate([15, 30, 15, 30]);
      } else if (isEventType(type, 'gameOver')) {
        const ev = item.event as unknown as { losingTeam: 0 | 1 };
        const won = ev.losingTeam !== teamOf(mySeat);
        if (settings.sound) gameOverSound(won);
        if (settings.haptics) vibrate(won ? [30, 50, 30, 50, 30] : [60]);
      }
    }
  }, [events, settings.sound, settings.haptics, mySeat]);

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
        el.style.transform = '';
        el.style.zIndex = '';
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
    <div className="@container relative h-full w-full flex flex-col bg-gradient-to-b from-felt-900 to-felt-950 overflow-hidden select-none">
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

      {/* Top: partner */}
      <div className="flex justify-center pt-3">
        <Avatar
          name={names[topSeat]}
          score={view.scores[topSeat]}
          roundScore={view.eatenPoints[topSeat]}
          isTurn={turn === topSeat}
          isDealer={dealer === topSeat}
          danger={dangerFor(topSeat)}
          team={teamOf(topSeat)}
          presence={presence?.[topSeat]}
          deadline={deadlineFor(topSeat)}
          emote={visibleEmotes[topSeat]}
          emoteDirection="down"
        />
      </div>

      {/* Middle: left - trick area - right */}
      <div className="flex-1 flex items-center justify-between px-2">
        <Avatar
          name={names[leftSeat]}
          score={view.scores[leftSeat]}
          roundScore={view.eatenPoints[leftSeat]}
          isTurn={turn === leftSeat}
          isDealer={dealer === leftSeat}
          danger={dangerFor(leftSeat)}
          team={teamOf(leftSeat)}
          presence={presence?.[leftSeat]}
          deadline={deadlineFor(leftSeat)}
          emote={visibleEmotes[leftSeat]}
        />

        <div className="flex-1 flex flex-col items-center justify-center gap-1 relative min-h-[150px] @[480px]:min-h-[200px]">
          <div className="relative w-36 h-36 @[480px]:w-48 @[480px]:h-48">
            {trickPlays.map((p) => {
              const pos = posFor(p.seat);
              const isWinner = winnerSeatForHighlight === p.seat;
              const isUndercutMarker = undercutCard && cardKey(undercutCard) === cardKey(p.card);
              return (
                <div key={p.seat} className={`absolute ${pos} flex flex-col items-center gap-0.5`}>
                  <div className={`relative ${isWinner ? 'ring-2 ring-amber-300 rounded-md' : ''}`}>
                    <CardFace card={p.card} size="lg" fourColor={settings.fourColorDeck} />
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

        <Avatar
          name={names[rightSeat]}
          score={view.scores[rightSeat]}
          roundScore={view.eatenPoints[rightSeat]}
          isTurn={turn === rightSeat}
          isDealer={dealer === rightSeat}
          danger={dangerFor(rightSeat)}
          team={teamOf(rightSeat)}
          presence={presence?.[rightSeat]}
          deadline={deadlineFor(rightSeat)}
          emote={visibleEmotes[rightSeat]}
        />
      </div>

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

      {/* Top-left cluster: a way back to the first/home screen mid-game
          (previously only reachable once the match had fully ended, via
          MatchEnd's own "Back to Home" button — there was no way out of an
          in-progress game), plus the room-code share chip when online. Both
          hidden once MatchEnd is on screen so its own Back to Home isn't
          duplicated. */}
      {!(view.phase === 'gameOver' && matchResult?.over) && (
        <div className="absolute top-2 left-2 z-20 flex flex-col items-start gap-1">
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
          </div>
          {codeCopied && (
            <span className="bg-black/75 text-white text-[10px] rounded-full px-2 py-0.5">{t('Copied!', 'تم النسخ!')}</span>
          )}
        </div>
      )}

      {/* Emote button: a standalone floating button anchored near the bottom
          hand tray (not the top-right corner) so it's within easy thumb
          reach on a phone, and its picker pops up above it, over the table,
          instead of covering the hand. The hand-tray rows end in a fixed-width
          spacer (not padding) matching this button's footprint: padding-right
          on an overflow-x-auto row is unreliable at max-scroll on mobile
          WebKit/Blink (it can collapse, letting the last card slide back
          underneath), but a real flex child's width always counts toward
          scrollWidth. */}
      {onEmote && (
        <button
          className="absolute bottom-2 right-2 z-20 w-11 h-11 flex items-center justify-center text-2xl rounded-full bg-emerald-900/80 border border-emerald-700 shadow-lg active:scale-95"
          onClick={() => setShowEmotePicker((v) => !v)}
          aria-label={t('Emotes', 'الرموز التعبيرية')}
        >
          😊
        </button>
      )}

      {showEmotePicker && onEmote && (
        <div className="absolute bottom-14 right-2 z-20">
          <div className="grid grid-cols-4 gap-1 bg-emerald-950 border border-emerald-700 rounded-xl p-2 shadow-lg">
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
        <div className="flex justify-center pb-1">
          <Avatar
            name={names[mySeat]}
            score={view.scores[mySeat]}
            roundScore={view.eatenPoints[mySeat]}
            isTurn={turn === mySeat}
            isDealer={dealer === mySeat}
            danger={dangerFor(mySeat)}
            team={teamOf(mySeat)}
            presence={presence?.[mySeat]}
            deadline={deadlineFor(mySeat)}
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

      {/* Hand: one continuous fan, not a row split. A single arc across the
          whole sorted hand — center card sits highest, each card further out
          rotates and droops a little more — is what an actual held fan of
          cards looks like; splitting it into two independently-arced rows
          used to read as two clashing arches, and reshuffled which row a
          card lived in (a visible jump, not a slide) every time the split
          point moved after a play. One row also means this is always in the
          exact same left-to-right order as PassingPanel's own sortHand(). */}
      {!spectator && view.phase !== 'passing' && (
        <div className="pb-3 pt-1 px-1">
          {(() => {
            const cards = sortHand(view.hand);
            const center = (cards.length - 1) / 2;
            const ROTATE_STEP = 2.5; // degrees of outward tilt per card away from center
            const DROOP_STEP = 3; // px each card droops below the center card
            return (
              // justify-center on the scrollable row itself would clip the start:
              // once the hand overflows, Chrome/Safari only grow the scrollable
              // region toward the end side, so anything centered past the left
              // edge becomes permanently unreachable (only visible with a full
              // hand, since a short hand never overflows). Centering instead
              // lives on the mx-auto inner wrapper, so the outer row can stay
              // justify-start and its scrollable area always includes card 0.
              // The box also has to be taller than the cards themselves: the
              // rotate/droop transform (and the raised-card pop-up) render
              // outside the cards' own layout box, and overflow-x-auto forces
              // the browser to clip the y-axis too (an axis left "visible" next
              // to a non-visible one computes to "auto" per the overflow spec).
              <div className="no-scrollbar flex items-center justify-start overflow-x-auto pl-4 pr-4 min-h-[124px] @[480px]:min-h-[168px]">
                <div className="flex items-center mx-auto">
                  {cards.map((card, i) => {
                    const legal =
                      view.phase !== 'playing' || !isMyTurn || !view.legal
                        ? true
                        : view.legal.some((c) => cardKey(c) === cardKey(card));
                    const isRaised = raised && cardKey(raised) === cardKey(card);
                    const justReceived = receivedReveal && view.youReceived?.some((c) => cardKey(c) === cardKey(card));
                    const pulseForced = forcedDumpActive && legal && isLeekha(card);
                    const arcOffset = i - center;
                    const rotateDeg = cards.length > 1 ? arcOffset * ROTATE_STEP : 0;
                    const liftPx = Math.round(Math.abs(arcOffset) * DROOP_STEP) + (!legal ? 4 : 0) + (justReceived ? -8 : 0);
                    // The inline transform below always wins over any Tailwind transform
                    // utility class in the cascade, so every case that used to nudge the
                    // card (raised, illegal, just-received) has to fold into this one
                    // computed value instead of a separate translate-y-* class.
                    const transform = isRaised ? 'translateY(-16px) rotate(0deg)' : `rotate(${rotateDeg}deg) translateY(${liftPx}px)`;
                    return (
                      <button
                        key={cardKey(card)}
                        disabled={view.phase !== 'playing' || !isMyTurn}
                        onPointerDown={(e) => onCardPointerDown(e, card, legal)}
                        style={{ zIndex: isRaised ? 50 : i, transform }}
                        className={`relative touch-none transition-transform flex-shrink-0 ${i === 0 ? '' : '-ml-5 @[480px]:-ml-6'} ${!legal ? 'grayscale-[65%] brightness-[0.72]' : ''} ${
                          justReceived ? 'ring-2 ring-amber-300 rounded-md' : ''
                        } ${pulseForced ? 'ring-2 ring-red-400 rounded-md animate-pulse' : ''}`}
                      >
                        <CardFace card={card} size="xl" fourColor={settings.fourColorDeck} />
                      </button>
                    );
                  })}
                  <div className="flex-shrink-0 w-16 @[480px]:w-20" aria-hidden="true" />
                </div>
              </div>
            );
          })()}
          {isMyTurn && settings.confirmBeforePlay && raised && (
            <div className="flex justify-center mt-2">
              <button
                className="rounded-lg bg-amber-400 text-emerald-950 font-semibold px-5 py-1.5 text-sm"
                onClick={() => {
                  submitPlay(raised);
                  setRaised(null);
                }}
              >
                {t(`Play ${cardName(raised)}`, `العب ${cardName(raised, 'ar')}`)}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Passing overlay */}
      {!spectator && view.phase === 'passing' && (
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

      {/* Round summary overlay */}
      {view.phase === 'roundEnd' && (
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
        />
      )}

      {/* Match end overlay */}
      {view.phase === 'gameOver' && matchResult?.over && (
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
  );
}
