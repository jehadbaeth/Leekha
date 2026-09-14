/**
 * Builds apps/web for the native shell.
 *
 * Two things differ from the plain web build, and both are done here (at build
 * time) rather than sniffed at runtime, so the shipped bundle is deterministic:
 *
 * 1. VITE_SERVER_URL is required. In a browser the page and the API share an
 *    origin; in the webview the origin is the local bundle, so the server has
 *    to be named explicitly or nothing connects (see apps/web/src/native.ts).
 *
 * 2. `viewport-fit=cover` is stripped from index.html. The webapp runs inside
 *    browser chrome, so its layout never had to dodge a notch or a home
 *    indicator. Dropping `cover` makes the webview viewport *be* the safe area,
 *    which means 100dvh is the safe height and every screen keeps the exact
 *    proportions it has on the web -- rather than each component having to grow
 *    its own env(safe-area-inset-*) handling and drift from the web layout.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, '../../web');
const indexHtml = resolve(webDir, 'dist/index.html');

// Default points at the deployment this app actually talks to; override with
// VITE_SERVER_URL=... for a staging box or a LAN dev server.
const serverUrl = process.env.VITE_SERVER_URL ?? 'https://carl-latitudee5570.tail5b4e29.ts.net:8443';

console.log(`[mobile] building apps/web against ${serverUrl}`);
execFileSync('pnpm', ['--filter', '@leekha/web', 'run', 'build'], {
  cwd: webDir,
  stdio: 'inherit',
  env: { ...process.env, VITE_SERVER_URL: serverUrl },
});

const html = readFileSync(indexHtml, 'utf8');
const patched = html.replace(/,\s*viewport-fit=cover/, '');
if (patched === html) {
  // Not fatal, but it means the safe-area assumption above silently stopped
  // holding -- say so rather than shipping a table under the notch.
  console.warn('[mobile] WARNING: viewport-fit=cover not found in index.html; check safe-area handling');
} else {
  writeFileSync(indexHtml, patched);
  console.log('[mobile] stripped viewport-fit=cover for native safe areas');
}
