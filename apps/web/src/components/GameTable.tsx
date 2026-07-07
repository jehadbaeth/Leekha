import { useEffect, useRef, useState } from 'react';
import type { Card, MatchState, Seat, SeatView } from '@leekha/engine';
import { nextSeat, teamOf } from '@leekha/engine';
import { CardFace } from './CardFace';
import { Avatar } from './Avatar';
import { PassingPanel } from './PassingPanel';
import { RoundSummary } from './RoundSummary';
import { MatchEnd } from './MatchEnd';
import { cardKey, cardName, isLeekha } from '../cardDisplay';
import { illegalReason, isForcedDumpSituation, undercutMarkerCard } from '../legality';
import type { Settings } from '../settings';
import type { GameEventLogItem } from '../useGame';

const BOT_NAMES: Record<number, string> = { 1: 'Rami', 2: 'Nour', 3: 'Sami' };

function seatName(seat: Seat, humanName: string): string {
  return seat === 0 ? humanName || 'You' : BOT_NAMES[seat];
}

interface FrozenTrick {
  leader: Seat;
  plays: { seat: Seat; card: Card; forced: boolean }[];
  winner: Seat;
  points: number;
}

export function GameTable({
  match,
  view,
  events,
  clearEvent,
  settings,
  onCommitPass,
  onPlayCard,
  onAdvanceRound,
  onRematch,
  onHome,
  turnSeatOf,
}: {
  match: MatchState;
  view: SeatView;
  events: GameEventLogItem[];
  clearEvent: (id: number) => void;
  settings: Settings;
  onCommitPass: (cards: [Card, Card, Card]) => void;
  onPlayCard: (card: Card) => void;
  onAdvanceRound: () => void;
  onRematch: () => void;
  onHome: () => void;
  turnSeatOf: (trick: { leader: Seat; plays: unknown[] }) => Seat;
}) {
  const names: Record<Seat, string> = {
    0: seatName(0, settings.displayName),
    1: BOT_NAMES[1],
    2: BOT_NAMES[2],
    3: BOT_NAMES[3],
  };

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

  const turn = view.phase === 'playing' ? turnSeatOf(view.currentTrick) : null;
  const isMyTurn = turn === 0 && !!view.legal;

  // Detect the moment a pass gets applied, to show the "you received" reveal briefly.
  useEffect(() => {
    const applied = match.round.passesApplied;
    if (applied && !wasPassesApplied.current) {
      setReceivedReveal(true);
      revealTimer.current = window.setTimeout(() => setReceivedReveal(false), 3000);
    }
    wasPassesApplied.current = applied;
    return () => {
      if (revealTimer.current) window.clearTimeout(revealTimer.current);
    };
  }, [match.round.passesApplied]);

  // Reset per-round local UI state.
  useEffect(() => {
    setRaised(null);
    setReasonToast(null);
    setShowLastTrick(false);
  }, [match.roundIndex]);

  // Freeze the completed trick on screen briefly, highlighting the winner.
  useEffect(() => {
    const trickEndEvents = events.filter((e) => e.event.type === 'trickEnd');
    for (const item of trickEndEvents) {
      const ev = item.event as Extract<typeof item.event, { type: 'trickEnd' }>;
      const completed = match.round.playedCards[match.round.playedCards.length - 1];
      if (completed) {
        setFrozenTrick({ leader: completed[0]?.seat ?? 0, plays: completed, winner: ev.winner, points: ev.points });
        if (freezeTimer.current) window.clearTimeout(freezeTimer.current);
        const ms = settings.reducedMotion ? 50 : 900;
        freezeTimer.current = window.setTimeout(() => setFrozenTrick(null), ms);
      }
      clearEvent(item.id);
    }
    for (const item of events) {
      if (item.event.type !== 'trickEnd') clearEvent(item.id);
    }
  }, [events, clearEvent, match.round.playedCards, settings.reducedMotion]);

  // Auto play when exactly one legal card and the setting is on.
  useEffect(() => {
    if (!settings.autoPlaySingleLegal) return;
    if (view.phase !== 'playing' || !isMyTurn || !view.legal) return;
    if (view.legal.length !== 1) return;
    const key = `${match.roundIndex}-${match.round.trickNumber}-${match.round.currentTrick.plays.length}`;
    if (autoPlayedTrick.current === key) return;
    autoPlayedTrick.current = key;
    onPlayCard(view.legal[0]);
  }, [settings.autoPlaySingleLegal, isMyTurn, view, match.roundIndex, match.round.trickNumber, match.round.currentTrick.plays.length, onPlayCard]);

  function tapCard(card: Card) {
    if (view.phase !== 'playing' || !isMyTurn || !view.legal) return;
    const legal = view.legal.some((c) => cardKey(c) === cardKey(card));
    if (!legal) {
      setReasonToast(illegalReason(view.hand, view.currentTrick, view.config, card));
      window.setTimeout(() => setReasonToast(null), 2200);
      return;
    }
    if (!settings.confirmBeforePlay) {
      onPlayCard(card);
      setRaised(null);
      return;
    }
    if (raised && cardKey(raised) === cardKey(card)) {
      onPlayCard(card);
      setRaised(null);
    } else {
      setRaised(card);
    }
  }

  const dealer = view.dealer;
  const passRecipient = names[nextSeat(0)];
  const passProgress: boolean[] = [0, 1, 2, 3].map((s) => match.round.passes[s as Seat] !== null);

  const dangerFor = (s: Seat) => view.scores[s] >= view.config.targetScore - 30;

  const trickPlays = frozenTrick ? frozenTrick.plays : view.currentTrick.plays;
  const winnerSeatForHighlight = frozenTrick?.winner ?? null;

  const lastCompletedTrick = view.playedCards[view.playedCards.length - 1] ?? null;

  const myPassedMemo = view.youPassed;
  const forcedDumpActive = isMyTurn ? isForcedDumpSituation(view.hand, view.currentTrick, view.config) : false;
  const undercutCard = frozenTrick ? null : undercutMarkerCard(view.currentTrick, view.config);

  return (
    <div className="relative h-full w-full flex flex-col bg-gradient-to-b from-felt-900 to-felt-950 overflow-hidden select-none">
      {/* Top: North (partner) */}
      <div className="flex justify-center pt-3">
        <Avatar
          name={names[2]}
          score={view.scores[2]}
          isTurn={turn === 2}
          isDealer={dealer === 2}
          danger={dangerFor(2)}
          team={teamOf(2)}
        />
      </div>

      {/* Middle: West - trick area - East */}
      <div className="flex-1 flex items-center justify-between px-2">
        <Avatar name={names[3]} score={view.scores[3]} isTurn={turn === 3} isDealer={dealer === 3} danger={dangerFor(3)} team={teamOf(3)} />

        <div className="flex-1 flex flex-col items-center justify-center gap-1 relative min-h-[120px]">
          <div className="relative w-32 h-32">
            {trickPlays.map((p) => {
              const pos =
                p.seat === 0
                  ? 'bottom-0 left-1/2 -translate-x-1/2'
                  : p.seat === 1
                    ? 'right-0 top-1/2 -translate-y-1/2'
                    : p.seat === 2
                      ? 'top-0 left-1/2 -translate-x-1/2'
                      : 'left-0 top-1/2 -translate-y-1/2';
              const isWinner = winnerSeatForHighlight === p.seat;
              const isUndercutMarker = undercutCard && cardKey(undercutCard) === cardKey(p.card);
              return (
                <div key={p.seat} className={`absolute ${pos} flex flex-col items-center gap-0.5`}>
                  <div className={`relative ${isWinner ? 'ring-2 ring-amber-300 rounded-md' : ''}`}>
                    <CardFace card={p.card} fourColor={settings.fourColorDeck} />
                    {isUndercutMarker && (
                      <span className="absolute -top-2 -right-2 text-[8px] bg-sky-500 text-white rounded-full px-1 font-bold">
                        play under
                      </span>
                    )}
                  </div>
                  {p.forced && (
                    <span className="text-[9px] bg-red-600 text-white rounded px-1 font-bold animate-pulse">forced</span>
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

        <Avatar name={names[1]} score={view.scores[1]} isTurn={turn === 1} isDealer={dealer === 1} danger={dangerFor(1)} team={teamOf(1)} />
      </div>

      {/* HUD strip */}
      <div className="flex items-center justify-center gap-3 text-[11px] text-emerald-200 bg-emerald-950/60 py-1.5 px-2">
        <span>Trick {view.trickNumber}/13</span>
        <span>&middot;</span>
        <span>Target {view.config.targetScore}</span>
        <span>&middot;</span>
        <span>Dealer: {names[dealer]}</span>
        {lastCompletedTrick && (
          <>
            <span>&middot;</span>
            <button className="underline" onClick={() => setShowLastTrick(true)}>
              Last trick
            </button>
          </>
        )}
      </div>

      {/* Passed memo chip */}
      {myPassedMemo && (
        <div className="px-2 pb-1">
          <button
            className="w-full text-left bg-emerald-900/70 rounded-lg px-3 py-1.5 text-xs text-emerald-100"
            onClick={() => setShowMemo((v) => !v)}
          >
            {showMemo ? '▾' : '▸'} You passed to {passRecipient}: {myPassedMemo.map((c) => cardName(c)).join(', ')}
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
      <div className="pb-3 pt-1 px-1">
        <div className="flex justify-center flex-wrap gap-1">
          {view.hand.map((card) => {
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
                onClick={() => tapCard(card)}
                className={`transition-transform ${isRaised ? '-translate-y-4' : ''} ${!legal ? 'opacity-40 translate-y-1' : ''} ${
                  justReceived ? 'ring-2 ring-amber-300 rounded-md -translate-y-2' : ''
                } ${pulseForced ? 'ring-2 ring-red-400 rounded-md animate-pulse' : ''}`}
              >
                <CardFace card={card} fourColor={settings.fourColorDeck} />
              </button>
            );
          })}
        </div>
        {isMyTurn && settings.confirmBeforePlay && raised && (
          <div className="flex justify-center mt-2">
            <button
              className="rounded-lg bg-amber-400 text-emerald-950 font-semibold px-5 py-1.5 text-sm"
              onClick={() => {
                onPlayCard(raised);
                setRaised(null);
              }}
            >
              Play {cardName(raised)}
            </button>
          </div>
        )}
      </div>

      {/* Passing overlay */}
      {view.phase === 'passing' && (
        <PassingPanel
          hand={view.hand}
          recipientName={passRecipient}
          committed={view.youPassed !== null}
          passProgress={passProgress}
          fourColor={settings.fourColorDeck}
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
          dealerReason={`${names[view.dealer]} ate ${view.eatenPoints[view.dealer]}, ${names[view.dealer]} deals next.`}
          onContinue={onAdvanceRound}
        />
      )}

      {/* Match end overlay */}
      {view.phase === 'gameOver' && match.result?.over && (
        <MatchEnd
          names={names}
          totals={view.scores}
          losingTeam={match.result.losingTeam!}
          bustSeat={match.result.bustSeat!}
          onRematch={onRematch}
          onHome={onHome}
        />
      )}

      {/* Last trick modal */}
      {showLastTrick && lastCompletedTrick && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-20" onClick={() => setShowLastTrick(false)}>
          <div className="bg-emerald-950 border border-emerald-700 rounded-2xl p-5 flex flex-col items-center gap-3">
            <h3 className="text-white font-semibold">Last trick</h3>
            <div className="flex gap-2">
              {lastCompletedTrick.map((p) => (
                <div key={p.seat} className="flex flex-col items-center gap-1">
                  <CardFace card={p.card} fourColor={settings.fourColorDeck} />
                  <span className="text-[10px] text-emerald-200">{names[p.seat]}</span>
                </div>
              ))}
            </div>
            <button className="text-xs underline text-emerald-200" onClick={() => setShowLastTrick(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
