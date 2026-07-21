/**
 * Continuous size formulas for the table's cards/avatars/trick area, driven
 * by the measured container width (the same `trayW` GameTable/PassingPanel
 * already track via ResizeObserver). Earlier this scaled in a few fixed
 * breakpoint steps (mobile/480px/900px tiers): fine up to a 1440x900-ish
 * laptop, but on anything wider (a 1440p/2560px monitor) the container blows
 * past the last breakpoint and everything freezes at the 900px-tier size,
 * so a much bigger window gets the same small cards floating in more empty
 * felt -- the exact complaint, just re-triggered at a bigger container
 * width. clamp(min, ratio * containerPx, max) instead scales continuously
 * the whole time, and only stops growing at a deliberate max so cards don't
 * become absurdly large on an ultrawide.
 */

const CARD_ASPECT = 146 / 104; // height / width, matched to the old xl tier

export function cardWidthForContainer(containerPx: number): number {
  // Bumped from a 60px floor / 0.125 ratio: the hand is the most important,
  // most-tapped thing, and on phones it was floored tiny while ~380px of felt
  // sat empty above it. Bigger cards fill that reclaimed vertical space with a
  // taller two-story fan (size stays stable across the deal; only overlap
  // shrinks as cards deplete). Still clamped so it can't overflow a 320px phone
  // or grow absurd on a desktop shell.
  return Math.max(74, Math.min(168, containerPx * 0.17));
}

export function cardHeightForWidth(width: number): number {
  return width * CARD_ASPECT;
}

export function cardFontPxForWidth(width: number): number {
  return width * 0.29;
}

export function avatarSizeForContainer(containerPx: number): number {
  return Math.max(44, Math.min(76, containerPx * 0.058));
}

export function trickCircleForContainer(containerPx: number): number {
  return Math.max(144, Math.min(320, containerPx * 0.29));
}

/**
 * Played-card width for the trick area, derived from the circle's own
 * diameter rather than the table width. The four played cards are anchored
 * at the circle's N/E/S/W edges (see posFor in GameTable.tsx); two
 * perpendicular edge-anchored cards start overlapping once width exceeds
 * diameter/3 (a card centered on one edge and a card flush against the next
 * edge share both an x- and a y-range past that point). Dividing by 2.85
 * instead of cardWidthForContainer's independent tableW-based ratio lets
 * adjacent plays overlap a little at every container size (each stays mostly
 * visible, just the corners tuck under one another) rather than freezing at
 * the old, more conservative gap.
 */
export function trickCardWidthForCircle(diameter: number): number {
  return diameter / 2.85;
}

/**
 * Gap between an avatar and the trick circle. Scaling this purely off
 * avatarSize under-shoots on mobile: avatarSizeForContainer floors at 44 for
 * every container under ~760px (nearly all phones), so a plain ratio of it
 * stayed tiny there and the avatar visibly touched the circle. The floor
 * below guarantees real breathing room at that floor size; the ratio still
 * lets the gap grow on wider desktop tables.
 */
export function avatarGapForContainer(avatarSize: number): number {
  return Math.min(28, Math.max(24, avatarSize * 0.6));
}

/**
 * Height of the name+score block Avatar renders below its circle, at a given
 * circle diameter. Avatar.tsx uses this to add matching invisible padding
 * above the circle, so the circle sits exactly in the middle of Avatar's own
 * box rather than above it -- otherwise the parent row's `items-center`
 * (which vertically centers each avatar's whole box against the much taller
 * trick circle) centers the *box*, and since the circle sits at the top of
 * it with text below, the circle itself renders visibly above the trick
 * circle's true middle. Keeping the label in normal flow (rather than
 * absolutely positioning it out of flow) matters too: other call sites, like
 * the spectator's own seat avatar, rely on Avatar's real rendered height to
 * space out whatever content follows it.
 */
export function avatarLabelHeightForSize(size: number, hasBadge = false): number {
  const gap = 2; // Tailwind gap-0.5 between the circle/name/score flex children
  // 1.53 matches this app's rendered line-height/font-size ratio for these
  // spans (measured directly via getBoundingClientRect against the applied
  // font-size, not the CSS default of ~1.2 -- using 1.2 here under-counted
  // real rendered height by ~10px and left the circle off-center).
  const lineHeightRatio = 1.53;
  const nameLineH = size * 0.23 * lineHeightRatio;
  const scoreLineH = size * 0.24 * lineHeightRatio;
  // Bot/reconnecting avatars render a third "bot is playing"/"reconnecting"
  // badge line under the name, a fixed text-[9px] row (not scaled by size).
  // Skipping it here would under-count that avatar's real label height, so
  // the mirrored padding above the circle falls short and the circle still
  // rides above the trick circle's true center for every bot seat.
  const badgeLineH = hasBadge ? 9 * lineHeightRatio : 0;
  return Math.round(gap + nameLineH + badgeLineH + gap + scoreLineH);
}
