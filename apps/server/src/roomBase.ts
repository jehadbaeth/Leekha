import { nanoid } from 'nanoid';
import { IllegalAction, type Seat } from '@leekha/engine';
import type { ServerMessage, PublicRoom, VoiceParticipant, VoiceSignal } from '@leekha/protocol';
import type { BotLevel, RoomPhase, SeatSlot } from './types.js';
import type { MatchRecord } from './db.js';
import type { RoomSnapshot } from './persistence.js';

export interface LiveSnapshot {
  phase: string;
  roundIndex: number;
  scores: [number, number, number, number];
}

const SEATS: Seat[] = [0, 1, 2, 3];

export function emptySeat(seat: Seat): SeatSlot {
  return {
    seat,
    token: null,
    name: null,
    isBot: false,
    botLevel: null,
    ready: false,
    connected: false,
    socketId: null,
    afkStrikes: 0,
    country: null,
    userId: null,
  };
}

// 'observers' targets every connected socket in the room that isn't currently
// seated (see RoomManager.makeEmit's io.except(seatedSocketIds) implementation).
// `{ socket }` targets exactly one socket by id, used for the directed voice
// signaling relay (offer/answer/ICE go to one peer, never broadcast).
export type EmitTarget = Seat | null | 'observers' | { socket: string };
export type Emit = (target: EmitTarget, msg: ServerMessage) => void;

/**
 * The game-agnostic half of a room: seat slots, tokens, host assignment, the
 * lobby (sit / addBot / removeBot / ready / start-gating), spectators, rematch
 * voting, and the whole connection lifecycle (disconnect grace, AFK strike →
 * flip-to-bot, reconnect binding, leave, idle sweeping). This is the Section-11
 * correctness the 43 server e2e tests pin down; both Leekha's `Room` and Trix's
 * `TrixRoom` extend it so there is exactly one copy of it, never a second
 * unverified one.
 *
 * The game-specific half (the phase machine, engine drive, snapshots, per-game
 * timers, bot scheduling, event→message mapping, match recording) lives in each
 * subclass behind the abstract seam below.
 */
export abstract class RoomBase<TConfig> {
  code: string;
  seats: SeatSlot[] = SEATS.map(emptySeat);
  hostSeat: Seat = 0;
  config: TConfig;
  phase: RoomPhase = 'lobby';
  /** Whether this room is listed on the home screen's public rooms list (see RoomManager.listPublic) while still in the lobby with an open seat. */
  isPublic: boolean;
  /** Whether seatless spectators may join the voice lobby. Seated players always may. Host-toggleable. */
  allowSpectatorVoice = true;
  protected rematchVotes = new Set<Seat>();
  private seq = 0;
  protected emit: Emit;
  protected onChange: (() => void) | null = null;
  protected onMatchEnd: ((record: MatchRecord) => void) | null = null;
  protected matchStartedAt: number | null = null;
  private disconnectTimers = new Map<Seat, ReturnType<typeof setTimeout>>();
  /** Seatless watchers currently connected: socketId -> country (null when unresolvable). Never persisted — sockets don't survive a restart. */
  private spectators = new Map<string, string | null>();
  /**
   * Voice lobby participants: socketId (== voiceId) -> {seat, name, muted}.
   * Peer-to-peer mesh, so this is a signaling roster only; no audio touches the
   * server (SPEC-VOICE.md). Capped so a phone's uplink can't be asked to fan out
   * to too many peers. Never persisted (sockets don't survive a restart).
   */
  private voice = new Map<string, { seat: Seat | null; name: string; muted: boolean }>();
  private static readonly MAX_VOICE = 8;
  lastActivity = Date.now();

  constructor(code: string, config: TConfig, emit: Emit, isPublic = false) {
    this.code = code;
    this.config = config;
    this.emit = emit;
    this.isPublic = isPublic;
  }

  // ---- game-specific seam (implemented by each subclass) ----

  /** Start (or rematch) a match: build match state and begin the first round/deal. */
  abstract start(): void;
  /** Deliver the right snapshot to a reconnecting seated player. */
  abstract resync(seat: Seat): void;
  /** The room.state message for this room (carries the game-specific config/gameType). */
  abstract roomStateMessage(): Extract<ServerMessage, { type: 'room.state' }>;
  /** A blanked spectator snapshot for a socket that holds no seat, or null if no match is running. */
  abstract publicSnapshotMessage(): ServerMessage | null;
  /** One row for the home screen's public rooms list. */
  abstract publicSummary(): PublicRoom;
  /** True once the current match has ended (drives rematch-vote counting on an AFK flip, and the idle sweep). */
  abstract isMatchOver(): boolean;
  /** Re-drive bots after a seat flips to bot control mid-decision (game-specific scheduling). */
  protected abstract resumeBotsAfterFlip(): void;
  /** Clear every game-specific timer on destroy. */
  protected abstract clearGameTimers(): void;
  /** A running match's public summary for the admin "ongoing" list, or null if no match is in progress. */
  abstract liveSnapshot(): LiveSnapshot | null;
  /** A Redis-persistable snapshot, or null if this game doesn't persist (Trix v1). */
  abstract serialize(): RoomSnapshot | null;

  // ---- plumbing ----

  setEmit(emit: Emit): void {
    this.emit = emit;
  }

  /** Called after every state-changing operation, used by RoomManager to snapshot to Redis (SPEC.md 9.5). */
  setOnChange(onChange: () => void): void {
    this.onChange = onChange;
  }

  /** Called once per finished match with a fully replayable record, used by RoomManager to write it to SQLite. */
  setOnMatchEnd(onMatchEnd: (record: MatchRecord) => void): void {
    this.onMatchEnd = onMatchEnd;
  }

  protected nextSeq(): number {
    return ++this.seq;
  }

  protected touch(): void {
    this.lastActivity = Date.now();
  }

  // ---- lobby ----

  seatSlotSchema() {
    return this.seats.map((s) => ({
      seat: s.seat,
      occupied: s.name !== null,
      name: s.name ?? undefined,
      isBot: s.isBot,
      botLevel: s.botLevel ?? undefined,
      ready: s.ready,
      connected: s.connected,
      country: s.country ?? null,
    }));
  }

  broadcastRoomState(): void {
    this.emit(null, this.roomStateMessage());
    this.onChange?.();
  }

  // ---- spectators ----

  spectatorsMessage(): Extract<ServerMessage, { type: 'room.spectators' }> {
    const countries: Record<string, number> = {};
    for (const country of this.spectators.values()) {
      if (country) countries[country] = (countries[country] ?? 0) + 1;
    }
    return {
      type: 'room.spectators',
      seq: this.nextSeq(),
      roomCode: this.code,
      count: this.spectators.size,
      countries,
    };
  }

  addSpectator(socketId: string, country: string | null): void {
    const known = this.spectators.get(socketId);
    if (this.spectators.has(socketId) && known === country) return;
    this.spectators.set(socketId, country);
    this.emit(null, this.spectatorsMessage());
  }

  removeSpectator(socketId: string): void {
    if (!this.spectators.delete(socketId)) return;
    this.emit(null, this.spectatorsMessage());
  }

  // ---- voice lobby ----

  private voiceRoster(): VoiceParticipant[] {
    return [...this.voice.entries()].map(([voiceId, v]) => ({ voiceId, seat: v.seat, name: v.name, muted: v.muted }));
  }

  /**
   * Add a socket to the voice mesh. On success, sends the joiner a voice.roster
   * (everyone ALREADY in voice, so it knows whom to call, plus its own voiceId)
   * and broadcasts voice.joined to the room. A seatless spectator is refused
   * when the host has voice off for spectators; anyone is refused once the mesh
   * is at capacity.
   */
  voiceJoin(socketId: string, seat: Seat | null, name: string): { ok: true } | { error: 'voice-disabled' | 'voice-full' } {
    this.touch();
    if (seat === null && !this.allowSpectatorVoice) return { error: 'voice-disabled' };
    if (!this.voice.has(socketId) && this.voice.size >= RoomBase.MAX_VOICE) return { error: 'voice-full' };
    // Snapshot the roster BEFORE adding self, so the joiner receives only the
    // peers it needs to open connections to (never itself).
    const others = this.voiceRoster();
    const already = this.voice.has(socketId);
    this.voice.set(socketId, { seat, name, muted: false });
    this.emit(
      { socket: socketId },
      { type: 'voice.roster', seq: this.nextSeq(), roomCode: this.code, self: socketId, participants: others },
    );
    if (!already) {
      this.emit(null, {
        type: 'voice.joined',
        seq: this.nextSeq(),
        roomCode: this.code,
        participant: { voiceId: socketId, seat, name, muted: false },
      });
    }
    return { ok: true };
  }

  voiceLeave(socketId: string): void {
    if (!this.voice.delete(socketId)) return;
    this.emit(null, { type: 'voice.left', seq: this.nextSeq(), roomCode: this.code, voiceId: socketId });
  }

  voiceSetMuted(socketId: string, muted: boolean): void {
    const v = this.voice.get(socketId);
    if (!v || v.muted === muted) return;
    v.muted = muted;
    this.emit(null, { type: 'voice.state', seq: this.nextSeq(), roomCode: this.code, voiceId: socketId, muted });
  }

  /**
   * Relay one signaling message from a voice member to a single other voice
   * member. Both ends must currently be in this room's voice set: this is the
   * guard that stops the relay being abused to push arbitrary payloads at any
   * socket. No-op (and returns false) otherwise.
   */
  voiceRelay(fromSocketId: string, toVoiceId: string, signal: VoiceSignal): boolean {
    if (!this.voice.has(fromSocketId) || !this.voice.has(toVoiceId)) return false;
    this.emit(
      { socket: toVoiceId },
      { type: 'voice.signal', seq: this.nextSeq(), roomCode: this.code, from: fromSocketId, signal },
    );
    return true;
  }

  /** Host toggle. Turning spectator voice off also drops any spectators currently in the mesh. */
  setAllowSpectatorVoice(allow: boolean): void {
    this.touch();
    this.allowSpectatorVoice = allow;
    if (!allow) {
      for (const [socketId, v] of [...this.voice.entries()]) {
        if (v.seat === null) this.voiceLeave(socketId);
      }
    }
    this.broadcastRoomState();
  }

  /** An empty chair, or if none, any bot-occupied seat a human can take over (SPEC.md 11: no seat may ever refuse a human for having a bot in it). */
  findOpenSeat(): Seat | null {
    const empty = this.seats.find((s) => s.name === null);
    if (empty) return empty.seat;
    return this.seats.find((s) => s.isBot)?.seat ?? null;
  }

  sit(seat: Seat, name: string, socketId: string, country: string | null = null, userId: string | null = null): string {
    this.touch();
    const slot = this.seats[seat];
    const isTakeover = slot.isBot;
    if (slot.name !== null && !isTakeover) throw new IllegalAction('seat-taken', 'That seat is occupied');
    slot.name = name;
    slot.isBot = false;
    slot.botLevel = null;
    slot.token = nanoid(24);
    slot.connected = true;
    slot.socketId = socketId;
    slot.afkStrikes = 0;
    slot.country = country;
    slot.userId = userId;
    slot.ready = isTakeover ? slot.ready : false;
    // A spectator who claims a seat stops being a spectator.
    this.removeSpectator(socketId);
    if (!this.seats.some((s) => s.name !== null && s.seat !== seat)) this.hostSeat = seat;
    this.broadcastRoomState();
    // A takeover replaces whoever (bot or previously-AFK human) held the seat; their
    // old seat token was just overwritten above, so a stale reconnect attempt with it
    // lands them as an observer in the 'auth' handler instead of fighting for the seat.
    if (isTakeover) this.emit(null, { type: 'presence', seq: this.nextSeq(), roomCode: this.code, seat, status: 'connected' });
    return slot.token;
  }

  addBot(seat: Seat, level: BotLevel): void {
    this.touch();
    if (this.phase !== 'lobby') throw new IllegalAction('bad-phase', 'Can only add bots in the lobby');
    const slot = this.seats[seat];
    if (slot.name !== null) throw new IllegalAction('seat-taken', 'That seat is occupied');
    slot.isBot = true;
    slot.botLevel = level;
    slot.name = `Bot ${seat}`;
    slot.ready = true;
    slot.connected = true;
    this.broadcastRoomState();
  }

  removeBot(seat: Seat): void {
    this.touch();
    if (this.phase !== 'lobby') throw new IllegalAction('bad-phase', 'Can only remove bots in the lobby');
    const slot = this.seats[seat];
    if (!slot.isBot) throw new IllegalAction('not-a-bot', 'That seat is not a bot');
    this.seats[seat] = emptySeat(seat);
    this.broadcastRoomState();
  }

  configure(config: TConfig): void {
    this.touch();
    if (this.phase !== 'lobby') throw new IllegalAction('bad-phase', 'Can only configure the room in the lobby');
    this.config = config;
    this.broadcastRoomState();
  }

  setReady(seat: Seat, ready: boolean): void {
    this.touch();
    const slot = this.seats[seat];
    if (slot.isBot) return;
    slot.ready = ready;
    this.broadcastRoomState();
  }

  canStart(): boolean {
    return this.seats.every((s) => (s.name !== null || s.isBot) && (s.isBot || s.ready));
  }

  /**
   * A connected human casting a "play again" vote once the match is over.
   * Bots (lobby-added or AFK-flipped) never need to vote — rematchQuorumMet
   * treats them as automatic yeses, mirroring canStart()'s ready-check — so a
   * solo human at a table of bots restarts on their first click, while an
   * all-human room only restarts once every seat has voted.
   */
  voteRematch(seat: Seat): void {
    this.touch();
    if (!this.isMatchOver()) return;
    if (this.seats[seat].isBot) return;
    this.rematchVotes.add(seat);
    this.broadcastRematchVotes();
    if (this.rematchQuorumMet()) this.start();
  }

  protected rematchQuorumMet(): boolean {
    return this.seats.every((s) => s.isBot || this.rematchVotes.has(s.seat));
  }

  protected broadcastRematchVotes(): void {
    this.emit(null, {
      type: 'game.rematchVotes',
      seq: this.nextSeq(),
      roomCode: this.code,
      seatsVoted: [...this.rematchVotes],
      seatsNeeded: this.seats.filter((s) => !s.isBot).map((s) => s.seat),
    });
  }

  // ---- presence / reconnection / AFK flip ----

  protected flipToBot(seat: Seat): void {
    const slot = this.seats[seat];
    if (slot.isBot) return;
    slot.isBot = true;
    slot.botLevel = slot.botLevel ?? 'hard';
    // The seat is no longer this player's place (SPEC.md 11 item 4): it goes
    // right back on the sidelines under its own bot name, same as a
    // lobby-added bot, rather than keeping the idled-out human's name on a
    // seat someone else may claim next.
    slot.name = `Bot ${seat}`;
    this.emit(null, { type: 'presence', seq: this.nextSeq(), roomCode: this.code, seat, status: 'bot' });
    // room.state (not just the presence status) has to go out here too, or
    // every client's cached seat roster keeps showing the idled-out human's
    // name until some unrelated event happens to refresh it.
    this.broadcastRoomState();
    this.resumeBotsAfterFlip();
    // A seat that goes AFK while a rematch vote is pending now counts as an
    // automatic yes (see rematchQuorumMet); this may be the last holdout.
    if (this.isMatchOver()) {
      this.broadcastRematchVotes();
      if (this.rematchQuorumMet()) this.start();
    }
    this.onChange?.();
  }

  /**
   * Only ever called for a seat server.ts's 'auth' handler has confirmed is
   * still this connection's own (token matches, not flipped to bot) - a
   * network-blip reconnect, not a comeback from being AFK-flipped or taken
   * over. Reclaiming either of those now goes through sit() like anyone else
   * on the sidelines (SPEC.md 11), so there is no isBot un-flip here.
   */
  bindSocket(seat: Seat, socketId: string, country?: string | null, userId?: string | null): void {
    const slot = this.seats[seat];
    slot.socketId = socketId;
    slot.connected = true;
    // A reconnect is a fresh connection with a fresh lookup; it also backfills
    // seats restored from pre-feature Redis snapshots that carried no country.
    if (country) slot.country = country;
    if (userId) slot.userId = userId;
    // A reconnecting player may have been counted as a spectator moments ago.
    this.removeSpectator(socketId);
    const timer = this.disconnectTimers.get(seat);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(seat);
    }
    this.emit(null, { type: 'presence', seq: this.nextSeq(), roomCode: this.code, seat, status: 'connected' });
    if (this.phase === 'lobby') this.broadcastRoomState();
  }

  seatForToken(token: string): Seat | null {
    return this.seats.find((s) => s.token === token)?.seat ?? null;
  }

  disconnectSocket(socketId: string): void {
    this.removeSpectator(socketId);
    this.voiceLeave(socketId);
    const slot = this.seats.find((s) => s.socketId === socketId);
    if (!slot || slot.isBot) return;
    slot.connected = false;
    slot.socketId = null;
    if (this.phase === 'lobby') {
      this.broadcastRoomState();
      return;
    }
    this.emit(null, { type: 'presence', seq: this.nextSeq(), roomCode: this.code, seat: slot.seat, status: 'reconnecting' });
    const timer = setTimeout(() => this.flipToBot(slot.seat), 15_000);
    this.disconnectTimers.set(slot.seat, timer);
  }

  leave(seat: Seat): void {
    const slot = this.seats[seat];
    if (this.phase === 'lobby') {
      this.seats[seat] = emptySeat(seat);
      if (this.hostSeat === seat) {
        const nextHost = this.seats.find((s) => s.name !== null && !s.isBot);
        if (nextHost) this.hostSeat = nextHost.seat;
      }
      this.broadcastRoomState();
    } else {
      slot.connected = false;
      slot.socketId = null;
      this.flipToBot(seat);
    }
  }

  /**
   * Seats a human still owns, including one AFK-flipped to bot control — it
   * still holds a token its owner could reclaim, so RoomManager.sweep() must
   * not treat the room as abandoned just because a bot is playing it right
   * now (SPEC.md 11). A lobby-added bot never receives a token, so this
   * excludes those correctly without checking isBot at all.
   */
  humanCount(): number {
    return this.seats.filter((s) => s.token !== null).length;
  }

  protected clearDisconnectTimers(): void {
    for (const t of this.disconnectTimers.values()) clearTimeout(t);
  }

  destroy(): void {
    this.clearGameTimers();
    this.clearDisconnectTimers();
  }
}
