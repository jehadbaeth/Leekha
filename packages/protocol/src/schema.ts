import { z } from 'zod';

export const SuitSchema = z.enum(['S', 'H', 'D', 'C']);
export const RankSchema = z.union([
  z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7),
  z.literal(8), z.literal(9), z.literal(10), z.literal(11), z.literal(12), z.literal(13), z.literal(14),
]);
export const CardSchema = z.object({ suit: SuitSchema, rank: RankSchema });
export const SeatSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export const BotLevelSchema = z.enum(['easy', 'medium', 'hard']);

export const RulesConfigSchema = z.object({
  targetScore: z.number().int().positive(),
  forcedLeekhaDiscard: z.boolean(),
  undercutRule: z.enum(['leekhaRank', 'winningCard', 'off']),
  undercutBindsDiscards: z.boolean(),
  dealerSelection: z.enum(['biggestEater', 'rotateRight']),
  leadRestrictions: z.literal('none'),
  moonRule: z.enum(['none', 'penalty']),
  moonPenalty: z.number().int().positive().optional(),
  passDirection: z.enum(['right', 'alternate']),
  bustTieBreak: z.literal('higherIndividual'),
  timers: z.object({ passMs: z.number().int().nonnegative(), playMs: z.number().int().nonnegative() }),
});

export const TrickPlaySchema = z.object({ seat: SeatSchema, card: CardSchema, forced: z.boolean() });
export const TrickStateSchema = z.object({ leader: SeatSchema, plays: z.array(TrickPlaySchema) });
export const PhaseSchema = z.enum(['passing', 'playing', 'roundEnd', 'gameOver']);

export const SeatViewSchema = z.object({
  seat: SeatSchema,
  hand: z.array(CardSchema),
  phase: PhaseSchema,
  dealer: SeatSchema,
  roundIndex: z.number().int().nonnegative(),
  trickNumber: z.number().int().min(1).max(13),
  currentTrick: TrickStateSchema,
  playedCards: z.array(z.array(TrickPlaySchema)),
  eatenPoints: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  eatenCards: z.array(z.array(CardSchema)),
  scores: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  youPassed: z.array(CardSchema).nullable(),
  youReceived: z.array(CardSchema).nullable(),
  legal: z.array(CardSchema).nullable(),
  config: RulesConfigSchema,
});

// ---- Client -> server ----

export const AuthMsg = z.object({ type: z.literal('auth'), name: z.string().min(1).max(24), seatToken: z.string().optional() });
export const RoomCreateMsg = z.object({ type: z.literal('room.create'), config: RulesConfigSchema });
export const RoomJoinMsg = z.object({ type: z.literal('room.join'), code: z.string().length(6) });
export const RoomSitMsg = z.object({ type: z.literal('room.sit'), seat: SeatSchema });
export const RoomAddBotMsg = z.object({ type: z.literal('room.addBot'), seat: SeatSchema, level: BotLevelSchema });
export const RoomRemoveBotMsg = z.object({ type: z.literal('room.removeBot'), seat: SeatSchema });
export const RoomConfigureMsg = z.object({ type: z.literal('room.configure'), config: RulesConfigSchema });
export const RoomReadyMsg = z.object({ type: z.literal('room.ready'), ready: z.boolean() });
export const RoomStartMsg = z.object({ type: z.literal('room.start') });
export const RoomLeaveMsg = z.object({ type: z.literal('room.leave') });
export const GamePassMsg = z.object({ type: z.literal('game.pass'), cards: z.tuple([CardSchema, CardSchema, CardSchema]) });
export const GamePlayMsg = z.object({ type: z.literal('game.play'), card: CardSchema });
export const GameResyncMsg = z.object({ type: z.literal('game.resync') });
export const EmoteMsg = z.object({ type: z.literal('emote'), id: z.string() });

export const ClientMessageSchema = z.discriminatedUnion('type', [
  AuthMsg,
  RoomCreateMsg,
  RoomJoinMsg,
  RoomSitMsg,
  RoomAddBotMsg,
  RoomRemoveBotMsg,
  RoomConfigureMsg,
  RoomReadyMsg,
  RoomStartMsg,
  RoomLeaveMsg,
  GamePassMsg,
  GamePlayMsg,
  GameResyncMsg,
  EmoteMsg,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ---- Server -> client ----

export const SeatSlotSchema = z.object({
  seat: SeatSchema,
  occupied: z.boolean(),
  name: z.string().optional(),
  isBot: z.boolean(),
  botLevel: BotLevelSchema.optional(),
  ready: z.boolean(),
  connected: z.boolean(),
});

export const RoomStateMsg = z.object({
  type: z.literal('room.state'),
  seq: z.number().int().nonnegative(),
  roomCode: z.string(),
  seats: z.array(SeatSlotSchema),
  config: RulesConfigSchema,
  hostSeat: SeatSchema,
});

export const GameSnapshotMsg = z.object({ type: z.literal('game.snapshot'), seq: z.number().int().nonnegative(), roomCode: z.string(), view: SeatViewSchema });
export const GameDealtMsg = z.object({ type: z.literal('game.dealt'), seq: z.number().int().nonnegative(), roomCode: z.string(), hand: z.array(CardSchema), dealer: SeatSchema, roundIndex: z.number().int() });
export const GamePassPromptMsg = z.object({ type: z.literal('game.passPrompt'), seq: z.number().int().nonnegative(), roomCode: z.string(), deadline: z.number().int().nullable() });
export const GamePassProgressMsg = z.object({ type: z.literal('game.passProgress'), seq: z.number().int().nonnegative(), roomCode: z.string(), seatsCommitted: z.array(SeatSchema) });
export const GamePassRevealMsg = z.object({ type: z.literal('game.passReveal'), seq: z.number().int().nonnegative(), roomCode: z.string(), received: z.tuple([CardSchema, CardSchema, CardSchema]) });
export const GameTurnMsg = z.object({ type: z.literal('game.turn'), seq: z.number().int().nonnegative(), roomCode: z.string(), seat: SeatSchema, deadline: z.number().int().nullable(), legal: z.array(CardSchema).optional() });
export const GamePlayedMsg = z.object({ type: z.literal('game.played'), seq: z.number().int().nonnegative(), roomCode: z.string(), seat: SeatSchema, card: CardSchema, forced: z.boolean() });
export const GameTrickEndMsg = z.object({ type: z.literal('game.trickEnd'), seq: z.number().int().nonnegative(), roomCode: z.string(), winner: SeatSchema, points: z.number(), cards: z.array(TrickPlaySchema) });
export const GameRoundEndMsg = z.object({ type: z.literal('game.roundEnd'), seq: z.number().int().nonnegative(), roomCode: z.string(), eaten: z.tuple([z.number(), z.number(), z.number(), z.number()]), totals: z.tuple([z.number(), z.number(), z.number(), z.number()]) });
export const GameOverMsg = z.object({ type: z.literal('game.over'), seq: z.number().int().nonnegative(), roomCode: z.string(), losingTeam: z.union([z.literal(0), z.literal(1)]), bustSeat: SeatSchema, totals: z.tuple([z.number(), z.number(), z.number(), z.number()]) });
export const PresenceMsg = z.object({ type: z.literal('presence'), seq: z.number().int().nonnegative(), roomCode: z.string(), seat: SeatSchema, status: z.enum(['connected', 'reconnecting', 'bot']) });
export const ErrorMsg = z.object({ type: z.literal('error'), code: z.string(), message: z.string() });

export const ServerMessageSchema = z.discriminatedUnion('type', [
  RoomStateMsg,
  GameSnapshotMsg,
  GameDealtMsg,
  GamePassPromptMsg,
  GamePassProgressMsg,
  GamePassRevealMsg,
  GameTurnMsg,
  GamePlayedMsg,
  GameTrickEndMsg,
  GameRoundEndMsg,
  GameOverMsg,
  PresenceMsg,
  ErrorMsg,
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
