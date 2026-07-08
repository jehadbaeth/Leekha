import { nanoid } from 'nanoid';
import {
  Card,
  GameEvent,
  IllegalAction,
  MatchState,
  RulesConfig,
  Seat,
  commitPass,
  newMatch,
  playCard,
  startRound,
  viewFor,
} from '@leekha/engine';
import type { ServerMessage } from '@leekha/protocol';
import { botForLevel } from './bot.js';
import type { RoomPhase, SeatSlot } from './types.js';
import type { RoomSnapshot } from './persistence.js';

const SEATS: Seat[] = [0, 1, 2, 3];
const ROUND_ADVANCE_DELAY_MS = 4000;
const BOT_MIN_DELAY_MS = 600;
const BOT_MAX_DELAY_MS = 1800;

function botThinkDelay(): number {
  return BOT_MIN_DELAY_MS + Math.random() * (BOT_MAX_DELAY_MS - BOT_MIN_DELAY_MS);
}

function emptySeat(seat: Seat): SeatSlot {
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
  };
}

// 'observers' targets every connected socket in the room that isn't currently
// seated (see RoomManager.makeEmit's io.except(seatedSocketIds) implementation).
export type EmitTarget = Seat | null | 'observers';
export type Emit = (target: EmitTarget, msg: ServerMessage) => void;

export class Room {
  code: string;
  seats: SeatSlot[] = SEATS.map(emptySeat);
  hostSeat: Seat = 0;
  config: RulesConfig;
  phase: RoomPhase = 'lobby';
  match: MatchState | null = null;
  private rematchVotes = new Set<Seat>();
  private seq = 0;
  private emit: Emit;
  private onChange: (() => void) | null = null;
  private passTimer: ReturnType<typeof setTimeout> | null = null;
  private playTimer: ReturnType<typeof setTimeout> | null = null;
  private roundAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimers = new Map<Seat, ReturnType<typeof setTimeout>>();
  lastActivity = Date.now();

  constructor(code: string, config: RulesConfig, emit: Emit) {
    this.code = code;
    this.config = config;
    this.emit = emit;
  }

  setEmit(emit: Emit): void {
    this.emit = emit;
  }

  /** Called after every state-changing operation, used by RoomManager to snapshot to Redis (SPEC.md 9.5). */
  setOnChange(onChange: () => void): void {
    this.onChange = onChange;
  }

  private nextSeq(): number {
    return ++this.seq;
  }

  private touch(): void {
    this.lastActivity = Date.now();
  }

  /** A snapshot suitable for JSON persistence; sockets never survive a restart so connection state is dropped. */
  serialize(): RoomSnapshot {
    return {
      code: this.code,
      config: this.config,
      phase: this.phase,
      hostSeat: this.hostSeat,
      match: this.match,
      seats: this.seats.map((s) => ({ ...s, connected: false, socketId: null })),
    };
  }

  /** Rebuilds a Room from a Redis snapshot and re-arms whatever clock the in-flight phase needs. */
  static fromSnapshot(snapshot: RoomSnapshot, emit: Emit): Room {
    const room = new Room(snapshot.code, snapshot.config, emit);
    room.phase = snapshot.phase;
    room.hostSeat = snapshot.hostSeat;
    room.match = snapshot.match;
    room.seats = snapshot.seats;
    room.touch();
    if (room.phase === 'game' && room.match) {
      if (room.match.phase === 'passing') {
        room.armPassTimer();
        room.scheduleBotPasses();
      } else if (room.match.phase === 'playing') {
        room.beginTurn();
      } else if (room.match.phase === 'roundEnd') {
        room.roundAdvanceTimer = setTimeout(() => room.beginRound(), ROUND_ADVANCE_DELAY_MS);
      }
    }
    return room;
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
    }));
  }

  /** Builds a room.state message without sending it, for targeting a single joining socket (see server.ts's observer join path). */
  roomStateMessage(): Extract<ServerMessage, { type: 'room.state' }> {
    return {
      type: 'room.state',
      seq: this.nextSeq(),
      roomCode: this.code,
      seats: this.seatSlotSchema(),
      config: this.config,
      hostSeat: this.hostSeat,
      phase: this.phase,
    };
  }

  broadcastRoomState(): void {
    this.emit(null, this.roomStateMessage());
    this.onChange?.();
  }

  /** An empty chair, or if none, any bot-occupied seat a human can take over (SPEC.md 11: no seat may ever refuse a human for having a bot in it). */
  findOpenSeat(): Seat | null {
    const empty = this.seats.find((s) => s.name === null);
    if (empty) return empty.seat;
    return this.seats.find((s) => s.isBot)?.seat ?? null;
  }

  sit(seat: Seat, name: string, socketId: string): string {
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
    slot.ready = isTakeover ? slot.ready : false;
    if (!this.seats.some((s) => s.name !== null && s.seat !== seat)) this.hostSeat = seat;
    this.broadcastRoomState();
    // A takeover replaces whoever (bot or previously-AFK human) held the seat; their
    // old seat token was just overwritten above, so a stale reconnect attempt with it
    // lands them as an observer in the 'auth' handler instead of fighting for the seat.
    if (isTakeover) this.emit(null, { type: 'presence', seq: this.nextSeq(), roomCode: this.code, seat, status: 'connected' });
    return slot.token;
  }

  addBot(seat: Seat, level: 'easy' | 'medium' | 'hard'): void {
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

  configure(config: RulesConfig): void {
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

  start(): void {
    this.touch();
    this.rematchVotes.clear();
    if (this.phase === 'lobby') {
      if (!this.canStart()) throw new IllegalAction('not-ready', 'All four seats must be filled and humans ready');
      this.match = newMatch(this.config, nanoid(16));
      this.phase = 'game';
      this.beginRound();
      return;
    }
    // Rematch: only valid once the previous match is over.
    if (this.match && this.match.phase === 'gameOver') {
      this.match = newMatch(this.config, nanoid(16));
      this.beginRound();
      return;
    }
    throw new IllegalAction('bad-phase', 'A match is already in progress');
  }

  /**
   * A connected human casting a "play again" vote once the match is over.
   * Bots (lobby-added or AFK-flipped) never need to vote — rematchQuorumMet
   * treats them as automatic yeses, mirroring canStart()'s ready-check — so a
   * solo human at a table of bots restarts on their first click, while an
   * all-human room only restarts once every seat has voted (SPEC.md: "with
   * votes if it's a multiplayer game").
   */
  voteRematch(seat: Seat): void {
    this.touch();
    if (!this.match || this.match.phase !== 'gameOver') return;
    if (this.seats[seat].isBot) return;
    this.rematchVotes.add(seat);
    this.broadcastRematchVotes();
    if (this.rematchQuorumMet()) this.start();
  }

  private rematchQuorumMet(): boolean {
    return this.seats.every((s) => s.isBot || this.rematchVotes.has(s.seat));
  }

  private broadcastRematchVotes(): void {
    this.emit(null, {
      type: 'game.rematchVotes',
      seq: this.nextSeq(),
      roomCode: this.code,
      seatsVoted: [...this.rematchVotes],
      seatsNeeded: this.seats.filter((s) => !s.isBot).map((s) => s.seat),
    });
  }

  // ---- game ----

  private beginRound(): void {
    if (!this.match) return;
    this.match = startRound(this.match);
    for (const seat of SEATS) {
      this.emit(seat, {
        type: 'game.dealt',
        seq: this.nextSeq(),
        roomCode: this.code,
        hand: this.match.round.hands[seat],
        dealer: this.match.dealer,
        roundIndex: this.match.roundIndex,
      });
    }
    this.sendAllSnapshots();
    this.sendPublicSnapshot();
    this.armPassTimer();
    this.emit(null, {
      type: 'game.passPrompt',
      seq: this.nextSeq(),
      roomCode: this.code,
      deadline: Date.now() + this.config.timers.passMs,
    });
    this.scheduleBotPasses();
  }

  private sendAllSnapshots(): void {
    if (!this.match) return;
    for (const seat of SEATS) this.sendSnapshot(seat);
  }

  sendSnapshot(seat: Seat): void {
    if (!this.match) return;
    this.emit(seat, {
      type: 'game.snapshot',
      seq: this.nextSeq(),
      roomCode: this.code,
      view: viewFor(this.match, seat),
    });
  }

  /**
   * A spectator-safe SeatView built for a fixed, fictitious seat 0: the public
   * fields (phase/dealer/currentTrick/scores/etc.) are computed independent of
   * which seat viewFor is called with, only hand/legal/youPassed/youReceived
   * are seat-specific, and those are blanked here so no hidden state crosses
   * the wire to a socket that owns no seat.
   */
  publicSnapshotMessage(): Extract<ServerMessage, { type: 'game.publicSnapshot' }> | null {
    if (!this.match) return null;
    const view = viewFor(this.match, 0);
    return {
      type: 'game.publicSnapshot',
      seq: this.nextSeq(),
      roomCode: this.code,
      view: { ...view, hand: [], legal: null, youPassed: null, youReceived: null },
    };
  }

  private sendPublicSnapshot(): void {
    const msg = this.publicSnapshotMessage();
    if (msg) this.emit('observers', msg);
  }

  private clearPassTimer(): void {
    if (this.passTimer) clearTimeout(this.passTimer);
    this.passTimer = null;
  }

  private clearPlayTimer(): void {
    if (this.playTimer) clearTimeout(this.playTimer);
    this.playTimer = null;
  }

  private armPassTimer(): void {
    this.clearPassTimer();
    if (this.config.timers.passMs <= 0) return;
    this.passTimer = setTimeout(() => this.onPassTimeout(), this.config.timers.passMs);
  }

  private armPlayTimer(): void {
    this.clearPlayTimer();
    if (this.config.timers.playMs <= 0) return;
    this.playTimer = setTimeout(() => this.onPlayTimeout(), this.config.timers.playMs);
  }

  private onPassTimeout(): void {
    if (!this.match || this.match.phase !== 'passing') return;
    for (const seat of SEATS) {
      if (this.match.phase !== 'passing') break;
      if (this.match.round.passes[seat] !== null) continue;
      const slot = this.seats[seat];
      if (slot.isBot) continue;
      this.strikeAndAutoPass(seat);
    }
  }

  private strikeAndAutoPass(seat: Seat): void {
    if (!this.match) return;
    const slot = this.seats[seat];
    slot.afkStrikes++;
    const bot = botForLevel('easy');
    const cards = bot.choosePass(viewFor(this.match, seat));
    this.commitPassInternal(seat, cards);
    if (slot.afkStrikes >= 2) this.flipToBot(seat);
  }

  private flipToBot(seat: Seat): void {
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
    this.scheduleBotPasses();
    this.scheduleBotPlayIfDue();
    // A seat that goes AFK while a rematch vote is pending now counts as an
    // automatic yes (see rematchQuorumMet); this may be the last holdout.
    if (this.match?.phase === 'gameOver') {
      this.broadcastRematchVotes();
      if (this.rematchQuorumMet()) this.start();
    }
    this.onChange?.();
  }

  private onPlayTimeout(): void {
    if (!this.match || this.match.phase !== 'playing') return;
    const seat = this.actingSeat();
    if (seat === null) return;
    const slot = this.seats[seat];
    if (slot.isBot) return;
    slot.afkStrikes++;
    const bot = botForLevel('easy');
    const card = bot.choosePlay(viewFor(this.match, seat));
    this.applyPlay(seat, card);
    if (slot.afkStrikes >= 2) this.flipToBot(seat);
  }

  private actingSeat(): Seat | null {
    if (!this.match || this.match.phase !== 'playing') return null;
    for (const seat of SEATS) {
      if (viewFor(this.match, seat).legal !== null) return seat;
    }
    return null;
  }

  pass(seat: Seat, cards: [Card, Card, Card]): void {
    this.touch();
    if (!this.match || this.match.phase !== 'passing') throw new IllegalAction('bad-phase', 'Not in the passing phase');
    this.commitPassInternal(seat, cards);
  }

  private commitPassInternal(seat: Seat, cards: [Card, Card, Card] | Card[]): void {
    if (!this.match) return;
    this.match = commitPass(this.match, seat, cards as Card[]);
    const committed = SEATS.filter((s) => this.match!.round.passes[s] !== null);
    this.emit(null, {
      type: 'game.passProgress',
      seq: this.nextSeq(),
      roomCode: this.code,
      seatsCommitted: committed,
    });

    if (this.match.phase === 'playing') {
      this.clearPassTimer();
      for (const s of SEATS) {
        this.emit(s, {
          type: 'game.passReveal',
          seq: this.nextSeq(),
          roomCode: this.code,
          received: this.match.round.passes[(((s + 3) % 4) as Seat)] as [Card, Card, Card],
        });
      }
      this.sendAllSnapshots();
      this.sendPublicSnapshot();
      this.beginTurn();
    } else {
      this.scheduleBotPasses();
    }
    this.onChange?.();
  }

  private scheduleBotPasses(): void {
    if (!this.match || this.match.phase !== 'passing') return;
    for (const seat of SEATS) {
      if (this.match.round.passes[seat] !== null) continue;
      if (!this.seats[seat].isBot) continue;
      const level = this.seats[seat].botLevel ?? 'medium';
      setTimeout(() => {
        if (!this.match || this.match.phase !== 'passing') return;
        if (this.match.round.passes[seat] !== null) return;
        const bot = botForLevel(level);
        this.commitPassInternal(seat, bot.choosePass(viewFor(this.match, seat)));
      }, botThinkDelay());
    }
  }

  private beginTurn(): void {
    if (!this.match || this.match.phase !== 'playing') return;
    const seat = this.actingSeat();
    if (seat === null) return;
    this.armPlayTimer();
    const view = viewFor(this.match, seat);
    this.emit(seat, {
      type: 'game.turn',
      seq: this.nextSeq(),
      roomCode: this.code,
      seat,
      deadline: this.config.timers.playMs > 0 ? Date.now() + this.config.timers.playMs : null,
      legal: view.legal ?? undefined,
    });
    for (const other of SEATS) {
      if (other === seat) continue;
      this.emit(other, {
        type: 'game.turn',
        seq: this.nextSeq(),
        roomCode: this.code,
        seat,
        deadline: this.config.timers.playMs > 0 ? Date.now() + this.config.timers.playMs : null,
      });
    }
    this.scheduleBotPlayIfDue();
  }

  private scheduleBotPlayIfDue(): void {
    if (!this.match || this.match.phase !== 'playing') return;
    const seat = this.actingSeat();
    if (seat === null || !this.seats[seat].isBot) return;
    const level = this.seats[seat].botLevel ?? 'medium';
    setTimeout(() => {
      if (!this.match || this.match.phase !== 'playing') return;
      if (this.actingSeat() !== seat) return;
      const bot = botForLevel(level);
      const card = bot.choosePlay(viewFor(this.match, seat));
      this.applyPlay(seat, card);
    }, botThinkDelay());
  }

  play(seat: Seat, card: Card): void {
    this.touch();
    if (!this.match || this.match.phase !== 'playing') throw new IllegalAction('bad-phase', 'Not in the playing phase');
    if (this.actingSeat() !== seat) throw new IllegalAction('not-your-turn', "It is not this seat's turn");
    this.applyPlay(seat, card);
  }

  private applyPlay(seat: Seat, card: Card): void {
    if (!this.match) return;
    this.clearPlayTimer();
    const { state, events } = playCard(this.match, seat, card);
    this.match = state;
    this.emitPlayEvents(seat, card, events);
    this.onChange?.();
  }

  private emitPlayEvents(seat: Seat, card: Card, events: GameEvent[]): void {
    for (const ev of events) {
      if (ev.type === 'played') {
        this.emit(null, {
          type: 'game.played',
          seq: this.nextSeq(),
          roomCode: this.code,
          seat: ev.seat,
          card: ev.card,
          forced: ev.forced,
        });
      } else if (ev.type === 'trickEnd') {
        this.emit(null, {
          type: 'game.trickEnd',
          seq: this.nextSeq(),
          roomCode: this.code,
          winner: ev.winner,
          points: ev.points,
          cards: ev.cards,
        });
      } else if (ev.type === 'roundEnd') {
        this.emit(null, {
          type: 'game.roundEnd',
          seq: this.nextSeq(),
          roomCode: this.code,
          eaten: ev.eaten,
          totals: ev.totals,
        });
        this.sendAllSnapshots();
        this.sendPublicSnapshot();
        if (this.roundAdvanceTimer) clearTimeout(this.roundAdvanceTimer);
        this.roundAdvanceTimer = setTimeout(() => this.beginRound(), ROUND_ADVANCE_DELAY_MS);
      } else if (ev.type === 'gameOver') {
        this.emit(null, {
          type: 'game.over',
          seq: this.nextSeq(),
          roomCode: this.code,
          losingTeam: ev.losingTeam,
          bustSeat: ev.bustSeat,
          totals: ev.totals,
        });
        this.sendAllSnapshots();
        this.sendPublicSnapshot();
        this.rematchVotes.clear();
        this.broadcastRematchVotes();
      }
    }
    if (this.match && this.match.phase === 'playing') {
      this.beginTurn();
    }
  }

  // ---- presence / reconnection ----

  resync(seat: Seat): void {
    if (this.match) this.sendSnapshot(seat);
    else this.broadcastRoomState();
  }

  /**
   * Only ever called for a seat server.ts's 'auth' handler has confirmed is
   * still this connection's own (token matches, not flipped to bot) - a
   * network-blip reconnect, not a comeback from being AFK-flipped or taken
   * over. Reclaiming either of those now goes through sit() like anyone else
   * on the sidelines (SPEC.md 11), so there is no isBot un-flip here.
   */
  bindSocket(seat: Seat, socketId: string): void {
    const slot = this.seats[seat];
    slot.socketId = socketId;
    slot.connected = true;
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

  destroy(): void {
    this.clearPassTimer();
    this.clearPlayTimer();
    if (this.roundAdvanceTimer) clearTimeout(this.roundAdvanceTimer);
    for (const t of this.disconnectTimers.values()) clearTimeout(t);
  }
}
