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

const buffers = new Map<string, Promise<AudioBuffer | null>>();

/** Fetches and decodes a sound file once; every later play() for the same URL reuses the decoded buffer. */
function loadBuffer(url: string): Promise<AudioBuffer | null> {
  const audio = getContext();
  if (!audio) return Promise.resolve(null);
  let cached = buffers.get(url);
  if (!cached) {
    cached = fetch(url)
      .then((res) => res.arrayBuffer())
      .then((data) => audio.decodeAudioData(data))
      .catch(() => null);
    buffers.set(url, cached);
  }
  return cached;
}

function play(url: string, gain = 0.7, delayMs = 0) {
  const audio = getContext();
  if (!audio) return;
  loadBuffer(url).then((buffer) => {
    if (!buffer) return;
    const source = audio.createBufferSource();
    source.buffer = buffer;
    const g = audio.createGain();
    g.gain.value = gain;
    source.connect(g).connect(audio.destination);
    source.start(audio.currentTime + delayMs / 1000);
  });
}

function playOneOf(urls: string[], gain = 0.7) {
  play(urls[Math.floor(Math.random() * urls.length)], gain);
}

// Real recorded/produced audio (CC0, Kenney.nl "Casino Audio", "Interface
// Sounds" and "Music Jingles" packs) — see public/CREDITS.txt. No more
// synthesized oscillator tones.
const CARD_PLACE = [1, 2, 3, 4].map((i) => `/sounds/card-place-${i}.ogg`);
const CARD_SLIDE = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => `/sounds/card-slide-${i}.ogg`);
const CHIP_STACK = [1, 2, 3, 4, 5, 6].map((i) => `/sounds/chip-stack-${i}.ogg`);
const BIG_CARD_HIT = '/sounds/big-card-hit.ogg';
const ROUND_END = '/sounds/round-end.ogg';
const GAME_WIN = '/sounds/game-win.ogg';
const GAME_LOSE = '/sounds/game-lose.ogg';

const EMOTE_SOUNDS: Record<string, string> = {
  nice: '/sounds/emote-nice.ogg',
  haha: '/sounds/emote-haha.ogg',
  wow: '/sounds/emote-wow.ogg',
  oops: '/sounds/emote-oops.ogg',
  fire: '/sounds/emote-fire.ogg',
  thanks: '/sounds/emote-thanks.ogg',
  ugh: '/sounds/emote-ugh.ogg',
  gg: '/sounds/emote-gg.ogg',
  clown: '/sounds/emote-clown.ogg',
  popcorn: '/sounds/emote-popcorn.ogg',
};

/** Q-spade, K-club, 10-diamond get a distinct sting per SPEC.md section 7.5.6. */
export function isBigCard(card: Card): boolean {
  return (
    (card.suit === 'S' && card.rank === 12) ||
    (card.suit === 'C' && card.rank === 13) ||
    (card.suit === 'D' && card.rank === 10)
  );
}

/** A card thrown onto the table. */
export function playCardSound() {
  playOneOf(CARD_PLACE);
}

export function trickEndSound(bigCard: boolean) {
  if (bigCard) {
    play(BIG_CARD_HIT, 0.85);
  } else {
    playOneOf(CHIP_STACK, 0.6);
  }
}

/** A distinct cue per emote (SPEC.md 7.5.11) so reactions are told apart by ear, not just by sight. */
export function emoteSound(id: string) {
  play(EMOTE_SOUNDS[id] ?? EMOTE_SOUNDS.nice, 0.7);
}

/** The round's deal flourish: each card gets its own slide, cycling through the pack so a full deal doesn't repeat one clip. */
export function dealSound(cardIndex: number) {
  play(CARD_SLIDE[cardIndex % CARD_SLIDE.length], 0.5);
}

export function roundEndSound() {
  play(ROUND_END, 0.8);
}

export function gameOverSound(won: boolean) {
  play(won ? GAME_WIN : GAME_LOSE, 0.9);
}

/**
 * Mobile browsers only allow an AudioContext to start (or resume from
 * suspended) synchronously inside a real user gesture's call stack; a sound
 * triggered later from an async effect (e.g. reacting to a server message)
 * is too late and gets silently swallowed. Call this once from the very
 * first tap/click anywhere in the app to unlock it for every sound after.
 * Scheduling a silent buffer (rather than just opening the context) is what
 * actually satisfies iOS Safari's gesture check.
 */
export function unlockAudio() {
  const audio = getContext();
  if (!audio) return;
  const buffer = audio.createBuffer(1, 1, audio.sampleRate);
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  source.start();
}

export function vibrate(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(pattern);
}
