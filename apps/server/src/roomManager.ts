import type { Server } from 'socket.io';
import { defaultConfig } from '@leekha/engine';
import type { RulesConfig, Seat } from '@leekha/engine';
import type { ServerMessage, PublicRoom } from '@leekha/protocol';
import { Room, type Emit, type EmitTarget } from './room.js';
import type { Persistence } from './persistence.js';
import type { Db } from './db.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

const LOBBY_IDLE_MS = 15 * 60 * 1000;
const GAME_OVER_IDLE_MS = 5 * 60 * 1000;

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(
    private io: Server,
    private persistence: Persistence | null = null,
    private db: Db | null = null,
  ) {}

  private makeEmit(room: Room): Emit {
    return (target: EmitTarget, msg) => {
      if (target === null) {
        this.io.to(`room:${room.code}`).emit('msg', msg);
        return;
      }
      if (target === 'observers') {
        // A seat AFK-flipped to bot control keeps its original occupant's stale
        // socketId (see room.ts's flipToBot) - excluding it here would silently
        // cut that connection off from every public snapshot, since it's really
        // an observer now regardless of what socketId is still on file.
        const seatedSocketIds = room.seats
          .filter((s) => !s.isBot)
          .map((s) => s.socketId)
          .filter((id): id is string => id !== null);
        this.io.to(`room:${room.code}`).except(seatedSocketIds).emit('msg', msg);
        return;
      }
      const slot = room.seats[target];
      // A bot-controlled seat's socketId is stale, not a live occupant - see the
      // comment above. Delivering a seat-scoped message (game.snapshot, game.dealt,
      // game.turn's legal cards, game.passReveal) there would hand a private,
      // seated view straight back to whoever used to sit there, including their
      // own resurrected mySeat on the client and the bot's actual hand.
      if (slot.socketId && !slot.isBot) this.io.to(slot.socketId).emit('msg', msg);
    };
  }

  private register(room: Room): void {
    room.setEmit(this.makeEmit(room));
    room.setOnChange(() => this.persist(room.code));
    room.setOnMatchEnd((record) => this.db?.recordMatch(record));
    this.rooms.set(room.code, room);
  }

  private persist(code: string): void {
    const room = this.rooms.get(code);
    if (room) this.persistence?.save(code, room.serialize());
  }

  create(config: RulesConfig = defaultConfig, isPublic = false): Room {
    let code = randomCode();
    while (this.rooms.has(code)) code = randomCode();
    const room = new Room(code, config, () => {}, isPublic);
    this.register(room);
    this.persist(code);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  /** Rooms fit for the home screen's public list: still in the lobby, marked public, and joinable by a new human (empty seat OR a bot seat, since bot seats are freely claimable — see claimableSeats in App.tsx). A room with every seat taken by real players can only be reached as an observer, which the list doesn't offer. */
  listPublic(): PublicRoom[] {
    return [...this.rooms.values()]
      .filter((room) => room.isPublic && room.phase === 'lobby' && room.seats.some((s) => s.name === null || s.isBot))
      .sort((a, b) => b.lastActivity - a.lastActivity)
      .slice(0, 50)
      .map((room) => room.publicSummary());
  }

  destroy(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room.destroy();
    this.rooms.delete(code);
    this.persistence?.remove(code);
  }

  /**
   * Restores rooms saved to Redis by a previous process (SPEC.md 9.5). Returns
   * the seat tokens found in those rooms so the caller can reseed its
   * socket-reconnect index — tokens live on the room's own seats, so nothing
   * else needs separate persistence.
   */
  async restore(): Promise<{ token: string; roomCode: string; seat: Seat }[]> {
    if (!this.persistence) return [];
    const snapshots = await this.persistence.loadAll();
    const tokens: { token: string; roomCode: string; seat: Seat }[] = [];
    for (const snapshot of snapshots) {
      const room = Room.fromSnapshot(snapshot, () => {});
      this.register(room);
      for (const slot of room.seats) {
        if (slot.token) tokens.push({ token: slot.token, roomCode: room.code, seat: slot.seat });
      }
    }
    return tokens;
  }

  sweep(): void {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.humanCount() === 0) {
        this.destroy(code);
        continue;
      }
      if (room.phase === 'lobby' && now - room.lastActivity > LOBBY_IDLE_MS) {
        this.destroy(code);
        continue;
      }
      if (room.match?.phase === 'gameOver' && now - room.lastActivity > GAME_OVER_IDLE_MS) {
        this.destroy(code);
      }
    }
  }
}

export type { Room, Emit, EmitTarget, ServerMessage };
