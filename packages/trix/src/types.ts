// Trix engine types. This package is pure and framework-free (no I/O, no timers,
// zero runtime deps), same discipline as @leekha/engine. The card/seat
// primitives are deliberately DUPLICATED from @leekha/engine rather than shared:
// two games is too few to justify a shared-core package, and Leekha's engine
// stays untouched. See SPEC-TRIX.md section 8.

export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14; // 11 J, 12 Q, 13 K, 14 A

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type Seat = 0 | 1 | 2 | 3; // partnership teams: (0,2) vs (1,3), same as Leekha

export const partnerOf = (s: Seat): Seat => ((s + 2) % 4) as Seat;
export const teamOf = (s: Seat): 0 | 1 => (s % 2 === 0 ? 0 : 1);
// Trix turn order is counter-clockwise; nextSeat is the next player to act.
export const nextSeat = (s: Seat): Seat => ((s + 1) % 4) as Seat;
export const SEATS: Seat[] = [0, 1, 2, 3];

// --- Contracts ---

/** The five contracts. Four are trick-avoidance; 'trix' is the Fan-Tan layout game. */
export type Contract = 'kingOfHearts' | 'diamonds' | 'queens' | 'slaps' | 'trix';
export const TRICK_CONTRACTS: Contract[] = ['kingOfHearts', 'diamonds', 'queens', 'slaps'];
export const ALL_CONTRACTS: Contract[] = ['kingOfHearts', 'diamonds', 'queens', 'slaps', 'trix'];

export interface TrixRulesConfig {
  /** true = partners opposite (teams 0,2 vs 1,3), scores summed per team. false = every seat for itself. */
  partnership: boolean;
  /** Complex variant: the kingdom owner may declare 2+ trick contracts in one deal. */
  complex: boolean;
  /** Doubling ("exposing") of the King of Hearts and Queens before the first lead. Default on. */
  doubling: boolean;
  timers: { selectMs: number; playMs: number };
}

export const defaultTrixConfig: TrixRulesConfig = {
  partnership: true,
  complex: false,
  doubling: true,
  timers: { selectMs: 30_000, playMs: 25_000 },
};

// --- Match / deal state (server-only, never crosses the wire) ---

export type MatchPhase =
  | 'selecting' // kingdom owner is choosing the contract(s) for this deal
  | 'exposing' // doubling window before the first lead (if any exposable honors)
  | 'trick' // a trick-taking contract is in progress
  | 'layout' // the trix layout contract is in progress
  | 'dealEnd' // deal scored, ready to advance
  | 'done'; // match over

/** The trix layout: per suit, the highest card built up (toward A=14) and lowest built down (toward 2). null = not started (jack not yet laid). */
export interface SuitLayout {
  up: Rank | null; // highest rank placed going up from J (11..14); null before the jack
  down: Rank | null; // lowest rank placed going down from J (11..2); null before the jack
}
export type Layout = Record<Suit, SuitLayout>;

export interface TrickPlay {
  seat: Seat;
  card: Card;
}

export interface DealState {
  /** The contract(s) being played this deal. Single entry except a Complex combined deal. Never contains 'trix' alongside others. */
  contracts: Contract[];
  hands: [Card[], Card[], Card[], Card[]];
  /** Whose turn it is to act. */
  turn: Seat;
  // Trick-contract state:
  currentTrick: { leader: Seat; plays: TrickPlay[] };
  /** Penalty cards captured by each seat (diamonds, queens, K heart), for scoring/tally. */
  captured: [Card[], Card[], Card[], Card[]];
  /** Tricks won by each seat (for the slaps contract). */
  tricksWon: [number, number, number, number];
  /** Whether a heart has been broken (for the "can't lead hearts" rule in King of Hearts). */
  heartsBroken: boolean;
  /** Cards exposed/doubled before the first lead, with the exposer. */
  exposed: { seat: Seat; card: Card }[];
  /** Exposing window (doubling): seats that have finished their expose-or-decline turn. Empty outside the 'exposing' phase. */
  exposePassed: Seat[];
  trickNumber: number; // 1..13
  // Trix layout state:
  layout: Layout;
  /** Finish order for the trix contract: seats in the order they emptied their hands. */
  finished: Seat[];
  /** Consecutive passes in the layout (all four passing would be a stuck state; shouldn't happen with legal play). */
  // Scoring accrued this deal, per seat (added to cumulative at dealEnd).
  dealScores: [number, number, number, number];
}

export interface TrixMatchState {
  config: TrixRulesConfig;
  seed: string;
  phase: MatchPhase;
  /** Whose kingdom is active (this player deals, chooses contracts, and leads). */
  kingdomOwner: Seat;
  kingdomIndex: number; // 0..3
  /** Contracts the current owner has already spent this kingdom. */
  contractsSpent: Contract[];
  /**
   * Cumulative individual score per seat. Team score (partnership) = sum of
   * partners. Zero-sum note: a single contract has a FIXED total
   * (kingOfHearts −75, diamonds −130, queens −100, slaps −195, trix +500), so a
   * deal is NOT zero-sum on its own. The five contracts sum to zero, so the sum
   * across seats returns to zero after each COMPLETE kingdom and at match end.
   */
  scores: [number, number, number, number];
  deal: DealState | null;
  moveLog: LoggedAction[];
  result?: MatchResult;
}

export type LoggedAction =
  | { type: 'chooseContract'; seat: Seat; contracts: Contract[] }
  | { type: 'expose'; seat: Seat; card: Card }
  | { type: 'play'; seat: Seat; card: Card }
  | { type: 'layoutPlay'; seat: Seat; card: Card }
  | { type: 'pass'; seat: Seat };

export interface MatchResult {
  /** Final cumulative per-seat scores. */
  scores: [number, number, number, number];
  /** In partnership, team totals (0 = seats 0,2 ; 1 = seats 1,3). */
  teamScores?: [number, number];
  /** Winner: a seat (solo) or a team index (partnership). Highest score wins. */
  winnerSeat?: Seat;
  winnerTeam?: 0 | 1;
}

// --- SeatView: the ONLY thing clients and bots ever see. No hidden hands. ---

export interface TrixSeatView {
  seat: Seat;
  config: TrixRulesConfig;
  phase: MatchPhase;
  hand: Card[];
  kingdomOwner: Seat;
  kingdomIndex: number;
  contractsSpent: Contract[];
  /** Contracts the owner may still choose (for the selecting phase; null if not this seat's choice). */
  choosableContracts: Contract[] | null;
  contracts: Contract[]; // active contract(s) this deal
  turn: Seat | null;
  currentTrick: { leader: Seat; plays: TrickPlay[] };
  captured: [Card[], Card[], Card[], Card[]];
  tricksWon: [number, number, number, number];
  exposed: { seat: Seat; card: Card }[];
  trickNumber: number;
  layout: Layout;
  finished: Seat[];
  scores: [number, number, number, number];
  /** Legal card plays for THIS seat right now (trick or layout). null when it is not this seat's turn to play a card. */
  legal: Card[] | null;
  /** Whether this seat may pass (layout, when it has no legal play). */
  canPass: boolean;
  /** Cards this seat may expose/double right now (empty unless in the exposing window and holding an exposable honor). */
  exposable: Card[];
}

export type TrixEvent =
  | { type: 'contractChosen'; contracts: Contract[] }
  | { type: 'exposed'; seat: Seat; card: Card }
  | { type: 'played'; seat: Seat; card: Card }
  | { type: 'trickEnd'; winner: Seat; cards: TrickPlay[] }
  | { type: 'layoutPlayed'; seat: Seat; card: Card }
  | { type: 'passed'; seat: Seat }
  | { type: 'finished'; seat: Seat; place: number } // trix: a player emptied their hand
  | { type: 'dealEnd'; dealScores: [number, number, number, number]; totals: [number, number, number, number] }
  | { type: 'matchOver'; result: MatchResult };

export class IllegalTrixAction extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'IllegalTrixAction';
  }
}
