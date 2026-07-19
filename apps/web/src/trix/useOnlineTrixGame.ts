import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card, Contract, Seat, TrickPlay, TrixRulesConfig, TrixSeatView } from '@leekha/trix';
import type { PublicRoom, ServerMessage } from '@leekha/protocol';
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
  const [emotes, setEmotes] = useState<Record<Seat, { id: string; ts: number } | null>>({ 0: null, 1: null, 2: null, 3: null });
  const [rematchVotes, setRematchVotes] = useState<{ seatsVoted: Seat[]; seatsNeeded: Seat[] } | null>(null);
  const [spectators, setSpectators] = useState<{ count: number; countries: Record<string, number> } | null>(null);
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const roomStateRef = useRef<RoomState | null>(null);
  // Ref mirror of mySeat so the socket message handler reads the live value, not
  // a stale closure capture (same race guard useOnlineGame uses).
  const mySeatRef = useRef<Seat | null>(null);
  const setMySeatBoth = useCallback((s: Seat | null) => {
    mySeatRef.current = s;
    setMySeat(s);
  }, []);
  // Event stream (from trix.played/trix.trickEnd) + completed tricks this deal,
  // feeding GameTable's sounds/haptics/trick-freeze + last-trick review, exactly
  // like the local hook. Reset per deal, keyed on (kingdom, contracts spent).
  const [events, setEvents] = useState<{ id: number; event: { type: string } }[]>([]);
  const [playedCards, setPlayedCards] = useState<TrickPlay[][]>([]);
  const eventIdRef = useRef(0);
  const lastDealKeyRef = useRef<string>('');
  const clearEvent = useCallback((id: number) => setEvents((prev) => prev.filter((e) => e.id !== id)), []);
  const pushEvent = useCallback((event: { type: string; [k: string]: unknown }) => {
    setEvents((prev) => [...prev, { id: eventIdRef.current++, event }]);
  }, []);

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
          // AFK-flip recovery via the roster (covers a backgrounded tab that
          // missed the live 'presence' event): if our own seat is now a bot, we
          // lost it — drop to observer and resync (same as useOnlineGame).
          if (mySeatRef.current !== null) {
            const mine = msg.seats.find((s) => s.seat === mySeatRef.current);
            if (mine && mine.isBot) {
              setMySeatBoth(null);
              socket.send({ type: 'game.resync' });
            }
          }
          break;
        }
        case 'trix.snapshot': {
          setView(msg.view);
          setMySeatBoth(msg.view.seat);
          // A fresh snapshot means the game moved on; clear any lingering recap.
          // The deal-recap pause holds because the server sends no snapshot
          // during its advance delay (see TrixRoom.applyResult).
          setPendingDeal(null);
          // New deal (kingdom or contracts-spent changed) → fresh trick history,
          // so "last trick" never shows a prior deal's trick. Resetting here (on
          // the next deal's first snapshot) rather than at dealEnd keeps the last
          // trick reviewable through the recap.
          const dealKey = `${msg.view.kingdomIndex}:${msg.view.contractsSpent.length}`;
          if (dealKey !== lastDealKeyRef.current) {
            lastDealKeyRef.current = dealKey;
            setPlayedCards([]);
          }
          break;
        }
        case 'trix.publicSnapshot': {
          if (mySeatRef.current !== null) break;
          setView(msg.view);
          break;
        }
        case 'trix.turn': {
          setTurnDeadline({ seat: msg.seat, deadline: msg.deadline });
          break;
        }
        case 'trix.played': {
          pushEvent({ type: 'played', seat: msg.seat, card: msg.card });
          break;
        }
        case 'trix.trickEnd': {
          pushEvent({ type: 'trickEnd', winner: msg.winner, cards: msg.cards, points: 0 });
          setPlayedCards((prev) => [...prev, msg.cards]);
          break;
        }
        case 'trix.dealEnd': {
          setPendingDeal({ dealScores: msg.dealScores, totals: msg.totals });
          pushEvent({ type: 'roundEnd' });
          break;
        }
        case 'trix.over': {
          pushEvent({ type: 'gameOver', losingTeam: msg.winnerTeam === 0 ? 1 : 0 });
          break;
        }
        case 'presence': {
          setPresence((prev) => ({ ...prev, [msg.seat]: msg.status }));
          // The live AFK-flip signal for our own seat: we lost it to a bot, so
          // drop to observer and resync (mirrors useOnlineGame).
          if (msg.seat === mySeatRef.current && msg.status === 'bot') {
            setMySeatBoth(null);
            socket.send({ type: 'game.resync' });
          }
          break;
        }
        case 'game.rematchVotes': {
          setRematchVotes({ seatsVoted: msg.seatsVoted, seatsNeeded: msg.seatsNeeded });
          break;
        }
        case 'room.spectators': {
          setSpectators({ count: msg.count, countries: msg.countries });
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
    // Handlers read mySeatRef (not state), so no need to re-subscribe on seat change.
  }, [pushEvent, setMySeatBoth]);

  const refreshPublicRooms = useCallback(async () => {
    const res = await socketRef.current!.request<{ rooms: PublicRoom[] } | { error: string }>({ type: 'room.list' });
    if ('rooms' in res) setPublicRooms(res.rooms);
  }, []);

  // Reconnect: replay a stored seat token so a refreshed tab resumes its seat,
  // and refresh the public rooms list on every (re)connect.
  useEffect(() => {
    const socket = socketRef.current!;
    return socket.onStatus((s) => {
      if (s !== 'connected') return;
      void refreshPublicRooms();
      const stored = loadSession();
      if (stored) {
        socket.send({ type: 'auth', name: 'Guest', seatToken: stored.seatToken, locale: navigator.language });
        socket.send({ type: 'game.resync' });
      }
    });
  }, [refreshPublicRooms]);

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
    setMySeatBoth(0);
    // The first room.state was broadcast before this socket joined its room (see
    // useOnlineGame.createRoom's note); resync re-triggers it now.
    socketRef.current!.send({ type: 'game.resync' });
    return res.code;
  }, [setMySeatBoth]);

  const claimSeat = useCallback(async (seat: Seat) => {
    const res = await socketRef.current!.request<{ seatToken: string } | { error: string }>({ type: 'room.sit', seat });
    if ('error' in res) {
      setLastError(res.error);
      return false;
    }
    const roomCode = roomStateRef.current?.roomCode ?? '';
    saveSession({ roomCode, seatToken: res.seatToken, seat });
    setMySeatBoth(seat);
    socketRef.current!.send({ type: 'game.resync' });
    return true;
  }, [setMySeatBoth]);

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
    setMySeatBoth(null);
    setPendingDeal(null);
    setRematchVotes(null);
    setSpectators(null);
  }, [setMySeatBoth]);

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
  const sendEmote = useCallback((emoteId: string) => {
    socketRef.current!.send({ type: 'emote', id: emoteId });
  }, []);

  // Per-seat country (ISO alpha-2) from the roster, for the flag next to names.
  const countries: Partial<Record<Seat, string | null>> = {};
  for (const slot of roomState?.seats ?? []) countries[slot.seat] = slot.country ?? null;

  return {
    status,
    roomState,
    mySeat,
    lastError,
    createRoom,
    joinRoom,
    claimSeat,
    addBot,
    removeBot,
    setReady,
    startGame,
    leaveRoom,
    refreshPublicRooms,
    publicRooms,
    // controller
    view,
    pendingDeal,
    continueDeal,
    startMatch,
    humanChooseContract,
    humanExpose,
    humanPass,
    humanPlay,
    events,
    clearEvent,
    playedCards,
    // online-only extras forwarded to GameTable. turnDeadline.seat is null during
    // the selecting phase (no acting card seat); GameTable's ring wants a real
    // seat, so drop those to null.
    presence,
    turnDeadline: turnDeadline && turnDeadline.seat !== null ? { seat: turnDeadline.seat, deadline: turnDeadline.deadline } : null,
    roomCode: roomState?.roomCode ?? null,
    emotes,
    sendEmote,
    rematchVotes,
    spectators,
    countries,
  };
}
