# System Design

This describes the system as built, not just as planned. For the original
design brief and rationale, see [`SPEC.md`](../SPEC.md); for player-facing
rules, see [`GAME_RULES.md`](./GAME_RULES.md); for how to run this in
production, see [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## 1. Shape of the system

```
apps/web (React PWA)  ⇄  socket.io over WebSocket  ⇄  apps/server (Node, authoritative)
        │                                                    │
        └───────────────── packages/protocol ────────────────┘   zod schemas, shared wire types
                            packages/engine                       pure rules, zero runtime deps
                            packages/bots                         heuristics + search, SeatView only
```

One Node process is authoritative for game state. The client never runs
rules logic against another player's hidden information; it either runs
the same pure engine locally (solo vs. bots, no network) or renders
whatever the server sends it (online mode).

## 2. Package boundaries and why they're drawn there

- **`packages/engine`** is pure: no I/O, no timers, no runtime dependencies.
  It exports `newMatch`, `startRound`, `commitPass`, `legalPlays`,
  `playCard`, `viewFor`, and `matchResult`. Every one of these is a plain
  function from state to new state (or a derived view); none of them touch
  the network, the clock, or randomness beyond a seeded PRNG. This is what
  makes the engine trivially unit-testable, trivially fuzzable (see
  Section 8), and safely runnable in the browser for offline/bot play
  without duplicating server logic.
- **`packages/protocol`** holds zod schemas for every client→server and
  server→client message. Both `apps/web` and `apps/server` import the same
  schema module, so the wire format cannot silently drift between them, and
  every inbound message is runtime-validated at the socket boundary before
  any game logic sees it.
- **`packages/bots`** consumes `SeatView` only, the same redacted view a
  human client receives. It is not merely convention: a test in this
  package's suite asserts that no file under `packages/bots` imports the
  full `MatchState` type. A bot cannot cheat by construction, not by
  discipline.
- **`apps/server`** owns all authoritative state: rooms, seat assignment,
  timers, the shuffle RNG, and redaction. It is the only place `MatchState`
  (the unredacted state, including all four hands) ever lives.
- **`apps/web`** is a thin renderer over either a local engine driver
  (offline vs. bots) or a socket driver (online), behind the same
  interface, so the game table component doesn't know or care which one is
  active.
- **`tools/sim`** runs the engine headlessly, thousands of bot-vs-bot
  matches, to produce balance statistics without any UI or network in the
  loop.

## 3. Data model

Defined in `packages/engine/src/types.ts`. The core types:

```ts
type Suit = 'S' | 'H' | 'D' | 'C';
type Rank = 2..14;                     // J=11, Q=12, K=13, A=14
type Seat = 0 | 1 | 2 | 3;             // teams: (0,2) vs (1,3), anticlockwise order

interface RulesConfig {
  targetScore: number;
  forcedLeekhaDiscard: boolean;
  undercutRule: 'leekhaRank' | 'winningCard' | 'off';
  undercutBindsDiscards: boolean;
  dealerSelection: 'biggestEater' | 'rotateRight';
  moonRule: 'none' | 'penalty';
  passDirection: 'right' | 'alternate';
  bustTieBreak: 'higherIndividual';
  timers: { passMs: number; playMs: number };
  // ...see the file for the complete field list
}

interface MatchState {           // server-only, full information
  config: RulesConfig;
  scores: [number, number, number, number];
  dealer: Seat;
  roundIndex: number;
  phase: 'passing' | 'playing' | 'roundEnd' | 'gameOver';
  round: RoundState;             // includes all four hands, uncommitted passes
  seed: string;
  moveLog: LoggedAction[];
}

interface SeatView {             // the ONLY thing a client or bot ever sees
  seat: Seat;
  hand: Card[];                  // this seat's hand only
  legal: Card[] | null;          // present only when it is this seat's turn
  // ...plus every field that's already public: scores, played tricks, phase, etc.
}
```

`MatchState` is plain JSON-serializable data, no functions, `Map`s, or
`Set`s, which is what makes it safe to round-trip through `JSON.stringify`
for Redis persistence (Section 6) without a custom (de)serializer.

Every rule decision in SPEC.md Section 3 that isn't a fixed mathematical
fact of the game lives as a named `RulesConfig` field, never as a hardcoded
branch in engine code. Changing a room's ruleset is a config change, not a
patch.

### Redaction

`viewFor(match, seat)` (`packages/engine/src/engine.ts`) is the single
function responsible for turning full state into a seat's view. It is the
only place that decides what a given seat is allowed to see: it copies in
that seat's own hand, computes `legal` only when it's actually that seat's
turn, and otherwise omits everything private (other hands, uncommitted
passes). Both the socket layer and the local offline driver call through
this same function, so there is exactly one redaction implementation to
audit.

## 4. Network protocol

All messages are zod-validated (`packages/protocol`). Every server message
carries `roomCode` and a per-room monotonically increasing `seq`.

**Client → server:** `auth`, `room.create`, `room.join`, `room.addBot`,
`room.removeBot`, `room.configure`, `room.ready`, `room.start`,
`room.leave`, `game.pass`, `game.play`, `game.resync`, `emote`.

**Server → client:** `room.state`, `game.snapshot`, `game.dealt`,
`game.passPrompt`, `game.passProgress`, `game.passReveal`, `game.turn`,
`game.played`, `game.trickEnd`, `game.roundEnd`, `game.over`, `presence`,
`error`.

Only `room.create` and `room.join` reply via a socket.io ack callback (they
return a seat token or an error the caller needs synchronously). Every
other client→server message is fire-and-forget from the caller's
perspective; the server's actual response arrives as one of the broadcast
message types above, not as an ack. (This distinction matters if you're
writing a test harness or a bot client against the raw socket: don't await
an ack on messages that don't produce one.)

Reconnection strategy is deliberately simple: on any socket (re)connect the
client sends `auth` (with its stored `seatToken` if it has one) followed by
`game.resync`, and the server always answers with one full `game.snapshot`.
There is no incremental event replay or diffing in this system; snapshots
are small (one player's hand plus public state) and always self-consistent,
so full-snapshot resync was chosen deliberately over the complexity of
diffing.

## 5. Room lifecycle

```
LOBBY → (host starts, 4 seats filled) → ROUND_START (deal)
  → PASSING (await 4 commits, timer per seat)
  → PASS_REVEAL
  → TRICK 1..13: TURN(seat) → ... → TRICK_END
  → ROUND_END (tally, bust check)
       ├─ no bust → ROUND_START (dealer = biggest eater, K♣ tiebreak)
       └─ bust    → GAME_OVER → rematch (reset scores, same seats) | room GC
```

- Each room is one in-memory `Room` instance (`apps/server/src/room.ts`),
  keyed by a 6-character code (`apps/server/src/roomManager.ts`).
- The host role transfers to the next human if the host leaves; a room with
  zero connected humans is destroyed immediately.
- `RoomManager.sweep()` runs every 60 seconds and garbage-collects rooms
  idle in the lobby for 15+ minutes or sitting in `gameOver` for 5+
  minutes.
- Seat tokens are opaque strings generated at `sit()` time and stored in
  the room's own seat slots (not a separate table), so a reconnecting
  client can present its token via `auth` and reclaim its seat as long as
  the room still exists (see Section 6 for what happens across a restart).

## 6. Persistence (optional)

By default rooms live in memory only; a server restart ends every in-flight
game. This is an accepted MVP tradeoff (SPEC.md 8.2), not an oversight, a
single small Node process is expected to comfortably hold thousands of
concurrent 4-seat rooms, so there's no state-sharding problem to solve, and
matches are turn-based and short-lived enough that "don't deploy mid-peak"
is a workable policy on its own.

When `REDIS_URL` is set (`apps/server/src/persistence.ts`), the tradeoff
changes: every meaningful state mutation (`broadcastRoomState`,
`flipToBot`, a committed pass, an applied play) triggers a snapshot save of
that room, JSON-serialized, to a `leekha:room:{code}` Redis key with a 6
hour TTL. On boot, if persistence is configured, the server loads every
surviving key, reconstructs each `Room` via `Room.fromSnapshot()`
(re-arming whatever pass/play/round timer the restored phase needs), and
rebuilds its socket-reconnect token index by scanning the restored rooms'
own seat slots. A client reconnecting with its original seat token after a
full server restart transparently resumes.

This is intentionally *not* a general persistence layer: there is no
database, no accounts, no historical match storage. It exists solely so a
deploy or a crash doesn't kill games already in progress.

## 7. Security and fairness model

- **Server-authoritative shuffle.** A cryptographic RNG seeds every match;
  the seed plus the append-only move log makes any match fully
  reproducible and auditable after the fact.
- **Single redaction chokepoint.** Covered in Section 3; there is one
  function a reviewer needs to check to be confident no client ever
  receives another seat's hand.
- **Input validation.** Every inbound message is zod-parsed against
  `packages/protocol` before it reaches any game logic; malformed messages
  get a `bad-message` error and are dropped, never partially processed.
- **Turn and seat enforcement.** The engine itself raises `IllegalAction`
  for a wrong-seat play, an out-of-turn play, or a play outside the current
  `legalPlays()` set; the server catches this at the socket handler and
  turns it into an `error` event rather than ever letting invalid state
  through.
- **Seat tokens.** Reconnection uses an opaque token issued at sit-down and
  kept client-side (localStorage). It's a capability token, not a password;
  anyone who obtains a live token can reclaim that seat. This is an
  accepted tradeoff for a link-and-play product with no accounts.
- **Unfixable by design, stated explicitly:** two partners talking on a
  phone call can signal each other outside the game. Every online
  partnership card game lives with this; the product's mitigation is
  framing (built for friends and family playing together, not for
  competitive-integrity strangers) rather than a technical fix.

See Section 10 for security-relevant gaps that exist today and should be
weighed before treating this as production-hardened.

## 8. Testing strategy

- **Engine unit tests** (`packages/engine/test`): every scenario in
  SPEC.md Section 14.1, including the full undercut-rule matrix and the
  forced-dump edge cases.
- **Scoring tests**: round-sum-to-50 assertion, bust thresholds, dealer
  selection cascade including the K♣ tiebreak.
- **Property-based tests** (`packages/engine/test/property.test.ts`, using
  `fast-check`): thousands of randomly seeded rounds assert that every card
  is played exactly once, every move actually came from `legalPlays()`,
  eaten totals always sum to 50, and `viewFor(seat)` never leaks another
  seat's hand or an uncommitted pass.
- **Bot no-cheating test** (`packages/bots/test/no-cheating.test.ts`):
  static check that no file under `packages/bots` imports `MatchState`.
- **Server integration tests** (`apps/server/test/match.test.ts`): real
  socket.io clients play a full match end-to-end against bots; a separate
  case drives a timer past expiry twice to confirm auto-play then bot
  takeover fires correctly.
- **Self-play soak** (`pnpm sim`): thousands of headless bot-vs-bot matches
  reporting forced-dump frequency, K♣ eater distribution after the pass,
  win rate symmetry by seat (an asymmetry here means an engine bug, not a
  balance question), and dealer-streak lengths.

Run `pnpm test` (all suites) and `pnpm sim` before considering any engine
or rules change complete; this is a repo-wide convention, not a suggestion
(see `CLAUDE.md`).

## 9. Bot AI

Two tiers, both driven purely off `SeatView`:

- **Tier 1, heuristic** (`packages/bots/src/heuristic.ts`): a hand-scored
  policy for passing (per-card danger weights: K♣ and Q♠ scored highest
  when short-suited, void-shaping bonuses, a penalty for creating a
  void+Leekha combination) and for playing (an ordered rule list: forced
  dumps prefer sending the biggest Leekha card to an opponent, ducking
  under live threats, endgame counting with 4 or fewer tricks left, and a
  rescue/sacrifice mode when a partner is dangerously close to the target).
  Easy and Medium share this policy; Easy adds substantially more decision
  noise.
- **Tier 2, search** (`packages/bots/src/search.ts` driven via
  `apps/server/src/bot.ts`): determinized Monte Carlo. It samples 24-48
  plausible hidden-hand worlds consistent with every public constraint
  (voids, proven Leekha absences, passed cards), rolls each legal move
  forward to the end of the round with the Tier 1 policy driving all four
  seats, and picks the move with the best mean utility, which heavily
  penalizes a teammate busting before optimizing score differential. This
  targets a sub-300ms decision budget.
- A shared inference tracker (folded into both tiers) tracks unseen cards,
  known passed cards, void marks, Leekha-absence proofs, and undercut
  proofs, the same public information a sharp human player would reason
  from.

## 10. Known gaps and honest caveats

Documented here deliberately rather than glossed over, since a reviewer
should weigh these before treating this as production-hardened:

- **No rate limiting.** SPEC.md Section 8.3 calls for rate-limiting socket
  messages per connection and capping rooms per IP; neither is implemented.
  A single misbehaving or malicious client can currently flood a room with
  messages or create unbounded rooms.
- **CORS is wide open** (`cors: { origin: '*' }` in `apps/server/src/server.ts`).
  Fine for same-origin single-image deployment (the default and
  recommended setup, see `DEPLOYMENT.md`), but worth tightening explicitly
  if the server is ever exposed as a separate origin from the client.
- **No CI pipeline.** There is no `.github/workflows` or equivalent in this
  repo; `pnpm test` and `pnpm sim` are run manually. Tests and typechecks
  are not enforced automatically on push or PR.
- **Single-process, no horizontal scaling path.** Rooms live in one Node
  process's memory (optionally mirrored to Redis for restart survival, not
  for sharding). Running multiple server replicas behind a load balancer
  would split rooms across instances incorrectly; this system is designed
  to scale by being cheap enough to run as one instance, not to scale out.
- **No structured logging or monitoring.** The server logs plain
  `console.log`/`console.error` lines (room creation, Redis connection
  status, restore counts). There's no metrics endpoint, no error tracking
  integration, and no health-check route beyond the fact that the HTTP
  server responds at all.
- **Seat tokens never expire on their own** except by the room's own GC
  policy (15 min idle lobby / 5 min post-game) or the Redis snapshot's 6
  hour TTL. There's no explicit token revocation.
- **No accounts, ranked play, or persistent stats**, by design (see
  SPEC.md Section 6 and Section 17); worth restating here so it isn't
  mistaken for an oversight during review.
- **Sound effects are synthesized**, not audio asset files: `apps/web/src/sound.ts`
  generates every sting via the Web Audio API (`OscillatorNode`), so there
  are no `.mp3`/`.wav` files to license or ship. This was a deliberate
  choice to avoid adding binary assets and licensing questions, not a
  placeholder.
- **Partner signaling outside the app is unfixable by design** (Section 7);
  restated here because it's a real, standing limitation of any online
  partnership card game, not something this codebase can close.
