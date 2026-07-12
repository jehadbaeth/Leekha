/**
 * Geometry for a hand of cards fanned across a fixed-width tray, shared by
 * the play-phase hand (GameTable) and the passing screen (PassingPanel) so
 * the two always look and order identically.
 *
 * The whole fan always fits the tray: spacing is computed from the measured
 * width rather than a fixed overlap, and the arc lifts the CENTER card up
 * from the baseline (rather than drooping the edges below it) so no card
 * ever pokes past the tray's bottom edge.
 */
export function fanLayout(n: number, trayW: number, cardW: number, cardH: number, reserveRight = 0) {
  const ROTATE_STEP = 2.5; // degrees of outward tilt per card away from center
  const LIFT_STEP = cardW >= 80 ? 3.5 : 3; // px the arc climbs per card toward the center
  const center = (n - 1) / 2;
  // Rotating the end cards swings their TOP corner outward past the layout
  // slot: with the pivot at bottom-center, that corner moves out by
  // h*sin(θ) - (w/2)(1 - cos(θ)), ~20px at a full hand's end tilt. That
  // overhang has to come out of the usable width or the two outermost cards
  // poke past the screen edges.
  const endRad = (center * ROTATE_STEP * Math.PI) / 180;
  const rotOverhang = Math.ceil(cardH * Math.sin(endRad) - (cardW / 2) * (1 - Math.cos(endRad)));
  const sidePad = 8 + Math.max(0, rotOverhang);
  const available = Math.max(cardW, trayW - sidePad * 2 - reserveRight);
  const step = n > 1 ? Math.min(cardW * 0.72, (available - cardW) / (n - 1)) : 0;
  const fanW = cardW + step * Math.max(0, n - 1);
  const x0 = sidePad + Math.max(0, (available - fanW) / 2);
  const maxLift = Math.ceil(center * LIFT_STEP);
  return {
    /** Tray height: card + arc + headroom for a raised/selected card's pop. */
    trayH: cardH + maxLift + 24,
    maxLift,
    /** Horizontal distance between neighbors == how much of each covered card stays visible. */
    step,
    left: (i: number) => Math.round(x0 + i * step),
    rotate: (i: number) => (n > 1 ? (i - center) * ROTATE_STEP : 0),
    lift: (i: number) => Math.max(0, Math.round((center - Math.abs(i - center)) * LIFT_STEP)),
  };
}

/**
 * A fan whose cards would each show less than half their width is too
 * cramped to read or tap comfortably (a 13-card hand on a phone leaves
 * ~22px per card); split it into two stories instead — two stacked
 * outward-arced fans, the back row peeking out above the front row.
 */
export function needsTwoStories(n: number, trayW: number, cardW: number, cardH: number, reserveRight = 0): boolean {
  return n > 1 && fanLayout(n, trayW, cardW, cardH, reserveRight).step < cardW * 0.5;
}
