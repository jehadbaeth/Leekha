# Leekha (Idlib Variant): Rules Specification and Implementation Plan

Version 1.1 (adds the undercut rule and dealer selection by biggest eater; both are pinned down in Section 3 items 12 and 13). This document is the single source of truth for building an online, four player version of Idlibi Leekha. It is written to be dropped into a repository as `SPEC.md` and consumed by Claude Code phase by phase. It contains: verified background on the base game, the complete rules of the Idlib variant with every edge case pinned down, open questions with chosen defaults (so nothing blocks implementation), a UX specification, the system architecture, the multiplayer and bot design, a testing plan, and a phased build plan.

---

## 1. Background research

Leekha (also spelled Likha, Arabic: ليخة) is a Middle Eastern trick avoidance game of the Hearts family, popular in Lebanon, Syria, Egypt and the Gulf. The documented Levantine partnership version works like this: play is anticlockwise, suit must be followed if possible, and the named "likha" cards are the Queen of Spades (13 points) and the 10 of Diamonds (10 points), with every heart worth 1 point. A player who cannot follow suit and holds a likha card must play one of them; holding both at once even has a name, "talyeekh". Scores are kept per individual player, but the game is a partnership: the team of the first player to individually reach the target loses, and if players from both teams cross the target in the same deal, the one with the higher score loses. The traditional target is 101, and taking all the penalty cards is punished (a 37 point penalty in the Lebanese version), not rewarded as in American Hearts.

Popular online implementations (for example Jawaker) confirm the play conventions: the player to the dealer's right leads the first trick with any card, the winner of each trick leads the next, the round always plays out to the last card even if someone crosses the target mid round, and some versions alternate the passing direction between right and left each round or add a doubling mechanic where the Q♠ or 10♦ can be exposed after the pass to double their value.

### What the Idlib variant changes

1. A third Leekha card is added: the King of Clubs, worth 14 points. It is part of the forced discard rule like the other two. Total penalty points per round become 50 (13 hearts + 10 + 13 + 14) instead of 36.
2. The target is 201 instead of 101.
3. Passing is always to the right, every round (no alternation).
4. The undercut rule: once a Leekha card lies on the current trick, every later player must play a card of lower rank than it whenever they hold one. Section 4.6 pins down the exact reading.
5. Dealer selection: from the second round on, the player who ate the most points in the previous round deals. On a tie, the tied player who ate the K♣ deals. Since the opening lead belongs to the seat at the dealer's right, which is always an opponent, eating big hands the other team the first lead of the next round.
6. **Forced talyeekh strengthens the base rule.** The documented base game only forces a Leekha card out when a player is void of the led suit (see Section 1's "talyeekh" definition). The Idlib variant goes further: if a player holds the led suit's own Leekha card (10♦ on a diamond lead, Q♠ on a spade lead, K♣ on a club lead), that card must be played immediately, even if the player holds other cards of that suit they could have followed with instead. Leading a suit that has a Leekha card in it therefore guarantees that card is surrendered on that very trick, by the holder if they can follow, or by whoever is void and forced to dump cross suit otherwise. This does not change the void-side forced dump rule at all; it only removes the choice to "hide" a Leekha behind other cards of its own suit.

Neither of the last three rules appears in any documented source consulted; all three come from the project owner and are marked as Idlib specific. Everything else carries over from the documented base game unless a decision in Section 3 says otherwise.

### Why the K♣ addition matters

The King of Clubs is the second highest club. Only the Ace of Clubs beats it. A player forced to follow a club lead with K♣ eats 14 points unless the A♣ lands on the same trick. That makes K♣ meaningfully nastier than Q♠ (which hides under both A♠ and K♠) and turns the A♣ into a hunting weapon. Expect the Idlib version to be bloodier and swingier than the Lebanese one. This is intended flavor, and Section 14 explains how simulation will verify it does not degenerate.

---

## 2. Terminology used in this document

* **Leekha cards**: 10♦, Q♠, K♣. Hearts are penalty cards but are not Leekha cards.
* **Eating**: winning a trick that contains penalty cards. The winner's round total increases by those points.
* **Forced dump**: the rule that a player void in the led suit who holds any Leekha card must play one.
* **Forced talyeekh (Idlib addition)**: a player who holds the led suit's own Leekha card must play it immediately when that suit is led, even if other cards of that suit are available to follow with instead.
* **Busting**: reaching a cumulative score of 201 or more at the end of a round.
* **Chasing / smoking out**: deliberately leading suits to force a known Leekha holder to release the card.
* **Sacrifice**: the healthier partner deliberately winning a pointed trick to protect a partner near 201.
* **Undercut**: the obligation, once a Leekha card lies on the current trick, to play a card of lower rank than it when possible.
* **Seats**: numbered 0 to 3. Seat 0 is South (the local player on screen), 1 East, 2 North, 3 West. Team A is seats 0 and 2, Team B is seats 1 and 3. Turn order proceeds anticlockwise.

---

## 3. Decisions and defaults (confirm these before Phase 1 ends)

Every rule below is implemented behind a config flag, so changing an answer later is a one line change, not a rewrite. The default is what ships if you say nothing.

1. **Direction of play.** Default: anticlockwise (to the right), matching the documented base game and matching the pass direction. Note the consequence: the player you pass 3 cards to acts immediately after you in every trick. If Idlib actually plays clockwise, the chase dynamics change, so confirm this one first.
2. **First lead.** Default: the player to the dealer's right leads trick 1 and may lead any card. No "2 of clubs opens" rule, no restriction on leading hearts at any point in the round.
3. **First trick.** Default: no special protections. The forced dump applies from trick 1 and penalty cards may land on trick 1.
4. **Bust threshold.** Default: a cumulative score of exactly 201 counts as busted (the check is score ≥ 201). No special rule for landing on exactly 201 (some families play reset or halving rules on exact numbers; say so if Idlib does).
5. **Bust timing and resolution.** Default: the round always plays out all 13 tricks. Scores are tallied at round end. If one or more players are at 201 or more: the team containing the player with the highest score loses. If the highest busted scores on opposing teams are exactly equal, compare team totals; if still equal, play one more round as sudden death. (The cross team tie rule, higher score loses, is documented in the base game.)
6. **Eating all 50.** Default: nothing special happens, the eater simply scores 50. The Lebanese base game punishes a moon shot with 37; if Idlib has an analog (for example 51), it slots into the config as `moonRule`.
7. **Passing restrictions.** Default: none. Any 3 cards may be passed, including Leekha cards and hearts. (One popular app forbids passing the last card of a suit; assumed not an Idlib rule.)
8. **Multiple Leekha cards when forced.** Default: the holder chooses which one to dump. This matches the documented base rule.
9. **Hearts and the forced rule.** Default: hearts are never forced. A void player with no Leekha cards may discard anything, including any heart.
10. **Match structure.** Default: the match ends at the first bust. Rematch resets scores and keeps seats. Target score is configurable per room: 101 (quick), 151, 201 (classic Idlib default).
11. **Platform.** Default: a mobile first web app (installable PWA), playable on desktop too. Native store wrappers can come later via Capacitor. Reason: a shareable room link is the single biggest growth lever for a niche community game.
12. **Undercut reading.** The rule as spoken is "once a Leekha is played, everyone after must play a lower card unless they have nothing lower". Default reading: lower means strictly lower in rank than the highest Leekha currently on the trick, and the constraint filters whichever legal set already applies, either the follow suit cards or the forced Leekha dump choice. It does not bind a free discard by a void player holding no Leekha (that card cannot win the trick anyway), and tricks containing hearts but no Leekha card do not trigger it. Two alternative readings worth checking at a real table, each one config value away: (a) lower means below the current winning card of the led suit, which outlaws every mid trick rescue outright; (b) the constraint also binds free discards, which stops players from ditching dangerous high cards on Leekha tricks.
13. **Dealer tiebreak cascade and the first deal.** The K♣ eater deals on a points tie. If the tied players do not include the K♣ eater, default cascade: the Q♠ eater among them, then the 10♦ eater, then the tied seat closest to the previous dealer's right. The first round of every match and every rematch uses a random dealer.

---

## 4. Complete rules specification (v1.1, defaults applied)

### 4.1 Players, deck, direction

1. Four players in two fixed partnerships, partners seated opposite each other.
2. Standard 52 card deck, no jokers. Ranks from high to low: A K Q J 10 9 8 7 6 5 4 3 2. No trump suit.
3. All rotation (dealing, passing, turn order) is anticlockwise, meaning toward each player's right.

### 4.2 Objective

Avoid eating penalty points. Each player keeps an individual cumulative score across rounds. A team loses the match the moment either of its members ends a round at 201 points or more. The other team wins.

### 4.3 Penalty values

1. Each heart: 1 point (13 total).
2. 10♦: 10 points.
3. Q♠: 13 points.
4. K♣: 14 points.
5. Exactly 50 points exist per round. The engine asserts this after every round.

### 4.4 The deal

1. The first dealer of a match is chosen at random.
2. From the second round on, the dealer is the player who ate the most points in the previous round. On a tie, the tied player who ate the K♣ deals; if the K♣ eater is not among the tied, the cascade from Section 3 item 13 applies.
3. Consequence worth naming: the opening lead belongs to the seat at the dealer's right, which is always on the opposing team, so the round's biggest eater hands the other team the first lead. Idlib players treat that lead as a signaling channel (Section 5). The dealer does play last to the first trick, a small positional consolation.
4. The server shuffles with a cryptographic RNG and deals 13 cards to each player. (Physical table rituals like cutting are not modeled.)

### 4.5 The pass

1. After looking at their hand, each player secretly selects exactly 3 cards to give to the player on their right.
2. Selections are committed before anyone sees incoming cards; you can never pass a card you are about to receive.
3. When all four players have committed, each player receives the 3 cards from their left and holds 13 cards again.
4. There are no restrictions on which cards may be passed.
5. Strategic consequence worth stating explicitly, because both the UI and the bots use it: you have perfect knowledge of 3 cards in your right hand opponent's hand (until they are played), and your left hand opponent has the same knowledge about you. Since play also proceeds to the right, the player whose cards you know acts immediately after you.

### 4.6 Trick play

1. The player to the dealer's right leads the first trick with any card.
2. Play proceeds anticlockwise; each player plays exactly one card per trick.
3. Following: a player holding one or more cards of the led suit must play one of them. Exception: if the led suit's own Leekha card (10♦ for diamonds, Q♠ for spades, K♣ for clubs) is among them, forced talyeekh (rule 3a) applies and removes the free choice.
3a. Forced talyeekh on a follow: if the cards a player could follow with include the led suit's own Leekha card, that Leekha card must be played; the player may not follow with a different card of that suit instead. There is at most one such card per suit, so no further choice arises here (unlike rule 4).
4. Void with Leekha (the forced dump): a player holding no cards of the led suit who holds at least one Leekha card (10♦, Q♠, K♣) must play a Leekha card. If they hold more than one, they choose which, subject to rule 6. This rule binds partners and opponents equally.
5. Void without Leekha: the player may discard any card. Rule 6 does not constrain these discards.
6. The undercut rule: from the moment a Leekha card lies on the current trick, every later player must play a card of strictly lower rank than the highest Leekha on the trick, chosen from whatever set rules 3 to 5 give them. If that set contains no such card, the constraint lifts and any card from the set may be played. Concrete cases: a follower whose cards of the led suit all outrank the Leekha simply plays one and usually eats the trick; a forced dumper holding 10♦ and K♣ while the Q♠ lies on the trick must dump the 10♦; a trick containing hearts but no Leekha card triggers nothing.
7. The trick is won by the highest ranked card of the led suit. Off suit cards, including dumped Leekha cards, can never win a trick.
8. The trick winner collects the trick face down, adds any penalty points in it to their round total, and leads the next trick.
9. A round is 13 tricks; every card is played exactly once.

Notes that fall out of the rules and must hold in the engine:

* A Leekha card cannot be hidden behind other cards of its own suit: a lead of its suit forces it out via rule 3a even while its holder has other legal followers, and a void holder is forced to dump it cross suit via rule 4. Either way, leading a suit that contains a live Leekha card guarantees that card is surrendered on that trick.
* Two or even three players can be forced on the same trick, so a single trick can contain Q♠ and K♣ and hearts at once.
* The forced dump can land on a trick the dumper's own partner is winning. This is the intended cruelty of the format, and rule 3a's forced follow is exactly as unforgiving: you cannot protect a partner who is winning by quietly following with a lower card of the suit instead of the Leekha.
* Public inference: everyone can see when a player fails to follow suit. If that player discards a non Leekha card, the whole table has proof they hold no Leekha cards. If they play a Leekha card while void, everyone knows it was forced (they may still hold another one). If a player follows suit with the suit's own Leekha card, that reveals nothing extra since rule 3a made it mandatory regardless of what else they held.
* The undercut rule makes the first Leekha on a trick sticky. Everyone behind it must duck beneath it, so it is eaten by whoever is winning when it lands, or by its own player when following suit forced it out. A deliberate rescue survives only in a narrow window: a card that beats the current winner while staying below the Leekha's rank. No such window exists while the Leekha itself is the highest card of the led suit on the table.
* The undercut rule creates a second public inference: any player who plays over a Leekha has proven they held nothing below it among their legal cards at that moment.

### 4.7 Scoring and match end

1. At the end of each round, each player adds the penalty points they ate to their cumulative score. Running totals are always public.
2. If no player is at 201 or more, the next dealer is selected per Section 4.4 (biggest eater, K♣ tiebreak) and the next round begins.
3. If one or more players are at 201 or more, the match ends. The losing team is the team of the highest scored busted player, with the tie handling from Section 3 item 5.
4. There is no bonus or penalty for eating everything (config: `moonRule: "none"`).

---

## 5. Why this ruleset is strategically deep (design rationale)

This section exists because the UX and the bots must serve these dynamics, not fight them.

1. **Holding a Leekha card is a timed liability, not a fixed cost.** You only eat its points if you win a trick containing it. Dumping it while void gives the points to whoever wins that trick, which can be great for you and terrible for your partner.
2. **Voids are double edged here.** In Hearts a void is pure gold. In Leekha, a void plus a Leekha card in hand is a bomb with a timer you do not control: the first off suit moment forces the dump whether or not your partner is winning the trick. Good players therefore sometimes keep a small "escape card" in every suit while carrying a Leekha card.
3. **The pass creates asymmetric perfect information.** Passing a Leekha card right means you can chase it for the rest of the round, and the receiver knows you can. Keeping it means risking rules 1 and 2. This tension is the heart of the pass decision.
4. **The K♣ duel changes shape under the undercut rule.** Low club leads while the king is unseen are daggers: a short suited holder forced to follow with the K♣ watches everyone behind duck beneath it and eats 14 on the spot. The A♣ is no longer a rescue weapon, because once the king lies on a club trick the ace is illegal for anyone still holding a lower club. The ace's value becomes personal insurance (with any lower club beside it, its holder can never be made to eat the king by following suit) plus early control of the club suit. The same logic protects spade length below the Q♠ and turns bare high spades into forced eaters.
5. **Team survival math dominates the endgame.** Because a team dies when either member busts, the effective team health is the maximum of the two members' scores. Late in a match the healthy partner should absorb points, but the undercut rule narrows mid trick rescues (Section 4.6), so protection flows mostly through the pass, through taking the lead in dangerous moments, and through absorbing heart tricks, which the undercut never constrains. The UI must make the danger states legible at a glance, and the bots must model all of it.
6. **Inference is public and rich.** Voids, forced plays, the "no Leekha" proof from rule 4.6, and the undercut proof (playing over a Leekha proves nothing lower was held) give strong hand reading material. This makes a hint system and a strong bot genuinely possible without any cheating.
7. **Eating big costs tempo, not just points.** The biggest eater deals, and the seat at the dealer's right, always an opponent, opens the next round. Punishment compounds: the suffering side keeps conceding the first lead. Idlib table culture treats that opening lead as a legal signal, announcing that a Leekha was just passed rightward or advertising the suit its owner is shortening in order to dump a Leekha later. Bots do not roleplay table talk, but Section 13 exploits the structural side of it, and the K♣ tiebreak is one more reason the king is the card nobody wants.

---

## 6. Product scope

### MVP (Phases 0 to 3)

1. Full Idlibi ruleset with config flags for every Section 3 decision.
2. Play instantly against 3 bots (offline capable once loaded).
3. Private online rooms with a 6 character code and share link, 1 to 4 humans, bots filling empty seats.
4. Disconnect handling: bot takeover with seat reclaim.
5. Turn timers with auto play on expiry.
6. English and Arabic (RTL) interfaces.
7. Round and match summaries, basic settings, rules screen.

### Explicitly out of MVP (parking lot in Section 16)

Accounts, rankings, matchmaking queues, doubling variants, spectators, replays UI, chat beyond emotes, native app store builds, tournaments.

---

## 7. UX specification

### 7.1 Screen inventory

1. **Home**: display name (guest, persisted locally), three primary actions: Play vs Bots, Create Room, Join Room (code field). Secondary: How to Play, Settings, language toggle (العربية / English).
2. **Lobby**: room code large and copyable, a share button that composes a join link (WhatsApp share prominent, it is the region's default), a miniature table showing 4 seats with team colors (seats 0 and 2 one color, 1 and 3 another), host controls to move players between seats, randomize seats, add or remove a bot per empty seat and pick its difficulty, and a rules panel (target score 101/151/201, timer lengths, optional variant toggles). Ready checkmarks per human; Start enables when all 4 seats are occupied and all humans are ready.
3. **Game table**: the core screen, specified below.
4. **Round summary overlay**: per player points eaten this round with icons for any Leekha cards eaten, updated cumulative totals with danger highlighting, a line naming the next dealer and why ("Khaled ate 21, Khaled deals"), and a countdown into the next round.
5. **Match end**: which team lost and who busted, totals, lightweight per player stats (points eaten, Leekhas eaten, tricks won), Rematch (same seats) and Back to Lobby.
6. **How to Play**: four short illustrated pages: the goal and the 4 penalty cards, the pass, the forced dump rule with one worked example, the team survival rule (either partner busting loses the match).
7. **Settings**: language, sound, haptics, card size, four color deck toggle, "confirm before playing a card" toggle, "auto play when only one legal card" toggle, reduced motion.

### 7.2 Game table anatomy (portrait phone is the primary layout)

```
              [ North: partner avatar, name, score ]
   [ West avatar ]        trick area           [ East avatar ]
      score            (up to 4 cards,            score
                        winner highlight)
              [ turn arrow showing anticlockwise ]
   [ HUD strip: trick 7/13 | target 201 | dealer chip | menu ]
   [ passed memo chip: "→ East: Q♠ 7♥ 2♦" (collapsible) ]
        [ your hand, 13 card fan, legal cards active ]
```

Desktop and landscape use the same topology with more breathing room. The local player is always at the bottom regardless of seat number.

### 7.3 Core interactions

1. **Playing a card**: tap to raise, tap again (or a Play button) to confirm. A settings toggle allows single tap for experienced players. Drag to the trick area also works. Misplays are the number one rage source in card apps; default to two step confirmation.
2. **Legality feedback**: illegal cards are dimmed and slightly lowered. Tapping a dimmed card shows a one line reason: "You must follow diamonds", "Leekha rule: you must play 10♦, Q♠ or K♣", or "Undercut rule: you must play below the Q♠". When the forced rule fires, the legal Leekha cards get a distinct pulsing outline, and when the undercut rule fires, the Leekha on the trick gets a small "play under" marker so the situation is unmistakable.
3. **Forced play visibility**: a card played under the forced rule renders with a small "forced" tag visible to all four players. This leaks nothing (the whole table can already deduce it) and teaches the rule.
4. **Passing phase**: banner "Pass 3 cards to [name] →" with the receiving avatar highlighted. Selected cards rise; a counter shows 0/3 to 3/3; Confirm locks in. While waiting, other avatars show progress ticks. On reveal, the 3 received cards slide into the fan highlighted for about 3 seconds.
5. **Passed memo**: a persistent, collapsible chip listing what you passed and to whom. Cards gray out in the memo once they appear on the table. This is information the player legitimately holds; surfacing it removes a pure memory burden without changing the game.
6. **Trick end**: hold the completed trick for about 900 ms, highlight the winning card, sweep the pile to the winner, and if points were eaten, fly "+N" chips to that player's score row. Q♠, K♣ and 10♦ get a distinct icon and sound sting so big moments feel big.
7. **Danger states**: any player within 30 points of the target gets a persistent red treatment on their score row. This makes the sacrifice dynamic visible to everyone, which is the point.
8. **Last trick**: a small button reopens the previous trick.
9. **Timers**: a ring around the active avatar. On expiry the server auto plays for that seat (see Section 12) and shows "auto played" briefly.
10. **Disconnects**: the avatar grays with a "reconnecting" ring for the grace period, then flips to a robot icon with "Bot is playing for Ali". When Ali returns, a Resume Seat button restores control instantly.
11. **Emotes**: 6 to 8 quick emotes and short preset phrases (localized). No free text chat in MVP: it is a moderation burden and, in a partnership game, a signaling channel.

### 7.4 Visual and audio direction

1. Clean tabletop feel, culturally neutral warm palette, high card legibility above all: oversized corner indices, optional four color deck.
2. Card designs must render crisply at 13 cards across a 360 px wide screen; use overlap fanning with a magnifier on touch and hold.
3. Distinct audio stings: card play, trick sweep, Leekha card eaten, bust, victory. All optional.

### 7.5 Localization and accessibility

1. Arabic and English at launch. Full RTL mirroring of chrome and text; the table geometry itself does not mirror (hand stays at the bottom, anticlockwise arrow stays correct). Use a font pairing that handles Arabic well (for example IBM Plex Sans Arabic or Cairo).
2. Numerals follow the locale with a settings override.
3. Accessibility: 44 px minimum touch targets, suit shapes never encoded by color alone, aria live announcements of plays ("East played the Queen of Spades, forced"), reduced motion mode, scalable card size.

---

## 8. System architecture

### 8.1 Shape of the system

```
apps/web (React PWA)  ⇄  WebSocket  ⇄  apps/server (Node, authoritative)
        │                                    │
        └────────── packages/protocol ───────┘   (zod schemas, shared types)
                     packages/engine              (pure rules, zero deps)
                     packages/bots                (heuristics + search, consumes engine views)
```

### 8.2 Stack choices and honest tradeoffs

1. **Client**: React 18 + TypeScript + Vite + Tailwind + framer motion (animations) + zustand (state) + socket.io client. Shipped as a PWA. Rationale: fastest iteration loop in Claude Code, no engine or canvas framework needed for a card table; DOM plus CSS transforms is plenty at this scale.
2. **Server**: Node 22 + TypeScript + socket.io + zod validation. Rooms live in memory in a single process, keyed by code. Rationale: a turn based 4 player game is tiny; one small instance handles thousands of concurrent tables. Do not build for scale that does not exist yet.
3. **Why authoritative server and not a realtime database (Firebase/Supabase)**: the game has hidden information and legality rules. Validation and redaction must run in a trusted process that owns timers. Doing that through database rules and edge functions is possible but awkward and slower to build correctly.
4. **Why not Colyseus**: it is a reasonable framework, but its state sync model sends full room state by default and per seat filtering is the fiddly part you would be relying on it for. A bespoke room manager over socket.io is roughly 300 lines and fully understood. If you strongly prefer batteries included, Colyseus is the fallback, and the engine package is framework agnostic either way.
5. **Persistence**: none required in MVP (a server restart kills in flight games; deploy during quiet hours). Phase 4 option: Redis snapshots per room keyed by code so matches survive restarts. Postgres only arrives with accounts, later.
6. **Deployment**: one Docker container that serves the built client and the WebSocket on the same origin, behind the platform's TLS (Fly.io, Railway, or a small VPS with Caddy). Same origin avoids CORS and cookie headaches.

### 8.3 Security and fairness

1. Server side shuffle with a cryptographic RNG; a per match seed plus the move log makes every game deterministic and replayable.
2. Clients only ever receive their own hand and public information. The redaction lives in one function (`viewFor`) with a dedicated test asserting no leakage.
3. Every incoming action is validated: correct room, correct seat token, that seat's turn, action in the legal set. Invalid actions get an error event and are dropped.
4. Rate limit socket messages per connection; cap rooms per IP.
5. Reconnection uses an opaque per seat token issued at sit down and stored in localStorage.
6. Unfixable by design: two partners on a phone call can signal. Every online partnership card game lives with this. The mitigation is product framing (friends and family first) and, much later, ranked modes with randomized partners.

---

## 9. Data model

Encoded here as TypeScript to be lifted directly into `packages/engine`.

```ts
export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = 2|3|4|5|6|7|8|9|10|11|12|13|14;   // 11 J, 12 Q, 13 K, 14 A
export interface Card { suit: Suit; rank: Rank }
export type Seat = 0 | 1 | 2 | 3;                     // teams: (0,2) vs (1,3)
export const partnerOf = (s: Seat): Seat => ((s + 2) % 4) as Seat;
export const nextSeat  = (s: Seat): Seat => ((s + 1) % 4) as Seat; // anticlockwise order

export interface RulesConfig {
  targetScore: number;                    // 201
  forcedLeekhaDiscard: boolean;           // true
  undercutRule: 'leekhaRank' | 'winningCard' | 'off';  // Idlib default 'leekhaRank'
  undercutBindsDiscards: boolean;         // false, see Section 3 item 12
  dealerSelection: 'biggestEater' | 'rotateRight';     // Idlib default 'biggestEater'
  leadRestrictions: 'none';               // reserved for variants
  moonRule: 'none' | 'penalty';           // Idlib default 'none'
  moonPenalty?: number;                   // Lebanese base uses 37 on a 36 point deck
  passDirection: 'right' | 'alternate';   // 'right'
  bustTieBreak: 'higherIndividual';
  timers: { passMs: number; playMs: number };
}

export const isLeekha = (c: Card) =>
  (c.suit === 'D' && c.rank === 10) ||
  (c.suit === 'S' && c.rank === 12) ||
  (c.suit === 'C' && c.rank === 13);

export const cardPoints = (c: Card): number =>
  c.suit === 'H' ? 1
  : c.suit === 'D' && c.rank === 10 ? 10
  : c.suit === 'S' && c.rank === 12 ? 13
  : c.suit === 'C' && c.rank === 13 ? 14
  : 0;

export interface TrickPlay { seat: Seat; card: Card; forced: boolean }
export interface TrickState { leader: Seat; plays: TrickPlay[] }

export type Phase = 'passing' | 'playing' | 'roundEnd' | 'gameOver';

export interface RoundState {
  hands: Card[][];                        // server only
  committedPasses: (Card[] | null)[];     // server only until all four commit
  trickNumber: number;                    // 1..13
  currentTrick: TrickState;
  playedCards: TrickPlay[][];             // completed tricks, public
  eatenPoints: [number, number, number, number];
  eatenCards: Card[][];                   // public, for UI icons
}

export interface MatchState {
  config: RulesConfig;
  scores: [number, number, number, number];  // cumulative, public
  dealer: Seat;
  roundIndex: number;
  phase: Phase;
  round: RoundState;
  seed: string;
  moveLog: LoggedAction[];                   // enables replay and audit
}

export interface SeatView {                  // the ONLY thing clients and bots see
  seat: Seat;
  hand: Card[];
  phase: Phase;
  dealer: Seat;
  roundIndex: number;
  trickNumber: number;
  currentTrick: TrickState;
  playedCards: TrickPlay[][];
  eatenPoints: [number, number, number, number];
  eatenCards: Card[][];
  scores: [number, number, number, number];
  youPassed: Card[] | null;                  // your own committed pass
  youReceived: Card[] | null;                // revealed after all commit
  legal: Card[] | null;                      // present only when it is your turn
  config: RulesConfig;
}
```

### Engine API (pure functions, no I/O, no timers)

```ts
newMatch(config: RulesConfig, seed: string): MatchState
startRound(m: MatchState): MatchState                    // deal, enter 'passing'
commitPass(m, seat, cards: Card[]): MatchState           // throws IllegalAction
legalPlays(m, seat): Card[]
playCard(m, seat, card): { state: MatchState; events: GameEvent[] }
viewFor(m, seat): SeatView
matchResult(m): { over: boolean; losingTeam?: 0|1; bustSeat?: Seat }
```

`legalPlays`, the rule that defines this game:

```ts
function legalPlaysFor(hand: Card[], trick: TrickState, cfg: RulesConfig): Card[] {
  if (trick.plays.length === 0) return hand;                   // any lead
  const led = trick.plays[0].card.suit;
  let base = hand.filter(c => c.suit === led);                 // must follow
  let freeDiscard = false;
  if (base.length === 0) {
    const leekha = hand.filter(isLeekha);
    if (cfg.forcedLeekhaDiscard && leekha.length > 0) {
      base = leekha;                                           // forced dump
    } else {
      base = hand; freeDiscard = true;                         // free discard
    }
  } else if (cfg.forcedLeekhaDiscard) {
    const leekhaOfSuit = base.filter(isLeekha);
    if (leekhaOfSuit.length > 0) base = leekhaOfSuit;           // forced talyeekh on a follow
  }
  const leekhasOnTrick = trick.plays.map(p => p.card).filter(isLeekha);
  const undercutApplies =
    cfg.undercutRule !== 'off' &&
    leekhasOnTrick.length > 0 &&
    (!freeDiscard || cfg.undercutBindsDiscards);
  if (undercutApplies) {
    const ceiling = cfg.undercutRule === 'leekhaRank'
      ? Math.max(...leekhasOnTrick.map(c => c.rank))
      : winningRank(trick, led);  // 'winningCard' variant: highest rank of the led suit so far
    const under = base.filter(c => c.rank < ceiling);
    if (under.length > 0) base = under;                        // "unless they have nothing lower"
  }
  return base;
}
```

Trick resolution: winner is the highest rank among plays whose suit equals the led suit; winner eats the sum of `cardPoints` over all four cards; winner leads next. After trick 13: add `eatenPoints` into `scores`, assert the round summed to exactly 50, run the bust check from Section 4.7, then either hand the deal to the round's biggest eater (K♣ tiebreak, Section 4.4) and start the next round, or end the match.

---

## 10. Network protocol

All messages are zod validated in `packages/protocol`. Every server message carries `roomCode` and a monotonically increasing `seq` per room.

### Client → server

1. `auth { name, seatToken? }`
2. `room.create { config } → ack { code, seatToken }`
3. `room.join { code } → ack { seatToken | error }`
4. `room.sit { seat }` · `room.addBot { seat, level }` · `room.removeBot { seat }`
5. `room.configure { config }` (host only, lobby only)
6. `room.ready { ready }` · `room.start` (host)
7. `game.pass { cards: [Card, Card, Card] }`
8. `game.play { card: Card }`
9. `game.resync { }` → server replies with a full `game.snapshot`
10. `room.leave` · `emote { id }`

### Server → client

1. `room.state { seats, config, hostSeat, readiness }` (lobby)
2. `game.snapshot { view: SeatView, seq }` (on start, join, and resync)
3. `game.dealt { hand, dealer, roundIndex }`
4. `game.passPrompt { deadline }` · `game.passProgress { seatsCommitted }`
5. `game.passReveal { received: Card[3] }`
6. `game.turn { seat, deadline }` plus, only to the acting seat, `legal: Card[]`
7. `game.played { seat, card, forced }`
8. `game.trickEnd { winner, points, cards }`
9. `game.roundEnd { eaten: number[4], totals: number[4] }`
10. `game.over { losingTeam, bustSeat, totals }`
11. `presence { seat, status: 'connected' | 'reconnecting' | 'bot' }`
12. `error { code, message }`

Reconnection: the client stores `seatToken` and on any socket (re)connect sends `auth` then `game.resync`. The server always answers with a full snapshot. Do not build event diffing in MVP; snapshots are small and always correct.

---

## 11. Server room lifecycle and state machine

```
LOBBY → (host starts, 4 seats filled) → ROUND_START(deal)
  → PASSING (await 4 commits, timer per seat)
  → PASS_REVEAL
  → TRICK n = 1..13: TURN(seat) → ... → TRICK_END
  → ROUND_END (tally, bust check)
       ├─ no bust → ROUND_START (dealer = biggest eater, K♣ tiebreak)
       └─ bust    → GAME_OVER → (rematch → ROUND_START with reset scores) | room GC
```

Room rules:

1. Rooms are garbage collected after 15 minutes idle in lobby or 5 minutes after game over.
2. The host role passes to the next human if the host leaves; a room with zero humans is destroyed.
3. Seat tokens survive room membership; a player who closed the tab can rejoin the room by code and reclaim their seat.

---

## 12. Timers, disconnects and bot takeover

1. Defaults: 45 s to pass, 25 s per card play. Both configurable per room, including "off" for living room play.
2. On timer expiry the server plays for that seat using the Easy bot policy (a single action, the seat stays human) and increments an AFK strike counter shown subtly on the avatar.
3. Two consecutive strikes, or a disconnect grace period of 15 s expiring, flips the seat to bot control at the seat's configured difficulty. The seat keeps the player's name with a robot badge.
4. A returning player reclaims the seat instantly with the resume button; control transfers at the next decision point.
5. Lobbies can start with any mix of humans and bots; a solo human with three bots is a first class mode, not a fallback.

---

## 13. Bot AI design

Two tiers ship in MVP. Both consume `SeatView` only, exactly what a human sees. Enforce this with a lint rule or a test that `packages/bots` never imports `MatchState`. Bots therefore cannot cheat by construction.

### 13.1 Shared inference tracker

A small module that folds public events into beliefs, used by both tiers and by the optional hint UI:

1. Remaining unseen cards (52 minus own hand minus table).
2. Known cards: the 3 you passed right remain assigned to that seat until seen on the table.
3. Void marks: seat X failed to follow suit Y at least once.
4. Leekha absence proofs: seat X was void and discarded a non Leekha card, therefore seat X holds no Leekha cards from that moment (minus any they later receive, which cannot happen mid round, so the proof is permanent for the round).
5. Danger board: each seat's cumulative score, distance to target, and this round's exposure.
6. Undercut proofs: a player who played over a Leekha held nothing below it among their legal cards at that moment; record the implied constraint (no led suit card below the ceiling, or no lower Leekha when the play was a forced dump).

### 13.2 Tier 1: heuristic policy (Easy and Medium)

**Passing.** Score each card, pass the top three:

* K♣: 95 if 2 or fewer lower clubs sit beside it, else 55. The undercut rule makes a short king nearly impossible to save.
* Q♠: 85 if 2 or fewer lower spades sit beside it, else 50.
* A♠ or K♠: 60 each when no lower spade accompanies them (the undercut rule turns bare honors into forced eaters of the queen), 15 when two or more lower spades do.
* A♥ K♥ Q♥: 30 each.
* 10♦: 35 (10 points but midrank, less lethal).
* A♣: keep while at least one lower club sits beside it (the undercut rule then makes eating the K♣ by following suit impossible, and the ace still controls the suit); pass it when bare.
* Void shaping: +25 to each card of a 1 or 2 card side suit, but subtract 20 from that bonus if the hand will still contain a Leekha card after the pass (a void plus a Leekha is a bomb that may hit the partner).
* Medium adds noise to these weights; Easy adds a lot.

**Play.** All rules choose from `legalPlays`, which already encodes following, forced dumps and the undercut filter; the lines below pick within that set. An ordered rule list, deliberately written so each line maps to one code branch:

1. If forced with multiple legal Leekha cards: if the projected trick winner is an opponent, dump the biggest (K♣ ≥ Q♠ ≥ 10♦); if the partner is currently winning, dump the smallest. Note that the undercut filter often removes this choice entirely.
2. If following a trick that already carries points, or a suit where a live Leekha may drop (spades while Q♠ unseen, clubs while K♣ unseen): play the highest card strictly below the current winning card ("duck high"); when the undercut rule leaves only winners in the legal set, win with the cheapest one.
3. If last to act on a clean trick and taking the lead is useful (next lead planned), win as cheaply as possible; otherwise duck.
4. Leading, in priority order: low clubs while K♣ is unseen and not yours, the strongest lead in the game since a short king cannot be rescued once it falls; low spades while Q♠ is unseen and not yours, for the same reason; chase a known Leekha holder by leading a suit they have shown void in when your partner has not shown weakness there; otherwise lead the lowest card of your longest safe suit.
5. Free discard (void, no Leekha): dump in order bare or nearly bare A♠ and K♠ (while Q♠ is live), high hearts, then the highest card of the most dangerous remaining suit. High honors guarded by plenty of lower cards are safer to keep under the undercut rule than they look.
6. Rescue and sacrifice module: if `partnerScore ≥ target − 30` and `myScore ≤ partnerScore − 40` (both tunable), absorb points where the rules allow: overtake pointed heart tricks the partner is winning with the cheapest winner, and on Leekha tricks use the narrow rescue window (beat the current winner while staying below the Leekha) whenever `legalPlays` contains such a card.
7. Endgame counting: with 4 or fewer tricks left, use the tracker's exact remaining card sets to detect certain winners and certain losers and route points accordingly.

### 13.3 Tier 2: determinized search (Hard)

1. Sample K plausible worlds (24 to 48): random assignments of the unseen cards to the three hidden hands, consistent with tracker constraints (hand sizes, known passed cards, voids, Leekha absence proofs). Rejection sample; fall back to constructive assignment if constraints get tight late in the round.
2. For each legal move, play each sampled world to the end of the round with the Tier 1 policy driving all four seats (flat Monte Carlo; upgrade path to ISMCTS if ever needed, it will not be for a long time).
3. Utility per rollout, from the acting team's perspective: heavily penalize any teammate bust, then minimize `max(teamScores)` distance dynamics, then round point differential. A simple shaped form: `u = 100·(oppBust − usBust) + (oppMaxScoreRisk − usMaxScoreRisk) + 0.1·(oppRoundPts − usRoundPts)`.
4. Pick the argmax of mean utility. Medium can reuse this with fewer samples and a temperature.
5. Budget: under 300 ms per decision inside a Node worker thread. At 13 card scale this is comfortable in TypeScript; no native code needed.

### 13.4 Presentation

Human pacing: 600 to 1800 ms randomized thinking delay, slightly longer on forced dumps and endgame decisions, so bot seats feel like players rather than instant oracles.

---

## 14. Testing and simulation plan

1. **Unit tests, engine (vitest).** Named scenarios, at minimum: must follow suit; leader may lead anything including hearts on trick 1; forced dump with exactly one Leekha; forced dump choice among two and three; forced dump fires on trick 1; void with no Leekha may discard anything; Q♠ is forced (talyeekh) when following a spade lead even with other spades in hand; a forced talyeekh follow is tagged `forced` while a plain follow of the same suit is not; off suit cards never win; K♣ eaten by following a club lead under the A♣; two players forced on the same trick; winner receives the sum of all points in the trick. Undercut scenarios: a follower must duck beneath a Leekha on the trick; a follower whose led suit cards all outrank it plays over and wins; a forced dumper must pick the Leekha below the trick's highest Leekha; a free discard stays unconstrained; a heart only trick triggers no undercut; with two Leekha cards on the trick the highest one sets the ceiling.
2. **Scoring tests.** Round total is exactly 50; bust at exactly 201; both teams crossing with the higher individual losing; equal cross team busts falling through to team totals then sudden death; same team double bust. Dealer selection: biggest eater deals; the K♣ eater breaks a points tie; the cascade fires when the K♣ eater is not among the tied; the first deal of every match is random.
3. **Property tests (fast check).** For thousands of randomly seeded rounds with random legal play: every card played exactly once; every applied move was in `legalPlays`; eaten totals always sum to 50; `viewFor(seat)` serialized never contains another seat's hand or an uncommitted pass.
4. **Self play soak.** `pnpm sim --matches 2000` runs bot matches headlessly and prints: rounds per match distribution, mean and p90 match length at realistic pacing, forced dump frequency per round, how often a forced dump lands on the dumper's partner's trick, K♣ eater identity distribution (holder after pass vs others), and win rate by seat (must be symmetric, an asymmetry means an engine bug), how often the undercut rule forces a Leekha back onto the player who played it, and dealer streak lengths (how long one team keeps conceding the opening lead).
5. **Balance review from the soak, stated honestly in advance.** Two findings would deserve a design conversation with real Idlibi players rather than a silent fix: (a) if post pass K♣ holders eat it far more often than not, the meta collapses into "always pass K♣", which then makes the chase trivial because the receiver is always known; (b) if match length at 201 lands beyond roughly 90 minutes median online, the default target may need to be 151 for public rooms with 201 kept as the classic option. The simulator exists to answer both with numbers instead of vibes.
6. **Server integration tests.** Four scripted socket clients complete a match; a client is killed mid trick and resumes via token; a timeout produces an auto play; two timeouts produce a bot takeover and a later resume returns control.
7. **Manual UX checklist per phase**, phone first: pass flow, forced dump clarity, trick readability at speed, RTL layout, reconnect banner.

---

## 15. Build plan for Claude Code

Work strictly in phases; each has a definition of done that gates the next. Keep the engine pure and framework free from day one, it is the foundation everything else stands on.

### Phase 0: rules engine

Build `packages/engine` and `packages/protocol` with the API from Section 9, plus `tools/sim`. Definition of done: all Section 14 items 1 to 4 green; a match is fully reproducible from `(seed, moveLog)`; the soak prints its stats table.

Suggested prompt to Claude Code: "Implement packages/engine exactly per SPEC.md Sections 4 and 9, TypeScript, zero runtime dependencies, vitest tests per Section 14 items 1 to 3, then tools/sim per item 4. Do not build any UI or networking yet."

### Phase 1: local game against bots

Build `apps/web` running the engine in browser with three Tier 1 bots, implementing the full table UX of Section 7 (pass flow, forced dump treatment, trick animations, summaries, settings, rules screen). Definition of done: a complete match is pleasant to play on a 360 px wide phone browser; every Section 7.3 interaction exists.

This phase is deliberately before networking: rules feel and UX feel get iterated at zero latency, and the result already constitutes a shippable single player product.

### Phase 2: online multiplayer

Build `apps/server` with rooms, lobby, seat tokens, timers, snapshots and resync per Sections 10 to 12. The client gains Home and Lobby screens and swaps its local engine driver for a socket driver behind the same interface. Definition of done: two real devices plus two bots complete a match over the internet; killing and reopening a tab resumes the seat; timer expiry auto plays.

### Phase 3: bots as online citizens

Bot fill in lobbies, disconnect takeover and reclaim, Tier 2 bot in a worker thread with difficulty selection. Definition of done: one human against three Hard bots online feels like a game; a mid trick disconnect flips to bot within the grace window and reclaim works.

### Phase 4: polish and launch

Arabic with full RTL, sounds and haptics, emotes, PWA install prompt, share links, deployment pipeline, optional Redis room persistence. Definition of done: a stranger can tap a WhatsApp link, land in the lobby with a name prompt, and be playing within 20 seconds.

### Repository layout

```
leekha/
  package.json            pnpm workspaces
  SPEC.md                 this document
  CLAUDE.md               build conventions + pointers into SPEC.md sections
  packages/
    engine/               pure rules, zero deps
    protocol/             zod schemas, shared types
    bots/                 tracker, heuristic, search
  apps/
    server/               node + socket.io, rooms, timers
    web/                  react + vite PWA
  tools/
    sim/                  self play soak and stats
```

`CLAUDE.md` should state: build order is engine → local UI → server → bots online → polish; the engine stays pure; clients and bots consume `SeatView` only; hidden state never crosses the wire; every Section 3 decision lives in `RulesConfig`; run `pnpm test` and `pnpm sim` before declaring any engine change done.

---

## 16. Risks and honest concerns

1. **The rules live in people's heads.** Idlibi Leekha has no written source; this spec is the first one. Sections 3 and 4 pin every ambiguity to a documented base game default, but two or three Idlibi players should review Section 4 before Phase 1 ends. Every contested point is a config flag precisely so their corrections cost minutes. The two v1.1 additions, the undercut rule and biggest eater deals, are exactly the kind of rule that varies from village to village, which is why Section 3 items 12 and 13 exist.
2. **Match length.** 50 points per round against a 201 target means roughly 12 to 18 rounds; online that is 60 to 100+ minutes. Perfect for family sessions, heavy for strangers. Mitigations are built in: target presets, resumable rooms, and the simulator will produce real numbers.
3. **Liquidity.** A niche multiplayer game with empty lobbies dies on day one. That is why bots are first class, why the share link flow is a launch requirement, and why matchmaking queues and rankings are deliberately absent from MVP.
4. **Partner signaling.** Voice calls between partners cannot be prevented. Frame the product for friend groups; treat competitive integrity as a later, separate problem.
5. **Reconnection is where realtime projects rot.** It has its own integration tests and its own phase gate on purpose.
6. **Scope creep.** You already have more feature ideas; the parking lot below is where they wait until the four phases are done.

---

## 17. Future feature parking lot

Doubling variant (the base game's exposure doubling of Q♠ and 10♦, with a possible Idlibi analog for K♣), accounts and persistent stats, replays (the event log already makes them free), spectators, tournaments and leaderboards, randomized partner ranked mode, free chat with moderation, native store builds via Capacitor, a house rules editor exposing `RulesConfig`, and richer hint or coaching modes built on the inference tracker.

---

## 18. Sources consulted

1. Wikipedia, "Black Lady", section on the Likha/Leekha Middle Eastern partnership variant (direction of play, the forced likha rule, talyeekh, individual scores with team loss at 101, the cross team tie rule, the moon penalty).
2. Jawaker rules pages for Leekha and Bent Al Sbeet (dealer's right leads, rounds play out fully, alternate passing in their version, doubling mechanic, partnership framing).
3. Leekha app listing on Google Play (solo variant conventions, the passing restriction some apps add).

These describe the Lebanese/Levantine base game. All Idlib specific deltas in this document, including the K♣ as a third Leekha card, the undercut rule and dealer selection by biggest eater, come from the project owner's description and are marked as such.
