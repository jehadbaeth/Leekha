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
  /** ISO 3166-1 alpha-2 of the seated human, resolved at connection time; null for bots/unknown. Optional so pre-feature Redis snapshots still deserialize. */
  country?: string | null;
  /** Registered account id of the seated human, resolved from their session cookie; null for guests/bots. Identity tag only, never an authorization mechanism (that stays socketId-based, see server.ts mySeat()). Optional so pre-feature Redis snapshots still deserialize. */
  userId?: string | null;
}

export type RoomPhase = 'lobby' | 'game';
