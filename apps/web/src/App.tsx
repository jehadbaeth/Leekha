import { useEffect, useMemo, useState } from 'react';
import type { Seat } from '@leekha/engine';
import { defaultConfig } from '@leekha/engine';
import { Home } from './Home';
import { Lobby } from './Lobby';
import { HowToPlay } from './HowToPlay';
import { SettingsScreen } from './SettingsScreen';
import { GameTable } from './components/GameTable';
import { defaultSettings, loadSettings, saveSettings, type Settings } from './settings';
import { useGame } from './useGame';
import { useOnlineGame } from './useOnlineGame';
import { loadSession } from './net/session';
import { useInstallPrompt } from './useInstallPrompt';
import { InstallBanner } from './components/InstallBanner';
import { unlockAudio } from './sound';

type Screen = 'home' | 'howto' | 'settings' | 'game' | 'lobby';
type Mode = 'local' | 'online';

const BOT_NAMES: Record<number, string> = { 1: 'Rami', 2: 'Nour', 3: 'Sami' };

function initialJoinCodeFromUrl(): string | undefined {
  const params = new URLSearchParams(window.location.search);
  const join = params.get('join');
  return join ? join.toUpperCase().slice(0, 6) : undefined;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [mode, setMode] = useState<Mode>('local');
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const game = useGame();
  const online = useOnlineGame();
  const install = useInstallPrompt();

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  useEffect(() => {
    document.documentElement.dir = settings.language === 'ar' ? 'rtl' : 'ltr';
  }, [settings.language]);

  // Mobile browsers require a real user gesture to start audio; unlock it on
  // the very first tap anywhere so every later sound effect (triggered from
  // async server events, not gestures) can actually be heard.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  // If a seat token is already stashed in localStorage (a killed-and-reopened
  // tab, per SPEC.md's Phase 2 definition of done), go straight into online
  // mode; useOnlineGame's own effect replays auth + game.resync on connect.
  useEffect(() => {
    if (loadSession()) setMode('online');
  }, []);

  // Follow the server's lead once we're in online mode: room.state means the
  // lobby, a SeatView means a game is running (also covers resync landing
  // either in the lobby or mid-match, per SPEC.md section 10).
  useEffect(() => {
    if (mode !== 'online') return;
    if (online.view) {
      setScreen('game');
    } else if (online.roomState) {
      setScreen((s) => (s === 'howto' || s === 'settings' ? s : 'lobby'));
    }
  }, [mode, online.view, online.roomState]);

  function updateSettings(patch: Partial<Settings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }

  const onlineNames: Record<Seat, string> = useMemo(() => {
    const base: Record<Seat, string> = { 0: 'Seat 0', 1: 'Seat 1', 2: 'Seat 2', 3: 'Seat 3' };
    if (online.roomState) {
      for (const slot of online.roomState.seats) {
        base[slot.seat] = slot.name ?? `Seat ${slot.seat}`;
      }
    }
    return base;
  }, [online.roomState]);

  // The unified sidelines list (SPEC.md 11): every bot-controlled seat is
  // claimable by any human without one, whether they're a brand-new observer
  // or an existing player whose own seat went idle and got flipped to a bot.
  const claimableSeats: Seat[] = ([0, 1, 2, 3] as Seat[]).filter((s) => online.presence[s] === 'bot');

  const localNames: Record<Seat, string> = {
    0: settings.displayName || 'You',
    1: BOT_NAMES[1],
    2: BOT_NAMES[2],
    3: BOT_NAMES[3],
  };

  async function handleCreateRoom(name: string) {
    setMode('online');
    const code = await online.createRoom(name, defaultConfig);
    if (code) setScreen('lobby');
  }

  async function handleJoinRoom(name: string, code: string) {
    setMode('online');
    const ok = await online.joinRoom(name, code);
    if (ok) setScreen('lobby');
  }

  // The 480px cap is a desktop-only "phone in a box" affordance. A width
  // breakpoint can't gate it correctly: a phone in landscape is routinely
  // 700-900px wide, well past any reasonable "mobile" cutoff, so it would
  // get boxed in right along with a real desktop window. Gating on
  // hover+fine-pointer instead targets an actual mouse-driven browser
  // specifically — true regardless of window width or orientation, and
  // never true on a touchscreen even rotated to landscape.
  return (
    <div className="h-screen w-screen [@media(hover:hover)_and_(pointer:fine)]:max-w-[480px] [@media(hover:hover)_and_(pointer:fine)]:mx-auto bg-felt-950 text-white overflow-hidden">
      {screen === 'home' && (
        <Home
          settings={settings}
          onUpdateSettings={updateSettings}
          onPlayVsBots={() => {
            setMode('local');
            game.startMatch();
            setScreen('game');
          }}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onHowToPlay={() => setScreen('howto')}
          onSettings={() => setScreen('settings')}
          joinError={online.lastError}
          initialJoinCode={initialJoinCodeFromUrl()}
        />
      )}

      {screen === 'howto' && <HowToPlay onBack={() => setScreen('home')} settings={settings} />}

      {screen === 'settings' && (
        <SettingsScreen settings={settings} onUpdate={updateSettings} onBack={() => setScreen('home')} />
      )}

      {screen === 'lobby' && (
        <Lobby
          roomState={online.roomState}
          roomCode={online.roomState?.roomCode ?? null}
          mySeat={online.mySeat}
          language={settings.language}
          onAddBot={online.addBot}
          onRemoveBot={online.removeBot}
          onReady={online.setReady}
          onStart={online.startGame}
          onConfigure={online.configure}
          onLeave={() => {
            online.leaveRoom();
            setMode('local');
            setScreen('home');
          }}
        />
      )}

      {screen === 'game' && mode === 'local' && game.match && game.view && (
        <GameTable
          view={game.view}
          names={localNames}
          events={game.events}
          clearEvent={game.clearEvent}
          passesApplied={game.match.round.passesApplied}
          passProgress={[0, 1, 2, 3].map((s) => game.match!.round.passes[s as Seat] !== null)}
          matchResult={game.match.result}
          settings={settings}
          onCommitPass={game.humanCommitPass}
          onPlayCard={game.humanPlayCard}
          onAdvanceRound={game.advanceRound}
          onRematch={() => game.rematch()}
          onHome={() => setScreen('home')}
        />
      )}

      {screen === 'game' && mode === 'online' && online.view && (
        <GameTable
          view={online.view}
          names={onlineNames}
          events={online.events}
          clearEvent={online.clearEvent}
          passesApplied={online.passesApplied}
          passProgress={online.passProgress}
          matchResult={online.matchResult}
          rematchVotes={online.mySeat !== null ? online.rematchVotes : undefined}
          presence={online.presence}
          turnDeadline={online.turnDeadline}
          emotes={online.emotes}
          onEmote={online.sendEmote}
          spectator={online.mySeat === null}
          claimableSeats={claimableSeats}
          onClaimSeat={online.claimSeat}
          roomCode={online.roomState?.roomCode ?? null}
          settings={settings}
          onCommitPass={online.pass}
          onPlayCard={online.play}
          onAdvanceRound={() => {
            // The server auto-advances to the next round a few seconds after
            // game.roundEnd (see ROUND_ADVANCE_DELAY_MS in apps/server/src/room.ts);
            // there is no client action to hurry it along, so this is a no-op
            // and the overlay dismisses itself once the next game.dealt/snapshot lands.
          }}
          onRematch={() => online.rematch()}
          onHome={() => {
            online.leaveRoom();
            setMode('local');
            setScreen('home');
          }}
        />
      )}

      {install.canInstall && (
        <InstallBanner
          rtl={settings.language === 'ar'}
          onInstall={install.promptInstall}
          onDismiss={install.dismiss}
        />
      )}
    </div>
  );
}
