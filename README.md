# Leekha (Idlib Variant)

An online, four player web app for Idlibi Leekha, a trick avoidance card game
in the Hearts family. Full ruleset, design rationale, and the phased build
plan live in [`SPEC.md`](./SPEC.md). Contribution conventions for this repo
live in [`CLAUDE.md`](./CLAUDE.md).

Play solo against bots, or create a room and share a link, WhatsApp works
best for this audience, so up to four humans can play with bots filling any
empty seats. English and Arabic (full RTL) are both supported.

## Repository layout

```
leekha/
  packages/
    engine/     pure rules engine, zero runtime deps, no I/O or timers
    protocol/   zod schemas and shared types for the client/server wire format
    bots/       heuristic (Tier 1) and search (Tier 2) bot AI, consumes SeatView only
  apps/
    server/     Node + socket.io authoritative game server, serves the built web app too
    web/        React + Vite PWA client
  tools/
    sim/        headless self-play soak tester used to sanity check game balance
```

`packages/engine` never imports Node or browser APIs and has no runtime
dependencies. `packages/bots` never imports `MatchState`, only the redacted
`SeatView`, so bots cannot see hidden information by construction (enforced
by a test).

## Requirements

- Node.js 22.x
- pnpm 9.x (`packageManager` is pinned in the root `package.json`; `corepack
  enable` will pick it up automatically)

## Setup

```bash
pnpm install
```

## Running it locally

Play solo against bots with no server at all:

```bash
pnpm --filter @leekha/web dev
```

Open the printed local URL; this runs the engine directly in the browser.

For online multiplayer, run the server and the client in two terminals:

```bash
pnpm --filter @leekha/server dev   # http://localhost:8080, websocket + API
pnpm --filter @leekha/web dev      # http://localhost:5173, connects to the server
```

## Testing

```bash
pnpm test   # runs every package's vitest suite (engine, protocol, bots, server)
pnpm sim    # headless self-play soak: pnpm sim --matches 2000
```

Run both before considering any engine or rules change done. `pnpm sim`
prints balance stats described in SPEC.md Section 14 (forced-dump frequency,
K♣ eater distribution, win rate by seat, undercut frequency, dealer streaks).

Other useful per-package scripts:

```bash
pnpm -r typecheck                        # tsc --noEmit across all packages
pnpm --filter @leekha/web build          # typecheck + production client build
```

## Deployment

The app ships as a single Docker image that serves the built client and the
WebSocket API on the same origin (avoids CORS and cookie headaches):

```bash
docker build -t leekha .
docker run -p 8080:8080 leekha
```

The container serves the web app's static files and the socket.io endpoint
from the same Node process on `$PORT` (default `8080`).

### Environment variables

| Variable        | Required | Purpose                                                                                  |
|-----------------|----------|-------------------------------------------------------------------------------------------|
| `PORT`          | no       | Port the server listens on. Defaults to `8080`.                                          |
| `WEB_DIST_PATH` | no       | Path to the built web client's static files. Defaults to the bundled `apps/web/dist`.    |
| `REDIS_URL`     | no       | When set, room state is persisted to Redis so in-flight games survive a server restart. Without it, rooms live in memory only (a restart ends all active games), which is fine for MVP deploys. |

Redis persistence is optional (SPEC.md Section 8.2/Phase 4): each room
snapshots itself to a `leekha:room:{code}` key on every state change with a
6 hour TTL, and on boot the server restores any rooms still in Redis,
including reconnecting seat tokens, so a client that reconnects after a
restart resumes exactly where it left off.

## Localization

The client supports English and Arabic with full RTL layout. Language is a
per-device setting; the table geometry itself does not mirror in RTL (the
local player's hand always stays at the bottom).
