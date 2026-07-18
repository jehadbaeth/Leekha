import { useEffect, useState } from 'react';
import { ALL_CONTRACTS, type Contract, type Seat, type TrixRulesConfig } from '@leekha/trix';
import { useTrixGame } from './useTrixGame';
import { TrixTrickTable } from './TrixTrickTable';
import { TrixLayoutBoard } from './TrixLayoutBoard';
import { CardFace } from '../components/CardFace';
import { CONTRACT_LABEL, SEAT_NAMES, cardKey, cardLabel } from './trixLabels';

const HUMAN_SEAT: Seat = 0;
const ALL_SEATS: Seat[] = [0, 1, 2, 3];

export function TrixGame({ config, onExit }: { config: TrixRulesConfig; onExit: () => void }) {
  const { match, view, startMatch, pendingDeal, continueDeal, humanChooseContract, humanExpose, humanPass, humanPlay } =
    useTrixGame(config);
  const [selected, setSelected] = useState<Contract[]>([]);

  // Kick off the match once the screen mounts; the human never sees a
  // separate "start" step for local vs-bots play.
  useEffect(() => {
    startMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear any in-progress Complex multi-select once the decision point moves on.
  useEffect(() => {
    setSelected([]);
  }, [view?.phase, view?.kingdomIndex]);

  // Show the deal-end recap only while paused between deals, never on top of the
  // match-over screen (phase 'done').
  const showDealSummary = pendingDeal !== null && view?.phase !== 'done';

  if (!match || !view) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-b from-felt-900 to-felt-950 text-emerald-100">
        Dealing...
      </div>
    );
  }

  const teamScores: [number, number] | null = config.partnership
    ? [view.scores[0] + view.scores[2], view.scores[1] + view.scores[3]]
    : null;

  const ownerIsHuman = view.choosableContracts !== null;

  return (
    <div className="relative flex flex-col h-full w-full overflow-hidden">
      {/* Header: contract, kingdom progress, running scores. Always visible. */}
      <div className="flex flex-col gap-1 bg-emerald-950 text-emerald-100 px-3 py-2 text-xs flex-shrink-0">
        <div className="flex items-center justify-between">
          <button onClick={onExit} className="text-emerald-300 underline text-[11px]">
            Exit
          </button>
          <span className="font-semibold">
            Kingdom {view.kingdomIndex + 1}/4 · {SEAT_NAMES[view.kingdomOwner]}&rsquo;s kingdom
          </span>
          <span className="w-8" />
        </div>
        <div className="flex items-center justify-center gap-1 flex-wrap">
          {ALL_CONTRACTS.map((c) => (
            <span
              key={c}
              className={`rounded-full px-2 py-0.5 text-[10px] ${
                view.contractsSpent.includes(c)
                  ? 'bg-emerald-800/60 text-emerald-400 line-through'
                  : view.contracts.includes(c)
                    ? 'bg-amber-400 text-emerald-950 font-bold'
                    : 'bg-emerald-900/60 text-emerald-200'
              }`}
            >
              {CONTRACT_LABEL[c]}
            </span>
          ))}
        </div>
        <div className="flex items-center justify-center gap-3 text-[11px]">
          {ALL_SEATS.map((s) => (
            <span key={s} className={s === HUMAN_SEAT ? 'font-bold text-amber-300' : ''}>
              {SEAT_NAMES[s]}: {view.scores[s]}
            </span>
          ))}
        </div>
        {teamScores && (
          <div className="flex items-center justify-center gap-4 text-[11px] text-emerald-300">
            <span>
              Team {SEAT_NAMES[0]}+{SEAT_NAMES[2]}: {teamScores[0]}
            </span>
            <span>
              Team {SEAT_NAMES[1]}+{SEAT_NAMES[3]}: {teamScores[1]}
            </span>
          </div>
        )}
      </div>

      {/* Body by phase */}
      <div className="flex-1 min-h-0">
        {view.phase === 'selecting' && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-4 bg-gradient-to-b from-felt-900 to-felt-950">
            {ownerIsHuman ? (
              <>
                <div className="text-emerald-100 text-sm font-semibold">Choose a contract</div>
                <div className="flex flex-wrap gap-2 justify-center max-w-xs">
                  {(view.choosableContracts ?? []).map((c) => {
                    const isTrix = c === 'trix';
                    const isSelected = selected.includes(c);
                    return (
                      <button
                        key={c}
                        onClick={() => {
                          if (!config.complex || isTrix) {
                            humanChooseContract([c]);
                          } else {
                            setSelected((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
                          }
                        }}
                        className={`rounded-lg px-4 py-2 text-sm font-semibold shadow ${
                          isSelected ? 'bg-amber-400 text-emerald-950' : 'bg-emerald-800 text-emerald-50'
                        }`}
                      >
                        {CONTRACT_LABEL[c]}
                      </button>
                    );
                  })}
                </div>
                {config.complex && selected.length > 0 && (
                  <button
                    onClick={() => humanChooseContract(selected)}
                    className="rounded-lg px-5 py-2 text-sm font-bold bg-amber-400 text-emerald-950 shadow"
                  >
                    Play {selected.map((c) => CONTRACT_LABEL[c]).join(' + ')}
                  </button>
                )}
              </>
            ) : (
              <div className="text-emerald-200 text-sm">
                Waiting for {SEAT_NAMES[view.kingdomOwner]} to choose a contract...
              </div>
            )}
          </div>
        )}

        {view.phase === 'exposing' && (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-4 bg-gradient-to-b from-felt-900 to-felt-950">
            <div className="text-emerald-100 text-sm font-semibold">Doubling window</div>
            {view.turn === HUMAN_SEAT ? (
              <>
                {view.exposable.length > 0 && (
                  <div className="flex flex-wrap gap-2 justify-center">
                    {view.exposable.map((c) => (
                      <button
                        key={cardKey(c)}
                        onClick={() => humanExpose(c)}
                        className="rounded-lg px-4 py-2 text-sm font-semibold bg-amber-400 text-emerald-950 shadow"
                      >
                        Double {cardLabel(c)}
                      </button>
                    ))}
                  </div>
                )}
                {/* Gated on canPass (true for the whole of the human's exposing
                    turn), not on exposable.length: once the human doubles their
                    last honor, exposable empties but the engine still holds the
                    turn until an explicit pass -- gating on exposable here would
                    strand the human with no control to end their turn. */}
                {view.canPass && (
                  <button
                    onClick={humanPass}
                    className="rounded-lg px-4 py-2 text-sm font-semibold bg-emerald-800 text-emerald-50 shadow"
                  >
                    {view.exposable.length > 0 ? 'Skip' : 'Done'}
                  </button>
                )}
              </>
            ) : (
              <div className="text-emerald-200 text-sm">Waiting for {SEAT_NAMES[view.turn ?? view.kingdomOwner]}...</div>
            )}
            <div className="flex overflow-x-auto -space-x-4 px-2 py-1 justify-center max-w-full">
              {view.hand.map((card) => (
                <div key={cardKey(card)} className="flex-shrink-0">
                  <CardFace card={card} size="md" />
                </div>
              ))}
            </div>
          </div>
        )}

        {view.phase === 'trick' && <TrixTrickTable view={view} onPlay={humanPlay} />}
        {view.phase === 'layout' && <TrixLayoutBoard view={view} onPlay={humanPlay} onPass={humanPass} />}

        {view.phase === 'done' && (
          <div className="flex flex-col items-center justify-center h-full gap-4 px-4 bg-gradient-to-b from-felt-900 to-felt-950">
            <div className="text-emerald-100 text-lg font-bold">Match over</div>
            <div className="flex flex-col gap-1 text-sm text-emerald-100">
              {ALL_SEATS.map((s) => (
                <span key={s}>
                  {SEAT_NAMES[s]}: {view.scores[s]}
                </span>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => startMatch()}
                className="rounded-lg px-4 py-2 text-sm font-semibold bg-amber-400 text-emerald-950 shadow"
              >
                Play again
              </button>
              <button
                onClick={onExit}
                className="rounded-lg px-4 py-2 text-sm font-semibold bg-emerald-800 text-emerald-50 shadow"
              >
                Exit
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Deal-end recap. The bots are paused while this is up; Continue resumes. */}
      {showDealSummary && pendingDeal && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-30" onClick={continueDeal}>
          <div
            className="bg-emerald-950 border border-emerald-700 rounded-2xl p-5 flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-emerald-100 font-bold">Deal complete</div>
            <div className="flex flex-col gap-1 text-sm text-emerald-100">
              {ALL_SEATS.map((s) => (
                <span key={s}>
                  {SEAT_NAMES[s]}: {pendingDeal.dealScores[s] >= 0 ? '+' : ''}
                  {pendingDeal.dealScores[s]} <span className="text-emerald-400">(total {pendingDeal.totals[s]})</span>
                </span>
              ))}
            </div>
            <button className="rounded-lg bg-amber-400 text-emerald-950 font-semibold text-sm px-4 py-1.5" onClick={continueDeal}>
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default TrixGame;
