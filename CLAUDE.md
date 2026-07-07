# Build conventions

Full ruleset and plan: `SPEC.md`. Build order: engine → local UI → server → bots online → polish.

- `packages/engine` stays pure and framework free: no I/O, no timers, zero runtime deps.
- Clients and bots consume `SeatView` only (see `viewFor`); hidden state never crosses the wire.
- Every Section 3 decision in SPEC.md lives in `RulesConfig`, not hardcoded.
- `packages/bots` must never import `MatchState` (enforced by a test).
- Run `pnpm test` and `pnpm sim` before declaring any engine change done.

Section pointers: rules 4, data model/engine API 9, protocol 10, room lifecycle 11,
timers/disconnects 12, bot AI 13, testing plan 14, build phases 15.
