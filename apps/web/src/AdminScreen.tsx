import { useCallback, useEffect, useState } from 'react';
import {
  loadAdminToken,
  saveAdminToken,
  clearAdminToken,
  verifyAdminToken,
  fetchOverview,
  fetchLive,
  fetchAdminMatches,
  fetchMatchesPerDay,
  downloadAdmin,
  type AdminOverview,
  type AdminMatch,
  type LiveGame,
} from './net/admin';

type Tab = 'overview' | 'matches';

function fmtDuration(ms: number | null): string {
  if (!ms || ms <= 0) return '—';
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
function fmtUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl bg-emerald-950/60 border border-emerald-800 p-4">
      <div className="text-2xl font-bold text-white tabular-nums">{value}</div>
      <div className="text-xs uppercase tracking-wide text-emerald-300 mt-1">{label}</div>
      {sub && <div className="text-[11px] text-emerald-400 mt-0.5">{sub}</div>}
    </div>
  );
}

/** Minimal dependency-free bar chart for the games-per-day view. */
function MiniBars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-1 h-32">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0" title={`${d.label}: ${d.value}`}>
          <div className="w-full rounded-t bg-amber-400/80" style={{ height: `${(d.value / max) * 100}%` }} />
          <div className="text-[8px] text-emerald-400 truncate w-full text-center">{d.label.slice(5)}</div>
        </div>
      ))}
    </div>
  );
}

export function AdminScreen({ onExit }: { onExit: () => void }) {
  const [token, setToken] = useState<string | null>(loadAdminToken());
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  // Validate any stored token on mount.
  useEffect(() => {
    let alive = true;
    if (!token) {
      setAuthed(false);
      return;
    }
    verifyAdminToken(token).then((ok) => {
      if (!alive) return;
      setAuthed(ok);
      if (!ok) clearAdminToken();
    });
    return () => {
      alive = false;
    };
  }, [token]);

  if (authed === null) {
    return <div className="min-h-full grid place-items-center bg-felt-950 text-emerald-200">Checking…</div>;
  }
  if (!authed) {
    return <TokenGate onSubmit={(t) => { saveAdminToken(t); setToken(t); setAuthed(null); }} onExit={onExit} />;
  }

  return (
    <div className="min-h-full bg-felt-950 text-white">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Leekha Admin</h1>
          <div className="flex gap-2">
            <button className="text-xs rounded-full border border-emerald-700 px-3 py-1.5 text-emerald-200 hover:bg-emerald-800/50" onClick={onExit}>
              Exit
            </button>
            <button
              className="text-xs rounded-full border border-rose-600/50 px-3 py-1.5 text-rose-300 hover:bg-rose-900/40"
              onClick={() => { clearAdminToken(); setToken(null); }}
            >
              Sign out
            </button>
          </div>
        </div>

        <div className="flex gap-1 mb-5 border-b border-emerald-800">
          {(['overview', 'matches'] as Tab[]).map((tb) => (
            <button
              key={tb}
              className={`px-4 py-2 text-sm capitalize -mb-px border-b-2 ${tab === tb ? 'border-amber-400 text-white' : 'border-transparent text-emerald-300 hover:text-white'}`}
              onClick={() => setTab(tb)}
            >
              {tb}
            </button>
          ))}
        </div>

        {tab === 'overview' && <OverviewTab token={token!} />}
        {tab === 'matches' && <MatchesTab token={token!} />}
      </div>
    </div>
  );
}

function TokenGate({ onSubmit, onExit }: { onSubmit: (t: string) => void; onExit: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  return (
    <div className="min-h-full grid place-items-center bg-felt-950 px-6">
      <div className="w-full max-w-sm flex flex-col gap-3">
        <h1 className="text-xl font-bold text-white">Admin access</h1>
        <p className="text-sm text-emerald-300">Enter the admin token to view telemetry.</p>
        <input
          type="password"
          autoFocus
          className="rounded-lg px-3 py-2 text-slate-900 bg-white font-mono"
          value={value}
          placeholder="ADMIN_TOKEN"
          onChange={(e) => { setValue(e.target.value); setError(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) onSubmit(value.trim()); }}
        />
        {error && <p className="text-rose-400 text-xs">Token rejected.</p>}
        <button
          className="rounded-xl bg-amber-400 text-emerald-950 font-semibold py-2.5 disabled:opacity-40"
          disabled={!value.trim()}
          onClick={async () => {
            const ok = await verifyAdminToken(value.trim());
            if (ok) onSubmit(value.trim());
            else setError(true);
          }}
        >
          Enter
        </button>
        <button className="text-emerald-300 text-sm underline" onClick={onExit}>
          Back to game
        </button>
      </div>
    </div>
  );
}

const RANGES: { key: string; label: string; since: () => number }[] = [
  { key: 'today', label: 'Today', since: () => new Date(new Date().setHours(0, 0, 0, 0)).getTime() },
  { key: '7d', label: '7 days', since: () => Date.now() - 7 * 86_400_000 },
  { key: '30d', label: '30 days', since: () => Date.now() - 30 * 86_400_000 },
  { key: 'all', label: 'All time', since: () => 0 },
];

function OverviewTab({ token }: { token: string }) {
  const [rangeKey, setRangeKey] = useState('7d');
  const [data, setData] = useState<AdminOverview | null>(null);
  const [perDay, setPerDay] = useState<{ day: string; count: number }[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const since = (RANGES.find((r) => r.key === rangeKey) ?? RANGES[1]).since();
    fetchOverview(token, since).then(setData).catch((e) => setErr(String(e.message ?? e)));
    fetchMatchesPerDay(token, 21).then((r) => setPerDay(r.buckets)).catch(() => {});
  }, [token, rangeKey]);

  // Live health refresh every 5s; the DB summary rides along, it's cheap.
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  if (err) return <p className="text-rose-400">{err}</p>;
  if (!data) return <p className="text-emerald-300">Loading…</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-sm uppercase tracking-wide text-emerald-300 mb-2">Live</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="Connected" value={data.health.connectedSockets} sub="open sockets" />
          <Stat label="In game" value={data.health.playersInGame} sub="players now" />
          <Stat label="Active rooms" value={data.health.activeRooms} />
          <Stat label="Uptime" value={fmtUptime(data.health.uptimeSec)} />
          <Stat label="Memory" value={`${data.health.memoryMb} MB`} />
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h2 className="text-sm uppercase tracking-wide text-emerald-300">Matches</h2>
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                className={`text-xs rounded-full px-3 py-1 ${rangeKey === r.key ? 'bg-amber-400 text-emerald-950 font-semibold' : 'bg-emerald-800 text-emerald-100'}`}
                onClick={() => setRangeKey(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Matches" value={data.stats.count} sub={`of ${data.total} all-time`} />
          <Stat label="Players" value={data.stats.uniquePlayers} sub="distinct humans" />
          <Stat label="Avg length" value={fmtDuration(data.stats.avgDurationMs)} />
          <Stat label="Busts" value={data.stats.busts} sub="reached target" />
        </div>
      </div>
      {perDay.length > 0 && (
        <div>
          <h2 className="text-sm uppercase tracking-wide text-emerald-300 mb-2">Games per day (21d)</h2>
          <MiniBars data={perDay.map((d) => ({ label: d.day, value: d.count }))} />
        </div>
      )}
    </div>
  );
}

function MatchesTab({ token }: { token: string }) {
  const [matches, setMatches] = useState<AdminMatch[]>([]);
  const [live, setLive] = useState<LiveGame[]>([]);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminMatch | null>(null);

  useEffect(() => {
    fetchAdminMatches(token, 100, 0).then((r) => { setMatches(r.matches); setTotal(r.total); }).catch((e) => setErr(String(e.message ?? e)));
    const loadLive = () => fetchLive(token).then((r) => setLive(r.live)).catch(() => {});
    loadLive();
    const id = setInterval(loadLive, 5000);
    return () => clearInterval(id);
  }, [token]);

  if (err) return <p className="text-rose-400">{err}</p>;
  return (
    <div className="flex flex-col gap-5">
      {live.length > 0 && (
        <div>
          <h2 className="text-sm uppercase tracking-wide text-amber-300 mb-2">Ongoing ({live.length})</h2>
          <div className="flex flex-col gap-1.5">
            {live.map((g) => (
              <div key={g.roomCode} className="rounded-lg bg-amber-950/30 border border-amber-700/50 px-3 py-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white">
                    {g.players.map((p) => `${p.name ?? 'Empty'}${p.isBot ? ' (bot)' : ''}`).join(', ')}
                  </span>
                  <span className="text-amber-300 text-xs shrink-0">room {g.roomCode}</span>
                </div>
                <div className="text-[11px] text-emerald-300 mt-0.5">
                  {g.phase} · round {g.roundIndex + 1} · scores {g.scores.join(' / ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm uppercase tracking-wide text-emerald-300 mb-1">Finished</h2>
        <p className="text-xs text-emerald-400 mb-2">{total} total, showing latest {matches.length}. Tap a match for details.</p>
        <div className="flex flex-col gap-1.5">
          {matches.map((m) => (
            <button
              key={m.id}
              className="text-left flex items-center justify-between gap-3 rounded-lg bg-emerald-950/50 border border-emerald-800 px-3 py-2 hover:bg-emerald-900/50"
              onClick={() => setSelected(m)}
            >
              <div className="min-w-0">
                <div className="text-sm text-white truncate">
                  {m.players.map((p) => `${p.displayName}${p.wasBot ? ' (bot)' : ''}`).join(', ')}
                </div>
                <div className="text-[11px] text-emerald-400">
                  {fmtDate(m.endedAt)} · {fmtDuration(m.endedAt - m.startedAt)} · room {m.roomCode}
                </div>
              </div>
              <span className="shrink-0 text-emerald-400 text-xs">details ›</span>
            </button>
          ))}
        </div>
      </div>

      {selected && <MatchDetail match={selected} token={token} onClose={() => setSelected(null)} />}
    </div>
  );
}

function MatchDetail({ match, token, onClose }: { match: AdminMatch; token: string; onClose: () => void }) {
  const winningTeam = match.result ? (match.result.losingTeam === 0 ? 1 : 0) : null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-emerald-950 border border-emerald-700 p-5 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">Match detail</h3>
          <button className="text-emerald-300 text-sm" onClick={onClose}>Close</button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-emerald-800 px-2.5 py-1 text-emerald-100">Finished</span>
          {match.result ? (
            <span className="rounded-full bg-rose-900/50 border border-rose-700/50 px-2.5 py-1 text-rose-200">
              Team {winningTeam} won · seat {match.result.bustSeat} busted
            </span>
          ) : (
            <span className="rounded-full bg-emerald-800 px-2.5 py-1 text-emerald-100">Ended (no bust)</span>
          )}
          <span className="rounded-full bg-emerald-800 px-2.5 py-1 text-emerald-100">room {match.roomCode}</span>
        </div>
        <div className="text-xs text-emerald-300">
          {fmtDate(match.startedAt)} → {fmtDate(match.endedAt)} · {fmtDuration(match.endedAt - match.startedAt)}
        </div>
        <div className="flex flex-col gap-1">
          {[...match.players].sort((a, b) => a.seat - b.seat).map((p) => {
            const team = p.seat % 2;
            const onWinningTeam = winningTeam !== null && team === winningTeam;
            return (
              <div key={p.seat} className="flex items-center justify-between rounded-lg bg-emerald-900/40 px-3 py-1.5 text-sm">
                <span className="text-white">
                  <span className={`inline-block w-2 h-2 rounded-full mr-2 ${team === 0 ? 'bg-sky-400' : 'bg-rose-400'}`} />
                  {p.displayName}{p.wasBot ? ' (bot)' : ''}
                  {onWinningTeam && <span className="text-amber-300 text-xs ml-2">winner</span>}
                </span>
                <span className="font-mono tabular-nums text-emerald-200">{match.finalScores[p.seat]}</span>
              </div>
            );
          })}
        </div>
        <button
          className="rounded-xl bg-amber-400 text-emerald-950 font-semibold py-2.5"
          onClick={() => downloadAdmin(`/api/admin/matches/${encodeURIComponent(match.id)}/export`, token, `match-${match.id}.json`)}
        >
          Export move log
        </button>
      </div>
    </div>
  );
}
