import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Db } from './db.js';
import { json } from './auth.js';

/** Live, non-persisted health numbers for the admin overview. */
export interface HealthSnapshot {
  connectedSockets: number;
  activeRooms: number;
  playersInGame: number;
  uptimeSec: number;
  memoryMb: number;
}

export interface AdminDeps {
  /** The shared secret from ADMIN_TOKEN. Null/empty disables the whole admin API. */
  token: string | null;
  getHealth: () => HealthSnapshot;
}

/** Constant-time bearer-token check so the admin surface can't be timing-probed. */
function tokenMatches(configured: string, presented: string): boolean {
  const a = Buffer.from(configured);
  const b = Buffer.from(presented);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers['authorization'];
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+(.+)$/.exec(h);
  return m ? m[1] : null;
}

/**
 * Token-gated admin/telemetry API, mounted alongside the accounts router in
 * server.ts. Auth is a standalone secret (ADMIN_TOKEN), sent as
 * `Authorization: Bearer <token>` -- deliberately NOT the cookie session, so
 * open registration can never grant admin, and because a custom header is
 * immune to CSRF (a cross-site page can set cookies but not arbitrary headers),
 * which matters for the destructive clear endpoints added in a later phase.
 * Returns true if it handled the request.
 */
export function createAdminHandler(db: Db, deps: AdminDeps) {
  const enabled = !!deps.token && deps.token.length >= 16;

  return async function handleAdminRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://internal');
    if (!url.pathname.startsWith('/api/admin/')) return false;

    if (!enabled) {
      json(res, 503, { error: 'admin-disabled' });
      return true;
    }
    const presented = bearer(req);
    if (!presented || !tokenMatches(deps.token as string, presented)) {
      json(res, 401, { error: 'bad-token' });
      return true;
    }

    const method = req.method ?? 'GET';
    const now = Date.now();

    // Panel calls this to validate a freshly-entered token before storing it.
    if (method === 'GET' && url.pathname === '/api/admin/verify') {
      json(res, 200, { ok: true });
      return true;
    }

    if (method === 'GET' && url.pathname === '/api/admin/overview') {
      json(res, 200, { matches: db.matchSummary(now), health: deps.getHealth() });
      return true;
    }

    if (method === 'GET' && url.pathname === '/api/admin/matches') {
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
      const matches = db.listAllMatches(limit, offset).map((m) => ({
        id: m.id,
        roomCode: m.roomCode,
        startedAt: m.startedAt,
        endedAt: m.endedAt,
        finalScores: JSON.parse(m.finalScores),
        result: JSON.parse(m.result),
        players: JSON.parse(m.players),
      }));
      json(res, 200, { matches, total: db.countMatches() });
      return true;
    }

    if (method === 'GET' && url.pathname === '/api/admin/matches-per-day') {
      const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30));
      json(res, 200, { buckets: db.matchesPerDay(now - days * 86_400_000) });
      return true;
    }

    // Per-match move-log export: streams the full stored record as a download.
    const exportMatch = /^\/api\/admin\/matches\/([^/]+)\/export$/.exec(url.pathname);
    if (method === 'GET' && exportMatch) {
      const record = db.getMatch(decodeURIComponent(exportMatch[1]));
      if (!record) {
        json(res, 404, { error: 'not-found' });
        return true;
      }
      const payload = {
        id: record.match.id,
        roomCode: record.match.room_code,
        config: JSON.parse(record.match.config),
        seed: record.match.seed,
        moveLog: JSON.parse(record.match.move_log),
        finalScores: JSON.parse(record.match.final_scores),
        result: JSON.parse(record.match.result),
        startedAt: record.match.started_at,
        endedAt: record.match.ended_at,
        players: record.players,
      };
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="match-${record.match.id}.json"`,
      });
      res.end(JSON.stringify(payload, null, 2));
      return true;
    }

    json(res, 404, { error: 'not-found' });
    return true;
  };
}
