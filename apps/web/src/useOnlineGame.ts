import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card, MatchResult, RulesConfig, Seat } from '@leekha/engine';
import type { SeatView } from '@leekha/engine';
import type { ServerMessage } from '@leekha/protocol';
import { GameSocket, type ConnectionStatus } from './net/socket';
import { clearSession, loadSession, saveSession, type StoredSession } from './net/session';

type RoomState = Extract<ServerMessage, { type: 'room.state' }>;
type PresenceStatus = 'connected' | 'reconnecting' | 'bot';

export interface TurnDeadline {
  seat: Seat;
  deadline: number | null;
}

export interface OnlineEventLogItem {
  id: number;
  event: ServerMessage;
}

const SEATS: Seat[] = [0, 1, 2, 3];

/**
 * The online counterpart of useGame.ts: instead of owning a local MatchState,
 * it owns a socket connection and derives the same shapes (a SeatView, plus
 * the handful of extra bits GameTable needs — see components/GameTable.tsx)
 * from server push messages. Mirrors SPEC.md sections 10-12.
 *
 * Protocol judgment call: room.join's ack is `{ seatToken }` with no seat
 * number (see packages/protocol/src/schema.ts and apps/server/src/room.ts
 * `sit()`), and room.state never says "this is you" (seat tokens are private,
 * per SPEC.md 8.3). This hook resolves its own seat after a join by matching
 * the first non-bot seat in the next room.state broadcast whose name equals
 * the name we just joined with. This is unambiguous for the common case; two
 * simultaneous joiners sharing an identical display name is an edge case left
 * unhandled (see final report).
 */
export function useOnlineGame() {
  const socketRef = useRef<GameSocket | null>(null);
  if (!socketRef.current) socketRef.current = new GameSocket();

  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [view, setView] = useState<SeatView | null>(null);
  const [mySeat, setMySeatState] = useState<Seat | null>(null);
  const [passesApplied, setPassesApplied] = useState(false);
  const [passProgress, setPassProgress] = useState<boolean[]>([false, false, false, false]);
  const [matchResult, setMatchResult] = useState<MatchResult | undefined>(undefined);
  const [rematchVotes, setRematchVotes] = useState<{ seatsVoted: Seat[]; seatsNeeded: Seat[] } | null>(null);
  const [turnDeadline, setTurnDeadline] = useState<TurnDeadline | null>(null);
  const [presence, setPresence] = useState<Record<Seat, PresenceStatus>>({
    0: 'connected',
    1: 'connected',
    2: 'connected',
    3: 'connected',
  });
  const [lastError, setLastError] = useState<string | null>(null);
  const [emotes, setEmotes] = useState<Record<Seat, { id: string; ts: number } | null>>({
    0: null,
    1: null,
    2: null,
    3: null,
  });
  const [events, setEvents] = useState<OnlineEventLogItem[]>([]);
  const eventIdRef = useRef(0);
  const sessionRef = useRef<StoredSession | null>(null);
  const mySeatRef = useRef<Seat | null>(null);
  const roomStateRef = useRef<RoomState | null>(null);
  const pendingJoinRef = useRef<{ token: string; name: string } | null>(null);

  const setMySeat = useCallback((seat: Seat | null) => {
    mySeatRef.current = seat;
    setMySeatState(seat);
  }, []);

  const pushEvent = useCallback((event: ServerMessage) => {
    setEvents((prev) => [...prev, { id: eventIdRef.current++, event }]);
  }, []);

  const clearEvent = useCallback((id: number) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  useEffect(() => {
    const socket = socketRef.current!;
    const offStatus = socket.onStatus(setStatus);
    const offMsg = socket.onMessage((msg) => {
      switch (msg.type) {
        case 'room.state': {
          roomStateRef.current = msg;
          setRoomState(msg);
          if (mySeatRef.current === null && pendingJoinRef.current) {
            const { token, name } = pendingJoinRef.current;
            const slot = msg.seats.find((s) => s.occupied && !s.isBot && s.name === name);
            if (slot) {
              setMySeat(slot.seat);
              const session: StoredSession = { roomCode: msg.roomCode, seatToken: token, seat: slot.seat };
              sessionRef.current = session;
              saveSession(session);
              pendingJoinRef.current = null;
            }
          }
          break;
        }
        case 'game.snapshot': {
          setView(msg.view);
          setMySeat(msg.view.seat);
          setPassesApplied(msg.view.phase !== 'passing');
          setPassProgress(msg.view.youPassed ? [true, true, true, true] : [false, false, false, false]);
          if (msg.view.phase === 'gameOver') {
            setMatchResult((prev) => prev ?? { over: true });
          }
          break;
        }
        case 'game.dealt': {
          setPassesApplied(false);
          setPassProgress([false, false, false, false]);
          setMatchResult(undefined);
          setRematchVotes(null);
          setTurnDeadline(null);
          break;
        }
        case 'game.passProgress': {
          setPassProgress(SEATS.map((s) => msg.seatsCommitted.includes(s)));
          break;
        }
        case 'game.passReveal': {
          setPassesApplied(true);
          setView((prev) => (prev ? { ...prev, youReceived: msg.received } : prev));
          break;
        }
        case 'game.turn': {
          setTurnDeadline({ seat: msg.seat, deadline: msg.deadline });
          setView((prev) => (prev ? { ...prev, legal: msg.legal ?? null } : prev));
          break;
        }
        case 'game.played': {
          pushEvent(msg);
          setView((prev) => {
            if (!prev) return prev;
            const plays = [...prev.currentTrick.plays, { seat: msg.seat, card: msg.card, forced: msg.forced }];
            const hand =
              msg.seat === prev.seat
                ? prev.hand.filter((c) => !(c.suit === msg.card.suit && c.rank === msg.card.rank))
                : prev.hand;
            return { ...prev, hand, currentTrick: { ...prev.currentTrick, plays } };
          });
          break;
        }
        case 'game.trickEnd': {
          pushEvent(msg);
          setView((prev) => {
            if (!prev) return prev;
            const playedCards = [...prev.playedCards, msg.cards];
            const eatenPoints = [...prev.eatenPoints] as typeof prev.eatenPoints;
            eatenPoints[msg.winner] += msg.points;
            return {
              ...prev,
              playedCards,
              eatenPoints,
              currentTrick: { leader: msg.winner, plays: [] },
              trickNumber: Math.min(13, prev.trickNumber + 1),
            };
          });
          break;
        }
        case 'game.roundEnd': {
          pushEvent(msg);
          setView((prev) =>
            prev ? { ...prev, phase: 'roundEnd', eatenPoints: msg.eaten, scores: msg.totals } : prev,
          );
          break;
        }
        case 'game.over': {
          setMatchResult({ over: true, losingTeam: msg.losingTeam, bustSeat: msg.bustSeat });
          setView((prev) => (prev ? { ...prev, phase: 'gameOver', scores: msg.totals } : prev));
          break;
        }
        case 'presence': {
          setPresence((prev) => ({ ...prev, [msg.seat]: msg.status }));
          break;
        }
        case 'game.rematchVotes': {
          setRematchVotes({ seatsVoted: msg.seatsVoted, seatsNeeded: msg.seatsNeeded });
          break;
        }
        case 'emote': {
          setEmotes((prev) => ({ ...prev, [msg.seat]: { id: msg.id, ts: Date.now() } }));
          break;
        }
        case 'error': {
          setLastError(msg.message);
          break;
        }
      }
    });
    return () => {
      offStatus();
      offMsg();
    };
  }, [pushEvent, setMySeat]);

  // On connect (including every reconnect), replay auth + resync if we have a
  // stored seat token, per SPEC.md section 10's reconnection contract. This is
  // what lets a killed-and-reopened tab resume its seat automatically.
  useEffect(() => {
    const socket = socketRef.current!;
    return socket.onStatus((s) => {
      if (s !== 'connected') return;
      const stored = loadSession();
      if (stored) {
        sessionRef.current = stored;
        setMySeat(stored.seat);
        socket.send({ type: 'auth', name: '', seatToken: stored.seatToken });
        socket.send({ type: 'game.resync' });
      }
    });
  }, [setMySeat]);

  const createRoom = useCallback(async (name: string, config: RulesConfig) => {
    socketRef.current!.send({ type: 'auth', name: name || 'Guest' });
    const res = await socketRef.current!.request<{ code: string; seatToken: string } | { error: string }>({
      type: 'room.create',
      config,
    });
    if ('error' in res) {
      setLastError(res.error);
      return null;
    }
    const session: StoredSession = { roomCode: res.code, seatToken: res.seatToken, seat: 0 };
    sessionRef.current = session;
    saveSession(session);
    setMySeat(0);
    // Protocol quirk worth flagging: apps/server/src/room.ts's sit() (called
    // from the room.create handler) broadcasts the very first room.state
    // before this socket has joined its socket.io room (that join happens
    // right after sit() returns, in server.ts). The host would otherwise
    // never see that first broadcast. game.resync re-triggers it now that we
    // have joined, without needing any server change.
    socketRef.current!.send({ type: 'game.resync' });
    return res.code;
  }, [setMySeat]);

  const joinRoom = useCallback(async (name: string, code: string) => {
    const resolvedName = name || 'Guest';
    socketRef.current!.send({ type: 'auth', name: resolvedName });
    const res = await socketRef.current!.request<{ seatToken: string } | { observer: true } | { error: string }>({
      type: 'room.join',
      code: code.toUpperCase(),
    });
    if ('error' in res) {
      setLastError(res.error);
      return false;
    }
    if ('observer' in res) {
      // The match is already running (SPEC.md 11): we hold no seat and no
      // hand, just the roster broadcast the server pushed us on the way in.
      // claimSeat() is the only path from here into an actual chair.
      return true;
    }
    pendingJoinRef.current = { token: res.seatToken, name: resolvedName };
    // Re-auth with the fresh token so the server binds this socket to the
    // seat it just sat us in (see server.ts's 'auth' handler); that bind
    // triggers a fresh room.state broadcast our seat-matching logic above reads.
    socketRef.current!.send({ type: 'auth', name: resolvedName, seatToken: res.seatToken });
    socketRef.current!.send({ type: 'game.resync' });
    return true;
  }, []);

  const claimSeat = useCallback(async (seat: Seat) => {
    const res = await socketRef.current!.request<{ seatToken: string } | { error: string }>({
      type: 'room.sit',
      seat,
    });
    if ('error' in res) {
      setLastError(res.error);
      return false;
    }
    const roomCode = roomStateRef.current?.roomCode ?? '';
    const session: StoredSession = { roomCode, seatToken: res.seatToken, seat };
    sessionRef.current = session;
    saveSession(session);
    setMySeat(seat);
    // room.sit already tells us which seat we got — unlike room.join's ack,
    // there's no name-matching to do (see the joinRoom comment above it used
    // to need). game.resync is what actually gets us a game.snapshot mid-match.
    socketRef.current!.send({ type: 'game.resync' });
    return true;
  }, [setMySeat]);

  const addBot = useCallback((seat: Seat, level: 'easy' | 'medium' | 'hard') => {
    socketRef.current!.send({ type: 'room.addBot', seat, level });
  }, []);
  const removeBot = useCallback((seat: Seat) => {
    socketRef.current!.send({ type: 'room.removeBot', seat });
  }, []);
  const configure = useCallback((config: RulesConfig) => {
    socketRef.current!.send({ type: 'room.configure', config });
  }, []);
  const setReady = useCallback((ready: boolean) => {
    socketRef.current!.send({ type: 'room.ready', ready });
  }, []);
  const startGame = useCallback(() => {
    socketRef.current!.send({ type: 'room.start' });
  }, []);
  const leaveRoom = useCallback(() => {
    socketRef.current!.send({ type: 'room.leave' });
    clearSession();
    sessionRef.current = null;
    setRoomState(null);
    setView(null);
    setMySeat(null);
    setMatchResult(undefined);
    setRematchVotes(null);
  }, [setMySeat]);
  const pass = useCallback((cards: [Card, Card, Card]) => {
    socketRef.current!.send({ type: 'game.pass', cards });
  }, []);
  const play = useCallback((card: Card) => {
    socketRef.current!.send({ type: 'game.play', card });
  }, []);
  const rematch = useCallback(() => {
    socketRef.current!.send({ type: 'room.rematch' });
  }, []);
  const sendEmote = useCallback((id: string) => {
    socketRef.current!.send({ type: 'emote', id });
  }, []);
  const reclaimSeat = useCallback(() => {
    socketRef.current!.send({ type: 'seat.reclaim' });
  }, []);

  return {
    status,
    roomState,
    view,
    mySeat,
    passesApplied,
    passProgress,
    matchResult,
    rematchVotes,
    turnDeadline,
    presence,
    emotes,
    lastError,
    events,
    clearEvent,
    createRoom,
    joinRoom,
    claimSeat,
    addBot,
    removeBot,
    configure,
    setReady,
    startGame,
    leaveRoom,
    pass,
    play,
    rematch,
    sendEmote,
    reclaimSeat,
  };
}
