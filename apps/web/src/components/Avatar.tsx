import type { Seat } from '@leekha/engine';
import { Flag } from './Flag';

export type PresenceStatus = 'connected' | 'reconnecting' | 'bot';

export function Avatar({
  name,
  score,
  roundScore,
  isTurn,
  isDealer,
  danger,
  team,
  compact = false,
  presence,
  deadline,
  emote,
  emoteDirection = 'up',
  country,
}: {
  name: string;
  score: number;
  /** Points this seat has eaten so far in the current round, resets each round. */
  roundScore: number;
  isTurn: boolean;
  isDealer: boolean;
  danger: boolean;
  team: 0 | 1;
  seat?: Seat;
  compact?: boolean;
  /** Section 7.3.10: gray the avatar while reconnecting, swap in a robot badge on bot takeover. */
  presence?: PresenceStatus;
  /** Section 7.3.9: ms timestamp the current turn expires at, drives the timer ring. */
  deadline?: number | null;
  /** Section 7.5.11: the most recent emote this seat sent, briefly shown as a big animated sticker pop above the avatar. */
  emote?: { anim: string; caption: string; ts: number } | null;
  /** 'down' for seats sitting close to the top of the viewport (e.g. the partner
   * seat), where popping the sticker upward from '-top-20' pushes it off-screen. */
  emoteDirection?: 'up' | 'down';
  /** ISO 3166-1 alpha-2 the player connects from. Online passes a string or null (null renders the generic xx placeholder flag); local play leaves it undefined and no flag renders at all. */
  country?: string | null;
}) {
  const reconnecting = presence === 'reconnecting';
  const isBot = presence === 'bot';
  return (
    <div className={`relative flex flex-col items-center gap-0.5 ${compact ? '' : ''}`}>
      {emote && (
        <div
          key={emote.ts}
          className={`absolute ${emoteDirection === 'down' ? 'top-full mt-1' : '-top-20'} left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-1 select-none pointer-events-none animate-emote-pop`}
          aria-hidden
        >
          <img src={emote.anim} alt="" className="w-16 h-16 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]" />
          <span className="bg-black/75 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap">
            {emote.caption}
          </span>
        </div>
      )}
      <div
        className={`relative w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-opacity ${
          team === 0 ? 'bg-sky-700 border-sky-400' : 'bg-rose-700 border-rose-400'
        } ${isTurn ? 'ring-2 ring-amber-300 ring-offset-2 ring-offset-felt-950 animate-pulse' : ''} ${
          reconnecting ? 'opacity-40 grayscale' : ''
        }`}
      >
        {isBot ? '🤖' : name.slice(0, 1).toUpperCase()}
        {isDealer && (
          <span className="absolute -bottom-1 -right-1 text-[10px] bg-amber-400 text-emerald-950 rounded-full px-1 font-bold">
            D
          </span>
        )}
        {reconnecting && (
          <span className="absolute inset-0 rounded-full border-2 border-dashed border-slate-300 animate-spin [animation-duration:2s]" />
        )}
        {isTurn && deadline != null && <TimerRing deadline={deadline} />}
      </div>
      <span className="flex flex-col items-center max-w-[72px]">
        <span className="flex items-center gap-1 max-w-full">
          {country !== undefined && !isBot && <Flag country={country ?? 'xx'} className="w-4 h-3 flex-shrink-0" />}
          <span className="text-[11px] text-emerald-100 truncate">{name}</span>
        </span>
        {isBot && (
          <span className="text-[9px] bg-slate-600 text-white rounded px-1 whitespace-nowrap">bot is playing</span>
        )}
        {reconnecting && (
          <span className="text-[9px] bg-slate-600 text-white rounded px-1 whitespace-nowrap">reconnecting</span>
        )}
      </span>
      <span className={`text-xs font-semibold px-1.5 rounded ${danger ? 'bg-red-600 text-white' : 'text-amber-200'}`}>
        {roundScore} / {score}
      </span>
    </div>
  );
}

/** A ring around the active avatar that sweeps down to the play/pass deadline (SPEC 7.3.9). */
function TimerRing({ deadline }: { deadline: number }) {
  const total = Math.max(1, deadline - Date.now());
  const dur = `${(total / 1000).toFixed(2)}s`;
  return (
    <svg className="absolute -inset-1 w-[calc(100%+8px)] h-[calc(100%+8px)] -rotate-90 pointer-events-none" viewBox="0 0 40 40">
      <circle
        cx="20"
        cy="20"
        r="18"
        fill="none"
        stroke="rgb(251 191 36)"
        strokeWidth="2"
        strokeDasharray={2 * Math.PI * 18}
        style={{
          animation: `timer-ring-sweep ${dur} linear forwards`,
        }}
      />
      <style>{`@keyframes timer-ring-sweep { from { stroke-dashoffset: 0; } to { stroke-dashoffset: ${2 * Math.PI * 18}; } }`}</style>
    </svg>
  );
}
