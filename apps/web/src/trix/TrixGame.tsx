import { useEffect, useState } from 'react';
import { ALL_CONTRACTS, TRICK_CONTRACTS, type Contract, type Seat, type TrixRulesConfig } from '@leekha/trix';
import { GameTable } from '../components/GameTable';
import type { Settings } from '../settings';
import { useTrixGame } from './useTrixGame';
import { TrixLayoutCenter } from './TrixLayoutCenter';
import { trixToSeatView, trixSeatTally, contractLabel } from './trixAdapter';
import { CardFace } from '../components/CardFace';
import { CONTRACT_LABEL, SEAT_NAMES, cardKey, cardLabel } from './trixLabels';

const HUMAN_SEAT: Seat = 0;
const ALL_SEATS: Seat[] = [0, 1, 2, 3];

/**
 * Trix reuses Leekha's real GameTable (avatars, hand fan, trick circle, emotes,
 * sounds) via the game-agnostic seam overrides. Only the genuinely Trix-specific
 * regions are supplied: a HUD line (kingdom + contract), the Fan-Tan board in the
 * centre for the layout contract, a contract picker / doubling panel in the
 * bottom slot, and the deal-recap / match-over overlays.
 */
export function TrixGame({ config, settings, onExit }: { config: TrixRulesConfig; settings: Settings; onExit: () => void }) {
  const { match, view, startMatch, pendingDeal, continueDeal, humanChooseContract, humanExpose, humanPass, humanPlay } =
    useTrixGame(config);
  const [selected, setSelected] = useState<Contract[]>([]);

  useEffect(() => {
    startMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Entering a fresh contract choice: under Complex, pre-select every remaining
  // penalty (trick) contract so the natural one-tap action plays them combined,
  // which is what "Complex" means. The player can still deselect to split them.
  useEffect(() => {
    if (config.complex && view?.phase === 'selecting' && view.choosableContracts) {
      setSelected(view.choosableContracts.filter((c) => TRICK_CONTRACTS.includes(c)));
    } else {
      setSelected([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.phase, view?.kingdomIndex]);

  if (!match || !view) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-b from-felt-900 to-felt-950 text-emerald-100">
        Dealing…
      </div>
    );
  }

  const ownerIsHuman = view.choosableContracts !== null;
  const teamScores: [number, number] | null = config.partnership
    ? [view.scores[0] + view.scores[2], view.scores[1] + view.scores[3]]
    : null;
  const contractText = view.contracts.map(contractLabel).join(' + ') || '—';

  // --- HUD: kingdom + contract + progress, in the shared HUD strip slot ---
  const hud = (
    <div className="flex flex-col gap-0.5 bg-emerald-950/60 py-1 px-2">
      <div className="flex items-center justify-center gap-2 text-[11px] text-emerald-100">
        <span className="font-semibold text-amber-200">{contractText}</span>
        {(view.phase === 'trick' || view.phase === 'layout') && (
          <span className="text-emerald-300">
            {view.phase === 'layout' ? `${view.hand.length} left` : `trick ${view.trickNumber}/13`}
          </span>
        )}
        <span className="text-emerald-400">·</span>
        <span className="text-emerald-300">
          K{view.kingdomIndex + 1}/4 {SEAT_NAMES[view.kingdomOwner]}&rsquo;s
        </span>
      </div>
      <div className="flex items-center justify-center gap-1 flex-wrap">
        {ALL_CONTRACTS.map((c) => (
          <span
            key={c}
            className={`rounded px-1.5 text-[9px] ${
              view.contractsSpent.includes(c)
                ? 'text-emerald-500 line-through'
                : view.contracts.includes(c)
                  ? 'bg-amber-400 text-emerald-950 font-bold'
                  : 'text-emerald-300'
            }`}
          >
            {CONTRACT_LABEL[c]}
          </span>
        ))}
        {teamScores && (
          <span className="text-[9px] text-sky-300 ml-1">
            {teamScores[0]} <span className="text-emerald-500">vs</span> <span className="text-rose-300">{teamScores[1]}</span>
          </span>
        )}
      </div>
      {config.restrictKingOfHeartsLead && view.phase === 'trick' && view.contracts.includes('kingOfHearts') && (
        <div className="text-center text-[9px] text-rose-200/80">
          ♥ can&rsquo;t be led while King of Hearts is live (only when you hold nothing else)
        </div>
      )}
    </div>
  );

  // --- Bottom slot: contract picker (selecting) / doubling (exposing) ---
  let bottom: React.ReactNode = undefined;
  if (view.phase === 'selecting') {
    bottom = (
      <div className="flex flex-col items-center gap-2 px-4 py-4">
        {ownerIsHuman ? (
          <>
            <div className="text-emerald-100 text-sm font-semibold">Choose a contract</div>
            <div className="flex flex-wrap gap-2 justify-center max-w-xs">
              {(view.choosableContracts ?? []).map((c) => {
                const isSelected = selected.includes(c);
                return (
                  <button
                    key={c}
                    onClick={() => {
                      if (!config.complex || c === 'trix') humanChooseContract([c]);
                      else setSelected((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
                    }}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold shadow ${isSelected ? 'bg-amber-400 text-emerald-950' : 'bg-emerald-800 text-emerald-50'}`}
                  >
                    {CONTRACT_LABEL[c]}
                  </button>
                );
              })}
            </div>
            {config.complex && selected.length > 0 && (
              <button onClick={() => humanChooseContract(selected)} className="rounded-lg px-5 py-2 text-sm font-bold bg-amber-400 text-emerald-950 shadow">
                {selected.length > 1 ? 'Play combined: ' : 'Play '}
                {selected.map(contractLabel).join(' + ')}
              </button>
            )}
          </>
        ) : (
          <div className="text-emerald-200 text-sm">Waiting for {SEAT_NAMES[view.kingdomOwner]} to choose a contract…</div>
        )}
      </div>
    );
  } else if (view.phase === 'exposing') {
    bottom = (
      <div className="flex flex-col items-center gap-2 px-4 py-4">
        <div className="text-emerald-100 text-sm font-semibold">Doubling window</div>
        {view.turn === HUMAN_SEAT ? (
          <div className="flex flex-wrap gap-2 justify-center">
            {view.exposable.map((c) => (
              <button key={cardKey(c)} onClick={() => humanExpose(c)} className="rounded-lg px-4 py-2 text-sm font-semibold bg-amber-400 text-emerald-950 shadow">
                Double {cardLabel(c)}
              </button>
            ))}
            {view.canPass && (
              <button onClick={humanPass} className="rounded-lg px-4 py-2 text-sm font-semibold bg-emerald-800 text-emerald-50 shadow">
                {view.exposable.length > 0 ? 'Skip' : 'Done'}
              </button>
            )}
          </div>
        ) : (
          <div className="text-emerald-200 text-sm">Waiting for {SEAT_NAMES[view.turn ?? view.kingdomOwner]}…</div>
        )}
      </div>
    );
  }

  // --- Overlay: deal recap (paused) or match over ---
  let overlay: React.ReactNode = undefined;
  if (view.phase === 'done') {
    const winner = teamScores
      ? teamScores[0] >= teamScores[1]
        ? `${SEAT_NAMES[0]} + ${SEAT_NAMES[2]}`
        : `${SEAT_NAMES[1]} + ${SEAT_NAMES[3]}`
      : SEAT_NAMES[[...ALL_SEATS].sort((a, b) => view.scores[b] - view.scores[a])[0]];
    overlay = (
      <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-40 px-4">
        <div className="bg-emerald-950 border border-emerald-700 rounded-2xl p-5 flex flex-col items-center gap-3 max-w-xs w-full">
          <div className="text-amber-300 text-lg font-bold">🏆 {winner} win</div>
          <div className="flex flex-col gap-1 text-sm text-emerald-100 w-full">
            {[...ALL_SEATS].sort((a, b) => view.scores[b] - view.scores[a]).map((s) => (
              <div key={s} className="flex justify-between">
                <span className={s === HUMAN_SEAT ? 'text-amber-300 font-semibold' : ''}>{SEAT_NAMES[s]}</span>
                <span className="font-mono">{view.scores[s]}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={() => startMatch()} className="rounded-lg px-4 py-2 text-sm font-semibold bg-amber-400 text-emerald-950 shadow">
              Play again
            </button>
            <button onClick={onExit} className="rounded-lg px-4 py-2 text-sm font-semibold bg-emerald-800 text-emerald-50 shadow">
              Exit
            </button>
          </div>
        </div>
      </div>
    );
  } else if (pendingDeal) {
    overlay = (
      <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-40 px-4" onClick={continueDeal}>
        <div className="bg-emerald-950 border border-emerald-700 rounded-2xl p-5 flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
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
    );
  }

  return (
    <GameTable
      view={trixToSeatView(view)}
      names={SEAT_NAMES}
      events={[]}
      clearEvent={() => {}}
      passesApplied
      passProgress={[false, false, false, false]}
      settings={settings}
      onCommitPass={() => {}}
      onPlayCard={humanPlay}
      onAdvanceRound={continueDeal}
      onRematch={() => startMatch()}
      onHome={onExit}
      hudOverride={hud}
      centerOverride={view.phase === 'layout' ? <TrixLayoutCenter view={view} onPass={humanPass} /> : undefined}
      bottomOverride={bottom}
      overlayOverride={overlay}
      seatSubline={(seat) => trixSeatTally(view, seat)}
    />
  );
}

export default TrixGame;
