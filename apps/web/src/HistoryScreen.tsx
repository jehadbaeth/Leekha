import { useEffect, useState } from 'react';
import { pick, type Settings } from './settings';
import { fetchHistory, fetchMatch, type MatchSummary, type MatchDetail } from './net/api';
import { BackButton } from './components/buttons';

function formatDate(ms: number, lang: Settings['language']): string {
  return new Date(ms).toLocaleString(lang === 'ar' ? 'ar' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function HistoryScreen({ settings, onBack }: { settings: Settings; onBack: () => void }) {
  const t = (en: string, ar: string) => pick(settings.language, en, ar);
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    fetchHistory()
      .then(setMatches)
      .catch(() => setError(t('Could not load your match history.', 'تعذر تحميل سجل مبارياتك.')));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function openDetail(matchId: string) {
    setLoadingDetail(true);
    try {
      setDetail(await fetchMatch(matchId));
    } catch {
      setError(t('Could not load that match.', 'تعذر تحميل هذه المباراة.'));
    } finally {
      setLoadingDetail(false);
    }
  }

  if (detail) {
    return (
      <div className="min-h-full bg-felt-950 text-white px-6 py-8">
        <div className="mb-4">
          <BackButton label={t('Back to History', 'رجوع إلى السجل')} onClick={() => setDetail(null)} />
        </div>
        <h2 className="text-xl font-bold mb-2">{t('Match Detail', 'تفاصيل المباراة')}</h2>
        <p className="text-emerald-300 text-sm mb-4">{formatDate(detail.match.endedAt, settings.language)}</p>

        <div className="max-w-md">
          <h3 className="text-sm uppercase tracking-wide text-emerald-200 mb-2">{t('Final Scores', 'النتائج النهائية')}</h3>
          <ul className="mb-4">
            {detail.players.map((p) => (
              <li key={p.seat} className="flex justify-between border-b border-emerald-800 py-1 text-sm">
                <span>
                  {p.displayName}
                  {p.wasBot ? ` (${t('bot', 'روبوت')})` : ''}
                </span>
                <span className="font-mono">{detail.match.finalScores[p.seat]}</span>
              </li>
            ))}
          </ul>

          <h3 className="text-sm uppercase tracking-wide text-emerald-200 mb-2">{t('Raw Move Log', 'سجل الحركات الخام')}</h3>
          <pre className="bg-emerald-950/60 border border-emerald-800 rounded-lg p-3 text-xs overflow-auto max-h-64">
            {JSON.stringify(detail.match.moveLog, null, 2)}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-felt-950 text-white px-6 py-8">
      <div className="mb-4">
        <BackButton label={t('Back', 'رجوع')} onClick={onBack} />
      </div>
      <h2 className="text-2xl font-bold mb-4">{t('Match History', 'سجل المباريات')}</h2>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

      {matches === null && !error && <p className="text-emerald-300 text-sm">{t('Loading…', 'جارٍ التحميل…')}</p>}

      {matches?.length === 0 && <p className="text-emerald-300 text-sm">{t('No matches yet. Play one to see it here!', 'لا توجد مباريات بعد. العب واحدة لتراها هنا!')}</p>}

      <ul className="max-w-md flex flex-col gap-2">
        {matches?.map((m) => (
          <li key={m.matchId}>
            <button
              className="w-full flex justify-between items-center bg-emerald-950/60 border border-emerald-800 rounded-lg px-4 py-3 text-left disabled:opacity-60"
              disabled={loadingDetail}
              onClick={() => openDetail(m.matchId)}
            >
              <span className="text-sm">{formatDate(m.endedAt, settings.language)}</span>
              <span className="font-mono text-sm">{m.finalScores.join(' · ')}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
