import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  created_at: number;
}

export interface SessionRow {
  token: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

export interface MatchRecord {
  id: string;
  roomCode: string;
  config: unknown;
  seed: string;
  moveLog: unknown;
  finalScores: [number, number, number, number];
  result: unknown;
  startedAt: number;
  endedAt: number;
  players: { seat: 0 | 1 | 2 | 3; userId: string | null; displayName: string; wasBot: boolean }[];
}

/**
 * Opens (and idempotently migrates) the SQLite store used for optional user
 * accounts and durable match history. Everything else about the game
 * (rooms, live match state) stays in memory/Redis exactly as before; this is
 * additive, not a replacement (SPEC.md 9.5, "Postgres only arrives with
 * accounts, later" — SQLite fills that role here instead, see the accounts plan).
 */
export function openDb(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      room_code TEXT NOT NULL,
      config TEXT NOT NULL,
      seed TEXT NOT NULL,
      move_log TEXT NOT NULL,
      final_scores TEXT NOT NULL,
      result TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS match_players (
      match_id TEXT NOT NULL REFERENCES matches(id),
      seat INTEGER NOT NULL,
      user_id TEXT REFERENCES users(id),
      display_name TEXT NOT NULL,
      was_bot INTEGER NOT NULL,
      PRIMARY KEY (match_id, seat)
    );
    CREATE INDEX IF NOT EXISTS idx_match_players_user ON match_players(user_id);
  `);

  const insertMatch = db.prepare(
    `INSERT INTO matches (id, room_code, config, seed, move_log, final_scores, result, started_at, ended_at)
     VALUES (@id, @roomCode, @config, @seed, @moveLog, @finalScores, @result, @startedAt, @endedAt)`,
  );
  const insertPlayer = db.prepare(
    `INSERT INTO match_players (match_id, seat, user_id, display_name, was_bot)
     VALUES (@matchId, @seat, @userId, @displayName, @wasBot)`,
  );

  return {
    raw: db,

    recordMatch(record: MatchRecord): void {
      const tx = db.transaction((r: MatchRecord) => {
        insertMatch.run({
          id: r.id,
          roomCode: r.roomCode,
          config: JSON.stringify(r.config),
          seed: r.seed,
          moveLog: JSON.stringify(r.moveLog),
          finalScores: JSON.stringify(r.finalScores),
          result: JSON.stringify(r.result),
          startedAt: r.startedAt,
          endedAt: r.endedAt,
        });
        for (const p of r.players) {
          insertPlayer.run({
            matchId: r.id,
            seat: p.seat,
            userId: p.userId,
            displayName: p.displayName,
            wasBot: p.wasBot ? 1 : 0,
          });
        }
      });
      tx(record);
    },

    createUser(user: Omit<UserRow, 'created_at'> & { created_at?: number }): void {
      db.prepare(
        `INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)`,
      ).run(user.id, user.email, user.password_hash, user.display_name, user.created_at ?? Date.now());
    },

    getUserByEmail(email: string): UserRow | undefined {
      return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as UserRow | undefined;
    },

    getUserById(id: string): UserRow | undefined {
      return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
    },

    createSession(session: SessionRow): void {
      db.prepare(`INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).run(
        session.token,
        session.user_id,
        session.created_at,
        session.expires_at,
      );
    },

    getSession(token: string): SessionRow | undefined {
      return db.prepare(`SELECT * FROM sessions WHERE token = ?`).get(token) as SessionRow | undefined;
    },

    deleteSession(token: string): void {
      db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
    },

    listMatchesForUser(userId: string, limit = 50): { matchId: string; endedAt: number; finalScores: string; result: string }[] {
      return db
        .prepare(
          `SELECT m.id AS matchId, m.ended_at AS endedAt, m.final_scores AS finalScores, m.result AS result
           FROM matches m JOIN match_players mp ON mp.match_id = m.id
           WHERE mp.user_id = ?
           ORDER BY m.ended_at DESC LIMIT ?`,
        )
        .all(userId, limit) as { matchId: string; endedAt: number; finalScores: string; result: string }[];
    },

    getMatch(matchId: string) {
      const match = db.prepare(`SELECT * FROM matches WHERE id = ?`).get(matchId) as
        | {
            id: string;
            room_code: string;
            config: string;
            seed: string;
            move_log: string;
            final_scores: string;
            result: string;
            started_at: number;
            ended_at: number;
          }
        | undefined;
      if (!match) return undefined;
      const players = db.prepare(`SELECT * FROM match_players WHERE match_id = ? ORDER BY seat`).all(match.id) as {
        seat: number;
        user_id: string | null;
        display_name: string;
        was_bot: number;
      }[];
      return { match, players };
    },
  };
}

export type Db = ReturnType<typeof openDb>;
