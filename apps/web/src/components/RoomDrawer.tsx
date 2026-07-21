import { useEffect, useState } from 'react';
import { pick, type Settings } from '../settings';
import { useRoomShare } from '../roomShare';
import type { VoiceController } from '../voice/useVoiceLobby';

export interface ScoreDigest {
  /** Current standings, one row per seat. */
  players: { name: string; score: number }[];
  /** Partnership totals (teams 0,2 vs 1,3), or null in a solo game. */
  teams?: { label: string; score: number }[] | null;
}

// A slide-out "curtain" that gathers the room's meta-controls — invite, voice
// lobby + participants, and leave/home — behind a single ☰ button, so the play
// area stays clean instead of scattering floating buttons around the edges
// (which kept colliding with the edge-seat avatars). Slides from the logical
// START side, so it mirrors correctly in Arabic.
export function RoomDrawer({
  open,
  onClose,
  language,
  roomCode,
  isHost,
  isPublic,
  onTogglePublic,
  allowSpectatorVoice,
  onToggleSpectatorVoice,
  voice,
  spectatorCount,
  scoreDigest,
  onLeave,
  onHowToPlay,
}: {
  open: boolean;
  onClose: () => void;
  language: Settings['language'];
  roomCode: string | null;
  isHost: boolean;
  isPublic: boolean;
  onTogglePublic?: (v: boolean) => void;
  allowSpectatorVoice: boolean;
  onToggleSpectatorVoice?: (v: boolean) => void;
  voice?: VoiceController;
  spectatorCount?: number;
  scoreDigest?: ScoreDigest | null;
  onLeave: () => void;
  onHowToPlay?: () => void;
}) {
  const t = (en: string, ar: string) => pick(language, en, ar);
  const rtl = language === 'ar';
  const { copied, share, copyCode } = useRoomShare(roomCode, language);
  const [showScores, setShowScores] = useState(false);

  // Close on Escape; lock nothing else (the scrim handles outside taps).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const hidden = rtl ? 'translateX(100%)' : 'translateX(-100%)';

  return (
    <>
      {/* Scrim */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
        aria-hidden
      />
      {/* Panel, anchored to the start edge */}
      <aside
        className="fixed top-0 bottom-0 start-0 z-50 w-[86%] max-w-xs flex flex-col bg-emerald-950 border-e border-emerald-700 shadow-2xl transition-transform duration-200 ease-out overflow-y-auto"
        style={{ transform: open ? 'translateX(0)' : hidden }}
        role="dialog"
        aria-modal="true"
        aria-label={t('Room menu', 'قائمة الغرفة')}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-emerald-800 sticky top-0 bg-emerald-950">
          <span className="text-sm font-semibold text-emerald-100">{t('Room', 'الغرفة')}</span>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-full text-emerald-300 hover:bg-emerald-900 text-lg"
            aria-label={t('Close', 'إغلاق')}
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-5 p-4">
          {/* Invite */}
          {roomCode && (
            <section className="flex flex-col gap-2">
              <h3 className="text-[10px] uppercase tracking-wide text-emerald-400">{t('Invite', 'دعوة')}</h3>
              <button
                onClick={copyCode}
                className="self-start text-2xl font-bold tracking-[0.25em] text-amber-300 font-mono"
                title={t('Tap to copy', 'اضغط للنسخ')}
              >
                {roomCode}
              </button>
              {copied && <span className="text-xs text-emerald-300">{t('Copied!', 'تم النسخ!')}</span>}
              <button
                onClick={share}
                className="rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold px-3 py-2"
              >
                {t('Share invite link', 'مشاركة رابط الدعوة')}
              </button>
              {isHost && onTogglePublic && (
                <label className="flex items-center gap-2 text-xs text-emerald-200 mt-0.5">
                  <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={isPublic} onChange={(e) => onTogglePublic(e.target.checked)} />
                  {t('List publicly', 'إدراج عام')}
                </label>
              )}
            </section>
          )}

          {/* Voice + participants */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] uppercase tracking-wide text-emerald-400">{t('Voice lobby', 'غرفة الصوت')}</h3>
              {typeof spectatorCount === 'number' && spectatorCount > 0 && (
                <span className="text-[10px] text-emerald-500">👁 {spectatorCount}</span>
              )}
            </div>
            {voice && voice.supported ? (
              <>
                {!voice.joined ? (
                  <button
                    onClick={voice.join}
                    disabled={voice.connecting}
                    className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold px-3 py-2 disabled:opacity-60"
                  >
                    {voice.connecting ? t('Connecting…', 'جارٍ الاتصال…') : t('🎙 Join voice', '🎙 انضم للصوت')}
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={voice.toggleMute}
                      className={`flex-1 rounded-lg text-sm font-semibold px-2 py-2 ${voice.muted ? 'bg-amber-600/90 text-white' : 'bg-emerald-700 text-emerald-50'}`}
                    >
                      {voice.muted ? t('Unmute', 'إلغاء الكتم') : t('Mute', 'كتم')}
                    </button>
                    <button onClick={voice.leave} className="flex-1 rounded-lg bg-rose-800/80 text-rose-100 text-sm font-semibold px-2 py-2">
                      {t('Leave voice', 'مغادرة الصوت')}
                    </button>
                  </div>
                )}
                {voice.joined && (
                  <ul className="flex flex-col gap-0.5 mt-1">
                    <Row name={t('You', 'أنت')} speaking={voice.self ? !!voice.speaking[voice.self] : false} muted={voice.muted} you />
                    {voice.participants.map((p) => (
                      <Row key={p.voiceId} name={p.name} speaking={!!voice.speaking[p.voiceId]} muted={p.muted} />
                    ))}
                  </ul>
                )}
                {isHost && onToggleSpectatorVoice && (
                  <label className="flex items-center gap-2 text-xs text-emerald-200 mt-1">
                    <input type="checkbox" className="h-4 w-4 accent-emerald-500" checked={allowSpectatorVoice} onChange={(e) => onToggleSpectatorVoice(e.target.checked)} />
                    {t('Let spectators talk', 'السماح للمتفرجين بالتحدث')}
                  </label>
                )}
              </>
            ) : (
              <p className="text-[11px] text-emerald-400">{t('Voice needs a secure (https) connection.', 'يحتاج الصوت إلى اتصال آمن (https).')}</p>
            )}
          </section>

          {/* Actions */}
          <section className="flex flex-col gap-2 mt-auto pt-2 border-t border-emerald-800">
            {scoreDigest && (
              <button onClick={() => setShowScores(true)} className="rounded-lg border border-emerald-700 text-emerald-100 text-sm font-medium px-3 py-2 hover:bg-emerald-900">
                {t('Scores', 'النتائج')}
              </button>
            )}
            {onHowToPlay && (
              <button onClick={onHowToPlay} className="rounded-lg border border-emerald-700 text-emerald-100 text-sm font-medium px-3 py-2 hover:bg-emerald-900">
                {t('How to play', 'طريقة اللعب')}
              </button>
            )}
            <button onClick={onLeave} className="rounded-lg bg-rose-800/80 text-rose-100 text-sm font-semibold px-3 py-2 hover:bg-rose-700">
              {t('Leave room', 'مغادرة الغرفة')}
            </button>
          </section>
        </div>
      </aside>

      {/* Scores digest: a translucent popup so the table stays visible behind it,
          with an X in the corner to dismiss. */}
      {showScores && scoreDigest && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" onClick={() => setShowScores(false)}>
          <div
            className="relative w-full max-w-xs rounded-2xl border border-emerald-600/70 bg-emerald-950/80 backdrop-blur-sm p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowScores(false)}
              className="absolute top-2 end-2 h-8 w-8 flex items-center justify-center rounded-full text-emerald-300 hover:bg-emerald-900/70 text-lg"
              aria-label={t('Close', 'إغلاق')}
            >
              ✕
            </button>
            <h3 className="text-sm font-semibold text-emerald-100 mb-3">{t('Scores', 'النتائج')}</h3>
            {scoreDigest.teams && scoreDigest.teams.length > 0 && (
              <ul className="mb-3 flex flex-col gap-1.5">
                {scoreDigest.teams.map((tm, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 rounded-lg bg-emerald-900/50 px-3 py-2 text-sm">
                    <span className="truncate text-emerald-100">{tm.label}</span>
                    <span className="tabular-nums font-bold text-amber-300">{tm.score}</span>
                  </li>
                ))}
              </ul>
            )}
            <ul className="flex flex-col gap-1">
              {scoreDigest.players.map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-1 py-1 text-sm text-emerald-100">
                  <span className="truncate">{p.name}</span>
                  <span className="tabular-nums font-semibold text-emerald-200">{p.score}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ name, speaking, muted, you }: { name: string; speaking: boolean; muted: boolean; you?: boolean }) {
  return (
    <li className="flex items-center gap-2 rounded-md px-1 py-1 text-sm text-emerald-100">
      <span
        className={`h-2.5 w-2.5 shrink-0 rounded-full transition ${muted ? 'bg-emerald-900 ring-1 ring-emerald-700' : speaking ? 'bg-green-400 animate-pulse' : 'bg-emerald-700'}`}
      />
      <span className={`flex-1 truncate ${you ? 'font-semibold text-white' : ''}`}>{name}</span>
      {muted && <span className="text-xs opacity-70">🔇</span>}
    </li>
  );
}
