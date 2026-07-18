# Trix and Trix Complex: Rules Specification and Implementation Plan

Status: **DRAFT PLAN, awaiting your sign-off.** No code is written yet. The
rules below are a first draft from public sources ([pagat](https://www.pagat.com/compendium/trex.html),
[Wikipedia](https://en.wikipedia.org/wiki/Trex_(card_game))) and are almost
certainly not your exact regional variant. Section 3 is the list of things I
need you to confirm or correct before Phase 1 starts. Treat everything else as
provisional until then.

This document mirrors the structure of `SPEC.md` (Leekha) on purpose: same 18
sections, same build discipline (engine → local UI → server → bots online →
polish), same "decide the defaults up front" habit.

---

## 1. Background research

Trix (also Trex, تركس) is a compound trick-avoidance-plus-layout game popular
across the Levant and Gulf (Syria, Lebanon, Jordan, Palestine, Egypt, Gulf
states).

**Correction (v1, from the domain owner).** An earlier draft of this plan called
Trix "individual, not partnership." That was wrong. Trix is played **both** ways,
and **partnership is the more common form** in practice: partners sit opposite
(two teams of two, exactly like Leekha's 0,2 vs 1,3), and the two partners'
individual scores are **combined into a team total** at the end. Jawaker, the
dominant regional platform, ships four first-class modes: Trix, Trix Partner,
Trix Complex, Trix Complex Partner. So the real variant grid is:

|            | Solo (individual) | Partner (teams of 2) |
|------------|-------------------|----------------------|
| Simple     | Trix              | Trix Partner         |
| Complex    | Trix Complex      | Trix Complex Partner |

The per-contract play and scoring are the same across solo/partner; partnership
only changes (a) that scores are summed per team and (b) strategy becomes
cooperative (you eat a penalty to spare your partner a worse one, you help your
partner empty their hand in Trex). **This is good news for the architecture**:
Leekha's team model, team-aware `SeatView`, and team-aware bots are directly
reusable, not something to purge (see the correction in Section 8).

A full game is a set of **kingdoms**. Whoever is dealt the 7♥ owns the first
kingdom, deals five hands, and picks a different **contract** for each. Kingdom
ownership then rotates around the table; after four kingdoms (20 deals) every
player has chosen every contract once and the game ends. Because the five
contracts sum to zero, every kingdom and the whole game net to zero points.

**Trix Complex** is a variant, not a different game: the kingdom owner may
combine two or more of the four trick-taking contracts into a single deal
(scoring all of them at once), which shortens the kingdom. Public sources note
it "increases the luck factor" and one calls it "not recommended" — flagging
that honestly (see Section 3, decision D2).

### What still needs confirming (you are the domain authority)
You built the Idlib variant of Leekha, so I am assuming you know Trix better
than any web source. Likely regional differences to pin down: exact per-card
and per-trick scores, whether doubling ("kaboot"/exposing) is standard or
optional, kingdom rotation direction, the Trex layout start card and pass
rules, and the Complex combination and scoring rules.

## 2. Terminology
- **Kingdom (مملكة):** the block of deals owned by one player, who deals and
  chooses the contracts.
- **Contract (مشروع):** one of the five sub-games the kingdom owner picks.
- **Trick contracts:** the four avoidance games (King of Hearts, Diamonds,
  Queens, Slaps). Standard trick-taking, follow suit, high card of led suit wins.
- **Trex / layout contract:** the non-trick game (Fan Tan / Card Dominoes).
- **Doubling / exposing:** revealing a King of Hearts or a Queen before the
  first lead to raise its stakes.
- **Complex:** the variant that combines trick contracts in one deal.

## 3. Decisions to confirm before Phase 1 ends
These change the engine's rules config (Trix's equivalent of Leekha's Section 3).
Nothing is hardcoded until you confirm.

- **D0 — Variants and picker. DECIDED: two cards plus a solo/partner toggle.**
  The picker shows **Trix** and **Trix Complex**; each carries a solo/partner
  switch that **defaults to partner** (the usual way). This covers all four
  Jawaker-style modes with two cards. The engine handles both via a
  `partnership` flag in `TrixRulesConfig`; Complex adds its combine options.
- **D1 — Ruleset accuracy.** Confirm/correct the Section 4 scoring table and
  contract rules to your regional version. Also confirm partnership scoring is a
  simple sum of the two partners' totals (what the sources say) rather than a
  worse-of-two or other rule.
- **D2 — Complex modeling. DECIDED: separate picker entry.** The start screen
  shows three choices: Leekha, Trix, Trix Complex. Implementation note so this
  stays clean: both Trix and Trix Complex run the **same `packages/trix` engine**
  differing only by a `complex: true` flag in `TrixRulesConfig`; the picker just
  presents them as two cards. So "separate entry" is a UX decision, not a second
  engine. (Still open: do you want Complex available from launch, or Trix first
  then Complex added in Phase 7? See D2b below.)
- **D2b — Complex at launch or later?** pagat flags Complex as luck-heavy. The
  build plan puts Complex/doubling in Phase 7 regardless; confirm whether the
  Trix Complex picker entry ships at launch or arrives with Phase 7.
- **D3 — Doubling.** On by default, optional, or off? Same for whether both
  King of Hearts and Queens can be doubled.
- **D4 — Kingdom rotation.** Direction (pagat says counter-clockwise / to the
  right) and whether the 7♥ rule for the very first kingdom is how you play it.
- **D5 — Contract free choice vs fixed order.** pagat lets the owner pick any
  unused contract each deal; confirm.
- **D6 — Trex specifics.** Layout starts on jacks, grows up to A and down to 2
  per suit; forced to play if able, else pass; redeal on four-twos. Confirm the
  start card and the redeal rule.
- **D7 — Match length. DECIDED: fixed 20 deals (four kingdoms).** Every player
  owns one kingdom and chooses every contract once; game ends after 20 deals.
  Keeps the zero-sum property clean.
- **D8 — Timers, AFK-to-bot, reconnect.** Reuse Leekha's exact policy? (Default: yes.)

## 4. Complete rules specification (v0 draft, confirm in D1)
Four players, standard 52-card deck, no jokers. Ranking A(high) down to 2.
Deal 13 each. Kingdom owner deals and leads (for trick contracts).

### 4.1 Trick contracts (avoidance; follow suit, high card of led suit wins)
| Contract | Arabic | Penalized | Per unit | Total |
|---|---|---|---|---|
| King of Hearts | شيخ الكوبة | taking K♥ | −75 | −75 |
| Diamonds | ديناري | each diamond taken | −10 | −130 |
| Queens | بنات | each queen taken | −25 | −100 |
| Slaps (tricks) | لطوش | each trick taken | −15 | −195 |

Special: in King of Hearts you may not lead a heart unless your hand is all
hearts. (Confirm whether Diamonds has an analogous lead restriction.)

### 4.2 Trex (layout contract, +500 total)
Not trick-taking. Owner leads. On your turn you must play if you can, else
pass. Legal plays: any jack, or a card one rank above or below a card already
on the layout in that suit. Each suit builds up from J→A and down from J→2.
Finishing order pays **+200 / +150 / +100 / +50** to 1st/2nd/3rd/4th out.
Redeal if a player holds four 2s (or three 2s + the 3 of the fourth suit).

### 4.3 Doubling (D3)
Before the first lead, the K♥ holder (King of Hearts contract) or any queen
holder (Queens contract) may expose the card to double its stakes, with a bonus
to the exposer. Exact +/− values in Section 4.1 doubled, per pagat; confirm.

### 4.4 Complex (D2b)
Kingdom owner declares two or more trick contracts for one deal; all their
penalties score together that deal; the kingdom shrinks by the number combined.
Trex and (typically) King of Hearts interactions to confirm.

### 4.5 Partnership scoring (D0/D1)
When `partnership` is on, partners sit opposite (teams {0,2} and {1,3}). Each
contract is played and scored per seat exactly as in 4.1–4.4, then the two
partners' totals are **summed into a team total** (per the sources). Play does
not change mechanically, but strategy becomes cooperative: a player may
deliberately eat a penalty to spare their partner a worse one, and in Trex help
their partner empty first for the higher finish bonus. The kingdom/contract
selection still rotates by seat (each of the four players still owns a kingdom
and picks contracts); confirm whether partners coordinate contract choice.

## 5. Why this is strategically deep
Each contract inverts the others: you dump high cards in avoidance games but
hoard sequence-enablers in Trex; the kingdom owner's contract-ordering is itself
a strategic layer (save the game you are strong in for when opponents are
loaded). Individual scoring means shifting, implicit alliances against the
current leader. Good bot targets.

## 6. Product scope
**MVP:** both games live in one web app; a game picker at the start; Trix with
all five contracts, kingdom rotation, full 20-deal match, local vs bots, then
online multiplayer, then bots online. Complex and doubling layered last.
**Out of MVP (parking lot):** ranked/ELO, tournaments, per-contract stats
dashboards beyond the existing telemetry's `game` dimension.

## 7. UX specification (portrait phone first, matches Leekha)
- **7.1 Game picker** — new entry screen with three cards: **Leekha, Trix,
  Trix Complex** (D2). Trix and Trix Complex each expose a **solo/partner
  toggle** (default partner, D0) and Complex its combine options; both create
  Trix rooms with the appropriate `TrixRulesConfig`. This is the one new
  top-level screen.
- **7.2 Contract selection** — when you own the kingdom, a sheet to pick the
  contract (and, in Complex, multi-select trick contracts).
- **7.3 Trick-contract table** — reuses Leekha's trick-circle table almost
  verbatim, minus partnership coloring, plus a per-contract penalty tally
  (diamonds/queens/tricks captured in front of each player) and a contract
  banner.
- **7.4 Trex board** — a genuinely new layout: four suit columns each showing
  the J→A up-run and J→2 down-run, a "pass" affordance when you cannot play,
  and finish-order badges. This is its own design task, not a reskin.
- **7.5 Scores** — individual running totals, kingdom progress (which contracts
  each owner has spent), and end-of-game standings.
- Localization (Arabic/RTL), sound, haptics, install banner: reuse Leekha's.

## 8. System architecture
Guiding principle (per review): **protect the deployed Leekha; do not
generalize or refactor its engine.** Two structurally different games is too few
to design a good abstraction, and Leekha is live.

- **8.1 New `packages/trix` engine** — pure, framework-free, zero runtime deps,
  same rules as Leekha's engine package. It **duplicates** the ~30 lines of
  genuinely shared primitives (`Card`/`Suit`/`Rank`, `makeDeck`, seeded RNG,
  seat rotation) rather than sharing them. No shared "trick mechanics" package:
  Leekha's trick logic is wound through undercut/forced-Leekha rules and Trix's
  contracts have their own (can't-lead-hearts), so sharing would couple them.
  Revisit a shared `@core` package only if a third game appears.
- **8.2 The one place we touch live Leekha: a `gameType` discriminator** in
  protocol, server, and web. It must be **purely additive** — Leekha's existing
  message shapes, room path, and `GameTable` stay byte-for-byte on the
  `'leekha'` branch; Trix is a new branch of a discriminated union. This is the
  integration risk to guard (a regression here breaks the live game), so it gets
  its own careful step and re-runs Leekha's full test + sim suite unchanged.
- **8.3 `packages/trix-bots`** — separate from Leekha bots, consumes only a
  Trix `SeatView`. The no-cheating and no-`MatchState` guards get Trix analogs.
- **8.4 Web** — a `packages/... ` game-agnostic shell (picker, lobby, seating,
  connection UI) with per-game table components (`LeekhaTable` = today's
  `GameTable`, new `TrixTrickTable`, new `TrixLayoutBoard`).
- **8.5 Team model is REUSED, not purged (corrected).** An earlier draft said
  to purge team assumptions because "Trix is individual." That was wrong: Trix is
  usually partnership, with the same opposite-seat teams as Leekha. So the Trix
  engine carries a `partnership` flag; when true, team = seats {0,2} and {1,3}
  and the two partners' contract scores sum to a team total; when false, each
  seat scores alone. The shared shell must support **both** an individual and a
  team scoring view, driven by that flag, rather than assuming either. The
  `SeatView` still never leaks a partner's hidden hand (same discipline as
  Leekha) even though partners cooperate.

## 9. Data model and engine API
- **Trix `MatchState`** (server-only, never on the wire): kingdom owner, deals
  played, per-owner contracts spent, current contract(s), phase
  (`selecting | playing | layout | scoring | done`), per-player hands, captured
  penalty piles, layout state (for Trex), running individual scores, seed,
  move log.
- **Trix `SeatView`** (the only thing clients/bots see): your hand, current
  contract, legal moves for this contract (trick-legal cards, or layout-legal
  cards + pass), visible captured piles, the layout, individual scores, kingdom
  progress. No hidden state crosses the wire (same discipline as Leekha).
- **Engine API** (pure, no I/O/timers): `newMatch`, `startKingdom`,
  `chooseContract`, `playCard` (trick), `playLayout`/`passLayout` (Trex),
  `expose` (doubling), `viewFor`, per-contract legal-move functions, scoring
  functions per contract. Every Section 3 decision lives in a `TrixRulesConfig`.

## 10. Network protocol
Additive discriminated union on `gameType`. Reuse Leekha's room/seat/lobby
messages unchanged; add Trix-specific game messages (`trix.chooseContract`,
`trix.play`, `trix.layoutPlay`, `trix.pass`, `trix.expose`) and Trix snapshot
messages. `room.create` gains a `game` field (`'leekha' | 'trix'`) and Trix
gains its options (Complex, doubling) the way Leekha rooms carry `RulesConfig`.

## 11–12. Room lifecycle, timers, disconnects
The server's seat/connection/AFK/spectator/reconnect machinery is already
mostly game-agnostic and is reused. What is game-specific is the phase machine
(Trix's selecting → playing/layout → scoring → next deal → next kingdom). Model
Trix's phases behind the same room interface so timers and AFK-to-bot reuse
Leekha's policy (D8).

## 13. Bot AI design
Scoped honestly: this is roughly the whole Leekha bot effort again, times the
contract variety.
- One **trick-avoidance policy** parameterized by the active contract's scoring
  function (dump the penalized cards, duck tricks, count what is out) covers all
  four trick contracts plus Complex combinations.
- A separate **Trex layout policy** (very different: manage sequence enablers,
  block opponents, race to empty). Its own mini-AI.
- A **contract-selection policy** for when the bot owns the kingdom.
- **Partner-aware play** when `partnership` is on: the same cooperative logic
  Leekha's bots already use (read the partner's likely holdings, sacrifice for a
  partner in danger). Reuse Leekha's team-aware inference patterns rather than
  reinventing them.
- Tiers mirror Leekha (heuristic easy/medium, determinized search hard). An
  Oracle/cheating tier is optional later.

## 14. Testing and simulation
- Per-contract unit tests (scoring correctness is the whole game).
- The **zero-sum invariant**: every deal and kingdom nets to zero — a powerful
  property test that catches most scoring bugs.
- `pnpm sim` self-play soak for Trix (rounds, contract-choice distribution,
  finish-order fairness in Trex, per-seat symmetry).
- Leekha's existing suites must stay green throughout (the gameType change is
  the thing that could regress them).

## 15. Build plan (phased; risky/weird parts last)
- **Phase 0 — research + decisions.** Lock Section 3 with you. Optionally run
  the deep-research skill for a cited rules confirmation. Write the confirmed
  ruleset into this file.
- **Phase 1 — trick-avoidance engine.** One trick engine parameterized by a
  scoring function; all four avoidance contracts; zero-sum tests; `pnpm sim`.
- **Phase 2 — Trex layout engine + board.** The Fan Tan engine and the new
  board UI. Its own phase because it is its own mini-project.
- **Phase 3 — kingdom/contract meta + full match.** Contract selection, kingdom
  rotation, 20-deal match, individual scoring, end-of-game standings. Local vs
  bots playable end to end.
- **Phase 4 — the gameType shell + game picker.** The additive protocol/server/
  web discriminator; Leekha suites re-run unchanged; both games selectable.
- **Phase 5 — online multiplayer for Trix**, reusing the room machinery.
- **Phase 6 — bots online**, per Section 13.
- **Phase 7 — Complex + doubling.** The combinatorial/luck layer, on top of
  proven cores.
- **Phase 8 — polish, telemetry `game` dimension, launch.** Admin match records
  and the picker gain a game filter.

### Repository layout (additive)
```
packages/engine      (Leekha, untouched)
packages/bots        (Leekha bots, untouched)
packages/trix        (new: pure Trix engine)
packages/trix-bots   (new: Trix bots)
packages/protocol    (extended: gameType union, additive)
apps/server          (extended: gameType-aware rooms, additive)
apps/web             (extended: game picker + per-game tables)
tools/sim            (extended: trix duel/soak)
```

## 16. Risks and honest concerns
- **This is plausibly bigger than Leekha**, not a reskin: a whole second engine,
  a non-trick layout game with its own board and AI, a compound match meta, and
  the Complex/doubling layer.
- **The gameType discriminator is the one way to break the live game.** Kept
  additive and guarded by re-running Leekha's suites.
- **Rules accuracy is make-or-break** (as with Leekha) and depends on your D1
  corrections, not on web sources.
- **Bot quality for five different contracts** is a large, easily-underestimated
  effort.
- **Complex increases luck** and may not be worth flagship status (D2).

## 17. Future parking lot
Ranked play, tournaments, Trix-specific stats, an Oracle/cheating Trix tier,
more regional Trix variants as `TrixRulesConfig` presets.

## 18. Sources consulted
- pagat.com — Trix/Trex rules: https://www.pagat.com/compendium/trex.html
- Wikipedia — Trex (card game): https://en.wikipedia.org/wiki/Trex_(card_game)
- (Phase 0 will add a cited, verified rules confirmation and, above all, your
  corrections.)
