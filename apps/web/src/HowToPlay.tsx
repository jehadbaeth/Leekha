import { useState } from 'react';
import { pick, type Settings } from './settings';

const PAGES = {
  en: [
    {
      title: 'The goal',
      body: [
        'Four players, two partnerships seated opposite each other. Avoid eating penalty points.',
        'Every heart is worth 1 point. The three Leekha cards are worth more: 10♦ = 10, Q♠ = 13, K♣ = 14. That is 50 points in the deck every round.',
        'Whoever wins a trick "eats" any penalty points in it. Scores add up across rounds toward a target of 201.',
      ],
    },
    {
      title: 'The pass',
      body: [
        'Before each round, everyone secretly picks 3 cards and passes them to the player on their right.',
        'You never see what you are about to receive until every player has committed their pass.',
        'Passing a Leekha card gets it out of your hand, but the receiver knows exactly what you gave them for the rest of the round.',
      ],
    },
    {
      title: 'The forced dump',
      body: [
        'If you cannot follow the suit that was led, and you hold a Leekha card (10♦, Q♠ or K♣), you must play one of them.',
        'Example: hearts are led. You have no hearts, but you hold the Q♠. You must play the Q♠, even if your partner is winning the trick.',
        'The undercut rule then kicks in: once a Leekha card is on the trick, everyone who plays after must play something lower than it, if they can.',
      ],
    },
    {
      title: 'Team survival',
      body: [
        'You and your partner share a fate: the moment either of you reaches 201 points, your team loses the match.',
        'Healthy partners often deliberately win pointed tricks to protect a partner who is close to the target. This is called a sacrifice.',
        'Watch the score rows: anyone within 30 points of the target is highlighted so the whole table can see the danger.',
      ],
    },
  ],
  ar: [
    {
      title: 'الطلوع',
      body: [
        'أربعة لاعبين، فريقان يجلس كل منهما في مواجهة الآخر. تجنّب أكل نقاط العقوبة.',
        'كل ورقة قلب (هارت) تساوي نقطة واحدة. أوراق الليخة الثلاث تساوي أكثر: 10♦ = 10، Q♠ = 13، K♣ = 14. أي 50 نقطة في المجموعة كل جولة.',
        'من يفوز باللفة "يأكل" نقاط العقوبة فيها. تتراكم النقاط عبر الجولات نحو طلوع 201.',
      ],
    },
    {
      title: 'التمرير',
      body: [
        'قبل كل جولة، يختار كل لاعب سراً 3 أوراق ويمررها للاعب الذي على يمينه.',
        'لن ترى ما ستستلمه إلا بعد أن يمرر كل اللاعبين أوراقهم.',
        'تمرير ورقة ليخة يخرجها من يدك، لكن من يستلمها يعرف بالضبط ما أعطيته له لبقية الجولة.',
      ],
    },
    {
      title: 'التفريغ الإجباري',
      body: [
        'إذا لم تستطع اللحاق بنوع الورقة التي بدأت اللفة، وكنت تحمل ورقة ليخة (10♦ أو Q♠ أو K♣)، يجب أن تلعب واحدة منها.',
        'مثال: بدأت اللفة بالقلوب. ليس معك قلوب، لكن معك Q♠. يجب أن تلعب Q♠، حتى لو كان شريكك هو من يفوز باللفة.',
        'عندها تطبَّق قاعدة اللعب تحت: بمجرد أن تدخل ورقة ليخة اللفة، يجب على كل من يلعب بعدها أن يلعب ورقة أقل منها إن استطاع.',
      ],
    },
    {
      title: 'بقاء الفريق',
      body: [
        'أنت وشريكك تتشاركان المصير: بمجرد أن يصل أي منكما إلى 201 نقطة، يخسر فريقكما الجولة.',
        'غالباً ما يفوز الشريك السليم عمداً بلفات فيها نقاط لحماية شريك قريب من الطلوع. يُسمى هذا التضحية.',
        'راقب صفوف النقاط: يُبرز أي لاعب على بعد 30 نقطة من الطلوع ليرى الجميع الخطر.',
      ],
    },
  ],
};

export function HowToPlay({ onBack, settings }: { onBack: () => void; settings: Settings }) {
  const [page, setPage] = useState(0);
  const pages = PAGES[settings.language];
  const p = pages[page];
  const t = (en: string, ar: string) => pick(settings.language, en, ar);

  return (
    <div className="min-h-full flex flex-col bg-felt-950 text-white px-6 py-8">
      <button className="self-start text-sm underline text-emerald-200 mb-6" onClick={onBack}>
        {t('← Back', '→ رجوع')}
      </button>

      <div className="flex-1 flex flex-col justify-center max-w-md mx-auto w-full gap-4">
        <div className="text-xs uppercase tracking-wide text-amber-300">
          {page + 1} / {pages.length}
        </div>
        <h2 className="text-2xl font-bold">{p.title}</h2>
        <div className="flex flex-col gap-3 text-emerald-100 text-sm leading-relaxed">
          {p.body.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </div>

      <div className="flex justify-between items-center max-w-md mx-auto w-full mt-8">
        <button
          className="px-4 py-2 rounded-lg bg-emerald-800 disabled:opacity-30"
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          {t('Previous', 'السابق')}
        </button>
        <div className="flex gap-1.5">
          {pages.map((_, i) => (
            <span key={i} className={`w-2 h-2 rounded-full ${i === page ? 'bg-amber-400' : 'bg-emerald-700'}`} />
          ))}
        </div>
        {page < pages.length - 1 ? (
          <button
            className="px-4 py-2 rounded-lg bg-amber-400 text-emerald-950 font-semibold"
            onClick={() => setPage((p) => Math.min(pages.length - 1, p + 1))}
          >
            {t('Next', 'التالي')}
          </button>
        ) : (
          <button className="px-4 py-2 rounded-lg bg-amber-400 text-emerald-950 font-semibold" onClick={onBack}>
            {t('Done', 'تم')}
          </button>
        )}
      </div>
    </div>
  );
}
