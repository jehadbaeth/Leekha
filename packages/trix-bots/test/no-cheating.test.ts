import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('trix-bots cannot cheat by construction', () => {
  it('never references TrixMatchState anywhere in packages/trix-bots/src', () => {
    const srcDir = join(__dirname, '..', 'src');
    for (const file of readdirSync(srcDir)) {
      if (!file.endsWith('.ts')) continue;
      const content = readFileSync(join(srcDir, file), 'utf8');
      expect(content).not.toMatch(/TrixMatchState/);
    }
  });
});
