import { useState } from 'react';
import type { Seat } from '@leekha/engine';
import type { ServerMessage } from '@leekha/protocol';

type RoomState = Extract<ServerMessage, { type: 'room.state' }>;
type BotLevel = 'easy' | 'medium' | 'hard';

const SEATS: Seat[] = [0, 1, 2, 3];
const LEVELS: BotLevel[] = ['easy', 'medium', 'hard'];

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
  onAddBot,
  onRemoveBot,
  onReady,
  onStart,
  onLeave,
}: {
  roomState: RoomState | null;
  roomCode: string | null;
  mySeat: Seat | null;
  onAddBot: (seat: Seat, level: BotLevel) => void;
  onRemoveBot: (seat: Seat) => void;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [pickerSeat, setPickerSeat] = useState<Seat | null>(null);

  if (!roomState || !roomCode) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center gap-4 bg-felt-950 text-emerald-100">
        <p>Connecting to room…</p>
        <button className="underline text-sm" onClick={onLeave}>
          Cancel
        </button>
      </div>
    );
  }

  const isHost = mySeat !== null && mySeat === roomState.hostSeat;
  const canStart = roomState.seats.every((s) => (s.occupied || s.isBot) && (s.isBot || s.ready));
  const joinLink = `${window.location.origin}${window.location.pathname}?join=${roomCode}`;
  const mySlot = mySeat !== null ? roomState.seats[mySeat] : null;

  async function share() {
    const text = `Join my Leekha room: ${roomCode}`;
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
        <p className="text-emerald-200 text-xs uppercase tracking-wide">Room code</p>
        <button
          className="text-4xl font-bold tracking-[0.3em] text-amber-300 font-mono"
          onClick={copyCode}
          title="Tap to copy"
        >
          {roomCode}
        </button>
        {copied && <p className="text-emerald-300 text-xs mt-1">Copied!</p>}
        <button
          className="mt-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-semibold px-4 py-2"
          onClick={share}
        >
          Share invite link
        </button>
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
                <span className="text-[10px] uppercase text-emerald-300">Seat {seat}</span>
                {slot.occupied && !slot.isBot && (
                  <span className={`text-[10px] rounded px-1 ${slot.ready ? 'bg-emerald-500 text-emerald-950' : 'bg-slate-600 text-white'}`}>
                    {slot.ready ? '✓ ready' : 'not ready'}
                  </span>
                )}
              </div>
              <div className="text-sm font-semibold text-white truncate">
                {slot.isBot ? `🤖 ${slot.name} (${slot.botLevel})` : slot.occupied ? slot.name : 'Empty'}
                {isMe && ' (you)'}
              </div>
              {!slot.connected && slot.occupied && !slot.isBot && (
                <span className="text-[10px] text-red-400">disconnected</span>
              )}

              {isHost && !slot.occupied && !slot.isBot && (
                <div className="relative">
                  <button
                    className="text-xs rounded-lg bg-amber-400 text-emerald-950 font-semibold px-2 py-1 w-full"
                    onClick={() => setPickerSeat(pickerSeat === seat ? null : seat)}
                  >
                    + Add bot
                  </button>
                  {pickerSeat === seat && (
                    <div className="absolute z-10 mt-1 flex flex-col gap-1 bg-emerald-950 border border-emerald-700 rounded-lg p-1 w-full">
                      {LEVELS.map((lvl) => (
                        <button
                          key={lvl}
                          className="text-xs text-left px-2 py-1 rounded hover:bg-emerald-800 text-emerald-100 capitalize"
                          onClick={() => {
                            onAddBot(seat, lvl);
                            setPickerSeat(null);
                          }}
                        >
                          {lvl}
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
                  Remove bot
                </button>
              )}
            </div>
          );
        })}
      </div>

      {mySlot && !mySlot.isBot && (
        <button
          className={`rounded-lg px-5 py-2 font-semibold ${
            mySlot.ready ? 'bg-emerald-800 text-emerald-100' : 'bg-amber-400 text-emerald-950'
          }`}
          onClick={() => onReady(!mySlot.ready)}
        >
          {mySlot.ready ? '✓ Ready' : 'I am ready'}
        </button>
      )}

      {isHost && (
        <button
          disabled={!canStart}
          className="rounded-xl bg-amber-400 disabled:opacity-30 text-emerald-950 font-bold py-3 px-8 text-lg"
          onClick={onStart}
        >
          Start game
        </button>
      )}
      {!isHost && <p className="text-emerald-300 text-xs">Waiting for the host to start&hellip;</p>}

      <button className="text-emerald-400 text-xs underline" onClick={onLeave}>
        Leave room
      </button>
    </div>
  );
}
