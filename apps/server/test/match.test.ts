import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.js';

function connect(port: number): ClientSocket {
  return ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
}

function waitFor(socket: ClientSocket, predicate: (msg: any) => boolean, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs);
    const handler = (msg: any) => {
      if (predicate(msg)) {
        clearTimeout(timer);
        socket.off('msg', handler);
        resolve(msg);
      }
    };
    socket.on('msg', handler);
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
  timers: { passMs: 0, playMs: 0 },
};

describe('apps/server end to end', () => {
  let app: ReturnType<typeof createApp>;
  let port: number;
  const sockets: ClientSocket[] = [];

  beforeEach(async () => {
    app = createApp();
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
    port = (app.httpServer.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const s of sockets) s.close();
    sockets.length = 0;
    app.io.close();
    app.httpServer.close();
  });

  it('completes a full round with 1 human and 3 bots', async () => {
    const host = connect(port);
    sockets.push(host);
    await new Promise((r) => host.on('connect', r));

    fire(host, { type: 'auth', name: 'Alice' });
    const createAck = await send(host, { type: 'room.create', config: FAST_CONFIG });
    expect(createAck.code).toBeTruthy();
    const roomCode = createAck.code as string;

    fire(host, { type: 'room.addBot', seat: 1, level: 'medium' });
    fire(host, { type: 'room.addBot', seat: 2, level: 'medium' });
    fire(host, { type: 'room.addBot', seat: 3, level: 'medium' });
    fire(host, { type: 'room.ready', ready: true });

    const roundEndPromise = waitFor(host, (m) => m.type === 'game.roundEnd', 90_000);
    fire(host, { type: 'room.start' });

    // Play seat 0's cards whenever it's our turn, following whatever the server calls legal.
    const playLoop = (async () => {
      for (let i = 0; i < 20; i++) {
        const turn = await waitFor(host, (m) => m.type === 'game.turn' && m.seat === 0 && m.legal, 10_000).catch(() => null);
        if (!turn) break;
        fire(host, { type: 'game.play', card: turn.legal[0] });
      }
    })();

    // Handle the passing phase for seat 0.
    const passPromise = (async () => {
      const prompt = await waitFor(host, (m) => m.type === 'game.dealt' && m.dealer !== undefined, 5000);
      const hand = prompt.hand as { suit: string; rank: number }[];
      fire(host, { type: 'game.pass', cards: [hand[0], hand[1], hand[2]] });
    })();

    await Promise.race([roundEndPromise, Promise.all([playLoop, passPromise])]);
    const roundEnd = await roundEndPromise;
    expect(roundEnd.eaten.reduce((a: number, b: number) => a + b, 0)).toBe(50);
    expect(roomCode.length).toBe(6);
  }, 100_000);

  it('reconnects a disconnected seat via seatToken and resumes control', async () => {
    const a = connect(port);
    sockets.push(a);
    await new Promise((r) => a.on('connect', r));
    fire(a, { type: 'auth', name: 'Alice' });
    const createAck = await send(a, { type: 'room.create', config: FAST_CONFIG });
    const seatToken = createAck.seatToken as string;
    const roomCode = createAck.code as string;

    a.close();
    await new Promise((r) => setTimeout(r, 100));

    const b = connect(port);
    sockets.push(b);
    await new Promise((r) => b.on('connect', r));
    const stateAfterAuth = waitFor(b, (m) => m.type === 'room.state', 3000);
    fire(b, { type: 'auth', name: 'Alice', seatToken });
    fire(b, { type: 'game.resync' });
    const state = await stateAfterAuth;
    expect(state.roomCode).toBe(roomCode);
    expect(state.seats[0].connected).toBe(true);
  });

  it('auto plays on timeout and flips to bot control after two strikes', async () => {
    const host = connect(port);
    sockets.push(host);
    await new Promise((r) => host.on('connect', r));
    fire(host, { type: 'auth', name: 'Alice' });
    const SHORT_TIMER_CONFIG = { ...FAST_CONFIG, timers: { passMs: 300, playMs: 300 } };
    const createAck = await send(host, { type: 'room.create', config: SHORT_TIMER_CONFIG });
    const roomCode = createAck.code as string;

    fire(host, { type: 'room.addBot', seat: 1, level: 'medium' });
    fire(host, { type: 'room.addBot', seat: 2, level: 'medium' });
    fire(host, { type: 'room.addBot', seat: 3, level: 'medium' });
    fire(host, { type: 'room.ready', ready: true });

    // Never respond to passPrompt or game.turn from seat 0: the server must auto-act for us
    // via the timer, strike us twice, and then flip our seat to bot control.
    const botTakeover = waitFor(host, (m) => m.type === 'presence' && m.seat === 0 && m.status === 'bot', 25_000);
    fire(host, { type: 'room.start' });

    const presence = await botTakeover;
    expect(presence.roomCode).toBe(roomCode);
  }, 30_000);
});
