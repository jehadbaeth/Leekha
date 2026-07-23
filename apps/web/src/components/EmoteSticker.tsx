import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export interface EmoteStickerData {
  anim: string;
  caption: string;
  ts: number;
}

/**
 * Renders the big animated emote sticker in a portal to document.body,
 * positioned in viewport coordinates from a live measurement of `anchorRef`,
 * instead of `position: absolute` + `z-index` inside the seat's own layout
 * subtree. Firefox for Android has been confirmed (real-device report) to
 * paint this sticker BEHIND the felt trick disc from the second occurrence
 * onward despite a z-index above it — a known class of Gecko mobile bug
 * where an element re-triggering a CSS animation (our key-remount-per-fire)
 * doesn't get correctly re-promoted to its own compositing layer, so its
 * z-index stops being honored against a sibling subtree. A portal sidesteps
 * needing z-index to escape any ancestor's stacking context at all: this
 * sticker is a direct child of <body>, so there is no ancestor stacking
 * context for the felt disc (or anything else) to trap it behind.
 */
export function EmoteSticker({
  anchorRef,
  emote,
  computeStyle,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  emote: EmoteStickerData | null | undefined;
  computeStyle: (rect: DOMRect) => { left: number; top?: number; bottom?: number };
}) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  useEffect(() => {
    if (!emote) {
      setPos(null);
      return;
    }
    let raf = 0;
    // Track the anchor every frame for the sticker's whole ~2.2s life: the
    // table can reflow (e.g. a rotation, or the hand tray resizing) while
    // it's showing, and a portal has no other way to follow its anchor.
    const measure = () => {
      const el = anchorRef.current;
      if (el) setPos(computeStyle(el.getBoundingClientRect()));
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emote?.ts]);

  if (!emote || !pos) return null;

  return createPortal(
    <div
      className="fixed z-[70] pointer-events-none"
      style={{ left: pos.left, top: pos.top, bottom: pos.bottom, transform: 'translateX(-50%)' }}
      aria-hidden
    >
      <div key={emote.ts} className="flex flex-col items-center gap-1 select-none animate-emote-pop">
        <img src={emote.anim} alt="" className="w-16 h-16 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]" />
        <span className="bg-black/75 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap">
          {emote.caption}
        </span>
      </div>
    </div>,
    document.body,
  );
}
