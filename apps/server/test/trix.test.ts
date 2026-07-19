import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.js';

// Collapse the cosmetic bot/deal pacing so a full 4-kingdom match runs in ~1s.
beforeAll(() => {
  process.env.TRIX_BOT_DELAY_MS = '0';
  process.env.TRIX_DEAL_ADVANCE_MS = '0';
});

function connect(port: number): ClientSocket {
  return ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
}

function send(socket: ClientSocket, msg: any): Promise<any> {
  return new Promise((resolve) => socket.emit('msg', msg, resolve));
}

function fire(socket: ClientSocket, msg: any): void {
  socket.emit('msg', msg);
}

const FAST_TRIX_CONFIG = {
  partnership: true,
  complex: false,
  doubling: false, // no exposing window keeps the seat-0 driver simple
  restrictKingOfHeartsLead: false,
  timers: { selectMs: 0, playMs: 0 },
};

describe('apps/server Trix online end to end', () => {
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

  it('plays a full Trix match with 1 human and 3 bots to trix.over', async () => {
    const host = connect(port);
    sockets.push(host);
    await new Promise<void>((r) => host.on('connect', r));

    fire(host, { type: 'auth', name: 'Alice' });
    const createAck = await send(host, { type: 'room.create', gameType: 'trix', trixConfig: FAST_TRIX_CONFIG });
    expect(createAck.code).toBeTruthy();

    fire(host, { type: 'room.addBot', seat: 1, level: 'medium' });
    fire(host, { type: 'room.addBot', seat: 2, level: 'medium' });
    fire(host, { type: 'room.addBot', seat: 3, level: 'medium' });
    fire(host, { type: 'room.ready', ready: true });

    // Drive seat 0 purely off its own snapshots: whenever it is our turn, take
    // the phase-appropriate action. A state fingerprint de-dupes repeated
    // snapshots for the same decision point (a bot's move re-broadcasts to us
    // too), while still allowing two seat-0 turns in a row (choose contract,
    // then lead the trick) since the state changes between them.
    // Drive off the trix.turn message (one per decision point, carrying the
    // acting seat), using the latest snapshot for the legal/choosable data. This
    // matches the real client's model and — unlike a snapshot fingerprint —
    // correctly handles a layout "no legal play, pass again" turn whose board
    // state looks unchanged. In selecting, actingSeat is the kingdom owner, so
    // trix.turn.seat === 0 covers "it's my kingdom to choose" too.
    let view: any = null;
    const over = new Promise<any>((resolve) => {
      host.on('msg', (m: any) => {
        if (m.type === 'trix.over') return resolve(m);
        if (m.type === 'trix.snapshot') {
          view = m.view;
          return;
        }
        if (m.type !== 'trix.turn' || m.seat !== 0 || !view) return;
        const v = view;
        if (v.phase === 'selecting') {
          if (v.choosableContracts?.length) fire(host, { type: 'trix.chooseContract', contracts: [v.choosableContracts[0]] });
        } else if (v.phase === 'exposing') {
          fire(host, { type: 'trix.pass' });
        } else if (v.phase === 'trick' || v.phase === 'layout') {
          if (v.legal?.length) fire(host, { type: 'trix.play', card: v.legal[0] });
          else if (v.canPass) fire(host, { type: 'trix.pass' });
        }
      });
    });

    fire(host, { type: 'room.start' });

    const result = await over;
    // A completed 4-kingdom match nets to zero across the four seats (five
    // contracts per kingdom sum to zero, x4 kingdoms).
    expect(result.scores).toHaveLength(4);
    expect(result.scores.reduce((a: number, b: number) => a + b, 0)).toBe(0);
    // Partnership match: a winning team is decided.
    expect([0, 1]).toContain(result.winnerTeam);
  }, 60_000);
});
