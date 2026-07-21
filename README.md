# Leekha (Idlib Variant)

An online, four player web app for Idlibi Leekha, a trick avoidance card game
in the Hearts family. Full ruleset, design rationale, and the phased build
plan live in [`SPEC.md`](./SPEC.md). Contribution conventions for this repo
live in [`CLAUDE.md`](./CLAUDE.md).

Deeper documentation for reviewers:

- [`docs/GAME_RULES.md`](./docs/GAME_RULES.md) — the rules as actually
  enforced by the engine, in plain language ([Levantine Arabic version](./docs/GAME_RULES.ar.md)).
- [`docs/SYSTEM_DESIGN.md`](./docs/SYSTEM_DESIGN.md) — architecture, data
  model, protocol, security model, testing strategy, and a section on
  known gaps stated honestly rather than glossed over.
- [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — every supported way to run
  this in production, including Redis persistence and reverse proxy setup.

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

## Continuous integration

GitHub Actions (`.github/workflows/ci.yml`) runs the same `pnpm test`, the
self-play soak, and the web build on every push to `main`.

One check is a known false failure on the hosted runners and can be ignored:
the Tier 2 search bot timing test in `packages/bots/test/search.test.ts`
(`decides the opening lead within the 300ms per-decision budget`, SPEC.md
13.3.5). It runs a fixed batch of search rollouts and asserts they finish
under 300ms. That budget holds on real hardware and the test passes locally,
but GitHub's shared runners are roughly 1.5 to 2x slower, so the same work
measures around 400 to 500ms and the assertion trips (the measured time
varies run to run, and it occasionally passes when a faster runner is
allocated). It is a wall-clock micro-benchmark on variable hardware, not a
correctness failure, so a red CI run whose only failure is this test is safe
to ignore. Because the `test` job then fails, the soak, web build, and the
image-publish `docker` job (which `needs: test`) are skipped too.

Production is unaffected either way: deploys build the image from the local
working tree on the deploy host (see `docs/DEPLOYMENT.md`), not from CI's
published image.

## Deployment

The app ships as a single Docker image that serves the built client and the
WebSocket API on the same origin (avoids CORS and cookie headaches):

```bash
docker build -t leekha .
docker run -p 8080:8080 leekha
```

See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for environment variables,
optional Redis persistence, reverse proxy/TLS setup, and platform-specific
notes (Fly.io, Railway, a bare VPS with Caddy).

## Localization

The client supports English and Arabic with full RTL layout. Language is a
per-device setting; the table geometry itself does not mirror in RTL (the
local player's hand always stays at the bottom).
