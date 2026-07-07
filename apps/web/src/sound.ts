import type { Card } from '@leekha/engine';

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq: number, durationMs: number, gain = 0.12, type: OscillatorType = 'sine', delayMs = 0) {
  const audio = getContext();
  if (!audio) return;
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const start = audio.currentTime + delayMs / 1000;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
  osc.connect(g).connect(audio.destination);
  osc.start(start);
  osc.stop(start + durationMs / 1000 + 0.02);
}

/** Q-spade, K-club, 10-diamond get a distinct sting per SPEC.md section 7.5.6. */
export function isBigCard(card: Card): boolean {
  return (
    (card.suit === 'S' && card.rank === 12) ||
    (card.suit === 'C' && card.rank === 13) ||
    (card.suit === 'D' && card.rank === 10)
  );
}

export function playCardSound() {
  tone(520, 70, 0.08, 'triangle');
}

export function trickEndSound(bigCard: boolean) {
  if (bigCard) {
    tone(220, 90, 0.16, 'sawtooth');
    tone(440, 160, 0.14, 'sawtooth', 90);
    tone(660, 220, 0.12, 'sawtooth', 180);
  } else {
    tone(660, 120, 0.1, 'sine');
    tone(880, 140, 0.08, 'sine', 90);
  }
}

export function roundEndSound() {
  tone(392, 150, 0.1);
  tone(494, 150, 0.1, 'sine', 130);
  tone(587, 220, 0.1, 'sine', 260);
}

export function gameOverSound(won: boolean) {
  if (won) {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 220, 0.12, 'sine', i * 130));
  } else {
    [392, 349, 294].forEach((f, i) => tone(f, 260, 0.12, 'sawtooth', i * 150));
  }
}

export function vibrate(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(pattern);
}
