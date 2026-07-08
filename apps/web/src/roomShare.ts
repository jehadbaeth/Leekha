import { useState } from 'react';
import { pick, type Settings } from './settings';

/**
 * "Copy room code" / "share join link" logic (SPEC.md 7.1 item 2), shared
 * between Lobby.tsx (pre-game) and GameTable.tsx (in-game, per the user
 * request that this stay reachable after the round has started too).
 */
export function useRoomShare(roomCode: string | null, language: Settings['language']) {
  const [copied, setCopied] = useState(false);
  const t = (en: string, ar: string) => pick(language, en, ar);
  const joinLink = roomCode ? `${window.location.origin}${window.location.pathname}?join=${roomCode}` : '';

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
    try {
      await navigator.clipboard.writeText(joinLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable; the link is still visible on screen to copy manually
    }
  }

  async function copyCode() {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return { copied, joinLink, share, copyCode };
}
