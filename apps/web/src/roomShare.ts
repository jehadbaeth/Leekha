import { useState } from 'react';
import { pick, type Settings } from './settings';

// navigator.clipboard is only exposed in a secure context (HTTPS or
// localhost); a plain-HTTP LAN deployment (e.g. a local test server) has
// `navigator.clipboard` as undefined, so writeText throws immediately and a
// bare try/catch around it silently does nothing. This legacy execCommand
// path has no such restriction and is still broadly supported as a fallback.
function legacyCopy(text: string): boolean {
  const el = document.createElement('textarea');
  el.value = text;
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.focus();
  el.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(el);
  return ok;
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy fallback below
    }
  }
  return legacyCopy(text);
}

/**
 * "Copy room code" / "share join link" logic (SPEC.md 7.1 item 2), shared
 * between Lobby.tsx (pre-game) and GameTable.tsx (in-game, per the user
 * request that this stay reachable after the round has started too).
 */
export function useRoomShare(roomCode: string | null, language: Settings['language']) {
  const [copied, setCopied] = useState(false);
  const t = (en: string, ar: string) => pick(language, en, ar);
  const joinLink = roomCode ? `${window.location.origin}${window.location.pathname}?join=${roomCode}` : '';

  function flashCopied() {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  async function share() {
    if (!roomCode) return;
    const text = t(`Join my Leekha room: ${roomCode}`, `انضم إلى غرفتي في ليخة: ${roomCode}`);
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Leekha', text, url: joinLink });
        return;
      } catch {
        // user cancelled the share sheet or it failed; fall through to copy
      }
    }
    if (await copyText(joinLink)) flashCopied();
  }

  async function copyCode() {
    if (!roomCode) return;
    if (await copyText(roomCode)) flashCopied();
  }

  return { copied, joinLink, share, copyCode };
}
