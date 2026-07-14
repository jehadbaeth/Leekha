import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db, type MatchRecord } from '../src/db.js';

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'leekha-db-test-'));
  db = openDb(join(dir, 'test.db'));
});

afterEach(() => {
  db.raw.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('openDb', () => {
  it('creates schema idempotently on repeated opens', () => {
    db.raw.close();
    db = openDb(join(dir, 'test.db'));
    db = openDb(join(dir, 'test.db'));
  });

  it('round trips a user through createUser/getUserByEmail/getUserById', () => {
    db.createUser({
      id: 'u1',
      email: 'alice@example.com',
      password_hash: 'hash',
      display_name: 'Alice',
    });

    expect(db.getUserByEmail('alice@example.com')?.id).toBe('u1');
    expect(db.getUserById('u1')?.display_name).toBe('Alice');
    expect(db.getUserByEmail('missing@example.com')).toBeUndefined();
  });

  it('enforces unique email', () => {
    db.createUser({ id: 'u1', email: 'a@example.com', password_hash: 'h', display_name: 'A' });
    expect(() =>
      db.createUser({ id: 'u2', email: 'a@example.com', password_hash: 'h2', display_name: 'B' }),
    ).toThrow();
  });

  it('round trips a session through createSession/getSession/deleteSession', () => {
    db.createUser({ id: 'u1', email: 'a@example.com', password_hash: 'h', display_name: 'A' });
    db.createSession({ token: 'tok1', user_id: 'u1', created_at: 1000, expires_at: 2000 });

    expect(db.getSession('tok1')?.user_id).toBe('u1');
    db.deleteSession('tok1');
    expect(db.getSession('tok1')).toBeUndefined();
  });

  it('records a match with mixed registered/guest/bot players and reads it back', () => {
    db.createUser({ id: 'u1', email: 'a@example.com', password_hash: 'h', display_name: 'A' });

    const record: MatchRecord = {
      id: 'm1',
      roomCode: 'ABCD',
      config: { targetScore: 201 },
      seed: 'seed-123',
      moveLog: [{ type: 'play', seat: 0, card: 'AS' }],
      finalScores: [10, 20, 30, 40],
      result: { losingTeam: 0 },
      startedAt: 1000,
      endedAt: 2000,
      players: [
        { seat: 0, userId: 'u1', displayName: 'A', wasBot: false },
        { seat: 1, userId: null, displayName: 'Guest', wasBot: false },
        { seat: 2, userId: null, displayName: 'Bot 1', wasBot: true },
        { seat: 3, userId: null, displayName: 'Bot 2', wasBot: true },
      ],
    };

    db.recordMatch(record);

    const fetched = db.getMatch('m1');
    expect(fetched).toBeDefined();
    expect(fetched?.match.seed).toBe('seed-123');
    expect(JSON.parse(fetched!.match.move_log)).toEqual(record.moveLog);
    expect(JSON.parse(fetched!.match.final_scores)).toEqual(record.finalScores);
    expect(fetched?.players).toHaveLength(4);
    expect(fetched?.players.find((p) => p.seat === 0)?.user_id).toBe('u1');
    expect(fetched?.players.find((p) => p.seat === 2)?.was_bot).toBe(1);

    const history = db.listMatchesForUser('u1');
    expect(history).toHaveLength(1);
    expect(history[0].matchId).toBe('m1');
  });

  it('records a fully guest match with no user_id at all', () => {
    const record: MatchRecord = {
      id: 'm2',
      roomCode: 'WXYZ',
      config: {},
      seed: 'seed-456',
      moveLog: [],
      finalScores: [0, 0, 0, 0],
      result: null,
      startedAt: 1,
      endedAt: 2,
      players: [
        { seat: 0, userId: null, displayName: 'Guest 1', wasBot: false },
        { seat: 1, userId: null, displayName: 'Guest 2', wasBot: false },
        { seat: 2, userId: null, displayName: 'Guest 3', wasBot: false },
        { seat: 3, userId: null, displayName: 'Guest 4', wasBot: false },
      ],
    };

    expect(() => db.recordMatch(record)).not.toThrow();
    expect(db.getMatch('m2')?.players.every((p) => p.user_id === null)).toBe(true);
  });
});
