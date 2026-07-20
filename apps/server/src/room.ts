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
import type { ServerMessage, PublicRoom } from '@leekha/protocol';
import { botForLevel, chooseOraclePlay, logHardBotBlunderIfAny } from './bot.js';
import { RoomBase, type Emit, type EmitTarget, type LiveSnapshot } from './roomBase.js';
import type { RoomSnapshot } from './persistence.js';

const SEATS: Seat[] = [0, 1, 2, 3];
const ROUND_ADVANCE_DELAY_MS = 4000;
const BOT_MIN_DELAY_MS = 600;
const BOT_MAX_DELAY_MS = 1800;

function botThinkDelay(): number {
  return BOT_MIN_DELAY_MS + Math.random() * (BOT_MAX_DELAY_MS - BOT_MIN_DELAY_MS);
}

// The Leekha room: everything below the shared seat/lobby/connection machinery
// in RoomBase is Leekha's own phase machine (passing → playing → roundEnd →
// gameOver), engine drive, snapshots, timers, bot scheduling, and match
// recording. This class is intentionally unchanged in behavior from before the
// RoomBase extraction — the 43 server e2e tests are the proof.
export class Room extends RoomBase<RulesConfig> {
  match: MatchState | null = null;
  private passTimer: ReturnType<typeof setTimeout> | null = null;
  private playTimer: ReturnType<typeof setTimeout> | null = null;
  private roundAdvanceTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- persistence ----

  /** A snapshot suitable for JSON persistence; sockets never survive a restart so connection state is dropped. */
  serialize(): RoomSnapshot {
    return {
      code: this.code,
      config: this.config,
      phase: this.phase,
      hostSeat: this.hostSeat,
      match: this.match,
      seats: this.seats.map((s) => ({ ...s, connected: false, socketId: null })),
      isPublic: this.isPublic,
    };
  }

  /** Rebuilds a Room from a Redis snapshot and re-arms whatever clock the in-flight phase needs. */
  static fromSnapshot(snapshot: RoomSnapshot, emit: Emit): Room {
    const room = new Room(snapshot.code, snapshot.config, emit, snapshot.isPublic ?? false);
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

  // ---- RoomBase seam ----

  isMatchOver(): boolean {
    return !!this.match && this.match.phase === 'gameOver';
  }

  protected resumeBotsAfterFlip(): void {
    this.scheduleBotPasses();
    this.scheduleBotPlayIfDue();
  }

  protected clearGameTimers(): void {
    this.clearPassTimer();
    this.clearPlayTimer();
    if (this.roundAdvanceTimer) clearTimeout(this.roundAdvanceTimer);
  }

  liveSnapshot(): LiveSnapshot | null {
    if (this.phase !== 'game' || !this.match) return null;
    return { phase: this.match.phase, roundIndex: this.match.roundIndex, scores: this.match.scores };
  }

  /** For the home screen's public rooms list (RoomManager.listPublic): only ever read while phase is 'lobby' and isPublic is true. */
  publicSummary(): PublicRoom {
    return {
      code: this.code,
      hostName: this.seats[this.hostSeat].name ?? 'Host',
      seatsFilled: this.seats.filter((s) => s.name !== null || s.isBot).length,
      gameType: 'leekha',
      targetScore: this.config.targetScore,
    };
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
      allowSpectatorVoice: this.allowSpectatorVoice,
      isPublic: this.isPublic,
    };
  }

  // ---- game ----

  start(): void {
    this.touch();
    this.rematchVotes.clear();
    if (this.phase === 'lobby') {
      if (!this.canStart()) throw new IllegalAction('not-ready', 'All four seats must be filled and humans ready');
      this.match = newMatch(this.config, nanoid(16));
      this.matchStartedAt = Date.now();
      this.phase = 'game';
      this.beginRound();
      return;
    }
    // Rematch: only valid once the previous match is over.
    if (this.match && this.match.phase === 'gameOver') {
      this.match = newMatch(this.config, nanoid(16));
      this.matchStartedAt = Date.now();
      this.beginRound();
      return;
    }
    throw new IllegalAction('bad-phase', 'A match is already in progress');
  }

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
      const level = this.seats[seat].botLevel ?? 'hard';
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
    const level = this.seats[seat].botLevel ?? 'hard';
    setTimeout(() => {
      if (!this.match || this.match.phase !== 'playing') return;
      if (this.actingSeat() !== seat) return;
      const view = viewFor(this.match, seat);
      const card =
        level === 'insane'
          ? chooseOraclePlay(this.match, seat, view)
          : botForLevel(level).choosePlay(view);
      if (level === 'hard') logHardBotBlunderIfAny(this.match, seat, view, card);
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
        this.recordMatchEnd(ev);
      }
    }
    if (this.match && this.match.phase === 'playing') {
      this.beginTurn();
    }
  }

  /** Writes the one durable, fully replayable record of this match (seed + config + moveLog let it be reconstructed trick by trick) plus one row per seat, tagging registered accounts and leaving guests/bots as null (SPEC.md 9.5's later-arriving accounts phase). */
  private recordMatchEnd(ev: Extract<GameEvent, { type: 'gameOver' }>): void {
    if (!this.onMatchEnd || !this.match) return;
    const now = Date.now();
    this.onMatchEnd({
      id: nanoid(16),
      gameType: 'leekha',
      roomCode: this.code,
      config: this.config,
      seed: this.match.seed,
      moveLog: this.match.moveLog,
      finalScores: ev.totals,
      result: { losingTeam: ev.losingTeam, bustSeat: ev.bustSeat },
      startedAt: this.matchStartedAt ?? now,
      endedAt: now,
      players: this.seats.map((s) => ({
        seat: s.seat,
        userId: s.userId ?? null,
        displayName: s.name ?? 'Unknown',
        wasBot: s.isBot,
      })),
    });
  }

  // ---- presence / reconnection ----

  resync(seat: Seat): void {
    if (this.match) this.sendSnapshot(seat);
    else this.broadcastRoomState();
  }
}

export type { Emit, EmitTarget } from './roomBase.js';
