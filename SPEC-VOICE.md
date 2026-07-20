# SPEC-VOICE: in-game voice lobbies

Always-on voice chat attached to a room. Players and (optionally) spectators
join a shared audio channel with a Join/Leave toggle and a mute toggle. Open
mic, not push-to-talk. Voice is a sidecar: it never touches game state, the
engines, or `RulesConfig`/`TrixRulesConfig`, and hidden hands never ride the
voice path.

## 0. Decisions locked (with the user)

- **Topology: peer-to-peer full mesh.** No media server, ever. Each participant
  holds a direct `RTCPeerConnection` to every other participant.
- **Spectators can talk.** When a room allows it, a spectator who joins voice is
  a full participant (talk + listen), not listen-only.
- **Hard cap ~8 total** (4 seats + up to 4 spectators). Past the cap, join is
  refused with a clear "voice lobby full" message. The cap is a single constant.
- **Configurable:** a room-level flag decides whether spectators may join voice
  at all. Host controls it. This is a ROOM setting (like `isPublic`), not an
  engine config field.

## 1. Why this shape (the honest constraints)

Browser voice means WebRTC. There is no realistic alternative; raw audio over
the websocket would be far more work and worse quality.

The deployment box is reachable from the public internet only through Tailscale
Funnel, which forwards HTTPS/TCP, not the arbitrary UDP that WebRTC media rides.
Consequences, stated plainly so nobody reaches for them later:

- A self-hosted SFU (mediasoup/LiveKit) or self-hosted coturn cannot relay media
  to public players through Funnel. Off the table. Do not design around it.
- Media therefore goes browser-to-browser (mesh). Signaling (the setup
  handshake) rides the existing socket.io `msg` channel, which works fine
  through Funnel because it is HTTPS/websocket.

Mesh cost is the reason for the cap: every speaker uploads their audio to every
listener, so one participant's uplink grows linearly with lobby size. Audio-only
is forgiving (a voice stream is tens of kbps, not the megabits video needs), but
a phone on a weak uplink still degrades somewhere around 6 to 8 peers. The cap
keeps us comfortably inside that.

Follow-on, NOT in the MVP and NOT blocking it: managed TURN (Cloudflare or
Metered free tier) for the minority of peer pairs that can't connect directly
(symmetric NAT, some mobile carriers). This is purely an ICE-server-list config
addition delivered from the server, reversible, no rearchitecting. STUN alone
covers all local testing and most real pairs.

## 2. Architecture overview

```
  Browser A  <----- direct audio (WebRTC media, UDP) ----->  Browser B
     |                                                          |
     |  signaling (SDP offer/answer + ICE) over socket.io "msg" |
     +---------------------->  Server  <-----------------------+
                            (relay only; never sees audio)
```

The server is a **signaling relay and roster keeper**. It:
- tracks which sockets in a room have joined voice,
- relays offer/answer/ICE messages to one specific target socket,
- enforces the cap and the spectator-voice flag,
- announces join/leave/mute to the room,
- tears a participant down for everyone on disconnect.

The server never sees or forwards audio. That stays peer-to-peer.

**Identity is per-connection (socket.id), not per-seat.** Spectators have no
seat, and a player can voice-chat from the lobby before sitting. A voice
participant is `{ voiceId, socketId, seat|null, name }` where `voiceId` is just
the socket.id (stable for the life of one connection; a reconnect is a brand new
peer, which is correct because the old peer connections are dead anyway).

## 3. Protocol additions (`packages/protocol`)

Schemas are validated, unlike the emote path which is intentionally out-of-band.
Voice signaling is correctness-sensitive (a malformed SDP relayed blindly could
wedge a peer), so both directions go through zod.

Add to a new `packages/protocol/src/voice.ts`, wired into `ClientMessageSchema`
and `ServerMessageSchema`.

Client to server:
- `voice.join` `{}` — join voice in my current room. Ack: `{ ok: true }` or
  `{ error: 'voice-full' | 'voice-disabled' | 'not-in-room' }`.
- `voice.leave` `{}` — leave voice, release nothing server-side except roster.
- `voice.signal` `{ to: voiceId, signal: Offer | Answer | Ice }` — relayed
  verbatim to the target socket, tagged with `from`.
  - `Offer`/`Answer`: `{ kind: 'offer'|'answer', sdp: string }`
  - `Ice`: `{ kind: 'ice', candidate: string, sdpMid: string|null, sdpMLineIndex: number|null }`
- `voice.state` `{ muted: boolean }` — broadcast my mic state to the room.

Server to client:
- `voice.roster` `{ participants: [{ voiceId, seat|null, name, muted }] }` — sent
  to the joiner: everyone already in voice, so it knows whom to call.
- `voice.joined` `{ voiceId, seat|null, name }` — broadcast when someone joins.
- `voice.left` `{ voiceId }` — broadcast when someone leaves or disconnects.
- `voice.signal` `{ from: voiceId, signal: Offer | Answer | Ice }` — directed
  delivery of a relayed signal.
- `voice.state` `{ voiceId, muted }` — broadcast mute change.

Note on the directed relay: emotes use `io.to(room:${code})` (broadcast).
Voice signals must go to ONE socket. The dispatch emits to `socket.id` of the
target, resolved through the room's voice participant map, never room-wide.

## 4. Server changes

### 4a. Voice registry on the room (`roomBase.ts`)
Shared by both `Room` and `TrixRoom` since it lives on the base, same as
spectators. Add:
- `private voice = new Map<socketId, { seat: Seat|null, name: string, muted: boolean }>()`
- `allowSpectatorVoice: boolean` room field (default true).
- `voiceJoin(socketId, seat, name): 'ok' | 'full' | 'disabled'`
  - reject if `!allowSpectatorVoice && seat === null`,
  - reject if `voice.size >= MAX_VOICE` (constant, start at 8),
  - else add, broadcast `voice.joined`, and return the roster for the caller.
- `voiceLeave(socketId)` — delete + broadcast `voice.left` (no-op if absent).
- `voiceSetMuted(socketId, muted)` — update + broadcast `voice.state`.
- `voiceRoster()` — build `voice.roster` payload.
- `voiceTarget(voiceId): socketId | null` — resolve relay target, membership-checked
  (both `from` and `to` must currently be in this room's voice set).

### 4b. Dispatch (`server.ts`)
New `case` blocks in the `msg` switch: `voice.join`, `voice.leave`,
`voice.signal`, `voice.state`. `voice.signal` resolves the target via
`room.voiceTarget(msg.to)` and, if the sender is also a voice member, emits
`{ type:'voice.signal', from: mySocketId, signal: msg.signal }` to that one
socket. Reject relays where either party isn't in the voice set (prevents using
the relay to spam arbitrary sockets).

### 4c. Cleanup
`socket.on('disconnect')` already calls `room.disconnectSocket(socketId)`; also
call `room.voiceLeave(socketId)` there and in the `room.leave` handler. That is
the single teardown point that makes a dropped peer disappear for everyone.

### 4d. Config surface
`allowSpectatorVoice` set at `room.create` (default true) and toggled by the
host through the existing `room.configure` path (add the field alongside the
game config, room-level, not inside `config`/`trixConfig`). Broadcast the room
state so clients update the toggle.

## 5. Client: signaling and peer lifecycle

New hook `apps/web/src/voice/useVoiceLobby.ts`. It owns:
- the local mic `MediaStream` (acquired on Join, stopped on Leave),
- a `Map<voiceId, RTCPeerConnection>` plus the remote `MediaStream`/audio element per peer,
- join / mute state, and a derived per-participant "speaking" flag.

### 5a. getUserMedia
`getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })`.
Without those three it howls and echoes. Acquire ONLY on the Join tap: that user
gesture is what unlocks both mic permission and remote-audio autoplay (browsers,
iOS especially, block both without a gesture).

### 5b. Who calls whom (glare-free)
Use **perfect negotiation**. For each pair, the peer with the lexicographically
greater `voiceId` is "polite", the other "impolite". On `voice.joined`, the
existing peers open a connection to the newcomer; the newcomer opens toward each
peer in the `voice.roster`. Collisions are resolved by the polite/impolite rule
(polite peer rolls back on offer collision). This is the standard MDN pattern and
it survives renegotiation and reconnect without hand-rolled turn-taking.

### 5c. Per-connection wiring
- Add every local mic track to each `RTCPeerConnection`.
- `onicecandidate` -> send `voice.signal { to, signal:{kind:'ice',...} }`.
- `ontrack` -> attach the remote stream to a hidden `<audio autoplay playsinline>`
  element (playsinline is required on iOS; keep the element in the DOM).
- `onconnectionstatechange` -> on `failed`, tear down and let the roster drive a
  fresh attempt; surface a per-peer "reconnecting" dot.
- On `voice.left` / `voice.signal`-less peers: close the pc, stop remote audio,
  drop from the map.

### 5d. Mute and speaking
- Mute = set every local audio track's `enabled=false` and send `voice.state`.
  No renegotiation, instant, and the peer keeps the transport warm.
- Speaking indicator is LOCAL only: a Web Audio `AnalyserNode` on each remote
  stream (and the local one) computes short-term volume; above a threshold shows
  a pulsing dot on that participant. Never signaled, so zero server cost.

### 5e. Reconnect
If the socket drops while joined, remember the intent; after socket reconnect,
re-send `voice.join` and rebuild peers from the fresh roster. Old pcs are already
dead; just discard them.

## 6. UI/UX

New `apps/web/src/components/VoiceControls.tsx`, mounted by `GameTable` (so both
Leekha and Trix get it for free through the shared board):
- A single primary control: **Join voice** -> once in, it becomes **Leave** plus
  a **Mute/Unmute** toggle. Always-on: after Join the mic is live until Leave.
- A small speaking dot on each seat avatar (and on spectator chips if we surface
  spectator voice presence), lit while that participant is talking, dimmed with a
  mic-off glyph when they're muted.
- "Voice lobby full" and "Spectator voice is off" states shown inline on the
  button, not as error toasts.
- Placement near the avatars, consistent with the emote control, and validated
  at 320/360/390px so it never pushes the board (same discipline the Trix UI
  work established).
- Host-only toggle in the lobby/config: "Allow spectators to talk".
- Arabic strings for every label (the app is bilingual; `t(en, ar)`).

## 7. Config and settings

- Room-level `allowSpectatorVoice` (host toggle), default on.
- Global app settings (`settings.ts`, applies to both games): optional
  "auto-join voice when I enter a room" and a remembered mute-on-join preference.
  Device picker (choose mic) is a nice-to-have, deferred.

## 8. Privacy and safety (state it, don't hide it)

- Mic is off until the user explicitly taps Join; permission is the browser's own
  prompt. Leaving fully stops the local tracks (the mic indicator goes dark).
- No recording, no server-side audio, no persistence. The server only ever sees
  signaling metadata (who is in voice, mute flags), never audio.
- Who can hear whom is exactly the room voice set; a spectator talking is audible
  to the whole voice lobby, which is the point, and is gated by the host flag.

## 9. Edge cases to handle

- **Permission denied / no mic:** Join fails gracefully with an inline message;
  no peers are opened. Retry allowed.
- **Seat takeover / AFK flip:** voice identity is per-socket, independent of seat
  changes, so a takeover doesn't disturb an existing voice peer. If a player is
  AFK-flipped to a bot but stays connected, their voice stays up (they're still a
  human in the room); that's acceptable.
- **Leave room:** `room.leave` also leaves voice.
- **iOS Safari:** `playsinline`, in-DOM audio elements, gesture-gated start, and
  known audio-routing quirks (speaker vs earpiece). Explicit test surface.
- **Autoplay policy:** remote audio only plays after the Join gesture; if a
  browser still blocks it, show a one-tap "enable audio" affordance.

## 10. Testing

Server (unit, same style as the existing 44 server tests):
- `voice.join` adds to roster and returns others; second join idempotent.
- Cap: the (N+1)th join is refused with `voice-full`.
- Spectator with `allowSpectatorVoice=false` is refused with `voice-disabled`.
- `voice.signal` reaches only the target socket, tagged `from`; a signal from a
  non-member or to a non-member is dropped.
- Disconnect and `room.leave` broadcast `voice.left`.

Client / integration (manual, multi-device, since real WebRTC media can't be
meaningfully unit-tested here):
- Two devices hear each other; mute silences and shows the indicator; leave/rejoin
  works; a third and fourth peer join cleanly; spectator joins and is heard;
  socket reconnect rebuilds voice; iOS Safari end-to-end.

Purity guard stays green: nothing in `packages/engine`/`packages/trix` changes,
and the bots-never-import-MatchState test is untouched.

## 11. Build phases

1. **Signaling backbone.** Protocol `voice.*` schemas + server registry, relay,
   cap, disconnect cleanup, config flag. Server unit tests. No client yet.
2. **Mesh MVP.** `useVoiceLobby` + minimal `VoiceControls` (Join/Leave/Mute),
   4-seat mesh, STUN only, perfect negotiation. Manual 2-device verify.
3. **Spectator voice + polish.** `allowSpectatorVoice` host toggle, spectator
   participants, speaking dots on avatars, mute broadcast, layout validation at
   phone widths, Arabic strings.
4. **Robustness + reach.** Reconnect re-join, iOS pass, permission-denied UX,
   global auto-join/mute settings. Then the TURN follow-on: server-delivered ICE
   list so a managed TURN provider can be dropped in via env with no code change.

## 12. Open item (not blocking)

Whether the home box can expose a public UDP port or is CGNAT/Funnel-only matters
ONLY if a self-hosted TURN is ever considered. The managed-TURN follow-on
sidesteps it entirely, so this stays a footnote unless priorities change.
