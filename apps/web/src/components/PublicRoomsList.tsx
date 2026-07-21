import { useEffect } from 'react';
import type { PublicRoom } from '@leekha/protocol';
import { pick, type Settings } from '../settings';

/**
 * The list of open, publicly-listed rooms anyone can drop into. Shared between
 * the global landing (GamePicker) — where BOTH game types share one list, hence
 * the per-row game-type badge — and Leekha's own home. Owning the 4s poll here
 * (rather than in each caller) keeps the two mount points from drifting: a room
 * created on another device after this screen loaded still shows up without a
 * manual refresh.
 */
export function PublicRoomsList({
  rooms,
  onRefresh,
  onJoin,
  language,
}: {
  rooms: PublicRoom[];
  onRefresh: () => void;
  /** Route the join to the right game; the caller commits the display name first. */
  onJoin: (code: string, gameType: 'leekha' | 'trix') => void;
  language: Settings['language'];
}) {
  const t = (en: string, ar: string) => pick(language, en, ar);

  useEffect(() => {
    onRefresh();
    const id = setInterval(onRefresh, 4000);
    return () => clearInterval(id);
  }, [onRefresh]);

  return (
    <div className="flex flex-col gap-2 bg-emerald-950/60 border border-emerald-700 rounded-xl p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-emerald-200">{t('Public Rooms', 'الغرف العامة')}</span>
        <button className="text-xs underline text-emerald-200" onClick={onRefresh}>
          {t('Refresh', 'تحديث')}
        </button>
      </div>
      {rooms.length === 0 ? (
        <p className="text-xs text-emerald-300/80 py-1">{t('No public rooms right now.', 'لا توجد غرف عامة حالياً.')}</p>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
          {rooms.map((room) => (
            <div key={room.code} className="flex items-center justify-between gap-2 bg-emerald-900/60 rounded-lg px-3 py-1.5">
              <span className="text-sm text-white truncate flex items-center gap-1.5 min-w-0">
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    room.gameType === 'trix' ? 'bg-sky-500/25 text-sky-200' : 'bg-amber-400/25 text-amber-200'
                  }`}
                >
                  {room.gameType === 'trix' ? t('Trix', 'تريكس') : t('Leekha', 'ليخة')}
                </span>
                <span className="truncate">
                  {t(`${room.hostName}'s room`, `غرفة ${room.hostName}`)}{' '}
                  <span className="text-emerald-300">
                    ({room.seatsFilled}/4{room.gameType !== 'trix' && room.targetScore ? ` · ${room.targetScore}` : ''})
                  </span>
                </span>
              </span>
              <button
                className="shrink-0 rounded-lg bg-amber-400 text-emerald-950 text-xs font-semibold px-3 py-1"
                onClick={() => onJoin(room.code, room.gameType ?? 'leekha')}
              >
                {t('Join', 'انضمام')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
