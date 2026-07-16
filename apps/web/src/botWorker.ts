import type { Card, SeatView } from '@leekha/engine';
import { chooseSearchPlay } from '@leekha/bots';

/**
 * Web Worker running the hard bot's sampled-world search off the main
 * thread, so a slow phone never janks the table animation while a bot
 * "thinks". Passing stays on the main thread (the hard tier passes with the
 * cheap medium heuristic, same as the server's botForLevel).
 *
 * Slightly under the server's 320: the server budget was tuned on Node with
 * a dedicated core; a phone worker shares cores with the render process, and
 * 240 keeps worst-case decisions comfortably inside the 600-1800ms fake
 * thinking delay that masks them.
 */
const WEB_SEARCH_ROLLOUTS = 240;

export interface BotWorkRequest {
  id: number;
  view: SeatView;
}

export type BotWorkResponse = { id: number; ok: true; card: Card } | { id: number; ok: false; error: string };

self.onmessage = (e: MessageEvent<BotWorkRequest>) => {
  const { id, view } = e.data;
  try {
    const card = chooseSearchPlay(view, { rng: Math.random, totalRollouts: WEB_SEARCH_ROLLOUTS });
    (self as unknown as Worker).postMessage({ id, ok: true, card } satisfies BotWorkResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(err) } satisfies BotWorkResponse);
  }
};
