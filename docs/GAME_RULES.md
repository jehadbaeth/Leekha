# Leekha (Idlib Variant): Game Rules

This is the human-readable rules reference. It describes what the shipped
engine actually enforces (`packages/engine`), not just the design intent.
The full research, rationale, and open-question log live in
[`SPEC.md`](../SPEC.md) Sections 1 to 5 if you want the "why" behind any of
these choices. A Levantine Arabic version of this same document is available
at [`GAME_RULES.ar.md`](./GAME_RULES.ar.md).

## What kind of game this is

Leekha is a trick-avoidance game in the Hearts family, played by four
players in two fixed partnerships, partners seated opposite each other
(seats 0 and 2 vs. seats 1 and 3). Instead of racing to score points, you
race to avoid them. The team with a member who crosses the target score
first loses the match.

## Setup

- Standard 52 card deck, no jokers. Rank order high to low: A K Q J 10 9 8 7
  6 5 4 3 2. There is no trump suit.
- All rotation, dealing, passing, and turn order, moves anticlockwise
  (to each player's right).
- Each player is dealt 13 cards.

## The three Leekha cards

This variant's identity comes from three penalty cards that must be dumped
when a player can't follow suit:

| Card | Points |
|------|--------|
| 10♦  | 10 |
| Q♠   | 13 |
| K♣   | 14 |

Every heart is worth 1 point (13 total). That's exactly 50 penalty points
per round, and the engine asserts this sums correctly after every round as
a correctness check.

The King of Clubs is what makes the Idlib variant distinct from the base
Levantine game (which only uses Q♠ and 10♦ as "likha" cards). Only the Ace
of Clubs outranks it, so a player forced to follow a club lead with the K♣
eats 14 points unless the A♣ falls on the same trick.

## The pass

1. After looking at your hand, you secretly choose exactly 3 cards to give
   to the player on your right.
2. You commit before seeing what you're about to receive, so you can never
   pass a card you're about to get back.
3. Once all four players commit, everyone receives their 3 cards from the
   left and is back to 13 cards.
4. There are no restrictions on what you can pass. Passing is always to the
   right, every round; this variant does not alternate direction.
5. Consequence: you have perfect, permanent knowledge of 3 cards in your
   right-hand opponent's hand until they're played, and your left-hand
   opponent has the same knowledge about you. Since play also proceeds to
   the right, the player whose hand you partly know acts immediately after
   you every trick.

## Trick play

1. The player to the dealer's right leads the first trick and may lead any
   card, hearts included, there is no "must lead a specific card" rule.
2. Play proceeds anticlockwise, one card per player per trick.
3. **Follow suit if you can.** If you hold a card of the led suit, you must
   play one of them, subject to rule 3a and the undercut rule below.
3a. **Forced talyeekh on a follow.** If the led suit's own Leekha card (10♦
   on a diamond lead, Q♠ on a spade lead, K♣ on a club lead) is one of the
   cards you could follow with, and a strictly higher card of that suit is
   already on the trick, guaranteeing the Leekha would lose the trick if
   played, you must play it. You cannot follow with a different card of that
   suit instead to keep the Leekha in hand. If nothing on the trick yet
   beats the Leekha, you are free to hold it back and follow with a
   different card of the suit, since playing it now would win you the trick
   (and its points) rather than surrender them. There's at most one such
   card per suit, so once the condition is met this never presents a
   choice, unlike rule 4.
4. **Forced dump.** If you have no card of the led suit but hold at least
   one Leekha card (10♦, Q♠, or K♣), you must play one of them. If you hold
   more than one, you choose which (again, subject to undercut). This binds
   your own partner exactly the same as an opponent, there is no mercy rule.
5. **Free discard.** If you have no card of the led suit and no Leekha card,
   you may throw away anything, unconstrained.
6. **The undercut rule.** The moment any Leekha card lands on the current
   trick, everyone who plays after it must play a card ranked strictly
   below the highest Leekha card on the trick, if they have one available
   in whatever set rules 3 to 5 already gave them. If they have nothing
   that qualifies, the restriction lifts and they can play from that full
   set. This never applies to a free discard by a void player holding no
   Leekha, and a trick with hearts but no Leekha triggers nothing.
7. The trick is won by the highest card of the led suit. A card of a
   different suit, including a dumped Leekha card, can never win a trick.
8. The winner collects the trick, adds any penalty points in it to their
   running round total, and leads the next trick.
9. A round is 13 tricks; every card is played exactly once.

### Worked example of the undercut rule

Suppose clubs are led and you're void in clubs. You hold both the 10♦ and
the K♣ and no other Leekha cards. If the Q♠ has already been played to this
trick, you're forced to dump a Leekha card, and the undercut rule means you
must play the 10♦ (ranked below the Q♠), not the K♣.

### Worked example of forced talyeekh on a follow

Suppose someone leads the J♦ and you hold the 10♦ along with the 3♦ and 7♦.
The jack already beats your ten, so playing the 10♦ now would lose it for
certain: rule 3a forces it out, even though the 3♦ and 7♦ would also have
been legal follows in a game without this rule.

Now suppose someone instead leads the 2♣ and you hold the K♣ along with the
4♣. Nothing on the trick beats your king yet, so rule 3a does not force it
out: you may play the 4♣ and keep the K♣ in hand, since playing the king
now would win you the trick (and its 13 points), not surrender them. Only
once someone leads, or plays before you, the A♣ does the K♣ become forced.

### Things that fall naturally out of these rules

- A Leekha card can never be hidden behind other cards of its own suit once
  it would lose. Leading that suit with something that already beats it
  forces it out via rule 3a even if the holder has other cards of the suit;
  being void forces it out via rule 4 regardless of winning odds, since an
  off-suit card can never win anyway. Before that point, the holder may
  legally hold the Leekha back and follow with a different card instead.
- More than one player can be forced on the same trick. A single trick can
  contain the Q♠, the K♣, and hearts all at once.
- A forced dump, or a forced talyeekh follow, can land on your own
  partner's trick. That's intended; once the Leekha is already beaten, you
  can't protect a partner who's winning by quietly following with a lower
  card of the suit instead.
- Everyone can see when a player fails to follow suit. If they then dump a
  non-Leekha card, the whole table now knows for certain they hold no
  Leekha cards for the rest of the round. If they dump a Leekha card while
  void, everyone knows it was forced, they might still hold another one. If
  a player follows suit with something other than that suit's own Leekha
  while a higher card of that suit is already on the trick, everyone knows
  they don't hold it.
- Anyone who plays a card that beats a Leekha card already on the trick has
  proven they held nothing lower among their legal options at that moment.

## Scoring and busting

- Each player keeps a running cumulative score across the whole match.
- At the end of each round, everyone adds whatever they ate that round to
  their total. Totals are always visible to everyone.
- The target score is **201** by default (configurable per room: 101 for a
  quick game, 151, or 201 for the classic Idlib length).
- A round always plays out all 13 tricks, even if someone crosses the
  target mid-round.
- If nobody has reached the target, the match continues to the next round.
- If one or more players are at or above the target, the match ends. The
  **team of the player with the highest score loses.** If the two highest
  busted scores across opposing teams are exactly tied, team totals break
  the tie; if that's still tied, one more round is played as sudden death.
- There is no bonus or penalty for eating everything (a "moon shot" in this
  variant just means you scored 50, unlike classic Hearts).

## Choosing the next dealer

- The very first dealer of a match (and of any rematch) is chosen at random.
- From the second round on, whoever ate the most points in the previous
  round deals next.
- On a tie, whichever tied player ate the K♣ deals. If the K♣ eater isn't
  among the tied players, the tiebreak cascades: the Q♠ eater among the
  tied players, then the 10♦ eater, then whoever is seated closest to the
  right of the previous dealer.
- Why this matters: the seat to the dealer's right leads the first trick of
  the round, and that seat is always on the opposing team. So the biggest
  eater's team hands the other team the game's first informational lead
  every single round. This is a deliberate, compounding punishment.

## Match structure

- A match ends the moment any player busts.
- Rematch keeps the same seats and resets everyone's score to zero.
- Room hosts configure the target score and both timers (see below) before
  starting.

## Turn timers, disconnects, and bot takeover

- Default timers: 45 seconds to commit a pass, 25 seconds to play a card.
  Both are configurable per room, including turning them off entirely for
  in-person/living-room play.
- If your timer expires, the server plays a single legal move for you using
  the Easy bot's policy. You stay in control of the seat; this only counts
  as a strike.
- Two strikes in a row, or a 15 second disconnect grace period expiring,
  flips your seat to full bot control at whatever difficulty was configured
  for that seat. Your name and a robot badge stay on the seat.
- If you come back, a "Resume Seat" action gives you control back instantly
  at the next decision point.
- Any mix of humans and bots can start a game. One human against three bots
  is a fully supported way to play, not a fallback.

## Bots

Two difficulty tiers are available per bot seat:

- **Easy / Medium** (`packages/bots/src/heuristic.ts`): a hand-tuned scoring
  policy for passing and playing, weighted toward known Leekha danger, void
  shaping, and duck/rescue logic. Easy adds more randomness to the same
  weights than Medium.
- **Hard**: a determinized Monte Carlo search. It samples plausible hidden
  hands consistent with everything publicly known (voids, proven Leekha
  absences, passed cards), rolls each legal move forward with the heuristic
  policy driving all four seats, and picks the move with the best average
  outcome, weighted heavily against a teammate busting.

Every bot, at every tier, only ever sees the same redacted view a human
player would see (`SeatView`). There is no hidden-information cheating path
available to them; this is enforced by an automated test that fails the
build if `packages/bots` ever imports the full, unredacted `MatchState`.

## Configurable rules

Every decision above that isn't a hard mathematical fact of the game (like
"a round has 13 tricks") is a named field in `RulesConfig`
(`packages/engine/src/types.ts`), not a hardcoded branch. That includes the
target score, the undercut rule's exact reading, whether it also binds free
discards, dealer selection method, moon rule, pass direction, tie-break
rule, and both timers. A room host changes these from the lobby without any
code change being required.
