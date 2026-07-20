import { useEffect, useMemo, useState } from 'react';
import type { Seat } from '@leekha/engine';
import { defaultConfig } from '@leekha/engine';
import { Home } from './Home';
import { Lobby } from './Lobby';
import { HowToPlay } from './HowToPlay';
import { SettingsScreen } from './SettingsScreen';
import { AuthScreen } from './AuthScreen';
import { HistoryScreen } from './HistoryScreen';
import { AdminScreen } from './AdminScreen';
import { GamePicker, type GameChoice } from './GamePicker';
import { TrixLocalGame } from './trix/TrixGame';
import { TrixOnlineGame } from './trix/TrixOnlineGame';
import { defaultTrixConfig } from '@leekha/trix';
import { GameTable } from './components/GameTable';
import { VoiceControls } from './components/VoiceControls';
import { defaultSettings, loadSettings, saveSettings, type Settings } from './settings';
import { useGame } from './useGame';
import { useOnlineGame } from './useOnlineGame';
import { useVoiceLobby } from './voice/useVoiceLobby';
import { loadSession } from './net/session';
import { fetchMe, logout as apiLogout, type AuthedUser } from './net/api';
import { useInstallPrompt } from './useInstallPrompt';
import { InstallBanner } from './components/InstallBanner';
import { unlockAudio } from './sound';

type Screen = 'home' | 'howto' | 'settings' | 'game' | 'lobby' | 'auth' | 'history';
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
  // Discreet admin/telemetry panel, reached via the #admin URL fragment. Access
  // is gated server-side by the ADMIN_TOKEN, so the route being guessable is
  // fine; the panel just prompts for the token.
  const [adminMode, setAdminMode] = useState(() => window.location.hash === '#admin');
  // Which game the player picked at the entry screen. null = show the picker.
  // Leekha's entire flow stays behind the 'leekha' choice, byte-for-byte.
  const [gameChoice, setGameChoice] = useState<GameChoice | null>(null);
  const [landingAuth, setLandingAuth] = useState(false);
  const [landingSettings, setLandingSettings] = useState(false);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [user, setUser] = useState<AuthedUser | null>(null);
  const game = useGame(settings.botDifficulty);
  const online = useOnlineGame();
  const voice = useVoiceLobby(online.socket, {
    roomCode: mode === 'online' ? online.roomState?.roomCode ?? null : null,
    seated: online.mySeat !== null,
    allowSpectatorVoice: online.roomState?.allowSpectatorVoice ?? true,
    connectionStatus: online.status,
    autoJoin: settings.voiceAutoJoin,
  });
  const install = useInstallPrompt();

  useEffect(() => {
    // loadSettings fills a persisted fun handle (Mad Llama, Cosmic Otter) when
    // the name is blank, so first-run players read as distinct on the table and
    // in telemetry, and it's set before the socket handshake reads it.
    setSettings(loadSettings());
  }, []);

  useEffect(() => {
    const onHash = () => setAdminMode(window.location.hash === '#admin');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    fetchMe()
      .then(setUser)
      .catch(() => setUser(null));
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

  const onlineCountries: Partial<Record<Seat, string | null>> = useMemo(() => {
    const base: Partial<Record<Seat, string | null>> = {};
    if (online.roomState) {
      for (const slot of online.roomState.seats) base[slot.seat] = slot.country ?? null;
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

  async function handleCreateRoom(name: string, isPublic: boolean) {
    setMode('online');
    const code = await online.createRoom(name, defaultConfig, isPublic);
    if (code) setScreen('lobby');
  }

  async function handleJoinRoom(name: string, code: string, gameType: 'leekha' | 'trix' = 'leekha') {
    // A public room carries its game type, so route the join to the right game:
    // a Trix room switches into the Trix online flow (which joins by code),
    // rather than being (incorrectly) joined through the Leekha socket.
    if (gameType === 'trix') {
      setGameChoice({ game: 'trix', config: defaultTrixConfig, online: true, joinCode: code });
      return;
    }
    setMode('online');
    const ok = await online.joinRoom(name, code);
    if (ok) setScreen('lobby');
  }

  // The table used to be force-stretched to h-full/100vh so its flex-col
  // sections would fill the whole viewport; on any window taller than its
  // actual content (avatars + trick area + HUD + hand tray), the flex-1
  // middle section soaked up all that leftover height as a dead void. Worse,
  // 100vh/fixed on a real mobile browser is measured against the layout
  // viewport, not the visible one -- when the address bar is showing, the
  // real visible height is shorter, so content sized to fill "100%" could run
  // past the bottom of the screen with nothing to scroll it back into view
  // (this is what made the Start button and hand of cards unreachable).
  // Sizing to natural content height, centering it, and using scroll as a
  // fallback rather than a hard clip fixes both at once: no forced height
  // means no dead void to fill, and nothing is ever clipped unreachable.
  // The `.game-shell-inner` media query in index.css still boxes the view to
  // a phone-sized silhouette once BOTH dimensions exceed a phone-shaped
  // threshold, so a real phone (portrait or landscape) always gets full
  // bleed and only a genuinely desktop-shaped window gets the centered box.
  if (adminMode) {
    return (
      <div className="min-h-[100dvh] w-full bg-felt-950 overflow-y-auto">
        <AdminScreen
          onExit={() => {
            history.replaceState(null, '', window.location.pathname + window.location.search);
            setAdminMode(false);
          }}
        />
      </div>
    );
  }

  // Entry: pick a game (with global identity/account). Leekha renders its
  // unchanged shell below; Trix renders through the same shared table.
  if (!gameChoice) {
    return (
      <div className="min-h-[100dvh] w-full flex items-center justify-center bg-felt-950 overflow-y-auto">
        <div className="game-shell-inner relative h-[100dvh] w-full text-white">
          {landingSettings ? (
            // Settings live at the landing so they apply to EVERY game (Leekha
            // and Trix), not just Leekha's own menu.
            <SettingsScreen settings={settings} onUpdate={updateSettings} onBack={() => setLandingSettings(false)} />
          ) : landingAuth ? (
            <AuthScreen
              settings={settings}
              onBack={() => setLandingAuth(false)}
              onAuthed={(u) => {
                setUser(u);
                setLandingAuth(false);
              }}
            />
          ) : (
            <GamePicker
              settings={settings}
              onUpdateSettings={updateSettings}
              user={user}
              onAuth={() => setLandingAuth(true)}
              onLogout={() => void apiLogout().finally(() => setUser(null))}
              onChoose={setGameChoice}
              onSettings={() => setLandingSettings(true)}
            />
          )}
        </div>
      </div>
    );
  }

  if (gameChoice.game === 'trix') {
    return (
      <div className="min-h-[100dvh] w-full flex items-center justify-center bg-felt-950 overflow-y-auto">
        <div className="game-shell-inner relative h-[100dvh] w-full text-white">
          {gameChoice.online ? (
            <TrixOnlineGame config={gameChoice.config} settings={settings} joinCode={gameChoice.joinCode} onExit={() => setGameChoice(null)} />
          ) : (
            <TrixLocalGame config={gameChoice.config} settings={settings} onExit={() => setGameChoice(null)} />
          )}
        </div>
      </div>
    );
  }

  // The install banner is fixed to the bottom of the viewport. Never show it
  // over the game board (it would cover the hand/emote on short screens); on
  // menu screens, reserve bottom space so footer controls clear it.
  const bannerVisible = install.canInstall && screen !== 'game';
  return (
    <div className={`min-h-[100dvh] w-full flex items-center justify-center bg-felt-950 overflow-y-auto ${bannerVisible ? 'pb-16' : ''}`}>
      <div className="game-shell-inner relative h-[100dvh] w-full text-white">
        {mode === 'online' && online.roomState && screen === 'game' && (
          <VoiceControls controller={voice} language={settings.language} />
        )}
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
          onChangeGame={() => {
            online.leaveRoom();
            setMode('local');
            setGameChoice(null);
          }}
          joinError={online.lastError}
          initialJoinCode={initialJoinCodeFromUrl()}
          publicRooms={online.publicRooms}
          onRefreshPublicRooms={online.refreshPublicRooms}
          user={user}
          onAuth={() => setScreen('auth')}
          onLogout={() => {
            void apiLogout().finally(() => setUser(null));
          }}
          onHistory={() => setScreen('history')}
        />
      )}

      {screen === 'howto' && <HowToPlay onBack={() => setScreen('home')} settings={settings} />}

      {screen === 'settings' && (
        <SettingsScreen settings={settings} onUpdate={updateSettings} onBack={() => setScreen('home')} />
      )}

      {screen === 'auth' && (
        <AuthScreen
          settings={settings}
          onBack={() => setScreen('home')}
          onAuthed={(u) => {
            setUser(u);
            setScreen('home');
          }}
        />
      )}

      {screen === 'history' && <HistoryScreen settings={settings} onBack={() => setScreen('home')} />}

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
          onToggleSpectatorVoice={online.setSpectatorVoice}
          onTogglePublic={online.setPublic}
          voice={voice}
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
          spectators={online.spectators}
          countries={onlineCountries}
          claimableSeats={claimableSeats}
          onClaimSeat={online.claimSeat}
          roomCode={online.roomState?.roomCode ?? null}
          settings={settings}
          onCommitPass={online.pass}
          onPlayCard={online.play}
          roundAutoAdvances
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

      {bannerVisible && (
        <InstallBanner
          rtl={settings.language === 'ar'}
          onInstall={install.promptInstall}
          onDismiss={install.dismiss}
        />
      )}
      </div>
    </div>
  );
}
