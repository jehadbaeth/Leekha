/**
 * A small country flag from the self-hosted SVG set in public/flags/
 * (lipis/flag-icons, MIT — includes the current three-star Syrian flag).
 * Self-hosting instead of emoji flags is deliberate: emoji flag glyphs are
 * drawn by each device's OS font, several of which still render Syria's
 * pre-2024 flag, and Windows renders no flag emoji at all.
 */
import type { CSSProperties } from 'react';

export function Flag({
  country,
  className = 'w-4 h-3',
  style,
}: {
  country: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <img
      src={`/flags/${country.toLowerCase()}.svg`}
      alt={country}
      title={country}
      loading="lazy"
      style={style}
      className={`inline-block rounded-[1px] shadow-sm ${className}`}
      onError={(e) => {
        // An unrecognized code (or a future ISO addition the set lacks) just
        // hides itself rather than showing a broken-image glyph.
        (e.currentTarget as HTMLImageElement).style.display = 'none';
      }}
    />
  );
}
