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

function play(url: string, gain = 0.7, delayMs = 0, maxMs?: number) {
  const audio = getContext();
  if (!audio) return;
  loadBuffer(url).then((buffer) => {
    if (!buffer) return;
    const source = audio.createBufferSource();
    source.buffer = buffer;
    const g = audio.createGain();
    g.gain.value = gain;
    source.connect(g).connect(audio.destination);
    const startAt = audio.currentTime + delayMs / 1000;
    source.start(startAt);
    // Some real recordings run far longer than an emote should (an 18s snore
    // loop, a 9s donkey): cap them with a short fade so the cut isn't abrupt.
    if (maxMs && buffer.duration * 1000 > maxMs) {
      const endAt = startAt + maxMs / 1000;
      g.gain.setValueAtTime(gain, endAt - 0.25);
      g.gain.linearRampToValueAtTime(0.0001, endAt);
      source.stop(endAt);
    }
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
const BIG_CARD_HIT = '/sounds/big-card-hit.mp3'; // user-recorded, "uh-oh"
const ROUND_END = '/sounds/round-end.ogg';
const GAME_WIN = '/sounds/game-win.ogg';
const GAME_LOSE = '/sounds/game-lose.ogg';

// Every emote cue is a real recording (Mixkit free license, plus two kept
// Kenney CC0 clips) — see public/CREDITS.txt for the exact source of each.
// maxMs caps recordings that run longer than a table reaction should.
const EMOTE_SOUNDS: Record<string, { url: string; gain?: number; maxMs?: number }> = {
  nice: { url: '/sounds/emote-nice.mp3' }, // small group applause
  haha: { url: '/sounds/emote-haha.opus' }, // user-recorded laugh
  wow: { url: '/sounds/emote-wow.ogg' }, // explosion (Kenney), for the exploding head
  gg: { url: '/sounds/emote-gg.mp3', maxMs: 4000 }, // user-recorded, "come"
  cry: { url: '/sounds/emote-cry.mp3' }, // sobbing kid
  angry: { url: '/sounds/emote-angry.opus' }, // user-recorded angry
  oops: { url: '/sounds/emote-oops.mp3', maxMs: 4500 }, // the classic sad trombone
  kiss: { url: '/sounds/emote-kiss.mp3', gain: 0.9 }, // user-recorded, "habibi"
  fire: { url: '/sounds/emote-fire.mp3', gain: 1 }, // real big fire burning roar (Mixkit), user-picked over 7 other candidates
  clown: { url: '/sounds/emote-clown.opus' }, // user-recorded, for "enter"
  popcorn: { url: '/sounds/emote-popcorn.opus', maxMs: 3000 }, // user-recorded, "ocazion"
  finger: { url: '/sounds/emote-finger.mp3', gain: 0.9 }, // cartoon fart
  donkey: { url: '/sounds/emote-donkey.opus', maxMs: 4000 }, // user-recorded donkey
  poop: { url: '/sounds/emote-poop.mp3' }, // funny cartoon fast splat
  sleep: { url: '/sounds/emote-sleep.mp3', maxMs: 3500, gain: 0.9 }, // user-recorded, "boring"
  goat: { url: '/sounds/emote-goat.mp3' }, // goat baa, for the GOAT
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
    play(BIG_CARD_HIT, 1);
  } else {
    playOneOf(CHIP_STACK, 0.6);
  }
}

/** A distinct cue per emote (SPEC.md 7.5.11) so reactions are told apart by ear, not just by sight. */
export function emoteSound(id: string) {
  const def = EMOTE_SOUNDS[id] ?? EMOTE_SOUNDS.nice;
  play(def.url, def.gain ?? 0.7, 0, def.maxMs);
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
