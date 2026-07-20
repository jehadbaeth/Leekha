import { nanoid } from 'nanoid';
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
} from '@leekha/trix';
import { makeTrixBot } from '@leekha/trix-bots';
import type { ServerMessage, PublicRoom } from '@leekha/protocol';
import { RoomBase, type LiveSnapshot } from './roomBase.js';
import type { RoomSnapshot } from './persistence.js';

const SEATS: Seat[] = [0, 1, 2, 3];
const BOT_MIN_DELAY_MS = 600;
const BOT_MAX_DELAY_MS = 1800;

// Both delays are cosmetic pacing (bot "thinking" and the deal-recap pause). An
// env override collapses them to a fixed value so the e2e test can drive a full
// match in a second or two; production leaves them unset for human-feeling play.
function botThinkDelay(): number {
  const override = process.env.TRIX_BOT_DELAY_MS;
  if (override !== undefined) return Number(override);
  return BOT_MIN_DELAY_MS + Math.random() * (BOT_MAX_DELAY_MS - BOT_MIN_DELAY_MS);
}

function dealAdvanceDelay(): number {
  const override = process.env.TRIX_DEAL_ADVANCE_MS;
  return override !== undefined ? Number(override) : 4000;
}

// One shared heuristic bot instance drives every bot seat, exactly as the local
// useTrixGame does. Trix has a single tier today (SPEC 13's easy/medium/hard/
// oracle ladder is a separate, large effort), so a seat's chosen BotLevel is
// cosmetic online for now — every level maps to this one policy.
const bot = makeTrixBot();

/**
 * The Trix room: Trix's phase machine (selecting -> exposing -> trick/layout ->
 * deal end -> next deal/kingdom -> done) wired onto the shared RoomBase seat/
 * connection/AFK machinery. Snapshot-driven, like the local client: after every
 * action a fresh TrixSeatView is pushed to each seat, so the online client
 * reuses the exact same TrixGame rendering as local play.
 */
export class TrixRoom extends RoomBase<TrixRulesConfig> {
  match: TrixMatchState | null = null;
  private decisionTimer: ReturnType<typeof setTimeout> | null = null;
  private advanceTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- RoomBase seam ----

  serialize(): RoomSnapshot | null {
    // Trix rooms are not Redis-persisted in v1 (a server restart drops in-flight
    // Trix games; Leekha is unaffected). The RoomSnapshot shape is Leekha-typed.
    return null;
  }

  isMatchOver(): boolean {
    return !!this.match && this.match.phase === 'done';
  }

  liveSnapshot(): LiveSnapshot | null {
    if (this.phase !== 'game' || !this.match) return null;
    return { phase: this.match.phase, roundIndex: this.match.kingdomIndex, scores: this.match.scores };
  }

  publicSummary(): PublicRoom {
    return {
      code: this.code,
      hostName: this.seats[this.hostSeat].name ?? 'Host',
      seatsFilled: this.seats.filter((s) => s.name !== null || s.isBot).length,
      targetScore: 0, // not applicable to Trix; the list is Leekha-centric
    };
  }

  roomStateMessage(): Extract<ServerMessage, { type: 'room.state' }> {
    return {
      type: 'room.state',
      seq: this.nextSeq(),
      roomCode: this.code,
      seats: this.seatSlotSchema(),
      gameType: 'trix',
      trixConfig: this.config,
      hostSeat: this.hostSeat,
      phase: this.phase,
      allowSpectatorVoice: this.allowSpectatorVoice,
    };
  }

  publicSnapshotMessage(): ServerMessage | null {
    if (!this.match) return null;
    const view = viewFor(this.match, 0);
    return {
      type: 'trix.publicSnapshot',
      seq: this.nextSeq(),
      roomCode: this.code,
      view: { ...view, hand: [], legal: null, exposable: [] },
    };
  }

  protected resumeBotsAfterFlip(): void {
    this.scheduleBotIfDue();
  }

  protected clearGameTimers(): void {
    this.clearDecisionTimer();
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
  }

  resync(seat: Seat): void {
    if (this.match) this.sendSnapshot(seat);
    else this.broadcastRoomState();
  }

  // ---- match lifecycle ----

  start(): void {
    this.touch();
    this.rematchVotes.clear();
    if (this.phase === 'lobby') {
      if (!this.canStart()) throw new IllegalTrixAction('not-ready', 'All four seats must be filled and humans ready');
      this.match = newMatch(this.config, nanoid(16));
      this.matchStartedAt = Date.now();
      this.phase = 'game';
      this.syncAndSchedule();
      return;
    }
    if (this.match && this.match.phase === 'done') {
      this.match = newMatch(this.config, nanoid(16));
      this.matchStartedAt = Date.now();
      this.syncAndSchedule();
      return;
    }
    throw new IllegalTrixAction('bad-phase', 'A match is already in progress');
  }

  // ---- snapshots ----

  private sendSnapshot(seat: Seat): void {
    if (!this.match) return;
    this.emit(seat, {
      type: 'trix.snapshot',
      seq: this.nextSeq(),
      roomCode: this.code,
      view: viewFor(this.match, seat),
    });
  }

  private sendAllSnapshots(): void {
    if (!this.match) return;
    for (const seat of SEATS) this.sendSnapshot(seat);
    const pub = this.publicSnapshotMessage();
    if (pub) this.emit('observers', pub);
  }

  private sendTurn(): void {
    if (!this.match) return;
    const seat = actingSeat(this.match);
    const timerMs = this.timerMsForPhase();
    this.emit(null, {
      type: 'trix.turn',
      seq: this.nextSeq(),
      roomCode: this.code,
      seat: seat,
      deadline: seat !== null && timerMs > 0 ? Date.now() + timerMs : null,
    });
  }

  // ---- timers ----

  private timerMsForPhase(): number {
    if (!this.match) return 0;
    return this.match.phase === 'selecting' ? this.config.timers.selectMs : this.config.timers.playMs;
  }

  private clearDecisionTimer(): void {
    if (this.decisionTimer) clearTimeout(this.decisionTimer);
    this.decisionTimer = null;
  }

  private armDecisionTimer(): void {
    this.clearDecisionTimer();
    const ms = this.timerMsForPhase();
    if (ms <= 0) return;
    this.decisionTimer = setTimeout(() => this.onDecisionTimeout(), ms);
  }

  private onDecisionTimeout(): void {
    if (!this.match) return;
    const seat = actingSeat(this.match);
    if (seat === null) return;
    const slot = this.seats[seat];
    if (slot.isBot) return;
    slot.afkStrikes++;
    this.autoPlayOneAction(seat);
    if (slot.afkStrikes >= 2) this.flipToBot(seat);
  }

  // ---- driving the engine ----

  /**
   * The one bot/auto action for a seat, phase-appropriate, mirroring the local
   * useTrixGame.botAct: choose a contract, expose-or-decline, or play/pass.
   * Returns the applied result, or null if there is nothing legal to do.
   */
  private oneAction(seat: Seat): { state: TrixMatchState; events: TrixEvent[] } | null {
    const m = this.match!;
    const view = viewFor(m, seat);
    if (m.phase === 'selecting') return chooseContract(m, seat, bot.chooseContract(view));
    if (m.phase === 'exposing') {
      const card = bot.chooseExpose(view);
      return card ? expose(m, seat, card) : pass(m, seat);
    }
    if (m.phase === 'trick' || m.phase === 'layout') {
      if (view.legal && view.legal.length > 0) return play(m, seat, bot.choosePlay(view));
      if (view.canPass) return pass(m, seat);
    }
    return null;
  }

  private autoPlayOneAction(seat: Seat): void {
    const result = this.oneAction(seat);
    if (result) this.applyResult(result);
  }

  private scheduleBotIfDue(): void {
    if (!this.match || this.match.phase === 'done') return;
    if (this.advanceTimer) return; // paused on a deal-end recap
    const seat = actingSeat(this.match);
    if (seat === null || !this.seats[seat].isBot) return;
    const atMove = this.match.moveLog.length;
    setTimeout(() => {
      if (!this.match || this.advanceTimer) return;
      if (actingSeat(this.match) !== seat || this.match.moveLog.length !== atMove) return;
      const result = this.oneAction(seat);
      if (result) this.applyResult(result);
    }, botThinkDelay());
  }

  /** Applies a fresh engine state, fans out the deal-end / match-over signals, then re-syncs and re-schedules. */
  private applyResult(result: { state: TrixMatchState; events: TrixEvent[] }): void {
    this.clearDecisionTimer();
    this.match = result.state;
    const over = result.events.find((e) => e.type === 'matchOver');
    const dealEnd = result.events.find((e) => e.type === 'dealEnd') as Extract<TrixEvent, { type: 'dealEnd' }> | undefined;

    this.sendAllSnapshots();

    // Granular per-play events so clients get the trick-completion pause, play/
    // trick sounds, and last-trick review (the snapshot alone already has the
    // trick collected). Sent after the snapshot so the client freezes the
    // just-completed trick over the fresh board.
    for (const e of result.events) {
      if (e.type === 'played' || e.type === 'layoutPlayed') {
        this.emit(null, { type: 'trix.played', seq: this.nextSeq(), roomCode: this.code, seat: e.seat, card: e.card });
      } else if (e.type === 'trickEnd') {
        this.emit(null, { type: 'trix.trickEnd', seq: this.nextSeq(), roomCode: this.code, winner: e.winner, cards: e.cards });
      }
    }

    if (over && over.type === 'matchOver') {
      this.emit(null, {
        type: 'trix.over',
        seq: this.nextSeq(),
        roomCode: this.code,
        scores: over.result.scores,
        teamScores: over.result.teamScores,
        winnerSeat: over.result.winnerSeat,
        winnerTeam: over.result.winnerTeam,
      });
      this.rematchVotes.clear();
      this.broadcastRematchVotes();
      this.recordMatchEnd();
      this.onChange?.();
      return;
    }

    if (dealEnd) {
      this.emit(null, {
        type: 'trix.dealEnd',
        seq: this.nextSeq(),
        roomCode: this.code,
        dealScores: dealEnd.dealScores,
        totals: dealEnd.totals,
      });
      // Pause on the recap, like Leekha's round-advance delay, then resume.
      if (this.advanceTimer) clearTimeout(this.advanceTimer);
      this.advanceTimer = setTimeout(() => {
        this.advanceTimer = null;
        this.syncAndSchedule();
      }, dealAdvanceDelay());
      this.onChange?.();
      return;
    }

    this.sendTurn();
    this.armDecisionTimer();
    this.scheduleBotIfDue();
    this.onChange?.();
  }

  /** Push current state to everyone, arm the decision clock, and let a bot move if it is a bot's turn. */
  private syncAndSchedule(): void {
    this.sendAllSnapshots();
    this.sendTurn();
    this.armDecisionTimer();
    this.scheduleBotIfDue();
    this.onChange?.();
  }

  // ---- human actions (server.ts routes trix.* messages here) ----

  private assertTurn(seat: Seat): TrixMatchState {
    if (!this.match) throw new IllegalTrixAction('bad-phase', 'No match in progress');
    if (this.advanceTimer) throw new IllegalTrixAction('bad-phase', 'Deal is being scored');
    if (actingSeat(this.match) !== seat) throw new IllegalTrixAction('not-your-turn', 'Not your turn');
    return this.match;
  }

  chooseContract(seat: Seat, contracts: Contract[]): void {
    this.touch();
    const m = this.assertTurn(seat);
    this.applyResult(chooseContract(m, seat, contracts));
  }

  expose(seat: Seat, card: Card): void {
    this.touch();
    const m = this.assertTurn(seat);
    this.applyResult(expose(m, seat, card));
  }

  passAction(seat: Seat): void {
    this.touch();
    const m = this.assertTurn(seat);
    this.applyResult(pass(m, seat));
  }

  playAction(seat: Seat, card: Card): void {
    this.touch();
    const m = this.assertTurn(seat);
    this.applyResult(play(m, seat, card));
  }

  // ---- recording ----

  private recordMatchEnd(): void {
    if (!this.onMatchEnd || !this.match || !this.match.result) return;
    const now = Date.now();
    this.onMatchEnd({
      id: nanoid(16),
      gameType: 'trix',
      roomCode: this.code,
      config: this.config,
      seed: this.match.seed,
      moveLog: this.match.moveLog,
      finalScores: this.match.scores,
      result: this.match.result,
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
}
