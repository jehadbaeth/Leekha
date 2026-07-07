import { useEffect, useState } from 'react';
import { Home } from './Home';
import { HowToPlay } from './HowToPlay';
import { SettingsScreen } from './SettingsScreen';
import { GameTable } from './components/GameTable';
import { defaultSettings, loadSettings, saveSettings, type Settings } from './settings';
import { useGame } from './useGame';

type Screen = 'home' | 'howto' | 'settings' | 'game';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const game = useGame();

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  useEffect(() => {
    document.documentElement.dir = settings.language === 'ar' ? 'rtl' : 'ltr';
  }, [settings.language]);

  function updateSettings(patch: Partial<Settings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }

  return (
    <div className="h-screen w-screen max-w-[480px] mx-auto bg-felt-950 text-white overflow-hidden">
      {screen === 'home' && (
        <Home
          settings={settings}
          onUpdateSettings={updateSettings}
          onPlayVsBots={() => {
            game.startMatch();
            setScreen('game');
          }}
          onHowToPlay={() => setScreen('howto')}
          onSettings={() => setScreen('settings')}
        />
      )}

      {screen === 'howto' && <HowToPlay onBack={() => setScreen('home')} />}

      {screen === 'settings' && (
        <SettingsScreen settings={settings} onUpdate={updateSettings} onBack={() => setScreen('home')} />
      )}

      {screen === 'game' && game.match && game.view && (
        <GameTable
          match={game.match}
          view={game.view}
          events={game.events}
          clearEvent={game.clearEvent}
          settings={settings}
          onCommitPass={game.humanCommitPass}
          onPlayCard={game.humanPlayCard}
          onAdvanceRound={game.advanceRound}
          onRematch={() => game.rematch()}
          onHome={() => setScreen('home')}
          turnSeatOf={game.turnSeatOf}
        />
      )}
    </div>
  );
}
