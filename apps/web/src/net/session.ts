import type { Seat } from '@leekha/engine';

export interface StoredSession {
  roomCode: string;
  seatToken: string;
  seat: Seat;
}

const KEY = 'leekha.session.v1';

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.roomCode === 'string' && typeof parsed?.seatToken === 'string') {
      return parsed as StoredSession;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // ignore storage failures (private mode, quota, etc.)
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
