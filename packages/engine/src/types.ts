export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14; // 11 J, 12 Q, 13 K, 14 A

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type Seat = 0 | 1 | 2 | 3; // teams: (0,2) vs (1,3)

export const partnerOf = (s: Seat): Seat => (((s + 2) % 4) as Seat);
export const nextSeat = (s: Seat): Seat => (((s + 1) % 4) as Seat); // anticlockwise order
export const prevSeat = (s: Seat): Seat => (((s + 3) % 4) as Seat);
export const teamOf = (s: Seat): 0 | 1 => (s % 2 === 0 ? 0 : 1);

export interface RulesConfig {
  targetScore: number; // 201
  forcedLeekhaDiscard: boolean; // true
  undercutRule: 'leekhaRank' | 'winningCard' | 'off'; // Idlib default 'winningCard'
  undercutBindsDiscards: boolean; // false, see Section 3 item 12
  dealerSelection: 'biggestEater' | 'rotateRight'; // Idlib default 'biggestEater'
  leadRestrictions: 'none'; // reserved for variants
  moonRule: 'none' | 'penalty'; // Idlib default 'none'
  moonPenalty?: number; // Lebanese base uses 37 on a 36 point deck
  passDirection: 'right' | 'alternate'; // 'right'
  bustTieBreak: 'higherIndividual';
  timers: { passMs: number; playMs: number };
}

export const defaultConfig: RulesConfig = {
  targetScore: 201,
  forcedLeekhaDiscard: true,
  undercutRule: 'winningCard',
  undercutBindsDiscards: false,
  dealerSelection: 'biggestEater',
  leadRestrictions: 'none',
  moonRule: 'none',
  passDirection: 'right',
  bustTieBreak: 'higherIndividual',
  timers: { passMs: 45_000, playMs: 25_000 },
};

export const isLeekha = (c: Card): boolean =>
  (c.suit === 'D' && c.rank === 10) || (c.suit === 'S' && c.rank === 12) || (c.suit === 'C' && c.rank === 13);

export const cardPoints = (c: Card): number =>
  c.suit === 'H'
    ? 1
    : c.suit === 'D' && c.rank === 10
      ? 10
      : c.suit === 'S' && c.rank === 12
        ? 13
        : c.suit === 'C' && c.rank === 13
          ? 14
          : 0;

export interface TrickPlay {
  seat: Seat;
  card: Card;
  forced: boolean;
}

export interface TrickState {
  leader: Seat;
  plays: TrickPlay[];
}

export type Phase = 'passing' | 'playing' | 'roundEnd' | 'gameOver';

export interface RoundState {
  hands: Card[][]; // server only, index = seat
  passes: (Card[] | null)[]; // what each seat sent (committed pass), index = seat
  passesApplied: boolean; // true once all 4 committed and cards have moved
  trickNumber: number; // 1..13
  currentTrick: TrickState;
  playedCards: TrickPlay[][]; // completed tricks, public
  eatenPoints: [number, number, number, number];
  eatenCards: Card[][]; // public, for UI icons, index = seat
}

export interface MatchResult {
  over: boolean;
  losingTeam?: 0 | 1;
  bustSeat?: Seat;
}

export interface MatchState {
  config: RulesConfig;
  scores: [number, number, number, number]; // cumulative, public
  dealer: Seat;
  roundIndex: number;
  phase: Phase;
  round: RoundState;
  seed: string;
  moveLog: LoggedAction[]; // enables replay and audit
  result?: MatchResult;
}

export type LoggedAction =
  | { type: 'pass'; seat: Seat; cards: Card[] }
  | { type: 'play'; seat: Seat; card: Card };

export type GameEvent =
  | { type: 'passesApplied' }
  | { type: 'played'; seat: Seat; card: Card; forced: boolean }
  | { type: 'trickEnd'; winner: Seat; points: number; cards: TrickPlay[] }
  | { type: 'roundEnd'; eaten: [number, number, number, number]; totals: [number, number, number, number]; nextDealer?: Seat }
  | { type: 'gameOver'; losingTeam: 0 | 1; bustSeat: Seat; totals: [number, number, number, number] };

export interface SeatView {
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
  youPassed: Card[] | null;
  youReceived: Card[] | null;
  legal: Card[] | null;
  config: RulesConfig;
}

export class IllegalAction extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'IllegalAction';
  }
}
