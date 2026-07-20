import { useState } from 'react';
import type { Settings } from '../settings';
import { pick } from '../settings';
import type { VoiceController } from '../voice/useVoiceLobby';

// The always-on voice lobby control (SPEC-VOICE.md §6). A single floating pill
// anchored top-right of the game shell; tap to expand a roster with per-person
// speaking dots and mute state. Rendered for both Leekha and Trix online paths;
// it drives a VoiceController from useVoiceLobby and holds no WebRTC logic itself.
export function VoiceControls({
  controller: v,
  language,
}: {
  controller: VoiceController;
  language: Settings['language'];
}) {
  const [open, setOpen] = useState(false);
  const t = (en: string, ar: string) => pick(language, en, ar);

  if (!v.supported) return null;

  const total = v.participants.length + (v.joined ? 1 : 0);
  const anyoneSpeaking = Object.values(v.speaking).some(Boolean);

  const errorText = v.error
    ? {
        unsupported: t('Voice not supported here', 'الصوت غير مدعوم هنا'),
        permission: t('Mic permission denied', 'تم رفض إذن الميكروفون'),
        mic: t('No microphone found', 'لا يوجد ميكروفون'),
        'voice-full': t('Voice lobby is full', 'غرفة الصوت ممتلئة'),
        'voice-disabled': t('Spectator voice is off', 'صوت المتفرجين مغلق'),
        'not-in-room': t('Join a room first', 'انضم إلى غرفة أولاً'),
      }[v.error]
    : null;

  return (
    // No forced dir: the cluster uses logical `end`, so it mirrors to the side
    // OPPOSITE the Home button (which is logical `start`) in both LTR and RTL —
    // in Arabic Home sits top-right, so this sits top-left, no collision.
    // pointer-events-none on the wrapper so the empty band beside the pill/panel
    // never intercepts taps meant for the HUD controls underneath; only the pill
    // and the panel themselves take pointer events. See the UI overlap audit.
    <div className="absolute top-2 end-2 z-30 flex flex-col items-end gap-1 pointer-events-none">
      <div className="flex flex-col items-end gap-1">
        {/* Collapsed pill */}
        <button
          onClick={() => setOpen((o) => !o)}
          className={`pointer-events-auto flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-sm font-medium shadow-lg active:scale-95 transition ${
            v.joined
              ? 'border-emerald-500/70 bg-emerald-800/85 text-emerald-50'
              : 'border-emerald-700/60 bg-emerald-950/80 text-emerald-200'
          }`}
          aria-label={t('Voice lobby', 'غرفة الصوت')}
        >
          <span className={`text-base leading-none ${anyoneSpeaking ? 'animate-pulse' : ''}`}>
            {v.joined ? (v.muted ? '🔇' : '🎙️') : '🎧'}
          </span>
          {total > 0 && <span className="tabular-nums">{total}</span>}
        </button>

        {open && (
          <div className="pointer-events-auto w-52 max-w-[calc(100vw-1rem)] rounded-xl border border-emerald-700 bg-emerald-950/95 p-2 shadow-xl">
            <div className="px-1 pb-1.5 text-[11px] uppercase tracking-wide text-emerald-400">
              {t('Voice lobby', 'غرفة الصوت')}
            </div>

            {/* Roster */}
            {v.joined && (
              <ul className="mb-2 max-h-40 space-y-0.5 overflow-y-auto">
                <Row
                  key="self"
                  name={t('You', 'أنت')}
                  speaking={v.self ? v.speaking[v.self] : false}
                  muted={v.muted}
                  you
                />
                {v.participants.map((p) => (
                  <Row key={p.voiceId} name={p.name} speaking={!!v.speaking[p.voiceId]} muted={p.muted} />
                ))}
              </ul>
            )}

            {/* Actions */}
            {!v.joined ? (
              <button
                onClick={v.join}
                disabled={v.connecting}
                className="w-full rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 active:scale-95 disabled:opacity-60"
              >
                {v.connecting ? t('Connecting…', 'جارٍ الاتصال…') : t('Join voice', 'انضم للصوت')}
              </button>
            ) : (
              <div className="flex gap-1.5">
                <button
                  onClick={v.toggleMute}
                  className={`flex-1 rounded-lg px-2 py-1.5 text-sm font-semibold active:scale-95 ${
                    v.muted
                      ? 'bg-amber-600/90 text-white hover:bg-amber-500'
                      : 'bg-emerald-700 text-emerald-50 hover:bg-emerald-600'
                  }`}
                >
                  {v.muted ? t('Unmute', 'إلغاء الكتم') : t('Mute', 'كتم')}
                </button>
                <button
                  onClick={v.leave}
                  className="flex-1 rounded-lg bg-rose-800/80 px-2 py-1.5 text-sm font-semibold text-rose-100 hover:bg-rose-700 active:scale-95"
                >
                  {t('Leave', 'مغادرة')}
                </button>
              </div>
            )}

            {errorText && (
              <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-rose-950/70 px-2 py-1 text-[11px] text-rose-200">
                <span>{errorText}</span>
                <button className="underline" onClick={v.clearError}>
                  {t('ok', 'حسناً')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ name, speaking, muted, you }: { name: string; speaking: boolean; muted: boolean; you?: boolean }) {
  return (
    <li className="flex items-center gap-2 rounded-md px-1 py-1 text-sm text-emerald-100">
      <span
        className={`h-2.5 w-2.5 shrink-0 rounded-full transition ${
          muted ? 'bg-emerald-900 ring-1 ring-emerald-700' : speaking ? 'bg-green-400 animate-pulse' : 'bg-emerald-700'
        }`}
      />
      <span className={`flex-1 truncate ${you ? 'font-semibold text-white' : ''}`}>{name}</span>
      {muted && <span className="text-xs opacity-70">🔇</span>}
    </li>
  );
}
