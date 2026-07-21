import type { Seat } from '@leekha/engine';
import { Flag } from './Flag';
import { avatarLabelHeightForSize } from '../tableScale';

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
  size,
  rtl = false,
  narrow = false,
  flushTop = false,
  speaking = false,
  colorClass,
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
  /** Continuous circle diameter in px, driven by the caller's measured
   * container width (see tableScale.ts). Without it, two fixed breakpoint
   * tiers apply -- fine up to a point, but they stop growing past the
   * biggest tier no matter how much wider the window gets. */
  size?: number;
  /** When true, the presence sublabels ("bot is playing"/"reconnecting") render in Arabic. */
  rtl?: boolean;
  /** Side seats: tighten the name width to slim the column and widen the center. */
  narrow?: boolean;
  /** Top seat: skip the tall label-mirror pad above the circle (only side seats need it, to align with the trick circle). Lets the partner sit near the top edge and frees vertical room for the play area below. */
  flushTop?: boolean;
  /** Voice: this player currently has incoming audio — draw a green glow ring around the circle. */
  speaking?: boolean;
  /** Overrides the team-based circle color (bg + border classes). Used in individual
   * mode to give each seat its own color instead of the two team colors. */
  colorClass?: string;
}) {
  const reconnecting = presence === 'reconnecting';
  const isBot = presence === 'bot';
  const circleStyle = size
    ? { width: size, height: size, fontSize: size * 0.3, borderWidth: Math.max(2, Math.round(size * 0.045)) }
    : undefined;
  // `narrow` (side seats) caps the name width tighter so the avatar's column
  // footprint shrinks, widening the central play area between the two side
  // seats. The circle, timer ring, dealer/danger badges, flag and emote anchor
  // are untouched — only the name's max width tightens (it truncates sooner).
  const nameMaxW = size ? size * (narrow ? 1.05 : 1.7) : undefined;
  // GameTable centers left/right avatars against the trick circle via
  // `items-center` on their shared row, which centers each avatar's WHOLE
  // box (circle + name + score). Since the circle sits at the top of that
  // box with text below it, centering the box put the circle itself
  // visibly above the trick circle's true middle. Mirroring the name+score
  // block's height as invisible padding above the circle makes the circle
  // sit exactly in the middle of Avatar's own box, so centering the box
  // also centers the circle -- without pulling the label out of normal
  // flow, which other call sites (the spectator's own seat avatar) rely on
  // for real layout spacing to whatever content follows.
  const labelPad = flushTop ? 0 : size ? avatarLabelHeightForSize(size, isBot || reconnecting) : 34;
  return (
    <div className={`relative flex flex-col items-center gap-0.5 ${compact ? '' : ''}`} style={{ paddingTop: labelPad }}>
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
        style={circleStyle}
        className={`relative ${size ? '' : 'w-11 h-11 @[900px]:w-16 @[900px]:h-16 text-sm @[900px]:text-lg border-2 @[900px]:border-[3px]'} rounded-full flex items-center justify-center font-bold shadow-[0_2px_5px_rgba(0,0,0,0.4)] transition-opacity ${
          colorClass ?? (team === 0 ? 'bg-sky-700 border-sky-400' : 'bg-rose-700 border-rose-400')
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
        {speaking && (
          // Voice: a green ring + soft glow while this player has incoming audio.
          // Rendered as its own absolutely-positioned element (with its own
          // box-shadow) sitting just outside the circle, so it never touches the
          // circle's own box-shadow slot that the amber turn `ring` uses -- the
          // two stack concentrically instead of overriding each other.
          <span
            className="absolute rounded-full pointer-events-none"
            style={{
              inset: -5,
              boxShadow: '0 0 0 3px #4ade80, 0 0 14px 4px rgba(74,222,128,0.55)',
            }}
          />
        )}
      </div>
      <span
        style={nameMaxW ? { maxWidth: nameMaxW, fontSize: size! * 0.23 } : undefined}
        className={`flex flex-col items-center ${size ? '' : 'max-w-[72px] @[900px]:max-w-[110px]'}`}
      >
        <span className="flex items-center gap-1 max-w-full">
          {country !== undefined && !isBot && (
            <Flag
              country={country ?? 'xx'}
              className={`${size ? '' : 'w-4 h-3 @[900px]:w-5 @[900px]:h-4'} flex-shrink-0`}
              style={size ? { width: size * 0.34, height: size * 0.34 * 0.75 } : undefined}
            />
          )}
          <span className={`${size ? '' : 'text-[11px] @[900px]:text-sm'} text-emerald-100 truncate`}>{name}</span>
        </span>
        {isBot && (
          <span className="text-[9px] bg-slate-600 text-white rounded px-1 whitespace-nowrap">{rtl ? 'روبوت يلعب' : 'bot is playing'}</span>
        )}
        {reconnecting && (
          <span className="text-[9px] bg-slate-600 text-white rounded px-1 whitespace-nowrap">{rtl ? 'يعيد الاتصال' : 'reconnecting'}</span>
        )}
      </span>
      <span
        style={size ? { fontSize: size * 0.24 } : undefined}
        className={`${size ? '' : 'text-xs @[900px]:text-sm'} font-semibold px-1.5 rounded ${danger ? 'bg-red-600 text-white' : 'text-amber-200'}`}
      >
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
