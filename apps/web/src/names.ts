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

// Arabic names are a curated list of correct animal + adjective pairs rather
// than a free adjective x animal cross product: Arabic adjectives agree with
// the noun's gender (بومة حكيمة vs ذئب ماكر), so a random mashup would produce
// grammatically wrong combos. Hand-picked pairs keep every one correct.
const ARABIC_NAMES = [
  'ذئب ماكر', 'ثعلب ذكي', 'صقر شجاع', 'نمر سريع', 'دب نعسان', 'قط مشاغب',
  'أسد جريء', 'قرد مشاكس', 'جمل صبور', 'غزال رشيق', 'أرنب مرح', 'فيل ضخم',
  'بطريق أنيق', 'حصان أصيل', 'بومة حكيمة', 'سلحفاة بطيئة', 'نحلة نشيطة',
  'فراشة جميلة', 'أفعى ماكرة', 'عقاب حاد',
];

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/** e.g. "Mad Llama" / "Cosmic Otter", or a correct Arabic pair when lang is 'ar'. */
export function randomFunName(lang: 'en' | 'ar' = 'en'): string {
  if (lang === 'ar') return pick(ARABIC_NAMES);
  return `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
}
