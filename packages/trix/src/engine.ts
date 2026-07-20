// Trix state machine. Pure and deterministic from (config, seed): no I/O, no
// timers, no Date.now / Math.random. Every function returns fresh state.
import { makeDeck, cardEquals, containsCard, removeCard } from './cards.js';
import { rngFromSeed, shuffle } from './rng.js';
import {
  CONTRACT_TOTAL,
  emptyLayout,
  exposableCards,
  isLayoutLegal,
  layoutLegalPlays,
  applyLayout,
  trickLegalPlays,
  trickWinner,
  scoreTrickDeal,
  scoreLayoutDeal,
} from './contracts.js';
import {
  ALL_CONTRACTS,
  TRICK_CONTRACTS,
  SEATS,
  nextSeat,
  teamOf,
  IllegalTrixAction,
  type Card,
  type Contract,
  type DealState,
  type MatchResult,
  type Seat,
  type TrixEvent,
  type TrixMatchState,
  type TrixRulesConfig,
  type TrixSeatView,
} from './types.js';

type Applied = { state: TrixMatchState; events: TrixEvent[] };

// --- Dealing ---

function dealHands(seed: string): [Card[], Card[], Card[], Card[]] {
  const rng = rngFromSeed(seed);
  const deck = shuffle(makeDeck(), rng);
  return [deck.slice(0, 13), deck.slice(13, 26), deck.slice(26, 39), deck.slice(39, 52)];
}

function sortHand(h: Card[]): Card[] {
  const order = ['S', 'H', 'C', 'D'];
  return h.slice().sort((a, b) => (order.indexOf(a.suit) - order.indexOf(b.suit)) || a.rank - b.rank);
}

// --- New match ---

/**
 * A freshly dealt deal for the SELECTING phase, before any contract is chosen.
 * Cards are dealt now (not at chooseContract) so the kingdom owner — and the
 * bots — decide their contract while looking at their actual hand, as in the
 * real game. contracts is empty until chooseContract sets it. The seed is
 * contract-independent (each deal within a kingdom is its own fresh shuffle).
 */
function freshDeal(seed: string, kingdomIndex: number, dealIndex: number, owner: Seat): DealState {
  const hands = dealHands(`${seed}:k${kingdomIndex}:d${dealIndex}`).map(sortHand) as [Card[], Card[], Card[], Card[]];
  const startingTwos = SEATS.flatMap((s) => hands[s].filter((c) => c.rank === 2).map((card) => ({ seat: s, card })));
  return {
    contracts: [],
    hands,
    turn: owner,
    currentTrick: { leader: owner, plays: [] },
    captured: [[], [], [], []],
    tricksWon: [0, 0, 0, 0],
    heartsBroken: false,
    exposed: [],
    startingTwos,
    layoutActions: 0,
    exposePassed: [],
    trickNumber: 1,
    layout: emptyLayout(),
    finished: [],
    dealScores: [0, 0, 0, 0],
  };
}

/**
 * Trex 2s rule: once the first full round of the layout has passed (every seat
 * has taken one turn), each 2 still in hand is revealed to the table — UNLESS one
 * partnership was dealt all four 2s. Returns the exposed entries to add, or [].
 * Display-only; the layout doesn't score 2s.
 */
function revealTwosForLayout(deal: DealState, config: TrixRulesConfig): { seat: Seat; card: Card }[] {
  const oneTeamHoldsAll =
    config.partnership && deal.startingTwos.every((x) => teamOf(x.seat) === teamOf(deal.startingTwos[0].seat));
  if (oneTeamHoldsAll) return [];
  return SEATS.flatMap((s) => deal.hands[s].filter((c) => c.rank === 2).map((card) => ({ seat: s, card })));
}

export function newMatch(config: TrixRulesConfig, seed: string): TrixMatchState {
  // A deterministic probe deal decides who holds 7 of hearts and thus owns
  // kingdom 0. Contract deals are fresh and independent of this probe.
  const probe = dealHands(`${seed}:probe`);
  let owner: Seat = 0;
  for (const s of SEATS) if (probe[s].some((c) => c.suit === 'H' && c.rank === 7)) owner = s;
  return {
    config,
    seed,
    phase: 'selecting',
    kingdomOwner: owner,
    kingdomIndex: 0,
    contractsSpent: [],
    scores: [0, 0, 0, 0],
    // Hands are dealt up front so the owner sees them before picking a contract.
    deal: freshDeal(seed, 0, 0, owner),
    moveLog: [],
  };
}

// --- Contract selection ---

/** Contracts still available to the current kingdom owner. */
export function legalContracts(state: TrixMatchState): Contract[] {
  return ALL_CONTRACTS.filter((c) => !state.contractsSpent.includes(c));
}

function validateChoice(state: TrixMatchState, contracts: Contract[]): void {
  if (state.phase !== 'selecting') throw new IllegalTrixAction('bad-phase', 'Not choosing a contract now');
  if (contracts.length === 0) throw new IllegalTrixAction('no-contract', 'Pick at least one contract');
  const legal = legalContracts(state);
  for (const c of contracts) if (!legal.includes(c)) throw new IllegalTrixAction('spent', `Contract ${c} already played`);
  if (new Set(contracts).size !== contracts.length) throw new IllegalTrixAction('dup', 'Duplicate contract');

  if (state.config.complex) {
    // Complex is strict: a deal is EITHER Trix (the layout) OR "Complex" — ALL
    // remaining penalty contracts played together. No individual penalties and
    // no partial combinations (e.g. Queens + King of Hearts only).
    const remainingPenalties = legal.filter((c) => TRICK_CONTRACTS.includes(c));
    const isTrix = contracts.length === 1 && contracts[0] === 'trix';
    const isAllPenalties =
      contracts.length === remainingPenalties.length && remainingPenalties.every((c) => contracts.includes(c));
    if (!isTrix && !isAllPenalties)
      throw new IllegalTrixAction('complex-combo', 'In Complex, play all penalties together or Trix');
    return;
  }

  // Simple Trix: exactly one contract per deal, no combining.
  if (contracts.length > 1) throw new IllegalTrixAction('not-complex', 'Combining contracts needs Complex');
}

export function chooseContract(state: TrixMatchState, seat: Seat, contracts: Contract[]): Applied {
  if (seat !== state.kingdomOwner) throw new IllegalTrixAction('not-owner', 'Only the kingdom owner chooses');
  if (!state.deal) throw new IllegalTrixAction('bad-phase', 'No hand dealt to choose against');
  validateChoice(state, contracts);

  const isLayout = contracts.length === 1 && contracts[0] === 'trix';
  // The hand was already dealt when the selecting phase began; the chosen
  // contract just labels this same deal.
  const hands = state.deal.hands;
  const deal: DealState = { ...state.deal, contracts };

  const events: TrixEvent[] = [{ type: 'contractChosen', contracts }];

  // Enter the doubling window only if doubling is on, it is a trick deal, and
  // someone actually holds an exposable honor.
  const anyExposable =
    state.config.doubling &&
    !isLayout &&
    SEATS.some((s) => exposableCards(hands[s], contracts).length > 0);

  const next: TrixMatchState = {
    ...state,
    phase: anyExposable ? 'exposing' : isLayout ? 'layout' : 'trick',
    deal: { ...deal, turn: anyExposable ? firstExposer(deal, hands, contracts, state.kingdomOwner) : state.kingdomOwner },
    moveLog: [...state.moveLog, { type: 'chooseContract', seat, contracts }],
  };
  return { state: next, events };
}

// --- Exposing (doubling) window ---

/** First seat (from owner, in turn order) that still needs to act in the exposing window. */
function firstExposer(deal: DealState, hands: Card[][], contracts: Contract[], owner: Seat): Seat {
  let s = owner;
  for (let i = 0; i < 4; i++) {
    if (!deal.exposePassed.includes(s) && exposableCards(hands[s], contracts).length > 0) return s;
    s = nextSeat(s);
  }
  return owner;
}

function everyoneExposed(deal: DealState): boolean {
  // Done when every seat that could act has passed (declined) their window.
  return SEATS.every((s) => deal.exposePassed.includes(s) || exposableCards(deal.hands[s], deal.contracts).length === 0);
}

export function expose(state: TrixMatchState, seat: Seat, card: Card): Applied {
  if (state.phase !== 'exposing' || !state.deal) throw new IllegalTrixAction('bad-phase', 'Not the exposing window');
  const deal = state.deal;
  if (seat !== deal.turn) throw new IllegalTrixAction('not-your-turn', 'Not your turn to expose');
  if (!exposableCards(deal.hands[seat], deal.contracts).some((c) => cardEquals(c, card)))
    throw new IllegalTrixAction('not-exposable', 'That card cannot be exposed');
  if (deal.exposed.some((e) => cardEquals(e.card, card))) throw new IllegalTrixAction('already', 'Already exposed');

  const nextDeal: DealState = { ...deal, exposed: [...deal.exposed, { seat, card }] };
  // Exposer keeps the turn (may expose another honor) until they pass.
  return {
    state: { ...state, deal: nextDeal, moveLog: [...state.moveLog, { type: 'expose', seat, card }] },
    events: [{ type: 'exposed', seat, card }],
  };
}

function passExposing(state: TrixMatchState, seat: Seat): Applied {
  const deal = state.deal!;
  if (seat !== deal.turn) throw new IllegalTrixAction('not-your-turn', 'Not your turn');
  const exposePassed = [...deal.exposePassed, seat];
  const dealWithPass: DealState = { ...deal, exposePassed };
  if (everyoneExposed(dealWithPass)) {
    const isLayout = deal.contracts.length === 1 && deal.contracts[0] === 'trix';
    return {
      state: {
        ...state,
        phase: isLayout ? 'layout' : 'trick',
        deal: { ...dealWithPass, turn: state.kingdomOwner },
        moveLog: [...state.moveLog, { type: 'pass', seat }],
      },
      events: [{ type: 'passed', seat }],
    };
  }
  const turn = firstExposer(dealWithPass, deal.hands, deal.contracts, state.kingdomOwner);
  return {
    state: { ...state, deal: { ...dealWithPass, turn }, moveLog: [...state.moveLog, { type: 'pass', seat }] },
    events: [{ type: 'passed', seat }],
  };
}

// --- Playing (trick or layout) ---

export function legalPlays(state: TrixMatchState, seat: Seat): Card[] | null {
  const deal = state.deal;
  if (!deal || deal.turn !== seat) return null;
  if (state.phase === 'trick')
    return trickLegalPlays(deal.hands[seat], deal.currentTrick.plays, deal.contracts, state.config.restrictKingOfHeartsLead);
  if (state.phase === 'layout') return layoutLegalPlays(deal.hands[seat], deal.layout);
  return null;
}

export function play(state: TrixMatchState, seat: Seat, card: Card): Applied {
  if (state.phase === 'trick') return playTrick(state, seat, card);
  if (state.phase === 'layout') return playLayout(state, seat, card);
  throw new IllegalTrixAction('bad-phase', 'Cannot play a card now');
}

export function pass(state: TrixMatchState, seat: Seat): Applied {
  if (state.phase === 'exposing') return passExposing(state, seat);
  if (state.phase === 'layout') return passLayout(state, seat);
  throw new IllegalTrixAction('bad-phase', 'Cannot pass now');
}

function playTrick(state: TrixMatchState, seat: Seat, card: Card): Applied {
  const deal = state.deal!;
  if (deal.turn !== seat) throw new IllegalTrixAction('not-your-turn', 'Not your turn');
  const legal = trickLegalPlays(deal.hands[seat], deal.currentTrick.plays, deal.contracts, state.config.restrictKingOfHeartsLead);
  if (!legal.some((c) => cardEquals(c, card))) throw new IllegalTrixAction('illegal-play', 'That card is not legal');

  const hands = deal.hands.map((h, i) => (i === seat ? removeCard(h, card) : h)) as DealState['hands'];
  const plays = [...deal.currentTrick.plays, { seat, card }];
  const events: TrixEvent[] = [{ type: 'played', seat, card }];

  if (plays.length < 4) {
    const nextDeal: DealState = { ...deal, hands, currentTrick: { ...deal.currentTrick, plays }, turn: nextSeat(seat) };
    return { state: { ...state, deal: nextDeal, moveLog: [...state.moveLog, { type: 'play', seat, card }] }, events };
  }

  // Trick complete: winner takes the cards and leads next.
  const winner = trickWinner(plays);
  const captured = deal.captured.map((c, i) => (i === winner ? [...c, ...plays.map((p) => p.card)] : c)) as DealState['captured'];
  const tricksWon = deal.tricksWon.slice() as DealState['tricksWon'];
  tricksWon[winner] += 1;
  events.push({ type: 'trickEnd', winner, cards: plays });

  const afterTrick: DealState = {
    ...deal,
    hands,
    captured,
    tricksWon,
    currentTrick: { leader: winner, plays: [] },
    turn: winner,
    trickNumber: deal.trickNumber + 1,
  };

  if (deal.trickNumber >= 13) {
    return endDeal({ ...state, deal: afterTrick, moveLog: [...state.moveLog, { type: 'play', seat, card }] }, events);
  }
  return { state: { ...state, deal: afterTrick, moveLog: [...state.moveLog, { type: 'play', seat, card }] }, events };
}

function playLayout(state: TrixMatchState, seat: Seat, card: Card): Applied {
  const deal = state.deal!;
  if (deal.turn !== seat) throw new IllegalTrixAction('not-your-turn', 'Not your turn');
  if (!isLayoutLegal(card, deal.layout)) throw new IllegalTrixAction('illegal-play', 'That card is not legal on the layout');
  if (!containsCard(deal.hands[seat], card)) throw new IllegalTrixAction('not-held', 'You do not hold that card');

  const hands = deal.hands.map((h, i) => (i === seat ? removeCard(h, card) : h)) as DealState['hands'];
  const layout = applyLayout(deal.layout, card);
  const events: TrixEvent[] = [{ type: 'layoutPlayed', seat, card }];
  let finished = deal.finished;
  if (hands[seat].length === 0 && !finished.includes(seat)) {
    finished = [...finished, seat];
    events.push({ type: 'finished', seat, place: finished.length });
  }
  const layoutActions = deal.layoutActions + 1;
  const nextDeal: DealState = { ...deal, hands, layout, finished, turn: nextSeat(seat), layoutActions };
  // Reveal the 2s once the first full round of the layout completes.
  if (layoutActions === 4) nextDeal.exposed = [...nextDeal.exposed, ...revealTwosForLayout(nextDeal, state.config)];
  const moveLog = [...state.moveLog, { type: 'layoutPlay' as const, seat, card }];

  if (finished.length >= 4 || nextDeal.hands.every((h) => h.length === 0)) {
    return endDeal({ ...state, deal: nextDeal, moveLog }, events);
  }
  return advanceLayoutTurn({ ...state, deal: nextDeal, moveLog }, events);
}

function passLayout(state: TrixMatchState, seat: Seat): Applied {
  const deal = state.deal!;
  if (deal.turn !== seat) throw new IllegalTrixAction('not-your-turn', 'Not your turn');
  if (layoutLegalPlays(deal.hands[seat], deal.layout).length > 0)
    throw new IllegalTrixAction('must-play', 'You have a legal play and must make it');
  const layoutActions = deal.layoutActions + 1;
  const nextDeal: DealState = { ...deal, turn: nextSeat(seat), layoutActions };
  if (layoutActions === 4) nextDeal.exposed = [...nextDeal.exposed, ...revealTwosForLayout(nextDeal, state.config)];
  return advanceLayoutTurn(
    { ...state, deal: nextDeal, moveLog: [...state.moveLog, { type: 'pass', seat }] },
    [{ type: 'passed', seat }],
  );
}

/** Skip any already-finished seats so the layout turn lands on a player who still has cards. */
function advanceLayoutTurn(state: TrixMatchState, events: TrixEvent[]): Applied {
  let deal = state.deal!;
  let guard = 0;
  while (deal.hands[deal.turn].length === 0 && guard < 4) {
    deal = { ...deal, turn: nextSeat(deal.turn) };
    guard++;
  }
  return { state: { ...state, deal }, events };
}

// --- Deal end and match advancement ---

function endDeal(state: TrixMatchState, events: TrixEvent[]): Applied {
  const deal = state.deal!;
  const isLayout = deal.contracts.length === 1 && deal.contracts[0] === 'trix';
  const dealScores = isLayout
    ? scoreLayoutDeal(deal.finished)
    : scoreTrickDeal(deal.contracts, deal.captured, deal.tricksWon, deal.exposed);

  const scores = state.scores.map((s, i) => s + dealScores[i]) as [number, number, number, number];
  const contractsSpent = [...state.contractsSpent, ...deal.contracts];
  const evs: TrixEvent[] = [...events, { type: 'dealEnd', dealScores, totals: scores }];

  // Kingdom finished when the owner has spent all five contracts.
  const kingdomDone = ALL_CONTRACTS.every((c) => contractsSpent.includes(c));
  if (!kingdomDone) {
    // Next deal, same kingdom: deal fresh hands now so the owner sees them
    // before choosing the next contract.
    return {
      state: {
        ...state,
        phase: 'selecting',
        deal: freshDeal(state.seed, state.kingdomIndex, contractsSpent.length, state.kingdomOwner),
        contractsSpent,
        scores,
      },
      events: evs,
    };
  }
  // Next kingdom, or match over after the fourth.
  if (state.kingdomIndex >= 3) {
    const result = buildResult(state.config, scores);
    return {
      state: { ...state, phase: 'done', deal: null, contractsSpent, scores, result },
      events: [...evs, { type: 'matchOver', result }],
    };
  }
  const nextKingdomIndex = state.kingdomIndex + 1;
  const nextOwner = nextSeat(state.kingdomOwner);
  return {
    state: {
      ...state,
      phase: 'selecting',
      deal: freshDeal(state.seed, nextKingdomIndex, 0, nextOwner),
      kingdomIndex: nextKingdomIndex,
      kingdomOwner: nextOwner,
      contractsSpent: [],
      scores,
    },
    events: evs,
  };
}

function buildResult(config: TrixRulesConfig, scores: [number, number, number, number]): MatchResult {
  if (config.partnership) {
    const teamScores: [number, number] = [scores[0] + scores[2], scores[1] + scores[3]];
    return { scores, teamScores, winnerTeam: teamScores[0] >= teamScores[1] ? 0 : 1 };
  }
  let winnerSeat: Seat = 0;
  for (const s of SEATS) if (scores[s] > scores[winnerSeat]) winnerSeat = s;
  return { scores, winnerSeat };
}

// --- SeatView ---

export function viewFor(state: TrixMatchState, seat: Seat): TrixSeatView {
  const deal = state.deal;
  const isOwner = seat === state.kingdomOwner;
  return {
    seat,
    config: state.config,
    phase: state.phase,
    hand: deal ? deal.hands[seat] : [],
    kingdomOwner: state.kingdomOwner,
    kingdomIndex: state.kingdomIndex,
    contractsSpent: state.contractsSpent,
    choosableContracts: state.phase === 'selecting' && isOwner ? legalContracts(state) : null,
    contracts: deal ? deal.contracts : [],
    turn: deal ? deal.turn : null,
    currentTrick: deal ? deal.currentTrick : { leader: state.kingdomOwner, plays: [] },
    captured: deal ? deal.captured : [[], [], [], []],
    tricksWon: deal ? deal.tricksWon : [0, 0, 0, 0],
    exposed: deal ? deal.exposed : [],
    trickNumber: deal ? deal.trickNumber : 0,
    layout: deal ? deal.layout : emptyLayout(),
    finished: deal ? deal.finished : [],
    scores: state.scores,
    legal: legalPlays(state, seat),
    canPass:
      !!deal &&
      deal.turn === seat &&
      ((state.phase === 'layout' && layoutLegalPlays(deal.hands[seat], deal.layout).length === 0) ||
        state.phase === 'exposing'),
    exposable:
      state.phase === 'exposing' && deal && deal.turn === seat
        ? exposableCards(deal.hands[seat], deal.contracts).filter(
            (c) => !deal.exposed.some((e) => e.card.suit === c.suit && e.card.rank === c.rank),
          )
        : [],
  };
}

/** Convenience: whose turn is it to act (choose / expose / play), or null if match over. */
export function actingSeat(state: TrixMatchState): Seat | null {
  if (state.phase === 'done') return null;
  if (state.phase === 'selecting') return state.kingdomOwner;
  return state.deal ? state.deal.turn : null;
}

export { teamOf, CONTRACT_TOTAL };
