import { useCallback, useEffect, useRef, useState } from 'react';
import {
  newMatch,
  startRound,
  commitPass,
  playCard,
  viewFor,
  defaultConfig,
  type Card,
  type GameEvent,
  type MatchState,
  type Seat,
} from '@leekha/engine';
import { makeHeuristicBot, type Bot } from '@leekha/bots';

const BOT_SEATS: Seat[] = [1, 2, 3];

function randomDelay(kind: 'pass' | 'play' | 'forced'): number {
  const base = 600 + Math.random() * 1200;
  return kind === 'play' ? base : base + 200;
}

function turnSeatOf(trick: { leader: Seat; plays: unknown[] }): Seat {
  return (((trick.leader as number) + trick.plays.length) % 4) as Seat;
}

export interface GameEventLogItem {
  id: number;
  event: GameEvent;
}

export function useGame() {
  const [match, setMatchState] = useState<MatchState | null>(null);
  const [lastEvents, setLastEvents] = useState<GameEventLogItem[]>([]);
  const matchRef = useRef<MatchState | null>(null);
  const botsRef = useRef<Record<number, Bot>>({
    1: makeHeuristicBot('medium'),
    2: makeHeuristicBot('medium'),
    3: makeHeuristicBot('medium'),
  });
  const scheduledRef = useRef<Set<string>>(new Set());
  const eventIdRef = useRef(0);

  const setMatch = useCallback((next: MatchState) => {
    matchRef.current = next;
    setMatchState(next);
  }, []);

  const pushEvents = useCallback((events: GameEvent[]) => {
    setLastEvents((prev) => [
      ...prev,
      ...events.map((event) => ({ id: eventIdRef.current++, event })),
    ]);
  }, []);

  const startMatch = useCallback(
    (config = defaultConfig, seed = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`) => {
      scheduledRef.current.clear();
      setLastEvents([]);
      let m = newMatch(config, seed);
      m = startRound(m);
      setMatch(m);
    },
    [setMatch],
  );

  const rematch = useCallback(() => {
    if (!match) return;
    startMatch(match.config);
  }, [match, startMatch]);

  const humanCommitPass = useCallback(
    (cards: [Card, Card, Card]) => {
      const m = matchRef.current;
      if (!m) return;
      const next = commitPass(m, 0, cards);
      setMatch(next);
    },
    [setMatch],
  );

  const humanPlayCard = useCallback(
    (card: Card) => {
      const m = matchRef.current;
      if (!m) return;
      const { state, events } = playCard(m, 0, card);
      setMatch(state);
      pushEvents(events);
    },
    [setMatch, pushEvents],
  );

  const advanceRound = useCallback(() => {
    const m = matchRef.current;
    if (!m || m.phase !== 'roundEnd') return;
    const next = startRound(m);
    setMatch(next);
  }, [setMatch]);

  // Drive bot seats: passing and trick play, with a human-like randomized delay.
  useEffect(() => {
    if (!match) return;

    if (match.phase === 'passing') {
      for (const seat of BOT_SEATS) {
        if (match.round.passes[seat] !== null) continue;
        const key = `pass-${match.roundIndex}-${seat}`;
        if (scheduledRef.current.has(key)) continue;
        scheduledRef.current.add(key);
        window.setTimeout(() => {
          const m = matchRef.current;
          if (!m || m.phase !== 'passing' || m.round.passes[seat] !== null) return;
          const view = viewFor(m, seat);
          const cards = botsRef.current[seat].choosePass(view);
          const next = commitPass(m, seat, cards);
          setMatch(next);
        }, randomDelay('pass'));
      }
    } else if (match.phase === 'playing') {
      const turn = turnSeatOf(match.round.currentTrick);
      if (turn !== 0) {
        const key = `play-${match.roundIndex}-${match.round.trickNumber}-${match.round.currentTrick.plays.length}`;
        if (!scheduledRef.current.has(key)) {
          scheduledRef.current.add(key);
          window.setTimeout(() => {
            const m = matchRef.current;
            if (!m || m.phase !== 'playing') return;
            if (turnSeatOf(m.round.currentTrick) !== turn) return; // stale timer
            const view = viewFor(m, turn);
            const card = botsRef.current[turn].choosePlay(view);
            const { state, events } = playCard(m, turn, card);
            setMatch(state);
            pushEvents(events);
          }, randomDelay('play'));
        }
      }
    }
  }, [match, setMatch, pushEvents]);

  const clearEvent = useCallback((id: number) => {
    setLastEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return {
    match,
    view: match ? viewFor(match, 0) : null,
    events: lastEvents,
    clearEvent,
    startMatch,
    rematch,
    humanCommitPass,
    humanPlayCard,
    advanceRound,
    turnSeatOf,
  };
}
