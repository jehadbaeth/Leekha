import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import type { Db } from './db.js';

const SESSION_COOKIE = 'leekha_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(data);
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/**
 * Reads a session token out of an `Authorization: Bearer <token>` header.
 *
 * Native app builds (Capacitor, see apps/mobile) cannot rely on the session
 * cookie: the webview's origin is the local bundle, so every /api/* call is
 * cross-site, and the cookie below is SameSite=Lax -- which browsers refuse
 * to attach to cross-site XHR. Those clients keep the same token in their own
 * storage and send it here instead. Web clients are unaffected and keep using
 * the cookie.
 */
function bearerToken(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1].trim() : null;
}

function setSessionCookie(res: ServerResponse, token: string, maxAgeMs: number): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  );
}

function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Fixed-window per-IP limiter for register/login, mirroring SPEC 9.3-9.4's socket-side rate limiting. */
export function createRateLimiter() {
  const hits = new Map<string, { count: number; windowStart: number }>();
  return function allow(key: string): boolean {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
      hits.set(key, { count: 1, windowStart: now });
      return true;
    }
    entry.count += 1;
    return entry.count <= RATE_LIMIT_MAX;
  };
}

export function clientKey(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = typeof forwarded === 'string' && forwarded.length > 0 ? forwarded.split(',')[0].trim() : null;
  return raw ?? req.socket.remoteAddress ?? 'unknown';
}

export interface AuthedUser {
  id: string;
  email: string;
  displayName: string;
}

/** Resolves a raw, unexpired session token to its user. */
export function resolveSessionFromToken(db: Db, token: string | null | undefined): AuthedUser | null {
  if (!token) return null;
  const session = db.getSession(token);
  if (!session || session.expires_at < Date.now()) return null;
  const user = db.getUserById(session.user_id);
  if (!user) return null;
  return { id: user.id, email: user.email, displayName: user.display_name };
}

/**
 * Resolves a session token found in a cookie header to a user. Takes the raw
 * header string (not an IncomingMessage) so the socket layer can resolve the
 * same cookie off `socket.handshake.headers.cookie`, not just plain HTTP
 * requests.
 */
export function resolveSessionFromCookieHeader(db: Db, cookieHeader: string | undefined): AuthedUser | null {
  return resolveSessionFromToken(db, parseCookieHeader(cookieHeader)[SESSION_COOKIE]);
}

/**
 * Resolves the caller from either transport: the cookie (web) or an
 * Authorization: Bearer header (native app builds). Checked in that order so
 * a browser session always wins on a shared machine.
 */
function resolveSession(db: Db, req: IncomingMessage): AuthedUser | null {
  return (
    resolveSessionFromCookieHeader(db, req.headers.cookie) ??
    resolveSessionFromToken(db, bearerToken(req.headers.authorization))
  );
}

/**
 * Small JSON API router for optional accounts, mounted ahead of the static
 * SPA fallback in server.ts. Returns true if the request was handled.
 */
export function createAuthHandler(db: Db) {
  const limiter = createRateLimiter();

  return async function handleAuthRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://internal');
    const method = req.method ?? 'GET';

    if (method === 'POST' && url.pathname === '/api/register') {
      if (!limiter(clientKey(req))) {
        json(res, 429, { error: 'rate-limited' });
        return true;
      }
      const body = await readJsonBody(req);
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 24) : '';
      if (!EMAIL_RE.test(email) || password.length < 8 || !displayName) {
        json(res, 400, { error: 'invalid-input' });
        return true;
      }
      if (db.getUserByEmail(email)) {
        json(res, 409, { error: 'email-taken' });
        return true;
      }
      const id = randomUUID();
      const passwordHash = await argon2.hash(password);
      db.createUser({ id, email, password_hash: passwordHash, display_name: displayName });
      const token = nanoid(32);
      const now = Date.now();
      db.createSession({ token, user_id: id, created_at: now, expires_at: now + SESSION_TTL_MS });
      setSessionCookie(res, token, SESSION_TTL_MS);
      // `token` is returned for native clients that cannot use the cookie
      // (see bearerToken above); web clients simply ignore it.
      json(res, 200, { user: { id, email, displayName }, token });
      return true;
    }

    if (method === 'POST' && url.pathname === '/api/login') {
      if (!limiter(clientKey(req))) {
        json(res, 429, { error: 'rate-limited' });
        return true;
      }
      const body = await readJsonBody(req);
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const user = email ? db.getUserByEmail(email) : undefined;
      const valid = user ? await argon2.verify(user.password_hash, password).catch(() => false) : false;
      if (!user || !valid) {
        json(res, 401, { error: 'invalid-credentials' });
        return true;
      }
      const token = nanoid(32);
      const now = Date.now();
      db.createSession({ token, user_id: user.id, created_at: now, expires_at: now + SESSION_TTL_MS });
      setSessionCookie(res, token, SESSION_TTL_MS);
      json(res, 200, { user: { id: user.id, email: user.email, displayName: user.display_name }, token });
      return true;
    }

    if (method === 'POST' && url.pathname === '/api/logout') {
      const token =
        parseCookieHeader(req.headers.cookie)[SESSION_COOKIE] ?? bearerToken(req.headers.authorization);
      if (token) db.deleteSession(token);
      clearSessionCookie(res);
      json(res, 200, { ok: true });
      return true;
    }

    if (method === 'GET' && url.pathname === '/api/me') {
      const user = resolveSession(db, req);
      if (!user) {
        json(res, 401, { error: 'not-authenticated' });
        return true;
      }
      json(res, 200, { user });
      return true;
    }

    if (method === 'GET' && url.pathname === '/api/history') {
      const user = resolveSession(db, req);
      if (!user) {
        json(res, 401, { error: 'not-authenticated' });
        return true;
      }
      const matches = db.listMatchesForUser(user.id).map((m) => ({
        matchId: m.matchId,
        endedAt: m.endedAt,
        finalScores: JSON.parse(m.finalScores),
        result: JSON.parse(m.result),
      }));
      json(res, 200, { matches });
      return true;
    }

    const historyMatch = /^\/api\/history\/([^/]+)$/.exec(url.pathname);
    if (method === 'GET' && historyMatch) {
      const user = resolveSession(db, req);
      if (!user) {
        json(res, 401, { error: 'not-authenticated' });
        return true;
      }
      const matchId = decodeURIComponent(historyMatch[1]);
      const record = db.getMatch(matchId);
      if (!record || !record.players.some((p) => p.user_id === user.id)) {
        json(res, 404, { error: 'not-found' });
        return true;
      }
      json(res, 200, {
        match: {
          id: record.match.id,
          roomCode: record.match.room_code,
          config: JSON.parse(record.match.config),
          seed: record.match.seed,
          moveLog: JSON.parse(record.match.move_log),
          finalScores: JSON.parse(record.match.final_scores),
          result: JSON.parse(record.match.result),
          startedAt: record.match.started_at,
          endedAt: record.match.ended_at,
        },
        players: record.players.map((p) => ({
          seat: p.seat,
          userId: p.user_id,
          displayName: p.display_name,
          wasBot: p.was_bot === 1,
        })),
      });
      return true;
    }

    return false;
  };
}
