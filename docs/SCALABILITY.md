# Scalability and mobile strategy

Status: analysis, not a load test. The numbers below are derived from the code and
from micro-benchmarks on the dev machine (Apple M3, 8 cores, Node 26). They are
order-of-magnitude estimates meant to point at the real bottleneck and the right
next moves, not guarantees. Before betting anything important on a specific
number, run the load test described at the end.

## TL;DR

1. The bottleneck is **not** SQLite. It is the **single Node process running the
   bot search synchronously on the event loop**. One `hard` bot move costs about
   84ms of blocking CPU (worst case, trick 1), versus 0.04ms for a heuristic move
   and effectively nothing for a human move.
2. On the current single-process deployment, human-only games are cheap (one to
   two orders of magnitude cheaper than bot games; exact ceiling not measured), but
   games containing `hard`/`insane` bots are the binding constraint: only **roughly
   15 to 30 concurrent bot games** before the event loop saturates and everyone
   starts feeling lag. Bots are the capacity variable, by a wide margin.
3. Swapping SQLite for Postgres does **not** raise single-node throughput here.
   Persistence is rare and mostly off the hot path. Postgres matters only once you
   want to run more than one process or box, because SQLite is a local single
   writer and cannot be shared. It is a prerequisite for horizontal scale, not a
   performance win on its own.
4. Biggest single improvement: move bot search into a **worker thread pool** so it
   stops blocking the event loop. That one change likely takes bot-game capacity
   from tens to low hundreds on the same box.
5. Mobile: the engine is pure, dependency-free TypeScript that consumes `SeatView`
   only, so the cleanest path is a **thin client over the existing socket
   protocol**, packaged with React Native or Capacitor so the same engine and bots
   run on-device for offline play. Voice already rides a transport-agnostic
   signaling channel and works through `react-native-webrtc` or a WebView.

## Current architecture, as built

- **One process, one event loop.** `apps/server/src/server.ts` creates a single
  `socket.io` `Server` on one Node HTTP server. There is **no socket.io adapter**
  configured, so there is no cross-process broadcast and no horizontal scaling
  today. Everything runs on one core's event loop.
- **Game state lives in memory.** `RoomManager` holds every room in a `Map`. A
  room is fully self-contained: seats, phase machine, timers, and the engine
  match. Nothing about one room touches another.
- **The engine is pure.** `packages/engine` has zero runtime dependencies, no I/O,
  no timers. Clients and bots only ever see `SeatView` (via `viewFor`). Hidden
  state never crosses the wire. This is what makes both mobile reuse and worker
  offloading straightforward.
- **Redis is wired but currently OFF in production.** `docker inspect leekha` on
  the deploy box shows no `REDIS_URL` in the container env, and `index.ts` makes
  persistence null without it. So on the machine you asked about there is **no
  crash recovery today** (a restart drops every in-flight room) and, usefully for
  this analysis, **no per-move snapshot cost** either. The code path exists:
  `persistence.ts` can write a room snapshot to Redis after every state change with
  a TTL and reload in-flight rooms on restart. It is only a snapshot store, not a
  socket.io pub/sub adapter, so it never fans out messages. If it were enabled, it
  would add a full `JSON.stringify` of the room (the move log grows all round) on
  every state change, which is worth remembering before turning it on under load.
- **SQLite (better-sqlite3) holds the durable data:** accounts, match history,
  sessions. Writes happen on match end and on session upsert, which is rare
  relative to gameplay. better-sqlite3 is synchronous, so a write briefly blocks
  the event loop, but the writes are small and infrequent.
- **Voice is peer to peer.** A full WebRTC mesh; the server only relays small
  signaling messages over the existing `msg` channel. Audio never touches the
  server, so voice adds almost no server load beyond a handful of tiny relays per
  join.
- **Bots run inline on the event loop.** `room.ts` schedules a bot move with a
  600 to 1800ms "thinking" delay, but when that timer fires, `choosePlay` runs
  synchronously. For `hard` it also runs a second full oracle pass
  (`logHardBotBlunderIfAny`) purely to log blunders, which is pure production
  overhead.

## Measured costs (Apple M3, one core)

| Move type | Per-move CPU | Notes |
|---|---|---|
| Human move | ~0 | Server just validates and broadcasts; engine apply is sub-millisecond |
| Heuristic bot (easy/medium) | 0.04ms | Negligible |
| Oracle bot (insane) | 3.3ms | One true world, ~13 candidate rollouts |
| Search bot (hard, 320 rollouts) | 84ms peak (trick 1), ~40 to 60ms average over a round | Blocks the event loop for its whole duration; plus a ~3ms blunder-audit pass on top |

The asymmetry is the whole story. A human-only table is almost free. A table with
three `hard` bots is expensive and, worse, its cost lands as discrete multi-tens-of-
milliseconds stalls on the one thread that also has to service every other room's
sockets.

## Capacity estimate and the reasoning

Assume the deploy box gives roughly one core to this process (it is one of several
personal services on that machine, so effective per-core throughput is likely
somewhat below the M3 figures; treat these as an optimistic ceiling).

**Connected but idle clients.** Node and socket.io hold websockets cheaply, on the
order of tens of kilobytes each. Several thousand idle connections fit in a few
hundred megabytes of RAM. Not the bottleneck.

**Human-only active games.** Each move is a validate-and-broadcast costing well
under a millisecond of engine CPU. This is the number I am *least* sure of, and I
did not measure it, so treat it as "clearly cheap, exact ceiling unknown." The two
costs that actually bound it are socket.io broadcast fan-out per move and outbound
bandwidth, neither of which I benchmarked; with Redis off there is no serialization
cost on top. It is safe to say human-only games are one to two orders of magnitude
cheaper than bot games, and that the ceiling is high enough not to be the first
thing that breaks. The load test at the end is what settles the real figure;
anyone quoting "N thousand games" before that is guessing.

**Games containing hard/insane bots.** This is the binding constraint. A
bot-heavy table (one human, three bots) produces roughly one bot move every
second or two during play (moves are sequential per trick, paced 600 to 1800ms
apart). At an average of ~50ms of blocking CPU per `hard` move, one such table
consumes very roughly 3 to 5 percent of a core on the M3, and more on a slower
box. That points to about **20 to 30 concurrent bot-heavy tables to saturate one
M3 core**, and realistically **~15 on a modest shared box**. Well before full
saturation, coincident bot timers produce bursts of 84ms stalls that show up as
input lag and delayed card animations for everyone, so the *comfortable* ceiling
is lower than the *saturation* ceiling.

Translating to players: a bot-heavy table is one human, so 15 to 30 tables is 15
to 30 humans in bot games. Human-only tables carry four humans each and are cheap,
so the mixed real-world number depends entirely on how many games use strong bots.
The single most useful thing you can do for capacity is get bot compute off the
event loop.

## The SQLite versus Postgres question, answered directly

Your instinct is right that persistence is not the bottleneck. State is in memory,
Redis holds ephemeral snapshots, and durable writes are rare and small. On a single
box, SQLite is if anything *faster* than Postgres for this workload because it is an
in-process library call with no network hop.

Where SQLite stops working is the moment you want more than one server process, on
one box or several. SQLite is a single local-file writer; two processes cannot share
it safely over a network. So Postgres is not a single-node performance upgrade, it
is the enabler for horizontal scale of the durable layer (accounts, history,
sessions). The ephemeral game state is already externalizable through Redis. Adopt
Postgres when, and because, you go multi-process, not before, and do not expect it
to change how many concurrent games one box can run.

One real, cheap win regardless of database: better-sqlite3 writes are synchronous
and block the loop. If profiling ever shows them mattering, move them behind a
write queue or a worker, or batch them. Today they are almost certainly noise next
to the 84ms bot moves.

## Improvement roadmap, in priority order

1. **Move bot search into a worker-thread pool.** This is the highest-leverage
   change by far. The engine is pure and the bots consume only `SeatView`, so a
   worker needs nothing but the serialized view and the rollout budget, and returns
   a card. The main loop stays responsive; bot compute spreads across the other 7
   cores. Expect bot-game capacity to jump from tens to low hundreds on the same
   box. Keep a small pool (cores minus one or two) and a queue. The real work here
   is not the offload, it is correctness on return: today the move is computed
   synchronously inside the turn, so room state cannot change under it. Once it is
   async, the seat may have been AFK-flipped to a bot, claimed by someone else, or
   the human may have acted by the time the worker answers, so the returned card
   has to be re-validated against current room state (and dropped if the turn moved
   on). Scope it as a small state-machine change, not just a thread move.
2. **Turn off the production blunder audit.** `logHardBotBlunderIfAny` runs a
   second oracle search on every single `hard` move just to log. That is free
   capacity being burned. Gate it behind a flag that defaults off in production.
3. **Consider a cheaper strong tier.** The oracle (insane) move is 3.3ms versus the
   search bot's 84ms, because it evaluates one world instead of ~24 sampled ones.
   The search bot's rollout budget (320) is the direct cost knob. If perceived
   strength survives a lower budget (abtest it, this repo already does), you buy
   linear capacity back. This is complementary to workers, not a substitute.
4. **Horizontal scale by room affinity, not shared game state.** Because a room is
   self-contained, the clean way to run N processes or boxes is to route every
   socket for a given room code to the same process (a thin front router doing
   consistent hashing on the room code, or sticky routing plus a room directory in
   Redis). Then no cross-process broadcast is needed at all and it scales close to
   linearly. The socket.io Redis adapter is the alternative if you would rather let
   any process serve any room, at the cost of pub/sub fan-out on every message.
   Room affinity is simpler and cheaper for this shape of workload.
5. **Then Postgres for the durable layer**, as the multi-process step above forces
   shared accounts, history, and sessions. Keep Redis for ephemeral room snapshots
   and the room directory.
6. **Backpressure and admission control.** Cap concurrent bot-heavy games per
   process and queue or shed politely past the cap, so the failure mode is "please
   wait" rather than global lag. The room manager already tracks active rooms, so
   this is a small addition.

A reasonable sequence: workers plus audit-off first (single box, big win, low
risk), measure, then room-affinity multi-process plus Postgres only if real demand
exceeds one box.

## Mobile clients (iOS and Android)

The engine being pure, framework-free TypeScript that only ever exposes `SeatView`
is the key asset. Two layers, and they compose.

**Online play: thin client over the existing protocol.** All authority stays on the
server; the engine runs only there. The mobile app is a UI that speaks the same
socket protocol defined in `packages/protocol` (zod-validated messages). The
fastest route from the current codebase is to wrap the existing React web client
with **Capacitor** or rebuild the UI in **React Native**, either of which gives you
one iOS plus Android app while reusing the protocol contract verbatim. A fully
native Swift/Kotlin client is possible too (socket.io has community clients for
both), but then the wire protocol is the only shared contract and you maintain the
UI twice.

**Offline and versus-bots play: reuse the engine on-device.** Because
`packages/engine` and `packages/bots` are pure TS with zero native dependencies,
they bundle straight into a JavaScript runtime. In React Native (Hermes) or
Capacitor (WebView), you can run the exact same engine and bots locally for offline
solo play, with no server round-trip and no code fork. This preserves the CLAUDE.md
invariant that the engine is the single source of truth, which a native port in
Swift or Kotlin would break, so avoid porting unless there is a hard reason.

Recommendation: **React Native (or Capacitor) so the TypeScript engine is reused as
is**, for both the online thin client and on-device offline bots. Reach for native
only if you hit a UI or performance wall the JS layer cannot meet.

**Voice on mobile.** The mesh already separates signaling (over the socket) from
media (peer to peer), and the signaling protocol is transport-agnostic. Capacitor
in a WebView gets WebRTC for free; React Native uses `react-native-webrtc`. No
server-side change is needed, and because audio never hits the server, mobile voice
does not affect the capacity analysis above.

**One consideration for on-device bots.** The 84ms hard-bot move measured on an M3
will be meaningfully slower on a phone. For on-device play, lower the rollout
budget for the mobile bots, or run them in a JS worker so the UI thread stays
smooth, the same fix as the server.

## What would make these numbers real

This is analysis, not measurement of the deployed box. To turn the estimates into
commitments:

1. Record the deploy machine's real per-core throughput (run the same bot
   micro-benchmark there).
2. Load test with a synthetic client that opens N sockets and drives M concurrent
   bot-heavy games, and watch event-loop lag (for example `perf_hooks`
   `monitorEventLoopDelay`), p95 message latency, and CPU.
3. Find the knee where event-loop delay climbs, both with bots inline (today) and
   with bots in workers. The gap between those two curves is the payoff of
   improvement #1, quantified.
