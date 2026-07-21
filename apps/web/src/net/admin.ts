import { SERVER_URL } from './socket';

// The admin token is a standalone secret (server ADMIN_TOKEN), NOT the account
// session. It is entered once into the panel and kept in localStorage, and sent
// as an Authorization header on every admin call. A custom header (not a
// cookie) is also what makes the destructive endpoints CSRF-safe.
const TOKEN_KEY = 'leekha_admin_token';

export function loadAdminToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function saveAdminToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}
export function clearAdminToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export interface AdminHealth {
  connectedSockets: number;
  activeRooms: number;
  playersInGame: number;
  uptimeSec: number;
  memoryMb: number;
}
export interface AdminOverview {
  sinceMs: number;
  total: number;
  stats: { count: number; avgDurationMs: number | null; busts: number; uniquePlayers: number };
  health: AdminHealth;
}
export interface AdminMatch {
  id: string;
  roomCode: string;
  startedAt: number;
  endedAt: number;
  finalScores: [number, number, number, number];
  result: { losingTeam: 0 | 1 | null; bustSeat: number } | null;
  players: { seat: number; displayName: string; wasBot: number }[];
}
export interface LiveGame {
  roomCode: string;
  phase: string;
  roundIndex: number;
  scores: [number, number, number, number];
  players: { seat: number; name: string | null; isBot: boolean; connected: boolean }[];
}

async function adminRequest<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `http-${res.status}` }));
    throw new Error(typeof body.error === 'string' ? body.error : `http-${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** True if the token is accepted; false on 401/disabled; throws only on network trouble. */
export async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    await adminRequest('/api/admin/verify', token);
    return true;
  } catch {
    return false;
  }
}

export interface AdminUsage {
  sinceMs: number;
  summary: { sessions: number; uniqueVisitors: number; avgDurationMs: number | null };
  buckets: { bucket: string; sessions: number; avgDurationMs: number }[];
  byCountry: { country: string | null; sessions: number }[];
  recent: { name: string | null; country: string | null; startedAt: number; durationMs: number }[];
}

export interface AdminError {
  id: string;
  source: string;
  message: string;
  stack: string | null;
  url: string | null;
  userAgent: string | null;
  createdAt: number;
}

export const fetchOverview = (token: string, sinceMs = 0) =>
  adminRequest<AdminOverview>(`/api/admin/overview?sinceMs=${sinceMs}`, token);
export const fetchUsage = (token: string, sinceMs: number, bucket: 'day' | 'hour') =>
  adminRequest<AdminUsage>(`/api/admin/usage?sinceMs=${sinceMs}&bucket=${bucket}`, token);
export const fetchErrors = (token: string, sinceMs: number) =>
  adminRequest<{ summary: { total: number; server: number; client: number }; errors: AdminError[] }>(
    `/api/admin/errors?sinceMs=${sinceMs}`,
    token,
  );
export const clearData = (token: string, what: 'sessions' | 'errors' | 'matches') =>
  adminRequest<{ cleared: number }>('/api/admin/clear', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ what }),
  });
export const fetchLive = (token: string) => adminRequest<{ live: LiveGame[] }>('/api/admin/live', token);
export const fetchAdminMatches = (token: string, limit = 100, offset = 0) =>
  adminRequest<{ matches: AdminMatch[]; total: number }>(`/api/admin/matches?limit=${limit}&offset=${offset}`, token);
export const fetchMatchesPerDay = (token: string, days = 30) =>
  adminRequest<{ buckets: { day: string; count: number }[] }>(`/api/admin/matches-per-day?days=${days}`, token);

/** Fetch a protected endpoint with the token and trigger a browser download of the JSON body. */
export async function downloadAdmin(path: string, token: string, filename: string): Promise<void> {
  const res = await fetch(`${SERVER_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`http-${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
