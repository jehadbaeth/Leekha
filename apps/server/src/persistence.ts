import Redis from 'ioredis';
import type { MatchState, RulesConfig, Seat } from '@leekha/engine';
import type { RoomPhase, SeatSlot } from './types.js';

export interface RoomSnapshot {
  code: string;
  config: RulesConfig;
  phase: RoomPhase;
  hostSeat: Seat;
  match: MatchState | null;
  seats: SeatSlot[];
}

export interface Persistence {
  save(code: string, snapshot: RoomSnapshot): void;
  loadAll(): Promise<RoomSnapshot[]>;
  remove(code: string): void;
}

const KEY_PREFIX = 'leekha:room:';
const TTL_SECONDS = 6 * 60 * 60;

/**
 * Optional Redis-backed room persistence (SPEC.md section 9 item 5). When
 * REDIS_URL is unset this returns null and the server behaves exactly as
 * before: rooms live in memory only and a restart kills in-flight games.
 */
export function createPersistence(url: string | undefined): Persistence | null {
  if (!url) return null;
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  redis.connect().catch((err) => console.error('[redis] connection failed:', err));

  return {
    save(code, snapshot) {
      redis.set(KEY_PREFIX + code, JSON.stringify(snapshot), 'EX', TTL_SECONDS).catch((err) => {
        console.error(`[redis] failed to persist room ${code}:`, err);
      });
    },
    async loadAll() {
      const keys = await redis.keys(`${KEY_PREFIX}*`);
      if (keys.length === 0) return [];
      const values = await redis.mget(keys);
      return values.filter((v): v is string => v !== null).map((v) => JSON.parse(v) as RoomSnapshot);
    },
    remove(code) {
      redis.del(KEY_PREFIX + code).catch(() => {});
    },
  };
}
