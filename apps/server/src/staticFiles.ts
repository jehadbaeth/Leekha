import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.ogg': 'audio/ogg',
};

/**
 * Serves the built web client from the same origin as the WebSocket
 * (SPEC.md section 9 item 6: one Docker container, no CORS/cookie split).
 * Falls back to index.html for any unmatched path so the client's own
 * router (App.tsx's `?join=` handling, etc.) still sees a normal load.
 */
export function createStaticHandler(webDist: string) {
  return async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://internal');
    const safePath = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    const filePath = join(webDist, safePath === '/' ? 'index.html' : safePath);

    try {
      const data = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      try {
        const index = await readFile(join(webDist, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(index);
      } catch {
        res.writeHead(404);
        res.end('not found');
      }
    }
  };
}
