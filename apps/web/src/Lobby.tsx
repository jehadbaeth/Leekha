import { useState } from 'react';
import type { RulesConfig, Seat } from '@leekha/engine';
import type { ServerMessage } from '@leekha/protocol';
import { pick, type Settings } from './settings';

type RoomState = Extract<ServerMessage, { type: 'room.state' }>;
type BotLevel = 'easy' | 'medium' | 'hard';

const SEATS: Seat[] = [0, 1, 2, 3];
const LEVELS: BotLevel[] = ['easy', 'medium', 'hard'];
const LEVEL_LABEL: Record<BotLevel, { en: string; ar: string }> = {
  easy: { en: 'easy', ar: 'سهل' },
  medium: { en: 'medium', ar: 'متوسط' },
  hard: { en: 'hard', ar: 'صعب' },
};

// Presets for "how long can a turn sit idle before it's auto-played", in ms.
// 0 means no timeout (armPlayTimer/armPassTimer in apps/server/src/room.ts
// treat <= 0 as disabled). Two AFK strikes at this same seat flips it to bot
// control (see Room.strikeAndAutoPass / onPlayTimeout), so the real wait
// before takeover is roughly double whatever is picked here.
const PLAY_TIMER_PRESETS_MS = [15_000, 25_000, 45_000, 60_000, 90_000, 0];
const PASS_TIMER_PRESETS_MS = [20_000, 45_000, 60_000, 90_000, 120_000, 0];

function formatTimerMs(ms: number, language: Settings['language']): string {
  if (ms <= 0) return pick(language, 'No limit', 'بلا حد');
  return pick(language, `${ms / 1000}s`, `${ms / 1000} ث`);
}

/**
 * SPEC.md section 7.1 item 2: room code, share link, a 4 seat mini table with
 * team colors, host controls to add/remove bots per empty seat, ready
 * checkmarks, and a Start button. `canStart` mirrors apps/server/src/room.ts's
 * `canStart()` (all four seats filled, every human ready) — re-derived here
 * since the client has no access to server internals, only the room.state
 * broadcast (see CLAUDE.md: clients consume public state, never server code).
 */
export function Lobby({
  roomState,
  roomCode,
  mySeat,
  language,
  onAddBot,
  onRemoveBot,
  onReady,
  onStart,
  onLeave,
  onConfigure,
}: {
  roomState: RoomState | null;
  roomCode: string | null;
  mySeat: Seat | null;
  language: Settings['language'];
  onAddBot: (seat: Seat, level: BotLevel) => void;
  onRemoveBot: (seat: Seat) => void;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onLeave: () => void;
  onConfigure: (config: RulesConfig) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [pickerSeat, setPickerSeat] = useState<Seat | null>(null);
  const t = (en: string, ar: string) => pick(language, en, ar);

  if (!roomState || !roomCode) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center gap-4 bg-felt-950 text-emerald-100">
        <p>{t('Connecting to room…', 'جارٍ الاتصال بالغرفة…')}</p>
        <button className="underline text-sm" onClick={onLeave}>
          {t('Cancel', 'إلغاء')}
        </button>
      </div>
    );
  }

  const isHost = mySeat !== null && mySeat === roomState.hostSeat;
  const canStart = roomState.seats.every((s) => (s.occupied || s.isBot) && (s.isBot || s.ready));
  const joinLink = `${window.location.origin}${window.location.pathname}?join=${roomCode}`;
  const mySlot = mySeat !== null ? roomState.seats[mySeat] : null;

  async function share() {
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

  return (
    <div className="min-h-full flex flex-col items-center gap-6 bg-felt-950 px-5 py-8 overflow-y-auto">
      <div className="text-center">
        <p className="text-emerald-200 text-xs uppercase tracking-wide">{t('Room code', 'رمز الغرفة')}</p>
        <button
          className="text-4xl font-bold tracking-[0.3em] text-amber-300 font-mono"
          onClick={copyCode}
          title={t('Tap to copy', 'اضغط للنسخ')}
        >
          {roomCode}
        </button>
        {copied && <p className="text-emerald-300 text-xs mt-1">{t('Copied!', 'تم النسخ!')}</p>}
        <div className="flex gap-2 mt-2">
          <a
            className="rounded-lg bg-[#25D366] hover:brightness-95 text-emerald-950 text-sm font-semibold px-4 py-2 flex items-center gap-1.5"
            href={`https://wa.me/?text=${encodeURIComponent(t(`Join my Leekha room: ${roomCode}`, `انضم إلى غرفتي في ليخة: ${roomCode}`) + '\n' + joinLink)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp
          </a>
          <button
            className="rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold px-4 py-2"
            onClick={share}
          >
            {t('Other apps', 'تطبيقات أخرى')}
          </button>
        </div>
      </div>

      {/* 4 seat mini table, team colors: seats 0/2 vs 1/3 */}
      <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
        {SEATS.map((seat) => {
          const slot = roomState.seats[seat];
          const team = seat % 2 === 0 ? 0 : 1;
          const isMe = seat === mySeat;
          return (
            <div
              key={seat}
              className={`rounded-xl border-2 p-3 flex flex-col gap-1 ${
                team === 0 ? 'border-sky-500 bg-sky-950/40' : 'border-rose-500 bg-rose-950/40'
              } ${isMe ? 'ring-2 ring-amber-300' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase text-emerald-300">{t(`Seat ${seat}`, `المقعد ${seat}`)}</span>
                {slot.occupied && !slot.isBot && (
                  <span className={`text-[10px] rounded px-1 ${slot.ready ? 'bg-emerald-500 text-emerald-950' : 'bg-slate-600 text-white'}`}>
                    {slot.ready ? t('✓ ready', '✓ جاهز') : t('not ready', 'غير جاهز')}
                  </span>
                )}
              </div>
              <div className="text-sm font-semibold text-white truncate">
                {slot.isBot ? `🤖 ${slot.name} (${LEVEL_LABEL[slot.botLevel ?? 'easy'][language]})` : slot.occupied ? slot.name : t('Empty', 'فارغ')}
                {isMe && t(' (you)', ' (أنت)')}
              </div>
              {!slot.connected && slot.occupied && !slot.isBot && (
                <span className="text-[10px] text-red-400">{t('disconnected', 'غير متصل')}</span>
              )}

              {isHost && !slot.occupied && !slot.isBot && (
                <div className="relative">
                  <button
                    className="text-xs rounded-lg bg-amber-400 text-emerald-950 font-semibold px-2 py-1 w-full"
                    onClick={() => setPickerSeat(pickerSeat === seat ? null : seat)}
                  >
                    {t('+ Add bot', '+ إضافة روبوت')}
                  </button>
                  {pickerSeat === seat && (
                    <div className="absolute z-10 mt-1 flex flex-col gap-1 bg-emerald-950 border border-emerald-700 rounded-lg p-1 w-full">
                      {LEVELS.map((lvl) => (
                        <button
                          key={lvl}
                          className="text-xs text-left px-2 py-1 rounded hover:bg-emerald-800 text-emerald-100"
                          onClick={() => {
                            onAddBot(seat, lvl);
                            setPickerSeat(null);
                          }}
                        >
                          {LEVEL_LABEL[lvl][language]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {isHost && slot.isBot && (
                <button
                  className="text-xs rounded-lg border border-red-400 text-red-300 px-2 py-1"
                  onClick={() => onRemoveBot(seat)}
                >
                  {t('Remove bot', 'إزالة الروبوت')}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Section 12: how long an idle seat gets before it's auto-played, and
          before two such strikes flip it to bot control (Room.flipToBot).
          Host-editable only, and only before the match starts. */}
      <div className="w-full max-w-xs rounded-xl border border-emerald-700 bg-emerald-950/40 p-3 flex flex-col gap-2">
        <p className="text-[10px] uppercase tracking-wide text-emerald-300">
          {t('Idle timers', 'مؤقتات الخمول')}
        </p>
        <label className="flex items-center justify-between gap-2 text-xs text-emerald-100">
          {t('Time to play a card', 'الوقت للعب ورقة')}
          {isHost ? (
            <select
              className="bg-emerald-900 border border-emerald-700 rounded px-2 py-1 text-xs text-white"
              value={roomState.config.timers.playMs}
              onChange={(e) =>
                onConfigure({ ...roomState.config, timers: { ...roomState.config.timers, playMs: Number(e.target.value) } })
              }
            >
              {PLAY_TIMER_PRESETS_MS.map((ms) => (
                <option key={ms} value={ms}>
                  {formatTimerMs(ms, language)}
                </option>
              ))}
            </select>
          ) : (
            <span className="font-semibold">{formatTimerMs(roomState.config.timers.playMs, language)}</span>
          )}
        </label>
        <label className="flex items-center justify-between gap-2 text-xs text-emerald-100">
          {t('Time to pass cards', 'الوقت لتمرير الأوراق')}
          {isHost ? (
            <select
              className="bg-emerald-900 border border-emerald-700 rounded px-2 py-1 text-xs text-white"
              value={roomState.config.timers.passMs}
              onChange={(e) =>
                onConfigure({ ...roomState.config, timers: { ...roomState.config.timers, passMs: Number(e.target.value) } })
              }
            >
              {PASS_TIMER_PRESETS_MS.map((ms) => (
                <option key={ms} value={ms}>
                  {formatTimerMs(ms, language)}
                </option>
              ))}
            </select>
          ) : (
            <span className="font-semibold">{formatTimerMs(roomState.config.timers.passMs, language)}</span>
          )}
        </label>
        <p className="text-[10px] text-emerald-400">
          {t(
            'Missing two turns in a row hands your seat to a bot.',
            'تفويت دورين متتاليين يسلّم مقعدك إلى روبوت.',
          )}
        </p>
      </div>

      {mySlot && !mySlot.isBot && (
        <button
          className={`rounded-lg px-5 py-2 font-semibold ${
            mySlot.ready ? 'bg-emerald-800 text-emerald-100' : 'bg-amber-400 text-emerald-950'
          }`}
          onClick={() => onReady(!mySlot.ready)}
        >
          {mySlot.ready ? t('✓ Ready', '✓ جاهز') : t('I am ready', 'أنا جاهز')}
        </button>
      )}

      {isHost && (
        <button
          disabled={!canStart}
          className="rounded-xl bg-amber-400 disabled:opacity-30 text-emerald-950 font-bold py-3 px-8 text-lg"
          onClick={onStart}
        >
          {t('Start game', 'ابدأ اللعبة')}
        </button>
      )}
      {!isHost && (
        <p className="text-emerald-300 text-xs">{t('Waiting for the host to start…', 'بانتظار أن يبدأ المضيف اللعبة…')}</p>
      )}

      <button className="text-emerald-400 text-xs underline" onClick={onLeave}>
        {t('Leave room', 'مغادرة الغرفة')}
      </button>
    </div>
  );
}
