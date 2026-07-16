import { useCallback, useEffect, useRef, useState } from 'react';
import {
  newMatch,
  startRound,
  commitPass,
  playCard,
  viewFor,
  defaultConfig,
  IllegalAction,
  type Card,
  type GameEvent,
  type MatchState,
  type Seat,
} from '@leekha/engine';
import { makeHeuristicBot, type Bot } from '@leekha/bots';
import type { BotWorkRequest, BotWorkResponse } from './botWorker';

export type BotDifficulty = 'easy' | 'medium' | 'hard';

const BOT_SEATS: Seat[] = [1, 2, 3];

// A search decision stuck longer than this (worker wedged, tab heavily
// throttled) falls back to the in-thread heuristic so the game never stalls.
const WORKER_DECISION_TIMEOUT_MS = 4000;

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

export function useGame(botDifficulty: BotDifficulty = 'hard') {
  const [match, setMatchState] = useState<MatchState | null>(null);
  const [lastEvents, setLastEvents] = useState<GameEventLogItem[]>([]);
  const matchRef = useRef<MatchState | null>(null);
  // Heuristic bots cover easy/medium play, all passing (the hard tier passes
  // with the medium heuristic, mirroring the server's botForLevel), and the
  // fallback when the search worker is unavailable.
  const heuristicBotsRef = useRef<Record<number, Bot>>({
    1: makeHeuristicBot('medium'),
    2: makeHeuristicBot('medium'),
    3: makeHeuristicBot('medium'),
  });
  const levelRef = useRef<BotDifficulty>(botDifficulty);
  const scheduledRef = useRef<Set<string>>(new Set());
  const eventIdRef = useRef(0);

  // Hard tier: sampled-world search in a Web Worker (botWorker.ts), created
  // lazily on the first hard decision and torn down with the hook. If the
  // worker can't boot or a decision times out, the seat quietly downgrades
  // to the in-thread medium heuristic rather than stalling the game.
  const workerRef = useRef<Worker | null>(null);
  const workerBrokenRef = useRef(false);
  const pendingRef = useRef(new Map<number, (card: Card | null) => void>());
  const requestIdRef = useRef(0);

  useEffect(() => {
    levelRef.current = botDifficulty;
    if (botDifficulty !== 'easy') {
      for (const seat of BOT_SEATS) heuristicBotsRef.current[seat] = makeHeuristicBot('medium');
    } else {
      for (const seat of BOT_SEATS) heuristicBotsRef.current[seat] = makeHeuristicBot('easy');
    }
  }, [botDifficulty]);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const searchWorker = useCallback((): Worker | null => {
    if (workerBrokenRef.current) return null;
    if (!workerRef.current) {
      try {
        const w = new Worker(new URL('./botWorker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<BotWorkResponse>) => {
          const resolve = pendingRef.current.get(e.data.id);
          if (!resolve) return;
          pendingRef.current.delete(e.data.id);
          resolve(e.data.ok ? e.data.card : null);
        };
        w.onerror = () => {
          workerBrokenRef.current = true;
          for (const resolve of pendingRef.current.values()) resolve(null);
          pendingRef.current.clear();
        };
        workerRef.current = w;
      } catch {
        workerBrokenRef.current = true;
      }
    }
    return workerRef.current;
  }, []);

  /** Resolves with the search bot's card, or null when the worker path failed (caller falls back to the heuristic). */
  const decideHardPlay = useCallback(
    (view: ReturnType<typeof viewFor>): Promise<Card | null> => {
      const worker = searchWorker();
      if (!worker) return Promise.resolve(null);
      const id = requestIdRef.current++;
      return new Promise<Card | null>((resolve) => {
        const timer = window.setTimeout(() => {
          if (pendingRef.current.delete(id)) resolve(null);
        }, WORKER_DECISION_TIMEOUT_MS);
        pendingRef.current.set(id, (card) => {
          window.clearTimeout(timer);
          resolve(card);
        });
        worker.postMessage({ id, view } satisfies BotWorkRequest);
      });
    },
    [searchWorker],
  );

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
      try {
        const next = commitPass(m, 0, cards);
        setMatch(next);
      } catch (err) {
        if (!(err instanceof IllegalAction)) throw err;
      }
    },
    [setMatch],
  );

  const humanPlayCard = useCallback(
    (card: Card) => {
      const m = matchRef.current;
      if (!m) return;
      try {
        const { state, events } = playCard(m, 0, card);
        setMatch(state);
        pushEvents(events);
      } catch (err) {
        if (!(err instanceof IllegalAction)) throw err;
      }
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
          const cards = heuristicBotsRef.current[seat].choosePass(view);
          try {
            const next = commitPass(m, seat, cards);
            setMatch(next);
          } catch (err) {
            if (!(err instanceof IllegalAction)) throw err;
          }
        }, randomDelay('pass'));
      }
    } else if (match.phase === 'playing') {
      const turn = turnSeatOf(match.round.currentTrick);
      if (turn !== 0) {
        const key = `play-${match.roundIndex}-${match.round.trickNumber}-${match.round.currentTrick.plays.length}`;
        if (!scheduledRef.current.has(key)) {
          scheduledRef.current.add(key);
          // Kick the search off immediately and let it think DURING the fake
          // thinking delay: the card lands at max(delay, search time) instead
          // of stacking the two, so hard feels exactly as responsive as
          // medium. Nothing else can act while it's this bot's turn, so the
          // view snapshot stays valid; the apply step still re-validates
          // against fresh state in case of a rematch mid-decision.
          const delay = randomDelay('play');
          const startedAt = performance.now();
          const view = viewFor(match, turn);
          const decision =
            levelRef.current === 'hard' && view.legal && view.legal.length > 1
              ? decideHardPlay(view)
              : Promise.resolve<Card | null>(null);
          decision.then((searchCard) => {
            const apply = () => {
              const m = matchRef.current;
              if (!m || m.phase !== 'playing') return;
              if (turnSeatOf(m.round.currentTrick) !== turn) return; // stale timer
              const freshView = viewFor(m, turn);
              const searchCardStillLegal =
                searchCard !== null &&
                freshView.legal?.some((c) => c.suit === searchCard.suit && c.rank === searchCard.rank);
              const card = searchCardStillLegal ? searchCard : heuristicBotsRef.current[turn].choosePlay(freshView);
              try {
                const { state, events } = playCard(m, turn, card);
                setMatch(state);
                pushEvents(events);
              } catch (err) {
                if (!(err instanceof IllegalAction)) throw err;
              }
            };
            window.setTimeout(apply, Math.max(0, delay - (performance.now() - startedAt)));
          });
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
