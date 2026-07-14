import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.js';

describe('apps/server auth REST endpoints', () => {
  let app: ReturnType<typeof createApp>;
  let base: string;

  beforeEach(async () => {
    app = createApp();
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
    base = `http://127.0.0.1:${(app.httpServer.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    app.io.close();
    app.httpServer.close();
    app.db.raw.close();
  });

  function cookieFrom(res: Response): string {
    const raw = res.headers.get('set-cookie') ?? '';
    return raw.split(';')[0];
  }

  it('rejects /api/me with no session', async () => {
    const res = await fetch(`${base}/api/me`);
    expect(res.status).toBe(401);
  });

  it('registers, sets a session cookie, and resolves /api/me', async () => {
    const res = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'Alice@Example.com', password: 'hunter22', displayName: 'Alice' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe('alice@example.com');
    const cookie = cookieFrom(res);
    expect(cookie).toMatch(/^leekha_session=/);

    const me = await fetch(`${base}/api/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    const meBody = await me.json();
    expect(meBody.user.displayName).toBe('Alice');
  });

  it('rejects duplicate email registration', async () => {
    const payload = { email: 'bob@example.com', password: 'hunter22', displayName: 'Bob' };
    const first = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(409);
  });

  it('rejects invalid input on register (short password)', async () => {
    const res = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.com', password: 'short', displayName: 'X' }),
    });
    expect(res.status).toBe(400);
  });

  it('logs in with correct credentials and rejects wrong password', async () => {
    await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'cara@example.com', password: 'correcthorse', displayName: 'Cara' }),
    });

    const bad = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'cara@example.com', password: 'wrongpass' }),
    });
    expect(bad.status).toBe(401);

    const good = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'cara@example.com', password: 'correcthorse' }),
    });
    expect(good.status).toBe(200);
    expect(cookieFrom(good)).toMatch(/^leekha_session=/);
  });

  it('logs out and invalidates the session', async () => {
    const reg = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'dan@example.com', password: 'hunter22', displayName: 'Dan' }),
    });
    const cookie = cookieFrom(reg);

    const logout = await fetch(`${base}/api/logout`, { method: 'POST', headers: { cookie } });
    expect(logout.status).toBe(200);

    const me = await fetch(`${base}/api/me`, { headers: { cookie } });
    expect(me.status).toBe(401);
  });

  it('records and lists match history for a registered user, scoped to that user', async () => {
    const reg = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'eve@example.com', password: 'hunter22', displayName: 'Eve' }),
    });
    const cookie = cookieFrom(reg);
    const { user } = await reg.json();

    app.db.recordMatch({
      id: 'match-1',
      roomCode: 'ABCD',
      config: { targetScore: 201 },
      seed: 'seed-xyz',
      moveLog: [{ type: 'play', seat: 0, card: 'AS' }],
      finalScores: [201, 50, 60, 70],
      result: { losingTeam: 0 },
      startedAt: 1,
      endedAt: 2,
      players: [
        { seat: 0, userId: user.id, displayName: 'Eve', wasBot: false },
        { seat: 1, userId: null, displayName: 'Bot 1', wasBot: true },
        { seat: 2, userId: null, displayName: 'Bot 2', wasBot: true },
        { seat: 3, userId: null, displayName: 'Bot 3', wasBot: true },
      ],
    });

    const history = await fetch(`${base}/api/history`, { headers: { cookie } });
    expect(history.status).toBe(200);
    const historyBody = await history.json();
    expect(historyBody.matches).toHaveLength(1);
    expect(historyBody.matches[0].matchId).toBe('match-1');

    const detail = await fetch(`${base}/api/history/match-1`, { headers: { cookie } });
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.match.seed).toBe('seed-xyz');
    expect(detailBody.players).toHaveLength(4);

    const noAuth = await fetch(`${base}/api/history/match-1`);
    expect(noAuth.status).toBe(401);
  });

  it('404s an unknown /api route', async () => {
    const res = await fetch(`${base}/api/nonsense`);
    expect(res.status).toBe(404);
  });
});
