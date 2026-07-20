import { z } from 'zod';
import { SeatSchema } from './primitives.js';

// Voice protocol arms. ADDITIVE and game-agnostic: voice attaches to a room
// (Leekha or Trix) as a sidecar and never touches game state. Media (the audio
// itself) is peer-to-peer WebRTC and never crosses the server; only the
// signaling handshake below is relayed. See SPEC-VOICE.md.
//
// A voice participant is identified by `voiceId`, which the server sets to the
// socket.id: stable for the life of one connection, and a reconnect is a brand
// new peer (the old peer connections are already dead). Identity is
// per-connection, not per-seat, because spectators have no seat.

/** SDP offer/answer or a single ICE candidate. Relayed verbatim between two peers. */
const VoiceSdpSchema = z.object({ kind: z.enum(['offer', 'answer']), sdp: z.string().max(20_000) });
const VoiceIceSchema = z.object({
  kind: z.literal('ice'),
  candidate: z.string().max(2_000),
  sdpMid: z.string().nullable(),
  sdpMLineIndex: z.number().int().nonnegative().nullable(),
});
export const VoiceSignalSchema = z.union([VoiceSdpSchema, VoiceIceSchema]);
export type VoiceSignal = z.infer<typeof VoiceSignalSchema>;

// ---- Client -> server ----

export const VoiceJoinMsg = z.object({ type: z.literal('voice.join') });
export const VoiceLeaveMsg = z.object({ type: z.literal('voice.leave') });
/** Relay a signal to ONE specific peer (never broadcast). `to` is that peer's voiceId. */
export const VoiceSignalMsg = z.object({ type: z.literal('voice.signal'), to: z.string().max(64), signal: VoiceSignalSchema });
export const VoiceStateMsg = z.object({ type: z.literal('voice.state'), muted: z.boolean() });

export const VoiceClientMessages = [VoiceJoinMsg, VoiceLeaveMsg, VoiceSignalMsg, VoiceStateMsg] as const;

// ---- Server -> client ----

export const VoiceParticipantSchema = z.object({
  voiceId: z.string(),
  seat: SeatSchema.nullable(),
  name: z.string(),
  muted: z.boolean(),
});
export type VoiceParticipant = z.infer<typeof VoiceParticipantSchema>;

/** Sent to the joiner: everyone already in voice (so it knows whom to call), plus its own voiceId. */
export const VoiceRosterMsg = z.object({
  type: z.literal('voice.roster'),
  seq: z.number().int().nonnegative(),
  roomCode: z.string(),
  self: z.string(),
  participants: z.array(VoiceParticipantSchema),
});
export const VoiceJoinedMsg = z.object({
  type: z.literal('voice.joined'),
  seq: z.number().int().nonnegative(),
  roomCode: z.string(),
  participant: VoiceParticipantSchema,
});
export const VoiceLeftMsg = z.object({
  type: z.literal('voice.left'),
  seq: z.number().int().nonnegative(),
  roomCode: z.string(),
  voiceId: z.string(),
});
/** Directed delivery of a relayed signal from another peer. */
export const VoiceServerSignalMsg = z.object({
  type: z.literal('voice.signal'),
  seq: z.number().int().nonnegative(),
  roomCode: z.string(),
  from: z.string(),
  signal: VoiceSignalSchema,
});
export const VoiceServerStateMsg = z.object({
  type: z.literal('voice.state'),
  seq: z.number().int().nonnegative(),
  roomCode: z.string(),
  voiceId: z.string(),
  muted: z.boolean(),
});

export const VoiceServerMessages = [
  VoiceRosterMsg,
  VoiceJoinedMsg,
  VoiceLeftMsg,
  VoiceServerSignalMsg,
  VoiceServerStateMsg,
] as const;
