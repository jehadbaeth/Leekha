import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.js';

function connect(port: number, cookie?: string): ClientSocket {
  return ioClient(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    forceNew: true,
    extraHeaders: cookie ? { cookie } : undefined,
  });
}

function send(socket: ClientSocket, msg: any): Promise<any> {
  return new Promise((resolve) => socket.emit('msg', msg, resolve));
}

function fire(socket: ClientSocket, msg: any): void {
  socket.emit('msg', msg);
}

const FAST_CONFIG = {
  targetScore: 201,
  forcedLeekhaDiscard: true,
  undercutRule: 'leekhaRank' as const,
  undercutBindsDiscards: false,
  dealerSelection: 'biggestEater' as const,
  leadRestrictions: 'none' as const,
  moonRule: 'none' as const,
  passDirection: 'right' as const,
  bustTieBreak: 'higherIndividual' as const,
  partnership: true,
  timers: { passMs: 0, playMs: 0 },
};

describe('apps/server identity seam', () => {
  let app: ReturnType<typeof createApp>;
  let port: number;
  let base: string;
  const sockets: ClientSocket[] = [];

  beforeEach(async () => {
    app = createApp();
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
    port = (app.httpServer.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    for (const s of sockets) s.close();
    sockets.length = 0;
    app.io.close();
    app.httpServer.close();
    app.db.raw.close();
  });

  async function registerAndGetCookie(email: string): Promise<{ cookie: string; userId: string }> {
    const res = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'hunter22', displayName: 'Registered' }),
    });
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
    const { user } = await res.json();
    return { cookie, userId: user.id as string };
  }

  it('tags a seat with userId when a logged-in socket creates a room', async () => {
    const { cookie, userId } = await registerAndGetCookie('seam1@example.com');
    const host = connect(port, cookie);
    sockets.push(host);
    await new Promise<void>((r) => host.on('connect', r));

    fire(host, { type: 'auth', name: 'Registered' });
    const createAck = await send(host, { type: 'room.create', config: FAST_CONFIG });
    const roomCode = createAck.code as string;

    const room = app.manager.get(roomCode);
    expect(room?.seats[0].userId).toBe(userId);
  });

  it('leaves userId null for a guest socket with no session cookie', async () => {
    const host = connect(port);
    sockets.push(host);
    await new Promise<void>((r) => host.on('connect', r));

    fire(host, { type: 'auth', name: 'Guest' });
    const createAck = await send(host, { type: 'room.create', config: FAST_CONFIG });
    const roomCode = createAck.code as string;

    const room = app.manager.get(roomCode);
    expect(room?.seats[0].userId).toBeNull();
  });

  it('does not leak userId to the client-facing seat schema', async () => {
    const { cookie } = await registerAndGetCookie('seam2@example.com');
    const host = connect(port, cookie);
    sockets.push(host);
    await new Promise<void>((r) => host.on('connect', r));

    fire(host, { type: 'auth', name: 'Registered' });
    const createAck = await send(host, { type: 'room.create', config: FAST_CONFIG });
    const roomCode = createAck.code as string;

    const room = app.manager.get(roomCode);
    expect(room?.seats[0].userId).toBeTruthy();
    const wireState = room!.roomStateMessage();
    expect((wireState.seats[0] as Record<string, unknown>).userId).toBeUndefined();
  });

  it('tags a seat with userId on room.join for a logged-in second player', async () => {
    const hostRes = await registerAndGetCookie('seam3-host@example.com');
    const joinerRes = await registerAndGetCookie('seam3-joiner@example.com');

    const host = connect(port, hostRes.cookie);
    sockets.push(host);
    await new Promise<void>((r) => host.on('connect', r));
    fire(host, { type: 'auth', name: 'Host' });
    const createAck = await send(host, { type: 'room.create', config: FAST_CONFIG });
    const roomCode = createAck.code as string;

    const joiner = connect(port, joinerRes.cookie);
    sockets.push(joiner);
    await new Promise<void>((r) => joiner.on('connect', r));
    fire(joiner, { type: 'auth', name: 'Joiner' });
    await send(joiner, { type: 'room.join', code: roomCode });

    const room = app.manager.get(roomCode);
    const joinedSeat = room?.seats.find((s) => s.name === 'Joiner');
    expect(joinedSeat?.userId).toBe(joinerRes.userId);
  });
});
