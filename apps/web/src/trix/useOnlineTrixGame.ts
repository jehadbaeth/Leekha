import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card, Contract, Seat, TrixRulesConfig, TrixSeatView } from '@leekha/trix';
import type { ServerMessage } from '@leekha/protocol';
import { GameSocket, type ConnectionStatus } from '../net/socket';
import { clearSession, loadSession, saveSession, type StoredSession } from '../net/session';

type RoomState = Extract<ServerMessage, { type: 'room.state' }>;
type PresenceStatus = 'connected' | 'reconnecting' | 'bot';

/**
 * Online counterpart of useTrixGame: owns a socket to a Trix room and derives
 * the same TrixController shape (view + pendingDeal + the human action
 * callbacks) that the local hook returns, so TrixGame renders identically for
 * both. Snapshot-driven — every trix.snapshot replaces the view wholesale.
 *
 * Scope (v1, vs-bots evaluation): create/join room, lobby, play, deal recap,
 * match over, rematch, leave. Reconnect/spectator/sideline-claim parity with
 * Leekha's useOnlineGame is deferred — the server still enforces seat ownership
 * regardless, so a client-side gap here is a UX annoyance, not a correctness
 * hole.
 */
export function useOnlineTrixGame() {
  const socketRef = useRef<GameSocket | null>(null);
  if (!socketRef.current) socketRef.current = new GameSocket();

  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [view, setView] = useState<TrixSeatView | null>(null);
  const [mySeat, setMySeat] = useState<Seat | null>(null);
  const [pendingDeal, setPendingDeal] = useState<{ dealScores: [number, number, number, number]; totals: [number, number, number, number] } | null>(null);
  const [turnDeadline, setTurnDeadline] = useState<{ seat: Seat | null; deadline: number | null } | null>(null);
  const [presence, setPresence] = useState<Record<Seat, PresenceStatus>>({ 0: 'connected', 1: 'connected', 2: 'connected', 3: 'connected' });
  const [lastError, setLastError] = useState<string | null>(null);
  const roomStateRef = useRef<RoomState | null>(null);

  useEffect(() => {
    const socket = socketRef.current!;
    const offStatus = socket.onStatus(setStatus);
    const offMsg = socket.onMessage((msg) => {
      switch (msg.type) {
        case 'room.state': {
          roomStateRef.current = msg;
          setRoomState(msg);
          setPresence(() => {
            const next = { 0: 'connected', 1: 'connected', 2: 'connected', 3: 'connected' } as Record<Seat, PresenceStatus>;
            for (const slot of msg.seats) next[slot.seat] = slot.isBot ? 'bot' : slot.connected ? 'connected' : 'reconnecting';
            return next;
          });
          break;
        }
        case 'trix.snapshot': {
          setView(msg.view);
          setMySeat(msg.view.seat);
          // A fresh snapshot means the game moved on; clear any lingering recap.
          // The deal-recap pause holds because the server sends no snapshot
          // during its advance delay (see TrixRoom.applyResult).
          setPendingDeal(null);
          break;
        }
        case 'trix.publicSnapshot': {
          if (mySeat !== null) break;
          setView(msg.view);
          break;
        }
        case 'trix.turn': {
          setTurnDeadline({ seat: msg.seat, deadline: msg.deadline });
          break;
        }
        case 'trix.dealEnd': {
          setPendingDeal({ dealScores: msg.dealScores, totals: msg.totals });
          break;
        }
        case 'presence': {
          setPresence((prev) => ({ ...prev, [msg.seat]: msg.status }));
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
  }, [mySeat]);

  // Reconnect: replay a stored seat token so a refreshed tab resumes its seat.
  useEffect(() => {
    const socket = socketRef.current!;
    return socket.onStatus((s) => {
      if (s !== 'connected') return;
      const stored = loadSession();
      if (stored) {
        socket.send({ type: 'auth', name: 'Guest', seatToken: stored.seatToken, locale: navigator.language });
        socket.send({ type: 'game.resync' });
      }
    });
  }, []);

  const createRoom = useCallback(async (name: string, config: TrixRulesConfig) => {
    socketRef.current!.send({ type: 'auth', name: name || 'Guest', locale: navigator.language });
    const res = await socketRef.current!.request<{ code: string; seatToken: string } | { error: string }>({
      type: 'room.create',
      gameType: 'trix',
      trixConfig: config,
    });
    if ('error' in res) {
      setLastError(res.error);
      return null;
    }
    const session: StoredSession = { roomCode: res.code, seatToken: res.seatToken, seat: 0 };
    saveSession(session);
    setMySeat(0);
    // The first room.state was broadcast before this socket joined its room (see
    // useOnlineGame.createRoom's note); resync re-triggers it now.
    socketRef.current!.send({ type: 'game.resync' });
    return res.code;
  }, []);

  const joinRoom = useCallback(async (name: string, code: string) => {
    const resolved = name || 'Guest';
    socketRef.current!.send({ type: 'auth', name: resolved, locale: navigator.language });
    const res = await socketRef.current!.request<{ seatToken: string } | { observer: true } | { error: string }>({
      type: 'room.join',
      code: code.toUpperCase(),
    });
    if ('error' in res) {
      setLastError(res.error);
      return false;
    }
    if ('observer' in res) return true;
    saveSession({ roomCode: code.toUpperCase(), seatToken: res.seatToken, seat: 0 });
    socketRef.current!.send({ type: 'auth', name: resolved, seatToken: res.seatToken, locale: navigator.language });
    socketRef.current!.send({ type: 'game.resync' });
    return true;
  }, []);

  const addBot = useCallback((seat: Seat) => {
    socketRef.current!.send({ type: 'room.addBot', seat, level: 'hard' });
  }, []);
  const removeBot = useCallback((seat: Seat) => {
    socketRef.current!.send({ type: 'room.removeBot', seat });
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
    setRoomState(null);
    setView(null);
    setMySeat(null);
    setPendingDeal(null);
  }, []);

  // --- TrixController API (identical shape to useTrixGame's return) ---
  const humanChooseContract = useCallback((contracts: Contract[]) => {
    socketRef.current!.send({ type: 'trix.chooseContract', contracts });
  }, []);
  const humanExpose = useCallback((card: Card) => {
    socketRef.current!.send({ type: 'trix.expose', card });
  }, []);
  const humanPass = useCallback(() => {
    socketRef.current!.send({ type: 'trix.pass' });
  }, []);
  const humanPlay = useCallback((card: Card) => {
    socketRef.current!.send({ type: 'trix.play', card });
  }, []);
  const continueDeal = useCallback(() => {
    // No-op online: the server auto-advances after the recap pause.
  }, []);
  const startMatch = useCallback(() => {
    socketRef.current!.send({ type: 'room.rematch' });
  }, []);

  return {
    status,
    roomState,
    mySeat,
    lastError,
    createRoom,
    joinRoom,
    addBot,
    removeBot,
    setReady,
    startGame,
    leaveRoom,
    // controller
    view,
    pendingDeal,
    continueDeal,
    startMatch,
    humanChooseContract,
    humanExpose,
    humanPass,
    humanPlay,
    // event stream is filled in Batch A-online (trix.played/trix.trickEnd); empty for now
    events: [] as { id: number; event: { type: string } }[],
    clearEvent: (_id: number) => {},
    playedCards: [] as { seat: Seat; card: unknown }[][],
    // online-only extras forwarded to GameTable. turnDeadline.seat is null during
    // the selecting phase (no acting card seat); GameTable's ring wants a real
    // seat, so drop those to null.
    presence,
    turnDeadline: turnDeadline && turnDeadline.seat !== null ? { seat: turnDeadline.seat, deadline: turnDeadline.deadline } : null,
    roomCode: roomState?.roomCode ?? null,
  };
}
