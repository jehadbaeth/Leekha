import { useCallback, useEffect, useState } from 'react';
import {
  loadAdminToken,
  saveAdminToken,
  clearAdminToken,
  verifyAdminToken,
  fetchOverview,
  fetchUsage,
  fetchErrors,
  fetchLive,
  fetchAdminMatches,
  fetchMatchesPerDay,
  clearData,
  downloadAdmin,
  type AdminOverview,
  type AdminUsage,
  type AdminError,
  type AdminMatch,
  type LiveGame,
} from './net/admin';

type Tab = 'overview' | 'usage' | 'matches' | 'errors' | 'danger';

/** ISO alpha-2 country code to flag emoji; falls back to the code or a globe. */
function flag(code: string | null): string {
  if (!code || code.length !== 2) return '🌐';
  const cc = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '🌐';
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

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

/**
 * Minimal dependency-free bar chart. Each column is full height (items-stretch
 * + a flex-1 bar area), so the bar's percentage height actually resolves --
 * a plain items-end row leaves the columns content-sized and the bars collapse.
 */
function MiniBars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-stretch gap-1 h-32">
      {data.map((d, i) => (
        <div key={i} className="flex-1 min-w-0 flex flex-col" title={`${d.label}: ${d.value}`}>
          <div className="flex-1 flex flex-col justify-end">
            <div className="w-full rounded-t bg-amber-400/80" style={{ height: `${(d.value / max) * 100}%` }} />
          </div>
          <div className="text-[8px] text-emerald-400 truncate text-center mt-1">{d.label.slice(5)}</div>
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

        {/* Concise tabs, and the row itself scrolls (invisibly) rather than the
            whole page if it ever can't fit -- the wider px-4/text-sm buttons
            used to overflow a phone and scroll the admin panel sideways. */}
        <div className="flex gap-1 mb-5 border-b border-emerald-800 overflow-x-auto no-scrollbar">
          {(['overview', 'usage', 'matches', 'errors', 'danger'] as Tab[]).map((tb) => (
            <button
              key={tb}
              className={`shrink-0 px-3 py-2 text-xs capitalize whitespace-nowrap -mb-px border-b-2 ${tab === tb ? 'border-amber-400 text-white' : 'border-transparent text-emerald-300 hover:text-white'}`}
              onClick={() => setTab(tb)}
            >
              {tb}
            </button>
          ))}
        </div>

        {tab === 'overview' && <OverviewTab token={token!} />}
        {tab === 'usage' && <UsageTab token={token!} />}
        {tab === 'matches' && <MatchesTab token={token!} />}
        {tab === 'errors' && <ErrorsTab token={token!} />}
        {tab === 'danger' && <DangerTab token={token!} />}
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

function UsageTab({ token }: { token: string }) {
  const [rangeKey, setRangeKey] = useState('7d');
  const [data, setData] = useState<AdminUsage | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[1];
    const bucket = rangeKey === 'today' ? 'hour' : 'day';
    fetchUsage(token, range.since(), bucket).then(setData).catch((e) => setErr(String(e.message ?? e)));
  }, [token, rangeKey]);

  if (err) return <p className="text-rose-400">{err}</p>;
  if (!data) return <p className="text-emerald-300">Loading…</p>;

  const maxCountry = Math.max(1, ...data.byCountry.map((c) => c.sessions));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm uppercase tracking-wide text-emerald-300">Visits</h2>
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

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label="Visits" value={data.summary.sessions} sub="sessions" />
        <Stat label="Unique visitors" value={data.summary.uniqueVisitors} sub="distinct browsers" />
        <Stat label="Avg session" value={fmtDuration(data.summary.avgDurationMs)} sub="time on site" />
      </div>

      {data.buckets.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-wide text-emerald-400 mb-2">
            Visits per {rangeKey === 'today' ? 'hour' : 'day'}
          </h3>
          <MiniBars data={data.buckets.map((b) => ({ label: b.bucket, value: b.sessions }))} />
        </div>
      )}

      <div>
        <h3 className="text-xs uppercase tracking-wide text-emerald-400 mb-2">Where from</h3>
        {data.byCountry.length === 0 ? (
          <p className="text-emerald-400 text-sm">No data yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {data.byCountry.map((c) => (
              <div key={c.country ?? 'unknown'} className="flex items-center gap-2 text-sm">
                <span className="w-12 shrink-0">{flag(c.country)} {c.country ?? '??'}</span>
                <div className="flex-1 h-4 rounded bg-emerald-950 overflow-hidden">
                  <div className="h-full bg-emerald-500/70" style={{ width: `${(c.sessions / maxCountry) * 100}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums text-emerald-200">{c.sessions}</span>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-emerald-500 mt-1">Location is approximate (GeoIP where available, else browser locale).</p>
      </div>

      <div>
        <h3 className="text-xs uppercase tracking-wide text-emerald-400 mb-2">Recent visits</h3>
        <div className="flex flex-col gap-1">
          {data.recent.map((s, i) => (
            <div key={i} className="flex items-center justify-between gap-3 rounded-lg bg-emerald-950/50 border border-emerald-800 px-3 py-1.5 text-sm">
              <span className="text-white truncate">
                {flag(s.country)} {s.name || 'Anonymous'}
              </span>
              <span className="text-[11px] text-emerald-400 shrink-0">
                {fmtDate(s.startedAt)} · {fmtDuration(s.durationMs)}
              </span>
            </div>
          ))}
          {data.recent.length === 0 && <p className="text-emerald-400 text-sm">No visits in this window yet.</p>}
        </div>
      </div>
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

function ErrorsTab({ token }: { token: string }) {
  const [rangeKey, setRangeKey] = useState('7d');
  const [data, setData] = useState<{ summary: { total: number; server: number; client: number }; errors: AdminError[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const since = (RANGES.find((r) => r.key === rangeKey) ?? RANGES[1]).since();
    fetchErrors(token, since).then(setData).catch((e) => setErr(String(e.message ?? e)));
  }, [token, rangeKey]);

  if (err) return <p className="text-rose-400">{err}</p>;
  if (!data) return <p className="text-emerald-300">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
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
        <button
          className="text-xs rounded-lg bg-emerald-800 hover:bg-emerald-700 text-emerald-100 px-3 py-1.5"
          onClick={() => downloadAdmin('/api/admin/errors/export', token, 'leekha-errors.json')}
        >
          Export all
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total" value={data.summary.total} />
        <Stat label="Server" value={data.summary.server} />
        <Stat label="Client" value={data.summary.client} />
      </div>
      <div className="flex flex-col gap-1.5">
        {data.errors.length === 0 && <p className="text-emerald-400 text-sm">No errors in this window. 🎉</p>}
        {data.errors.map((e) => (
          <div key={e.id} className="rounded-lg bg-emerald-950/50 border border-emerald-800 px-3 py-2">
            <button className="w-full text-left flex items-start justify-between gap-3" onClick={() => setOpen(open === e.id ? null : e.id)}>
              <span className="min-w-0">
                <span className={`text-[10px] rounded px-1.5 py-0.5 mr-2 ${e.source === 'server' ? 'bg-rose-900 text-rose-200' : 'bg-sky-900 text-sky-200'}`}>
                  {e.source}
                </span>
                {/* Rendered as text (React escapes it) -- error strings are attacker-controlled, never dangerouslySetInnerHTML. */}
                <span className="text-sm text-white break-words">{e.message}</span>
              </span>
              <span className="text-[11px] text-emerald-400 shrink-0">{fmtDate(e.createdAt)}</span>
            </button>
            {open === e.id && (
              <div className="mt-2 text-[11px] text-emerald-300 flex flex-col gap-1">
                {e.url && <div className="break-all">URL: {e.url}</div>}
                {e.stack && <pre className="whitespace-pre-wrap break-words bg-emerald-950 rounded p-2 overflow-x-auto max-h-64 no-scrollbar">{e.stack}</pre>}
                {e.userAgent && <div className="break-all text-emerald-500">{e.userAgent}</div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ClearButton({ label, description, token, what }: { label: string; description: string; token: string; what: 'sessions' | 'errors' | 'matches' }) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-xl border border-rose-700/40 bg-rose-950/20 p-4 flex flex-col gap-2">
      <div className="text-sm font-semibold text-white">{label}</div>
      <div className="text-xs text-emerald-300">{description}</div>
      {result && <div className="text-xs text-amber-300">{result}</div>}
      {!confirming ? (
        <button className="self-start text-xs rounded-lg border border-rose-500/60 text-rose-200 px-3 py-1.5 hover:bg-rose-900/40" onClick={() => { setConfirming(true); setResult(null); }}>
          Clear…
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <button
            disabled={busy}
            className="text-xs rounded-lg bg-rose-600 text-white px-3 py-1.5 disabled:opacity-50"
            onClick={async () => {
              setBusy(true);
              try {
                const { cleared } = await clearData(token, what);
                setResult(`Deleted ${cleared} row${cleared === 1 ? '' : 's'}.`);
              } catch (e) {
                setResult(`Failed: ${String((e as Error).message ?? e)}`);
              } finally {
                setBusy(false);
                setConfirming(false);
              }
            }}
          >
            {busy ? 'Clearing…' : 'Yes, delete permanently'}
          </button>
          <button className="text-xs text-emerald-300" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function DangerTab({ token }: { token: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-emerald-300">
        These permanently delete data from the database. There is no undo. Accounts and logins are not touched.
      </p>
      <ClearButton token={token} what="sessions" label="Clear usage data" description="Deletes all visit/session records (counts, durations, geography). Does not affect matches or accounts." />
      <ClearButton token={token} what="errors" label="Clear error logs" description="Deletes all captured server and client errors. Export first if you want a copy." />
      <ClearButton token={token} what="matches" label="Clear match history" description="Deletes all stored matches and move logs. Note: logged-in players will lose their History too." />
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
