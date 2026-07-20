import { describe, it, expect } from 'vitest';
import type { EmitTarget } from '../src/roomBase.js';
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

interface Emitted {
  target: EmitTarget;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  msg: any;
}

function makeRoom() {
  const emitted: Emitted[] = [];
  const room = new Room('TEST', FAST_CONFIG, (target, msg) => emitted.push({ target, msg }));
  return { room, emitted };
}

const OFFER = { kind: 'offer', sdp: 'v=0...' } as const;

describe('voice lobby — join / roster', () => {
  it('sends the joiner a roster of prior members and broadcasts a join', () => {
    const { room, emitted } = makeRoom();
    expect(room.voiceJoin('sock-a', 0, 'Alice')).toEqual({ ok: true });

    // First joiner's roster is empty (nobody was there yet), delivered to it alone.
    const rosterA = emitted.find((e) => e.msg.type === 'voice.roster');
    expect(rosterA?.target).toEqual({ socket: 'sock-a' });
    expect(rosterA?.msg.self).toBe('sock-a');
    expect(rosterA?.msg.participants).toEqual([]);
    // And a broadcast join for Alice.
    const joinedA = emitted.find((e) => e.msg.type === 'voice.joined');
    expect(joinedA?.target).toBe(null);
    expect(joinedA?.msg.participant).toMatchObject({ voiceId: 'sock-a', seat: 0, name: 'Alice', muted: false });

    emitted.length = 0;
    room.voiceJoin('sock-b', 1, 'Bob');
    const rosterB = emitted.find((e) => e.msg.type === 'voice.roster');
    expect(rosterB?.target).toEqual({ socket: 'sock-b' });
    expect(rosterB?.msg.participants).toEqual([{ voiceId: 'sock-a', seat: 0, name: 'Alice', muted: false }]);
  });

  it('is idempotent: re-joining the same socket does not double-broadcast a join', () => {
    const { room, emitted } = makeRoom();
    room.voiceJoin('sock-a', 0, 'Alice');
    emitted.length = 0;
    room.voiceJoin('sock-a', 0, 'Alice');
    expect(emitted.filter((e) => e.msg.type === 'voice.joined')).toHaveLength(0);
    // Still gets a fresh roster (useful after a resync).
    expect(emitted.some((e) => e.msg.type === 'voice.roster')).toBe(true);
  });
});

describe('voice lobby — cap and spectator gate', () => {
  it('refuses the 9th participant with voice-full', () => {
    const { room } = makeRoom();
    for (let i = 0; i < 8; i++) expect(room.voiceJoin(`sock-${i}`, null, `S${i}`)).toEqual({ ok: true });
    expect(room.voiceJoin('sock-9', null, 'late')).toEqual({ error: 'voice-full' });
  });

  it('refuses a seatless spectator when spectator voice is off, but never a seated player', () => {
    const { room } = makeRoom();
    room.setAllowSpectatorVoice(false);
    expect(room.voiceJoin('spec', null, 'Watcher')).toEqual({ error: 'voice-disabled' });
    expect(room.voiceJoin('player', 2, 'Seated')).toEqual({ ok: true });
  });

  it('drops spectators from the mesh the moment the host turns spectator voice off', () => {
    const { room, emitted } = makeRoom();
    room.voiceJoin('player', 0, 'Seated');
    room.voiceJoin('spec', null, 'Watcher');
    emitted.length = 0;
    room.setAllowSpectatorVoice(false);
    const lefts = emitted.filter((e) => e.msg.type === 'voice.left').map((e) => e.msg.voiceId);
    expect(lefts).toEqual(['spec']);
  });
});

describe('voice lobby — signaling relay', () => {
  it('relays a signal to exactly the target socket, tagged with the sender', () => {
    const { room, emitted } = makeRoom();
    room.voiceJoin('sock-a', 0, 'Alice');
    room.voiceJoin('sock-b', 1, 'Bob');
    emitted.length = 0;

    expect(room.voiceRelay('sock-a', 'sock-b', OFFER)).toBe(true);
    const sig = emitted.find((e) => e.msg.type === 'voice.signal');
    expect(sig?.target).toEqual({ socket: 'sock-b' });
    expect(sig?.msg.from).toBe('sock-a');
    expect(sig?.msg.signal).toEqual(OFFER);
  });

  it('drops a relay when either end is not a current voice member', () => {
    const { room, emitted } = makeRoom();
    room.voiceJoin('sock-a', 0, 'Alice');
    emitted.length = 0;
    // target not in voice
    expect(room.voiceRelay('sock-a', 'ghost', OFFER)).toBe(false);
    // sender not in voice
    expect(room.voiceRelay('ghost', 'sock-a', OFFER)).toBe(false);
    expect(emitted.filter((e) => e.msg.type === 'voice.signal')).toHaveLength(0);
  });
});

describe('voice lobby — teardown', () => {
  it('broadcasts a leave and forgets the member', () => {
    const { room, emitted } = makeRoom();
    room.voiceJoin('sock-a', 0, 'Alice');
    room.voiceJoin('sock-b', 1, 'Bob');
    emitted.length = 0;
    room.voiceLeave('sock-a');
    const left = emitted.find((e) => e.msg.type === 'voice.left');
    expect(left?.target).toBe(null);
    expect(left?.msg.voiceId).toBe('sock-a');
    // A relay to the departed peer now fails.
    expect(room.voiceRelay('sock-b', 'sock-a', OFFER)).toBe(false);
  });

  it('a socket disconnect also removes it from voice', () => {
    const { room, emitted } = makeRoom();
    room.sit(0, 'Alice', 'sock-a');
    room.voiceJoin('sock-a', 0, 'Alice');
    emitted.length = 0;
    room.disconnectSocket('sock-a');
    expect(emitted.some((e) => e.msg.type === 'voice.left' && e.msg.voiceId === 'sock-a')).toBe(true);
  });

  it('mute state broadcasts once and dedupes', () => {
    const { room, emitted } = makeRoom();
    room.voiceJoin('sock-a', 0, 'Alice');
    emitted.length = 0;
    room.voiceSetMuted('sock-a', true);
    room.voiceSetMuted('sock-a', true); // no-op
    const states = emitted.filter((e) => e.msg.type === 'voice.state');
    expect(states).toHaveLength(1);
    expect(states[0].msg).toMatchObject({ voiceId: 'sock-a', muted: true });
  });
});
