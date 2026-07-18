// Friendly auto-generated display names (adjective + animal), assigned when a
// player leaves the name field blank instead of everyone landing on "Guest".
// Besides being nicer, it gives telemetry a fighting chance at telling two
// anonymous players apart -- the name is persisted per browser (settings.ts),
// so the same visitor keeps the same handle across sessions.

const ADJECTIVES = [
  'Mad', 'Funny', 'Sneaky', 'Brave', 'Sleepy', 'Clever', 'Grumpy', 'Cosmic', 'Lucky', 'Wild',
  'Silent', 'Fuzzy', 'Turbo', 'Mighty', 'Curious', 'Dizzy', 'Jolly', 'Nimble', 'Rusty', 'Salty',
  'Cheeky', 'Bold', 'Swift', 'Quiet', 'Spicy', 'Golden', 'Shadow', 'Frosty', 'Electric', 'Royal',
];

const ANIMALS = [
  'Llama', 'Bat', 'Fox', 'Otter', 'Falcon', 'Panda', 'Wolf', 'Gecko', 'Moose', 'Raven',
  'Tiger', 'Badger', 'Heron', 'Lynx', 'Camel', 'Hawk', 'Seal', 'Ferret', 'Bison', 'Cobra',
  'Puffin', 'Walrus', 'Mantis', 'Dingo', 'Koala', 'Owl', 'Crane', 'Ibex', 'Stoat', 'Viper',
];

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/** e.g. "Mad Llama", "Cosmic Otter". */
export function randomFunName(): string {
  return `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
}
