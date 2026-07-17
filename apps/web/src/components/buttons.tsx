import type { ReactNode } from 'react';

/**
 * Shared button vocabulary for the menu screens. Replaces the bare underlined
 * text links that used to serve as Back / footer navigation. The chevron auto
 * flips for RTL via the `.mirror-rtl` transform in index.css (dir is set on
 * <html> in App.tsx), so callers pass a plain label with no arrow glyph.
 */
export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/60 bg-emerald-900/50 pl-2.5 pr-3.5 py-1.5 text-sm font-medium text-emerald-100 hover:bg-emerald-800/70 active:scale-95 transition"
    >
      <svg
        className="w-4 h-4 mirror-rtl"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
      <span>{label}</span>
    </button>
  );
}

/**
 * A subtle ghost pill for secondary navigation (Home footer, Leave room, etc.).
 * `tone="danger"` tints it for destructive actions like leaving a room.
 */
export function PillButton({
  children,
  onClick,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: 'neutral' | 'danger';
  className?: string;
}) {
  const tones =
    tone === 'danger'
      ? 'border-rose-500/50 bg-rose-950/30 text-rose-200 hover:bg-rose-900/50'
      : 'border-emerald-600/50 bg-emerald-900/40 text-emerald-100 hover:bg-emerald-800/60';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium active:scale-95 transition ${tones} ${className}`}
    >
      {children}
    </button>
  );
}
