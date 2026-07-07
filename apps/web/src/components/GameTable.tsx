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
  settings,
  onCommitPass,
  onPlayCard,
  onAdvanceRound,
  onRematch,
  onHome,
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
  settings: Settings;
  onCommitPass: (cards: [Card, Card, Card]) => void;
  onPlayCard: (card: Card) => void;
  onAdvanceRound: () => void;
  onRematch: () => void;
  onHome: () => void;
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
  const [visibleEmotes, setVisibleEmotes] = useState<Partial<Record<Seat, string>>>({});
  const [showEmotePicker, setShowEmotePicker] = useState(false);
  const [pendingPlay, setPendingPlay] = useState(false);
  const pendingPlayRef = useRef(false);
  const pendingPlayTimer = useRef<number | null>(null);
  const [dealFx, setDealFx] = useState(false);
  const [dealStarted, setDealStarted] = useState(false);

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

  // Show each incoming emote above its seat for ~2.5s (SPEC.md 7.5.11).
  useEffect(() => {
    if (!emotes) return;
    const timers: number[] = [];
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      const e = emotes[seat];
      if (!e) continue;
      const glyph = EMOTE_BY_ID[e.id]?.glyph;
      if (!glyph) continue;
      setVisibleEmotes((prev) => ({ ...prev, [seat]: glyph }));
      if (settings.sound) emoteSound();
      timers.push(
        window.setTimeout(() => {
          setVisibleEmotes((prev) => ({ ...prev, [seat]: undefined }));
        }, 2500),
      );
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [emotes ? ([0, 1, 2, 3] as Seat[]).map((s) => emotes[s]?.ts ?? 0).join(',') : '', settings.sound]);

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
        const ms = settings.reducedMotion ? 50 : 900;
        freezeTimer.current = window.setTimeout(() => setFrozenTrick(null), ms);
      }
      clearEvent(item.id);
    }
    for (const item of events) {
      if (!isEventType(item.event.type, 'trickEnd')) clearEvent(item.id);
    }
  }, [events, clearEvent, view.playedCards, settings.reducedMotion]);

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
    <div className="relative h-full w-full flex flex-col bg-gradient-to-b from-felt-900 to-felt-950 overflow-hidden select-none">
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
          emoteGlyph={visibleEmotes[topSeat]}
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
          emoteGlyph={visibleEmotes[leftSeat]}
        />

        <div className="flex-1 flex flex-col items-center justify-center gap-1 relative min-h-[120px]">
          <div className="relative w-32 h-32">
            {trickPlays.map((p) => {
              const pos = posFor(p.seat);
              const isWinner = winnerSeatForHighlight === p.seat;
              const isUndercutMarker = undercutCard && cardKey(undercutCard) === cardKey(p.card);
              return (
                <div key={p.seat} className={`absolute ${pos} flex flex-col items-center gap-0.5`}>
                  <div className={`relative ${isWinner ? 'ring-2 ring-amber-300 rounded-md' : ''}`}>
                    <CardFace card={p.card} fourColor={settings.fourColorDeck} />
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
          emoteGlyph={visibleEmotes[rightSeat]}
        />
      </div>

      {/* HUD strip */}
      <div className="flex items-center justify-center gap-3 text-[11px] text-emerald-200 bg-emerald-950/60 py-1.5 px-2">
        <span
          className={`font-semibold px-1.5 rounded ${dangerFor(mySeat) ? 'bg-red-600 text-white' : 'text-amber-200'}`}
        >
          {t(`You: ${view.eatenPoints[mySeat]} / ${view.scores[mySeat]}`, `أنت: ${view.eatenPoints[mySeat]} / ${view.scores[mySeat]}`)}
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
        {onEmote && (
          <>
            <span>&middot;</span>
            <button className="underline" onClick={() => setShowEmotePicker((v) => !v)}>
              😊
            </button>
          </>
        )}
      </div>

      {showEmotePicker && onEmote && (
        <div className="absolute inset-x-0 top-10 z-20 flex justify-center">
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

      {/* Passed memo chip */}
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

      {/* Illegal reason toast */}
      {reasonToast && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-40 bg-red-700 text-white text-xs rounded-lg px-3 py-2 shadow-lg z-10">
          {reasonToast}
        </div>
      )}

      {/* Hand */}
      {view.phase !== 'passing' && (
        <div className="pb-3 pt-1 px-1">
          <div className="flex justify-center overflow-x-auto px-4">
            {sortHand(view.hand).map((card, i) => {
              const legal =
                view.phase !== 'playing' || !isMyTurn || !view.legal
                  ? true
                  : view.legal.some((c) => cardKey(c) === cardKey(card));
              const isRaised = raised && cardKey(raised) === cardKey(card);
              const justReceived = receivedReveal && view.youReceived?.some((c) => cardKey(c) === cardKey(card));
              const pulseForced = forcedDumpActive && legal && isLeekha(card);
              return (
                <button
                  key={cardKey(card)}
                  disabled={view.phase !== 'playing' || !isMyTurn}
                  onPointerDown={(e) => onCardPointerDown(e, card, legal)}
                  style={{ zIndex: isRaised ? 50 : i }}
                  className={`relative touch-none transition-transform flex-shrink-0 ${i === 0 ? '' : '-ml-5 sm:-ml-7'} ${isRaised ? '-translate-y-4' : ''} ${!legal ? 'opacity-40 translate-y-1' : ''} ${
                    justReceived ? 'ring-2 ring-amber-300 rounded-md -translate-y-2' : ''
                  } ${pulseForced ? 'ring-2 ring-red-400 rounded-md animate-pulse' : ''}`}
                >
                  <CardFace card={card} size="lg" fourColor={settings.fourColorDeck} />
                </button>
              );
            })}
          </div>
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
      {view.phase === 'passing' && (
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
                  <CardFace card={p.card} fourColor={settings.fourColorDeck} />
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
