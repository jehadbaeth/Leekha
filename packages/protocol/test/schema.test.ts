import { describe, expect, it } from 'vitest';
import { ClientMessageSchema, ServerMessageSchema, RulesConfigSchema } from '../src/index.js';

const config = {
  targetScore: 201,
  forcedLeekhaDiscard: true,
  undercutRule: 'leekhaRank' as const,
  undercutBindsDiscards: false,
  dealerSelection: 'biggestEater' as const,
  leadRestrictions: 'none' as const,
  moonRule: 'none' as const,
  passDirection: 'right' as const,
  bustTieBreak: 'higherIndividual' as const,
  timers: { passMs: 45000, playMs: 25000 },
};

describe('protocol schemas', () => {
  it('validates a rules config', () => {
    expect(RulesConfigSchema.parse(config)).toBeTruthy();
  });

  it('validates a room.create client message', () => {
    const msg = { type: 'room.create', config };
    expect(ClientMessageSchema.parse(msg).type).toBe('room.create');
  });

  it('validates a game.play client message', () => {
    const msg = { type: 'game.play', card: { suit: 'S', rank: 12 } };
    expect(ClientMessageSchema.parse(msg).type).toBe('game.play');
  });

  it('rejects an invalid client message', () => {
    expect(() => ClientMessageSchema.parse({ type: 'game.play', card: { suit: 'X', rank: 1 } })).toThrow();
  });

  it('validates a game.trickEnd server message', () => {
    const msg = {
      type: 'game.trickEnd',
      seq: 1,
      roomCode: 'ABC123',
      winner: 2,
      points: 14,
      cards: [{ seat: 0, card: { suit: 'C', rank: 13 }, forced: true }],
    };
    expect(ServerMessageSchema.parse(msg).type).toBe('game.trickEnd');
  });
});
