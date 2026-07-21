import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card, MatchResult, RulesConfig, Seat } from '@leekha/engine';
import type { SeatView } from '@leekha/engine';
import type { PublicRoom, ServerMessage } from '@leekha/protocol';
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
  const [spectators, setSpectators] = useState<{ count: number; countries: Record<string, number> } | null>(null);
  const [publicRooms, setPublicRooms] = useState<PublicRoom[]>([]);
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
          setPresence(() => {
            const next = { 0: 'connected', 1: 'connected', 2: 'connected', 3: 'connected' } as Record<Seat, PresenceStatus>;
            for (const slot of msg.seats) next[slot.seat] = slot.isBot ? 'bot' : slot.connected ? 'connected' : 'reconnecting';
            return next;
          });
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
          // Authoritative un-seat on reconnect. Normally the 'presence' event
          // below tells a displaced player it was AFK-flipped, but that live
          // event is lost when a phone backgrounds the tab: the socket dies
          // while frozen, so the flip is only learned from the roster in the
          // reconnect's sendObserverView (room.state here). Without this, mySeat
          // stays set, the following game.publicSnapshot is blocked by its
          // mySeatRef guard, and the player is stuck on a stale seated board
          // until a manual refresh. Mirror the presence handler: drop the seat
          // and resync so the observer/claim view lands. (Takeover-by-another-
          // human while backgrounded is a rarer case that would need userId
          // identity to detect here; not covered.)
          if (mySeatRef.current !== null) {
            const mine = msg.seats.find((s) => s.seat === mySeatRef.current);
            if (mine && mine.isBot) {
              setMySeat(null);
              socket.send({ type: 'game.resync' });
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
        case 'game.publicSnapshot': {
          // Only ever apply while unseated: a seat<->observer transition race
          // must never let a blanked (hand: [], legal: null) view stomp a
          // seated player's real hand, so this checks the ref (not state,
          // which could be a render behind) rather than trusting the server's
          // own observer-only targeting alone.
          if (mySeatRef.current !== null) break;
          setView(msg.view);
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
          // Wire uses null for individual games; MatchResult uses undefined.
          setMatchResult({ over: true, losingTeam: msg.losingTeam ?? undefined, bustSeat: msg.bustSeat });
          setView((prev) => (prev ? { ...prev, phase: 'gameOver', scores: msg.totals } : prev));
          break;
        }
        case 'presence': {
          setPresence((prev) => ({ ...prev, [msg.seat]: msg.status }));
          // Room.flipToBot (AFK strikes) only ever announces itself through this
          // event, never a fresh room.state — so this is the one place a
          // displaced player's own client learns it lost its seat. Without
          // clearing mySeat here, a player who goes AFK stays stuck rendering a
          // frozen "seated" board it no longer controls, with the
          // game.publicSnapshot handler's mySeatRef guard permanently blocking
          // it from ever reaching the sidelines claim UI.
          if (msg.seat === mySeatRef.current && msg.status === 'bot') {
            setMySeat(null);
            // sendPublicSnapshot only fires at round boundaries (see room.ts),
            // so without this the view stays stale (our last private hand)
            // until the round ends; resync pulls the current public snapshot now.
            socket.send({ type: 'game.resync' });
          }
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
        case 'room.spectators': {
          setSpectators({ count: msg.count, countries: msg.countries });
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
  //
  // Deliberately does NOT optimistically setMySeat(stored.seat) here: the seat
  // may have been AFK-flipped to a bot, or claimed outright by someone else,
  // while this tab was away, and the server routes a stale token to the
  // observer view rather than handing the seat back (see server.ts's 'auth'
  // handler). Claiming a seat back is room.sit's job now, same as any other
  // sideline observer - assuming we still own it here would let this client
  // render itself into a seat another human already legitimately holds.
  // mySeat is set for real once game.snapshot confirms the seat is still ours.
  const refreshPublicRooms = useCallback(async () => {
    const res = await socketRef.current!.request<{ rooms: PublicRoom[] } | { error: string }>({ type: 'room.list' });
    if ('rooms' in res) setPublicRooms(res.rooms);
  }, []);

  useEffect(() => {
    const socket = socketRef.current!;
    return socket.onStatus((s) => {
      if (s !== 'connected') return;
      // The home screen's public rooms list has nothing to do with any stored
      // seat session, so it refreshes on every connect regardless of the
      // reconnect branch below.
      void refreshPublicRooms();
      const stored = loadSession();
      if (stored) {
        sessionRef.current = stored;
        // Reconnect rebinds purely on seatToken server-side (see server.ts's
        // 'auth' handler); name is a required, non-empty field on the wire
        // regardless, so send a placeholder rather than '' which would fail
        // AuthMsg's min(1) validation and surface as a raw error on screen.
        socket.send({ type: 'auth', name: 'Guest', seatToken: stored.seatToken, locale: navigator.language });
        socket.send({ type: 'game.resync' });
      }
    });
  }, []);

  const createRoom = useCallback(async (name: string, config: RulesConfig, isPublic = false) => {
    socketRef.current!.send({ type: 'auth', name: name || 'Guest', locale: navigator.language });
    const res = await socketRef.current!.request<{ code: string; seatToken: string } | { error: string }>({
      type: 'room.create',
      config,
      isPublic,
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
    socketRef.current!.send({ type: 'auth', name: resolvedName, locale: navigator.language });
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
    socketRef.current!.send({ type: 'auth', name: resolvedName, seatToken: res.seatToken, locale: navigator.language });
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

  const addBot = useCallback((seat: Seat, level: 'easy' | 'medium' | 'hard' | 'insane') => {
    socketRef.current!.send({ type: 'room.addBot', seat, level });
  }, []);
  const removeBot = useCallback((seat: Seat) => {
    socketRef.current!.send({ type: 'room.removeBot', seat });
  }, []);
  const configure = useCallback((config: RulesConfig) => {
    socketRef.current!.send({ type: 'room.configure', config });
  }, []);
  const setSpectatorVoice = useCallback((allow: boolean) => {
    socketRef.current!.send({ type: 'room.configure', allowSpectatorVoice: allow });
  }, []);
  const setPublic = useCallback((isPublic: boolean) => {
    socketRef.current!.send({ type: 'room.configure', isPublic });
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
    setSpectators(null);
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

  return {
    socket: socketRef.current,
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
    spectators,
    lastError,
    events,
    clearEvent,
    publicRooms,
    refreshPublicRooms,
    createRoom,
    joinRoom,
    claimSeat,
    addBot,
    removeBot,
    configure,
    setReady,
    setSpectatorVoice,
    setPublic,
    startGame,
    leaveRoom,
    pass,
    play,
    rematch,
    sendEmote,
  };
}
