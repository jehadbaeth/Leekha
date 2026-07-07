import type { Server } from 'socket.io';
import { defaultConfig } from '@leekha/engine';
import type { RulesConfig, Seat } from '@leekha/engine';
import type { ServerMessage } from '@leekha/protocol';
import { Room, type Emit } from './room.js';
import type { Persistence } from './persistence.js';

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
  ) {}

  private makeEmit(room: Room): Emit {
    return (seat, msg) => {
      if (seat === null) {
        this.io.to(`room:${room.code}`).emit('msg', msg);
        return;
      }
      const socketId = room.seats[seat].socketId;
      if (socketId) this.io.to(socketId).emit('msg', msg);
    };
  }

  private register(room: Room): void {
    room.setEmit(this.makeEmit(room));
    room.setOnChange(() => this.persist(room.code));
    this.rooms.set(room.code, room);
  }

  private persist(code: string): void {
    const room = this.rooms.get(code);
    if (room) this.persistence?.save(code, room.serialize());
  }

  create(config: RulesConfig = defaultConfig): Room {
    let code = randomCode();
    while (this.rooms.has(code)) code = randomCode();
    const room = new Room(code, config, () => {});
    this.register(room);
    this.persist(code);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
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

export type { Room, Emit, ServerMessage };
