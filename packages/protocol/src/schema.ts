import { z } from 'zod';

export const SuitSchema = z.enum(['S', 'H', 'D', 'C']);
export const RankSchema = z.union([
  z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7),
  z.literal(8), z.literal(9), z.literal(10), z.literal(11), z.literal(12), z.literal(13), z.literal(14),
]);
export const CardSchema = z.object({ suit: SuitSchema, rank: RankSchema });
export const SeatSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export const BotLevelSchema = z.enum(['easy', 'medium', 'hard', 'insane']);

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

export const AuthMsg = z.object({
  type: z.literal('auth'),
  name: z.string().min(1).max(24),
  seatToken: z.string().optional(),
  /** BCP 47 tag from navigator.language (e.g. "ar-SY"); its region subtag is the country fallback when GeoIP can't place the peer address. The client's own websocket handshake carries no usable Accept-Language, so this rides the auth message instead. */
  locale: z.string().max(35).optional(),
});
export const RoomCreateMsg = z.object({
  type: z.literal('room.create'),
  config: RulesConfigSchema,
  /** Lists the room on the home screen's public rooms list while it's still joinable (lobby, seats open). Defaults to false: a room is code/link-only unless the host opts in. */
  isPublic: z.boolean().optional(),
});
export const RoomJoinMsg = z.object({ type: z.literal('room.join'), code: z.string().length(6) });
export const RoomListMsg = z.object({ type: z.literal('room.list') });
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
export const RoomRematchMsg = z.object({ type: z.literal('room.rematch') });

export const ClientMessageSchema = z.discriminatedUnion('type', [
  AuthMsg,
  RoomCreateMsg,
  RoomJoinMsg,
  RoomListMsg,
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
  RoomRematchMsg,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/** One row of the home screen's public rooms list (room.list's ack); not part of ServerMessageSchema since acks, per this protocol's existing convention (room.create/room.join), are typed directly rather than validated as broadcast messages. */
export const PublicRoomSchema = z.object({
  code: z.string().length(6),
  hostName: z.string(),
  seatsFilled: z.number().int().min(0).max(4),
  targetScore: z.number().int().positive(),
});
export type PublicRoom = z.infer<typeof PublicRoomSchema>;

// ---- Server -> client ----

export const SeatSlotSchema = z.object({
  seat: SeatSchema,
  occupied: z.boolean(),
  name: z.string().optional(),
  isBot: z.boolean(),
  botLevel: BotLevelSchema.optional(),
  ready: z.boolean(),
  connected: z.boolean(),
  /** ISO 3166-1 alpha-2 of the occupant, resolved server-side (GeoIP with an Accept-Language region fallback); null/absent when unknown or a bot. */
  country: z.string().length(2).nullable().optional(),
});

export const RoomStateMsg = z.object({
  type: z.literal('room.state'),
  seq: z.number().int().nonnegative(),
  roomCode: z.string(),
  seats: z.array(SeatSlotSchema),
  config: RulesConfigSchema,
  hostSeat: SeatSchema,
  // Lets a joiner who received no seatToken (an observer, see RoomSitMsg) tell
  // "match already running, I'm watching the roster" apart from "founding lobby".
  phase: z.enum(['lobby', 'game']),
});

export const GameSnapshotMsg = z.object({ type: z.literal('game.snapshot'), seq: z.number().int().nonnegative(), roomCode: z.string(), view: SeatViewSchema });
// Same shape as game.snapshot but for sockets with no seat (observers): view.hand/legal/
// youPassed/youReceived are always blanked server-side (see Room.publicSnapshotMessage),
// since hidden state must never cross the wire to a socket that isn't that seat's owner.
export const GamePublicSnapshotMsg = z.object({ type: z.literal('game.publicSnapshot'), seq: z.number().int().nonnegative(), roomCode: z.string(), view: SeatViewSchema });
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
export const ServerEmoteMsg = z.object({ type: z.literal('emote'), seat: SeatSchema, id: z.string() });
// Broadcast whenever the set of seatless watchers changes (and to each socket
// on join/resync): how many are watching and, aggregated, from where. Only
// counts cross the wire — never identities — and spectators with no resolvable
// country are included in `count` but absent from `countries`.
export const RoomSpectatorsMsg = z.object({
  type: z.literal('room.spectators'),
  seq: z.number().int().nonnegative(),
  roomCode: z.string(),
  count: z.number().int().nonnegative(),
  countries: z.record(z.string(), z.number().int().positive()),
});
export const GameRematchVotesMsg = z.object({
  type: z.literal('game.rematchVotes'),
  seq: z.number().int().nonnegative(),
  roomCode: z.string(),
  seatsVoted: z.array(SeatSchema),
  seatsNeeded: z.array(SeatSchema),
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  RoomStateMsg,
  GameSnapshotMsg,
  GamePublicSnapshotMsg,
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
  ServerEmoteMsg,
  GameRematchVotesMsg,
  RoomSpectatorsMsg,
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
