import { describe, it, expect } from 'vitest';
import type { MatchState } from '@leekha/engine';
import { Room } from '../src/room.js';
import { RoomManager } from '../src/roomManager.js';
import type { MatchRecord } from '../src/db.js';

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

function makeRoom() {
  const emitted: unknown[] = [];
  const room = new Room('TEST', FAST_CONFIG, (_target, msg) => emitted.push(msg));
  return { room, emitted };
}

describe('Room match-end recording', () => {
  it('builds a fully replayable record and hands it to onMatchEnd, tagging registered/guest/bot seats correctly', () => {
    const { room } = makeRoom();
    room.sit(0, 'Alice', 'sock-0', null, 'user-alice');
    room.sit(1, 'Bob', 'sock-1');
    room.addBot(2, 'medium');
    room.addBot(3, 'hard');
    room.phase = 'game';
    room.match = {
      seed: 'seed-abc',
      moveLog: [{ type: 'play', seat: 0, card: { suit: 'S', rank: 14 } }],
    } as unknown as MatchState;
    (room as unknown as { matchStartedAt: number }).matchStartedAt = 1000;

    let recorded: MatchRecord | null = null;
    room.setOnMatchEnd((r) => {
      recorded = r;
    });

    (room as unknown as { recordMatchEnd: (ev: unknown) => void }).recordMatchEnd({
      type: 'gameOver',
      losingTeam: 0,
      bustSeat: 0,
      totals: [210, 50, 60, 70],
    });

    expect(recorded).not.toBeNull();
    const record = recorded as unknown as MatchRecord;
    expect(record.roomCode).toBe('TEST');
    expect(record.seed).toBe('seed-abc');
    expect(record.moveLog).toEqual([{ type: 'play', seat: 0, card: { suit: 'S', rank: 14 } }]);
    expect(record.finalScores).toEqual([210, 50, 60, 70]);
    expect(record.result).toEqual({ losingTeam: 0, bustSeat: 0 });
    expect(record.startedAt).toBe(1000);

    expect(record.players).toHaveLength(4);
    expect(record.players.find((p) => p.seat === 0)).toMatchObject({ userId: 'user-alice', displayName: 'Alice', wasBot: false });
    expect(record.players.find((p) => p.seat === 1)).toMatchObject({ userId: null, displayName: 'Bob', wasBot: false });
    expect(record.players.find((p) => p.seat === 2)).toMatchObject({ userId: null, wasBot: true });
    expect(record.players.find((p) => p.seat === 3)).toMatchObject({ userId: null, wasBot: true });
  });

  it('does nothing when no onMatchEnd callback has been set', () => {
    const { room } = makeRoom();
    room.phase = 'game';
    room.match = { seed: 's', moveLog: [] } as unknown as MatchState;
    expect(() =>
      (room as unknown as { recordMatchEnd: (ev: unknown) => void }).recordMatchEnd({
        type: 'gameOver',
        losingTeam: 0,
        bustSeat: 0,
        totals: [0, 0, 0, 0],
      }),
    ).not.toThrow();
  });
});

describe('RoomManager wiring', () => {
  it('wires a freshly created room to call db.recordMatch on match end', () => {
    const recordMatch = (record: MatchRecord) => calls.push(record);
    const calls: MatchRecord[] = [];
    const fakeDb = { recordMatch } as unknown as import('../src/db.js').Db;
    const fakeIo = { to: () => ({ emit: () => {} }) } as unknown as import('socket.io').Server;
    const manager = new RoomManager(fakeIo, null, fakeDb);

    const room = manager.create(FAST_CONFIG);
    room.sit(0, 'Alice', 'sock-0', null, 'user-alice');
    room.addBot(1, 'medium');
    room.addBot(2, 'medium');
    room.addBot(3, 'medium');
    room.phase = 'game';
    room.match = { seed: 'seed-xyz', moveLog: [] } as unknown as MatchState;

    (room as unknown as { recordMatchEnd: (ev: unknown) => void }).recordMatchEnd({
      type: 'gameOver',
      losingTeam: 1,
      bustSeat: 1,
      totals: [80, 210, 40, 30],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].seed).toBe('seed-xyz');
    expect(calls[0].roomCode).toBe(room.code);
  });
});
