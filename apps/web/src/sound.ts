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

/** A short filtered noise burst — the raw material for a card's paper "snap" or a drum's "crack". */
function noiseBurst(durationMs: number, gain: number, filterFreq: number, filterType: BiquadFilterType, delayMs = 0) {
  const audio = getContext();
  if (!audio) return;
  const start = audio.currentTime + delayMs / 1000;
  const durationSec = durationMs / 1000;
  const buffer = audio.createBuffer(1, Math.max(1, Math.floor(audio.sampleRate * durationSec)), audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = audio.createBufferSource();
  src.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = filterFreq;
  const g = audio.createGain();
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);
  src.connect(filter).connect(g).connect(audio.destination);
  src.start(start);
  src.stop(start + durationSec + 0.02);
}

/** A pitch-swept low thump — the raw material for a kick-drum style hit. */
function thump(startFreq: number, endFreq: number, durationMs: number, gain: number, delayMs = 0) {
  const audio = getContext();
  if (!audio) return;
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = 'sine';
  const start = audio.currentTime + delayMs / 1000;
  const durationSec = durationMs / 1000;
  osc.frequency.setValueAtTime(startFreq, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), start + durationSec);
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);
  osc.connect(g).connect(audio.destination);
  osc.start(start);
  osc.stop(start + durationSec + 0.02);
}

/** Q-spade, K-club, 10-diamond get a distinct sting per SPEC.md section 7.5.6. */
export function isBigCard(card: Card): boolean {
  return (
    (card.suit === 'S' && card.rank === 12) ||
    (card.suit === 'C' && card.rank === 13) ||
    (card.suit === 'D' && card.rank === 10)
  );
}

/** A card thrown onto the table: a quick paper whoosh followed by a crisp snap. */
export function playCardSound() {
  noiseBurst(70, 0.1, 2200, 'bandpass');
  noiseBurst(35, 0.14, 5000, 'highpass', 45);
  tone(900, 30, 0.05, 'square', 50);
}

/** A player eating a Leekha card: a big kick-drum hit, not just a louder chime. */
function bigLeekhaDrum() {
  thump(180, 45, 130, 0.3);
  noiseBurst(60, 0.18, 1800, 'bandpass', 5);
  thump(140, 40, 160, 0.22, 150);
  noiseBurst(50, 0.12, 1500, 'bandpass', 155);
}

export function trickEndSound(bigCard: boolean) {
  if (bigCard) {
    bigLeekhaDrum();
  } else {
    tone(660, 120, 0.1, 'sine');
    tone(880, 140, 0.08, 'sine', 90);
  }
}

/** A cartoonish little "boing" for emote reactions. */
export function emoteSound() {
  const audio = getContext();
  if (!audio) return;
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = 'sine';
  const start = audio.currentTime;
  osc.frequency.setValueAtTime(320, start);
  osc.frequency.exponentialRampToValueAtTime(720, start + 0.09);
  osc.frequency.exponentialRampToValueAtTime(420, start + 0.16);
  g.gain.setValueAtTime(0.001, start);
  g.gain.linearRampToValueAtTime(0.12, start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
  osc.connect(g).connect(audio.destination);
  osc.start(start);
  osc.stop(start + 0.2);
}

/** A fast, light patter for the round's deal flourish — many quick taps, over almost as soon as it starts. */
export function dealSound(cardIndex: number) {
  noiseBurst(28, 0.05, 3200, 'bandpass', 0);
  tone(700 + (cardIndex % 4) * 40, 18, 0.02, 'triangle');
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

/**
 * Mobile browsers only allow an AudioContext to start (or resume from
 * suspended) synchronously inside a real user gesture's call stack; a sound
 * triggered later from an async effect (e.g. reacting to a server message)
 * is too late and gets silently swallowed. Call this once from the very
 * first tap/click anywhere in the app to unlock it for every sound after.
 */
export function unlockAudio() {
  getContext();
}

export function vibrate(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(pattern);
}
