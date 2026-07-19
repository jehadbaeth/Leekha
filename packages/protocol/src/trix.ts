import { z } from 'zod';
import { CardSchema, SeatSchema, RankSchema } from './primitives.js';

// Trix protocol arms. These are ADDITIVE: Leekha's existing message shapes in
// schema.ts are untouched. A room is either a Leekha room or a Trix room,
// discriminated by `gameType` on room.create / room.state; Trix rooms speak the
// trix.* game messages below instead of Leekha's game.pass / game.play.

export const GameTypeSchema = z.enum(['leekha', 'trix']);
export type GameType = z.infer<typeof GameTypeSchema>;

export const ContractSchema = z.enum(['kingOfHearts', 'diamonds', 'queens', 'slaps', 'trix']);
export const TrixPhaseSchema = z.enum(['selecting', 'exposing', 'trick', 'layout', 'dealEnd', 'done']);

export const TrixRulesConfigSchema = z.object({
  partnership: z.boolean(),
  complex: z.boolean(),
  doubling: z.boolean(),
  restrictKingOfHeartsLead: z.boolean(),
  timers: z.object({ selectMs: z.number().int().nonnegative(), playMs: z.number().int().nonnegative() }),
});

const TrixTrickPlaySchema = z.object({ seat: SeatSchema, card: CardSchema });
const SuitLayoutSchema = z.object({ up: RankSchema.nullable(), down: RankSchema.nullable() });
const LayoutSchema = z.object({ S: SuitLayoutSchema, H: SuitLayoutSchema, D: SuitLayoutSchema, C: SuitLayoutSchema });
const ExposedSchema = z.object({ seat: SeatSchema, card: CardSchema });
const Quad = <T extends z.ZodTypeAny>(t: T) => z.tuple([t, t, t, t]);

/** The only Trix state clients/bots ever see (mirrors packages/trix TrixSeatView). No hidden hands cross the wire. */
export const TrixSeatViewSchema = z.object({
  seat: SeatSchema,
  config: TrixRulesConfigSchema,
  phase: TrixPhaseSchema,
  hand: z.array(CardSchema),
  kingdomOwner: SeatSchema,
  kingdomIndex: z.number().int().nonnegative(),
  contractsSpent: z.array(ContractSchema),
  choosableContracts: z.array(ContractSchema).nullable(),
  contracts: z.array(ContractSchema),
  turn: SeatSchema.nullable(),
  currentTrick: z.object({ leader: SeatSchema, plays: z.array(TrixTrickPlaySchema) }),
  captured: Quad(z.array(CardSchema)),
  tricksWon: Quad(z.number()),
  exposed: z.array(ExposedSchema),
  trickNumber: z.number().int().nonnegative(),
  layout: LayoutSchema,
  finished: z.array(SeatSchema),
  scores: Quad(z.number()),
  legal: z.array(CardSchema).nullable(),
  canPass: z.boolean(),
  exposable: z.array(CardSchema),
});

// ---- Client -> server (Trix game actions) ----

export const TrixChooseContractMsg = z.object({ type: z.literal('trix.chooseContract'), contracts: z.array(ContractSchema).min(1) });
export const TrixExposeMsg = z.object({ type: z.literal('trix.expose'), card: CardSchema });
export const TrixPassMsg = z.object({ type: z.literal('trix.pass') });
export const TrixPlayMsg = z.object({ type: z.literal('trix.play'), card: CardSchema });

export const TrixClientMessages = [TrixChooseContractMsg, TrixExposeMsg, TrixPassMsg, TrixPlayMsg] as const;

// ---- Server -> client (Trix snapshots / turn / deal end / over) ----

// Granular per-play events so the online client can reproduce the trick-
// completion pause, the play/trick sounds, and the "last trick" review — the
// whole-view snapshots alone arrive with the trick already collected.
export const TrixPlayedMsg = z.object({ type: z.literal('trix.played'), seq: z.number().int().nonnegative(), roomCode: z.string(), seat: SeatSchema, card: CardSchema });
export const TrixTrickEndMsg = z.object({ type: z.literal('trix.trickEnd'), seq: z.number().int().nonnegative(), roomCode: z.string(), winner: SeatSchema, cards: z.array(TrixTrickPlaySchema) });
export const TrixSnapshotMsg = z.object({ type: z.literal('trix.snapshot'), seq: z.number().int().nonnegative(), roomCode: z.string(), view: TrixSeatViewSchema });
export const TrixPublicSnapshotMsg = z.object({ type: z.literal('trix.publicSnapshot'), seq: z.number().int().nonnegative(), roomCode: z.string(), view: TrixSeatViewSchema });
export const TrixTurnMsg = z.object({ type: z.literal('trix.turn'), seq: z.number().int().nonnegative(), roomCode: z.string(), seat: SeatSchema.nullable(), deadline: z.number().int().nullable() });
export const TrixDealEndMsg = z.object({
  type: z.literal('trix.dealEnd'),
  seq: z.number().int().nonnegative(),
  roomCode: z.string(),
  dealScores: Quad(z.number()),
  totals: Quad(z.number()),
});
export const TrixOverMsg = z.object({
  type: z.literal('trix.over'),
  seq: z.number().int().nonnegative(),
  roomCode: z.string(),
  scores: Quad(z.number()),
  teamScores: z.tuple([z.number(), z.number()]).optional(),
  winnerSeat: SeatSchema.optional(),
  winnerTeam: z.union([z.literal(0), z.literal(1)]).optional(),
});

export const TrixServerMessages = [TrixSnapshotMsg, TrixPublicSnapshotMsg, TrixTurnMsg, TrixDealEndMsg, TrixOverMsg, TrixPlayedMsg, TrixTrickEndMsg] as const;
