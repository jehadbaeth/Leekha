# Trix ↔ Leekha feature parity (validated audit)

Ground-truth checklist for bringing Trix (local + online) to parity with Leekha,
and for the abstraction discipline that lets game #3 inherit the same features.

## Status (after the parity push)

DONE + exercised in-browser + deployed: Batch D (Trex board, page-scroll,
doubling-hand, recap), Batch B+A-local (sounds/haptics/trick-pause/last-trick +
presence/turn/share-chip forwarding, local), Batch A-online (trix.played/
trix.trickEnd so online gets the same), Batch C+i18n (emotes online + Arabic
throughout), Batch E in-game robustness (AFK recovery both paths, reconnect
ref, rematch votes, spectators, seat-claim, country flags, public-rooms in hook).

DEFERRED (tracked as follow-ons): the entry/discovery chrome — join-by-code UI +
deep-link ?join= routing (needs game-type detection before picking the Leekha
vs Trix hook), a Trix public-rooms list in the picker, cold tab-reopen
auto-resume into a Trix room, a Trix How-to-Play screen, the PWA install banner
on the picker/Trix screens; plus Trix bot difficulty tiers (one tier today) and
admin-panel gameType filtering (column written, UI doesn't split yet).

**Core finding.** Almost every gap has one root cause: Trix bypasses the shared
`GameTable`'s own systems instead of feeding them. It passes `events={[]}` (kills
every sound / haptic / trick-pause / animation), replaces whole regions via
`hudOverride` / `overlayOverride` (kills the last-trick button, share chip,
confetti, round summary), pins `phase:'playing'` in `trixAdapter` (makes
GameTable's match-end branch unreachable), and its online hook computes
presence / turn-deadline / etc. but never forwards them. `GameTable` is already
the game-agnostic layer; the work is to stop bypassing it, not to build a new
abstraction. **We do not design a neutral cross-game view/event contract yet —
two games is too few (SPEC-TRIX §8). If game #3 proves the Leekha-shaped view
needs neutralizing, that is a decision to raise, not to pre-build.**

**Definition of done (per row):** the feature is *exercised and observed
working* in the running game (local and, where applicable, online) — not "the
prop is passed" or "it renders". Shallow verification is the exact thing that
has failed repeatedly here.

Legend — Status: ✅ parity · ⚠️ partial · ❌ missing · 🎯 deliberate difference
(NOT a gap; do not "port"). Confidence: ✔ confirmed in code · ~ observed, not
run live.

---

## A. Event-stream cluster — gated on `events` fed to GameTable

Local fix is cheap: `useTrixGame` already builds a real `TrixEvent[]`; map it to
what GameTable's effects consume and stop passing `events={[]}`.
**Online is real protocol work, not a forwarding fix:** there is no
`trix.played` / `trix.trickEnd` on the wire (`packages/protocol/src/trix.ts` has
only snapshot / turn / dealEnd / over), so the server sends whole snapshots with
the trick already collected. Online parity here needs new protocol messages +
server emission + client accumulation, OR synthesizing events from snapshot
diffs. Do not fold this into "just feed events."

| Feature | Leekha wiring | Trix status | Conf |
|---|---|---|---|
| Card-play sound | `GameTable.tsx:304-325` (walks `events`) | ❌ local+online (`events={[]}`; online has no per-play msg) | ✔ |
| Trick-end sound (Q♠/K♣/10♦ sting) | `GameTable.tsx:310-314`, `sound.ts:92-111` | ❌ local+online | ✔ |
| Round/deal-end sound | `GameTable.tsx:315-317` | ❌ local+online (no Trix event fed) | ✔ |
| Game-over sound | `GameTable.tsx:318-322` | ❌ local+online (`trix.over` also dropped by hook) | ✔ |
| Haptics (`vibrate`) on play/trick/round/over | `GameTable.tsx:308-322`, `settings.haptics` | ❌ local+online (same events gate) | ✔ |
| **Trick-completion pause** (hold full trick ~900ms before clearing) | client `frozenTrick` `GameTable.tsx:328-344`, `settings.trickPauseMs` | ❌ effectively 0ms — trick vanishes instantly. Online needs the protocol msgs above | ✔ |
| **"Last trick" review button + modal** | `GameTable.tsx:702-709,1013-1030`, `view.playedCards` | ❌ HUD replaced by `hudOverride`; `playedCards` hardcoded `[]`; `TrixSeatView` has no field for it | ✔ |
| Deal flourish (cards fly out ~950ms) | `GameTable.tsx:285-300` keyed `view.roundIndex` | ⚠️ mis-keyed: `trixAdapter` maps `roundIndex:=kingdomIndex`, so it fires ~once per kingdom (~1 in 5 deals), not per hand | ✔ |
| Confetti on game over | `MatchEnd.tsx:8-32` | ❌ Trix uses its own plain scorecard overlay | ✔ |

## B. Forward-the-prop — data already computed, dropped at the TrixGame boundary

Trivial: `useOnlineTrixGame` already has these; `TrixGame`'s `<GameTable>` call
and the `TrixController` type just don't pass them through.

| Feature | Leekha wiring | Trix status | Conf |
|---|---|---|---|
| Presence dots (connected/reconnecting/bot) | `GameTable`+`Avatar`; `App.tsx:321` | ❌ hook tracks `presence`, never forwarded | ✔ |
| Turn-deadline ring (countdown) | `Avatar` TimerRing; `App.tsx:322` | ❌ hook tracks `turnDeadline`, never forwarded | ✔ |
| In-game room-code share chip | `GameTable.tsx:736-744`; `App.tsx:330` | ❌ `roomCode` available in `TrixOnlineGame`, not threaded in | ✔ |

## C. Emotes — server is generic, client side entirely absent for Trix

Server already broadcasts `emote` for any room type (`server.ts`), protocol
`EmoteMsg` is generic. Missing purely on the Trix client: no `onEmote` prop, no
`emote` case in `useOnlineTrixGame`'s switch, no `emotes`/`sendEmote`.

| Feature | Leekha wiring | Trix status | Conf |
|---|---|---|---|
| Emote picker + send | `GameTable.tsx:632-667`, `useOnlineGame.sendEmote` | ❌ no `onEmote` prop, no hook plumbing | ✔ |
| Emote bubble over avatar | `Avatar.tsx:69-80` | ❌ no `emotes` data | ✔ |
| Emote sound | `GameTable.tsx:238-257` | ❌ (depends on emotes) | ✔ |

## D. Contained, independent bugs — not architectural, high annoyance

| Feature | Root cause | Conf |
|---|---|---|
| **Hand hidden during doubling** | `GameTable.tsx:854-855` makes `bottomOverride` and the hand fan mutually exclusive; Trix's exposing panel takes the whole bottom slot. Needs an *above-hand* slot, not a rewrite. | ✔ |
| **Trex/Fan-Tan board looks wrong** | `TrixLayoutCenter.tsx:9-20` builds the down-run high→low and never reverses it; four suits in a 2×2 grid of independently-wrapping mini-boxes instead of continuous low→high runs per suit | ✔ |
| **Page grows / big scroll** | `centerOverride`/`bottomOverride` inject unbounded wrap content with no height cap; GameTable's native regions are all pre-budgeted. Bound/clip the override slots (`min-h-0`, max-height). | ✔ |
| No Arabic in Trix chrome | zero `pick()` calls under `src/trix/`; all Trix strings hardcoded English (`trixLabels.ts` contract names, all `TrixGame` prompts/overlays). Shared Lobby/GameTable still localize, so the player sees a bilingual lobby around English game screens | ✔ |
| Online recap "Continue" is a dead button | `useOnlineTrixGame.continueDeal` is a no-op (server auto-advances); Leekha online swaps the button for a "starting shortly" note instead | ✔ |

## E. Hook-orchestration cluster — `useOnlineTrixGame` missing logic `useOnlineGame` has (later, bigger batch)

| Feature | Leekha wiring | Trix status | Conf |
|---|---|---|---|
| Spectator count + countries | `GameTable.tsx:745-799`; `room.spectators` msg | ❌ no handler, not forwarded | ✔ |
| Sideline seat-claim (observer → seat) | `useOnlineGame.claimSeat`; `GameTable.tsx:820-833` | ❌ no `claimSeat` in hook at all | ✔ |
| AFK-flip clears `mySeat` (live `presence` path) | `useOnlineGame.ts:219-236` | ❌ Trix presence handler never checks own-seat→bot | ✔ |
| AFK-flip clears `mySeat` (`room.state` fallback, backgrounded tab) | `useOnlineGame.ts:110-127` | ❌ no equivalent | ✔ |
| Country flags per seat | `Avatar.tsx:105-111` | ❌ `countries` not forwarded | ✔ |
| Rematch vote / quorum UI | `GameTable.tsx:1005`; `game.rematchVotes` (server emits generically) | ❌ no `rematchVotes` handler; bare "Play again" | ✔ |
| Public rooms list | `Home.tsx:134-166` | ❌ no `room.list` in Trix flow | ✔ |
| Join-by-code entry for online Trix | `Home.tsx:168-204` | ❌ picker only offers host/vs-bots | ✔ |
| Deep link `?join=CODE` | `App.tsx:29-33` | ❌ not read for Trix | ✔ |
| Cold tab-reopen resume (Trix) | always-mounted `useOnlineGame` + `loadSession` | ❌ `gameChoice` not persisted; `TrixOnlineGame` mount always `createRoom`s, would race a stored session | ~ |
| Reconnect race guarded by `mySeatRef` | `useOnlineGame.ts:69,121-146` | ⚠️ Trix uses plain `mySeat` state in the closure; narrows but may not eliminate the race | ~ |
| "How to Play" / rules screen | `HowToPlay.tsx` via Home | ❌ no Trix entry point | ✔ |
| Settings screen entry point | `SettingsScreen.tsx` via Home | ⚠️ no entry from picker, but shared `settings` still apply once set from Leekha's screen | ✔ |
| PWA install banner | `App.tsx:350-356` | ❌ not rendered on Trix/picker screens | ✔ |

## F. Already at parity ✅ (verify by exercising, don't assume)

Drag-to-throw / tap-to-confirm play, "your turn" highlight, auto-play single
legal card, four-color deck / reducedMotion / confirmBeforePlay / language
*setting object* (not the strings), per-seat name/score subline (via
`seatSubline` seam), bot think-delay (local `useTrixGame`, online `trixRoom`),
observer join-as-observer ack handling.

## G. Deliberate differences 🎯 — NOT gaps, do not port

- Leekha passing panel / "you passed" memo / pass-reveal flash — Trix has no
  3-card pass; its "layout" (Fan-Tan) is a different mechanic via `centerOverride`.
- Leekha HUD content (trick/target/dealer) — Trix HUD shows kingdom/contract.
- Undercut / forced-Leekha-dump markers, danger-near-target badge — Leekha-only
  rules, correctly suppressed by the adapter's stub config.
- Round-summary eaten-cards breakdown / dealer-reason text — Trix shows a
  score-delta recap instead (though a richer recap is a fair enhancement later).

---

## Recommended sequence (you pick the batch)

1. **Contained UI bugs (D):** Trex run order, page-scroll bound, doubling-hand
   above-hand slot, recap button. Unambiguous, high annoyance, no protocol work.
2. **Forward-the-prop (B) + local event-stream (A-local):** sounds, haptics,
   trick-pause, last-trick, presence, turn ring, share chip — big felt payoff,
   mostly wiring, local first.
3. **Online event stream (A-online):** the real protocol work — add
   `trix.played`/`trix.trickEnd` (or snapshot-diff), so online gets the pause /
   sounds / last-trick too.
4. **Emotes (C)** and **i18n (D)**: parallel, independent.
5. **Hook-orchestration (E):** spectator/claim/reconnect-AFK/join-by-code — the
   heavier online-robustness batch.

Until this matrix is green, "Play online" should carry a **beta** marker so
friends aren't surprised by these edges.
