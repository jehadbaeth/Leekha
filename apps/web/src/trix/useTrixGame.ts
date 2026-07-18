import { useCallback, useEffect, useRef, useState } from 'react';
import {
  newMatch,
  viewFor,
  actingSeat,
  chooseContract,
  expose,
  play,
  pass,
  IllegalTrixAction,
  type Card,
  type Contract,
  type Seat,
  type TrixEvent,
  type TrixMatchState,
  type TrixRulesConfig,
  type TrixSeatView,
} from '@leekha/trix';
import { makeTrixBot } from '@leekha/trix-bots';

const HUMAN_SEAT: Seat = 0;
const BOT_SEATS: Seat[] = [1, 2, 3];

function randomDelay(): number {
  return 500 + Math.random() * 900;
}

// The real heuristic bot (packages/trix-bots): contract selection, doubling,
// trick-avoidance play parameterized by the active contract, layout play, and
// partner-aware cooperation. One instance drives every bot seat.
const bot = makeTrixBot();

function botAct(state: TrixMatchState, seat: Seat): { state: TrixMatchState; events: TrixEvent[] } | null {
  const view = viewFor(state, seat);
  if (state.phase === 'selecting') {
    const options = view.choosableContracts ?? [];
    if (options.length === 0) return null;
    return chooseContract(state, seat, bot.chooseContract(view));
  }
  if (state.phase === 'exposing') {
    const card = bot.chooseExpose(view);
    return card ? expose(state, seat, card) : pass(state, seat);
  }
  if (state.phase === 'trick' || state.phase === 'layout') {
    if (view.legal && view.legal.length > 0) {
      return play(state, seat, bot.choosePlay(view));
    }
    if (view.canPass) return pass(state, seat);
    return null;
  }
  return null;
}

export interface TrixEventLogItem {
  id: number;
  event: TrixEvent;
}

export function useTrixGame(config: TrixRulesConfig) {
  const [match, setMatchState] = useState<TrixMatchState | null>(null);
  const [events, setEvents] = useState<TrixEventLogItem[]>([]);
  const matchRef = useRef<TrixMatchState | null>(null);
  const scheduledRef = useRef<Set<string>>(new Set());
  const eventIdRef = useRef(0);
  // When a deal ends, hold here until the player continues. Bots pause so each
  // deal's result is shown cleanly instead of the next deal flowing over it.
  const [pendingDeal, setPendingDeal] = useState<Extract<TrixEvent, { type: 'dealEnd' }> | null>(null);

  const setMatch = useCallback((next: TrixMatchState) => {
    matchRef.current = next;
    setMatchState(next);
  }, []);

  const pushEvents = useCallback((evs: TrixEvent[]) => {
    if (evs.length === 0) return;
    setEvents((prev) => [...prev, ...evs.map((event) => ({ id: eventIdRef.current++, event }))]);
    const de = [...evs].reverse().find((e) => e.type === 'dealEnd');
    if (de && de.type === 'dealEnd') setPendingDeal(de);
  }, []);

  const continueDeal = useCallback(() => setPendingDeal(null), []);

  const startMatch = useCallback(
    (seed: string = `trix-local-${Date.now()}-${Math.random().toString(36).slice(2)}`) => {
      scheduledRef.current.clear();
      setEvents([]);
      setPendingDeal(null);
      const m = newMatch(config, seed);
      setMatch(m);
    },
    [config, setMatch],
  );

  const clearEvent = useCallback((id: number) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // --- Human actions. Each swallows IllegalTrixAction (a stale/racy tap that
  // is no longer legal by the time it lands) and rethrows anything else. ---

  const humanChooseContract = useCallback(
    (contracts: Contract[]) => {
      const m = matchRef.current;
      if (!m) return;
      try {
        const { state, events: evs } = chooseContract(m, HUMAN_SEAT, contracts);
        setMatch(state);
        pushEvents(evs);
      } catch (err) {
        if (!(err instanceof IllegalTrixAction)) throw err;
      }
    },
    [setMatch, pushEvents],
  );

  const humanExpose = useCallback(
    (card: Card) => {
      const m = matchRef.current;
      if (!m) return;
      try {
        const { state, events: evs } = expose(m, HUMAN_SEAT, card);
        setMatch(state);
        pushEvents(evs);
      } catch (err) {
        if (!(err instanceof IllegalTrixAction)) throw err;
      }
    },
    [setMatch, pushEvents],
  );

  const humanPass = useCallback(() => {
    const m = matchRef.current;
    if (!m) return;
    try {
      const { state, events: evs } = pass(m, HUMAN_SEAT);
      setMatch(state);
      pushEvents(evs);
    } catch (err) {
      if (!(err instanceof IllegalTrixAction)) throw err;
    }
  }, [setMatch, pushEvents]);

  const humanPlay = useCallback(
    (card: Card) => {
      const m = matchRef.current;
      if (!m) return;
      try {
        const { state, events: evs } = play(m, HUMAN_SEAT, card);
        setMatch(state);
        pushEvents(evs);
      } catch (err) {
        if (!(err instanceof IllegalTrixAction)) throw err;
      }
    },
    [setMatch, pushEvents],
  );

  // Drive bot seats. Every action (chooseContract/expose/play/pass) appends
  // exactly one entry to moveLog, so `moveLog.length` is a simple, unique
  // fingerprint of "the decision point right after N prior moves" -- reusing
  // it as the schedule key means we don't need per-phase key plumbing like
  // Leekha's useGame (trickNumber/plays.length/etc): it just works across
  // selecting, exposing, trick, and layout alike.
  useEffect(() => {
    if (!match || match.phase === 'done') return;
    if (pendingDeal) return; // paused on a deal-end summary
    const seat = actingSeat(match);
    if (seat === null || !BOT_SEATS.includes(seat)) return;

    const key = `move-${match.moveLog.length}-seat-${seat}`;
    if (scheduledRef.current.has(key)) return;
    scheduledRef.current.add(key);

    const timer = window.setTimeout(() => {
      const m = matchRef.current;
      if (!m) return;
      // Re-check against fresh state: a rematch/start mid-delay, or a human
      // action that raced ahead, can make this stale.
      if (actingSeat(m) !== seat || m.moveLog.length !== match.moveLog.length) return;
      try {
        const result = botAct(m, seat);
        if (!result) return;
        setMatch(result.state);
        pushEvents(result.events);
      } catch (err) {
        if (!(err instanceof IllegalTrixAction)) throw err;
      }
    }, randomDelay());

    return () => window.clearTimeout(timer);
  }, [match, pendingDeal, setMatch, pushEvents]);

  const view: TrixSeatView | null = match ? viewFor(match, HUMAN_SEAT) : null;

  return {
    match,
    view,
    events,
    clearEvent,
    startMatch,
    pendingDeal,
    continueDeal,
    humanChooseContract,
    humanExpose,
    humanPass,
    humanPlay,
  };
}
