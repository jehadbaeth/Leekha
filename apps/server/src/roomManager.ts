import type { Server } from 'socket.io';
import { defaultConfig } from '@leekha/engine';
import type { RulesConfig } from '@leekha/engine';
import type { ServerMessage } from '@leekha/protocol';
import { Room, type Emit } from './room.js';

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

  constructor(private io: Server) {}

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

  create(config: RulesConfig = defaultConfig): Room {
    let code = randomCode();
    while (this.rooms.has(code)) code = randomCode();
    const room = new Room(code, config, () => {});
    room.setEmit(this.makeEmit(room));
    this.rooms.set(code, room);
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
