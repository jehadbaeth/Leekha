import { useEffect, useRef } from 'react';
import type { Seat, TrixRulesConfig } from '@leekha/trix';
import { pick, type Settings } from '../settings';
import { Lobby } from '../Lobby';
import { TrixGame } from './TrixGame';
import { useOnlineTrixGame } from './useOnlineTrixGame';
import { SEAT_NAMES } from './trixLabels';
import { VoiceControls } from '../components/VoiceControls';
import { useVoiceLobby } from '../voice/useVoiceLobby';

const ALL_SEATS: Seat[] = [0, 1, 2, 3];

/**
 * Online Trix: the socket-backed counterpart of TrixLocalGame. It owns a
 * useOnlineTrixGame controller, reuses the shared Lobby until the host starts,
 * then hands the identical TrixController to the shared TrixGame board. Entry is
 * either "host a new room" (default) or "join by code" (joinCode prop).
 */
export function TrixOnlineGame({
  config,
  settings,
  joinCode,
  onExit,
}: {
  config: TrixRulesConfig;
  settings: Settings;
  joinCode?: string;
  onExit: () => void;
}) {
  const online = useOnlineTrixGame();
  const entered = useRef(false);

  useEffect(() => {
    if (entered.current) return;
    if (online.status !== 'connected') return;
    entered.current = true;
    if (joinCode) void online.joinRoom(settings.displayName, joinCode);
    else void online.createRoom(settings.displayName, config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online.status]);

  const leave = () => {
    online.leaveRoom();
    onExit();
  };

  const { roomState, view } = online;

  const voice = useVoiceLobby(online.socket, {
    roomCode: roomState?.roomCode ?? null,
    seated: online.mySeat !== null,
    allowSpectatorVoice: roomState?.allowSpectatorVoice ?? true,
    connectionStatus: online.status,
    autoJoin: settings.voiceAutoJoin,
  });

  // Real roster names for the board (fall back to the local placeholder set).
  const names: Record<Seat, string> = { ...SEAT_NAMES };
  if (roomState) {
    for (const s of ALL_SEATS) {
      const slot = roomState.seats[s];
      if (slot?.name) names[s] = slot.seat === online.mySeat ? `${slot.name} ${pick(settings.language, '(you)', '(أنت)')}` : slot.name;
    }
  }

  // A live view means the match has started (trix.snapshot only flows once the
  // host starts). Server start() doesn't rebroadcast room.state with phase
  // 'game', so — like Leekha's online client — we switch on view presence, not
  // roomState.phase.
  if (view) {
    // Seatless watcher of a running match: render read-only, and offer the
    // bot-controlled seats as claimable from the sidelines.
    const spectator = online.mySeat === null;
    const claimableSeats = spectator ? ALL_SEATS.filter((s) => online.presence[s] === 'bot') : [];
    const controller = { ...online, spectator, claimableSeats, onClaimSeat: online.claimSeat };
    return (
      <>
        <TrixGame controller={controller} config={config} settings={settings} onExit={leave} names={names} recapAutoAdvances />
        <VoiceControls controller={voice} language={settings.language} />
      </>
    );
  }

  if (!roomState) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-b from-felt-900 to-felt-950 text-emerald-100">
        {online.status === 'connected'
          ? pick(settings.language, 'Setting up room…', 'يُجهّز الغرفة…')
          : pick(settings.language, 'Connecting…', 'يتصل…')}
      </div>
    );
  }

  return (
    <>
      <Lobby
        roomState={roomState}
        roomCode={roomState.roomCode}
        mySeat={online.mySeat}
        language={settings.language}
        onAddBot={(seat) => online.addBot(seat)}
        onRemoveBot={online.removeBot}
        onReady={online.setReady}
        onStart={online.startGame}
        onLeave={leave}
        onConfigure={() => {}}
        onToggleSpectatorVoice={online.setSpectatorVoice}
        voice={voice}
      />
    </>
  );
}

export default TrixOnlineGame;
