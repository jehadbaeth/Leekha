import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
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
  /** Which game this match was. Absent means 'leekha' (keeps pre-Trix records/fixtures valid). Lets the admin panel / history split by game. */
  gameType?: 'leekha' | 'trix';
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
      game_type TEXT NOT NULL DEFAULT 'leekha',
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

    -- Telemetry: one row per site visit (Phase 2). Keyed by a stable per-browser
    -- visitor_id so a reconnect within the grace window extends the same visit
    -- rather than starting a new one (mobile app-switch would otherwise fragment
    -- and inflate the count). duration = last_seen - started_at.
    CREATE TABLE IF NOT EXISTS telemetry_sessions (
      id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      name TEXT,
      country TEXT,
      started_at INTEGER NOT NULL,
      last_seen INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tsessions_visitor ON telemetry_sessions(visitor_id, last_seen);
    CREATE INDEX IF NOT EXISTS idx_tsessions_started ON telemetry_sessions(started_at);

    -- Telemetry: captured errors (Phase 3), server-side and browser-side.
    -- Fields are length-capped at insert; the table is pruned by age and row
    -- count so a flood (e.g. a buggy client) can't fill the shared box's disk.
    CREATE TABLE IF NOT EXISTS telemetry_errors (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      stack TEXT,
      url TEXT,
      user_agent TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_terrors_created ON telemetry_errors(created_at);
  `);

  // Migration: pre-Trix databases have a `matches` table with no game_type column.
  // ADD COLUMN with a default backfills existing rows as 'leekha' (they all are).
  const hasGameType = (db.prepare(`PRAGMA table_info(matches)`).all() as { name: string }[]).some(
    (c) => c.name === 'game_type',
  );
  if (!hasGameType) db.exec(`ALTER TABLE matches ADD COLUMN game_type TEXT NOT NULL DEFAULT 'leekha'`);

  const insertMatch = db.prepare(
    `INSERT INTO matches (id, room_code, game_type, config, seed, move_log, final_scores, result, started_at, ended_at)
     VALUES (@id, @roomCode, @gameType, @config, @seed, @moveLog, @finalScores, @result, @startedAt, @endedAt)`,
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
          gameType: r.gameType ?? 'leekha',
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

    // --- Admin/telemetry read-only aggregates over existing match data (Phase 1) ---

    countMatches(): number {
      return (db.prepare(`SELECT COUNT(*) AS n FROM matches`).get() as { n: number }).n;
    },

    /** All matches newest-first, with seat display names folded in, for the admin match list. */
    listAllMatches(limit = 100, offset = 0): {
      id: string;
      roomCode: string;
      endedAt: number;
      startedAt: number;
      finalScores: string;
      result: string;
      players: string;
    }[] {
      const rows = db
        .prepare(
          `SELECT id, room_code AS roomCode, ended_at AS endedAt, started_at AS startedAt,
                  final_scores AS finalScores, result AS result
           FROM matches ORDER BY ended_at DESC LIMIT ? OFFSET ?`,
        )
        .all(limit, offset) as {
        id: string;
        roomCode: string;
        endedAt: number;
        startedAt: number;
        finalScores: string;
        result: string;
      }[];
      const playerStmt = db.prepare(
        `SELECT seat, display_name AS displayName, was_bot AS wasBot FROM match_players WHERE match_id = ? ORDER BY seat`,
      );
      return rows.map((r) => ({ ...r, players: JSON.stringify(playerStmt.all(r.id)) }));
    },

    /** Match counts bucketed by local calendar day (SQLite date()), for the games-over-time view. */
    matchesPerDay(sinceMs: number): { day: string; count: number }[] {
      return db
        .prepare(
          `SELECT date(ended_at / 1000, 'unixepoch') AS day, COUNT(*) AS count
           FROM matches WHERE ended_at >= ? GROUP BY day ORDER BY day`,
        )
        .all(sinceMs) as { day: string; count: number }[];
    },

    /**
     * Match stats over a caller-chosen window [sinceMs, now], for the admin
     * overview's configurable time-range selector. `sinceMs = 0` means all time.
     * uniquePlayers counts distinct non-bot display names that appear in those
     * matches -- the "who played" headcount for the window.
     */
    matchStatsSince(sinceMs: number): {
      count: number;
      avgDurationMs: number | null;
      busts: number;
      uniquePlayers: number;
    } {
      const count = (
        db.prepare(`SELECT COUNT(*) AS n FROM matches WHERE ended_at >= ?`).get(sinceMs) as { n: number }
      ).n;
      const avg = db
        .prepare(`SELECT AVG(ended_at - started_at) AS avg FROM matches WHERE ended_at >= ? AND ended_at > started_at`)
        .get(sinceMs) as { avg: number | null };
      // A "bust" match is one whose result recorded a losing team (game reached
      // the target), vs. one that just ended -- cheap LIKE avoids parsing every
      // result blob just for a headline count.
      const busts = (
        db
          .prepare(`SELECT COUNT(*) AS n FROM matches WHERE ended_at >= ? AND result LIKE '%losingTeam%'`)
          .get(sinceMs) as { n: number }
      ).n;
      const uniquePlayers = (
        db
          .prepare(
            `SELECT COUNT(DISTINCT mp.display_name) AS n
             FROM match_players mp JOIN matches m ON m.id = mp.match_id
             WHERE m.ended_at >= ? AND mp.was_bot = 0`,
          )
          .get(sinceMs) as { n: number }
      ).n;
      return { count, avgDurationMs: avg.avg, busts, uniquePlayers };
    },

    // --- Telemetry sessions (Phase 2) ---

    /**
     * Records activity for a visit. If the visitor's most recent session was
     * seen within graceMs, that session is extended (a reconnect, not a new
     * visit); otherwise a fresh session row is opened. Name/country refresh to
     * the latest non-null values seen.
     */
    recordSessionPing(visitorId: string, name: string | null, country: string | null, now: number, graceMs: number): void {
      const latest = db
        .prepare(`SELECT id, last_seen FROM telemetry_sessions WHERE visitor_id = ? ORDER BY last_seen DESC LIMIT 1`)
        .get(visitorId) as { id: string; last_seen: number } | undefined;
      if (latest && latest.last_seen >= now - graceMs) {
        db.prepare(
          `UPDATE telemetry_sessions SET last_seen = ?, name = COALESCE(?, name), country = COALESCE(?, country) WHERE id = ?`,
        ).run(now, name, country, latest.id);
      } else {
        db.prepare(
          `INSERT INTO telemetry_sessions (id, visitor_id, name, country, started_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(randomUUID(), visitorId, name, country, now, now);
      }
    },

    /** Bumps the visitor's latest session last_seen to now (on disconnect), so its duration reflects the full visit. */
    endSession(visitorId: string, now: number): void {
      db.prepare(
        `UPDATE telemetry_sessions SET last_seen = ?
         WHERE id = (SELECT id FROM telemetry_sessions WHERE visitor_id = ? ORDER BY last_seen DESC LIMIT 1)
           AND last_seen < ?`,
      ).run(now, visitorId, now);
    },

    /** Session counts + average duration bucketed by day or hour, for the usage chart. */
    sessionBuckets(sinceMs: number, bucket: 'day' | 'hour'): { bucket: string; sessions: number; avgDurationMs: number }[] {
      const fmt =
        bucket === 'hour'
          ? `strftime('%Y-%m-%d %H:00', started_at / 1000, 'unixepoch', 'localtime')`
          : `date(started_at / 1000, 'unixepoch', 'localtime')`;
      return db
        .prepare(
          `SELECT ${fmt} AS bucket, COUNT(*) AS sessions, AVG(last_seen - started_at) AS avgDurationMs
           FROM telemetry_sessions WHERE started_at >= ? GROUP BY bucket ORDER BY bucket`,
        )
        .all(sinceMs) as { bucket: string; sessions: number; avgDurationMs: number }[];
    },

    sessionsByCountry(sinceMs: number): { country: string | null; sessions: number }[] {
      return db
        .prepare(
          `SELECT country, COUNT(*) AS sessions FROM telemetry_sessions
           WHERE started_at >= ? GROUP BY country ORDER BY sessions DESC`,
        )
        .all(sinceMs) as { country: string | null; sessions: number }[];
    },

    /** Recent visits (who, from where, when, how long) -- the "who played and for how long" list. */
    recentSessions(sinceMs: number, limit = 100): { name: string | null; country: string | null; startedAt: number; durationMs: number }[] {
      return db
        .prepare(
          `SELECT name, country, started_at AS startedAt, (last_seen - started_at) AS durationMs
           FROM telemetry_sessions WHERE started_at >= ? ORDER BY started_at DESC LIMIT ?`,
        )
        .all(sinceMs, limit) as { name: string | null; country: string | null; startedAt: number; durationMs: number }[];
    },

    sessionSummary(sinceMs: number): { sessions: number; uniqueVisitors: number; avgDurationMs: number | null } {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS sessions, COUNT(DISTINCT visitor_id) AS uniqueVisitors, AVG(last_seen - started_at) AS avgDurationMs
           FROM telemetry_sessions WHERE started_at >= ?`,
        )
        .get(sinceMs) as { sessions: number; uniqueVisitors: number; avgDurationMs: number | null };
      return row;
    },

    /** Retention: drop visits older than the cutoff so this table can't grow unbounded on the shared box. */
    pruneSessions(olderThanMs: number): number {
      return db.prepare(`DELETE FROM telemetry_sessions WHERE started_at < ?`).run(olderThanMs).changes;
    },

    clearSessions(): number {
      return db.prepare(`DELETE FROM telemetry_sessions`).run().changes;
    },

    // --- Telemetry errors (Phase 3) ---

    /** Inserts a captured error, truncating each field to a safe cap so a hostile/buggy client can't bloat rows. */
    insertError(e: { source: 'server' | 'client'; message: string; stack?: string | null; url?: string | null; userAgent?: string | null; createdAt: number }): void {
      const cap = (s: string | null | undefined, n: number) => (s == null ? null : String(s).slice(0, n));
      db.prepare(
        `INSERT INTO telemetry_errors (id, source, message, stack, url, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), e.source, cap(e.message, 2000) ?? '(empty)', cap(e.stack, 8000), cap(e.url, 500), cap(e.userAgent, 300), e.createdAt);
    },

    listErrors(sinceMs: number, limit = 200): { id: string; source: string; message: string; stack: string | null; url: string | null; userAgent: string | null; createdAt: number }[] {
      return db
        .prepare(
          `SELECT id, source, message, stack, url, user_agent AS userAgent, created_at AS createdAt
           FROM telemetry_errors WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?`,
        )
        .all(sinceMs, limit) as { id: string; source: string; message: string; stack: string | null; url: string | null; userAgent: string | null; createdAt: number }[];
    },

    errorSummary(sinceMs: number): { total: number; server: number; client: number } {
      const total = (db.prepare(`SELECT COUNT(*) AS n FROM telemetry_errors WHERE created_at >= ?`).get(sinceMs) as { n: number }).n;
      const server = (db.prepare(`SELECT COUNT(*) AS n FROM telemetry_errors WHERE created_at >= ? AND source = 'server'`).get(sinceMs) as { n: number }).n;
      return { total, server, client: total - server };
    },

    /** Retention: keep only errors newer than the cutoff AND only the newest maxRows overall. */
    pruneErrors(olderThanMs: number, maxRows: number): number {
      const byAge = db.prepare(`DELETE FROM telemetry_errors WHERE created_at < ?`).run(olderThanMs).changes;
      const byCount = db.prepare(
        `DELETE FROM telemetry_errors WHERE id NOT IN (SELECT id FROM telemetry_errors ORDER BY created_at DESC LIMIT ?)`,
      ).run(maxRows).changes;
      return byAge + byCount;
    },

    clearErrors(): number {
      return db.prepare(`DELETE FROM telemetry_errors`).run().changes;
    },

    // --- Destructive clears (Phase 4). Accounts are intentionally NOT clearable here. ---

    clearMatches(): number {
      const tx = db.transaction(() => {
        db.prepare(`DELETE FROM match_players`).run();
        return db.prepare(`DELETE FROM matches`).run().changes;
      });
      return tx();
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
