import type { Seat } from '@leekha/engine';

export type BotLevel = 'easy' | 'medium' | 'hard';

export interface SeatSlot {
  seat: Seat;
  token: string | null;
  name: string | null;
  isBot: boolean;
  botLevel: BotLevel | null;
  ready: boolean;
  connected: boolean;
  socketId: string | null;
  afkStrikes: number;
}

export type RoomPhase = 'lobby' | 'game';
