import { SERVER_URL } from './socket';

export interface AuthedUser {
  id: string;
  email: string;
  displayName: string;
}

export interface MatchSummary {
  matchId: string;
  endedAt: number;
  finalScores: [number, number, number, number];
  result: { losingTeam: 0 | 1 | null; bustSeat: number } | null;
}

export interface MatchPlayer {
  seat: number;
  userId: string | null;
  displayName: string;
  wasBot: boolean;
}

export interface MatchDetail {
  match: {
    id: string;
    roomCode: string;
    config: unknown;
    seed: string;
    moveLog: unknown[];
    finalScores: [number, number, number, number];
    result: { losingTeam: 0 | 1 | null; bustSeat: number } | null;
    startedAt: number;
    endedAt: number;
  };
  players: MatchPlayer[];
}

class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'unknown' }));
    throw new ApiError(res.status, typeof body.error === 'string' ? body.error : 'unknown');
  }
  return res.json() as Promise<T>;
}

export async function fetchMe(): Promise<AuthedUser | null> {
  try {
    const { user } = await request<{ user: AuthedUser }>('/api/me');
    return user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export function register(email: string, password: string, displayName: string): Promise<AuthedUser> {
  return request<{ user: AuthedUser }>('/api/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  }).then((r) => r.user);
}

export function login(email: string, password: string): Promise<AuthedUser> {
  return request<{ user: AuthedUser }>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }).then((r) => r.user);
}

export function logout(): Promise<void> {
  return request<{ ok: true }>('/api/logout', { method: 'POST' }).then(() => undefined);
}

export function fetchHistory(): Promise<MatchSummary[]> {
  return request<{ matches: MatchSummary[] }>('/api/history').then((r) => r.matches);
}

export function fetchMatch(matchId: string): Promise<MatchDetail> {
  return request<MatchDetail>(`/api/history/${encodeURIComponent(matchId)}`);
}

export { ApiError };
