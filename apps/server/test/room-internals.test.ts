import { describe, it, expect, vi } from 'vitest';
import type { MatchState } from '@leekha/engine';
import { Room } from '../src/room.js';

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

function makeRoom() {
  const emitted: unknown[] = [];
  const room = new Room('TEST', FAST_CONFIG, (_seat, msg) => emitted.push(msg));
  return { room, emitted };
}

/** Seats a solo human at 0 and bots everywhere else, then forces the room straight into a finished match. */
function seatSoloHumanWithBots(room: Room) {
  room.sit(0, 'Alice', 'sock-0');
  room.addBot(1, 'medium');
  room.addBot(2, 'medium');
  room.addBot(3, 'medium');
  room.phase = 'game';
  room.match = { phase: 'gameOver' } as unknown as MatchState;
}

function seatAllHumans(room: Room) {
  room.sit(0, 'Alice', 'sock-0');
  room.sit(1, 'Bob', 'sock-1');
  room.sit(2, 'Cara', 'sock-2');
  room.sit(3, 'Dan', 'sock-3');
  room.phase = 'game';
  room.match = { phase: 'gameOver' } as unknown as MatchState;
}

describe('Room.voteRematch', () => {
  it('restarts immediately for a solo human at a table of bots', () => {
    const { room } = makeRoom();
    seatSoloHumanWithBots(room);
    room.voteRematch(0);
    expect(room.match?.phase).not.toBe('gameOver');
  });

  it('waits for every human seat before restarting an all-human room', () => {
    const { room } = makeRoom();
    seatAllHumans(room);
    room.voteRematch(0);
    expect(room.match?.phase).toBe('gameOver');
    room.voteRematch(1);
    room.voteRematch(2);
    expect(room.match?.phase).toBe('gameOver');
    room.voteRematch(3);
    expect(room.match?.phase).not.toBe('gameOver');
  });
});

describe('Room.reclaimSeat', () => {
  it('does nothing for a seat that never went AFK (never became a bot)', () => {
    const { room } = makeRoom();
    seatSoloHumanWithBots(room);
    room.reclaimSeat(0);
    expect(room.seats[0].isBot).toBe(false);
  });

  it('lets a still-connected human take back a seat flipped to bot by AFK strikes', () => {
    const { room } = makeRoom();
    seatSoloHumanWithBots(room);
    (room as unknown as { flipToBot(seat: number): void }).flipToBot(0);
    expect(room.seats[0].isBot).toBe(true);
    room.reclaimSeat(0);
    expect(room.seats[0].isBot).toBe(false);
  });
});

describe('Room.findOpenSeat', () => {
  it('offers a bot-occupied seat to a new joiner instead of reporting room-full', () => {
    const { room } = makeRoom();
    room.sit(0, 'Alice', 'sock-0');
    room.addBot(1, 'medium');
    room.addBot(2, 'medium');
    room.addBot(3, 'medium');
    expect(room.findOpenSeat()).toBe(1);
  });

  it('prefers a genuinely empty seat over a bot-occupied one', () => {
    const { room } = makeRoom();
    room.sit(0, 'Alice', 'sock-0');
    room.addBot(1, 'medium');
    expect(room.findOpenSeat()).toBe(2);
  });
});

describe('Room.sit — bot seat takeover', () => {
  it('lets a new human sit into a seat a bot is playing, replacing the bot', () => {
    const { room } = makeRoom();
    room.sit(0, 'Alice', 'sock-0');
    room.addBot(1, 'medium');
    room.sit(1, 'Newcomer', 'sock-1');
    expect(room.seats[1].isBot).toBe(false);
    expect(room.seats[1].name).toBe('Newcomer');
  });

  it('lets a new human take over a seat a human left mid-match (AFK-flipped to bot)', () => {
    const { room } = makeRoom();
    seatSoloHumanWithBots(room);
    (room as unknown as { flipToBot(seat: number): void }).flipToBot(1);
    expect(room.seats[1].isBot).toBe(true);
    const oldToken = room.seats[1].token;
    room.sit(1, 'Newcomer', 'sock-new');
    expect(room.seats[1].isBot).toBe(false);
    expect(room.seats[1].name).toBe('Newcomer');
    expect(room.seats[1].token).not.toBe(oldToken);
  });

  it('still refuses a seat genuinely occupied by another connected human', () => {
    const { room } = makeRoom();
    room.sit(0, 'Alice', 'sock-0');
    expect(() => room.sit(0, 'Mallory', 'sock-evil')).toThrow('That seat is occupied');
  });
});
