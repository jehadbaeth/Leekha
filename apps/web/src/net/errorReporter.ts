import { SERVER_URL } from './socket';

// Ships uncaught browser errors to the server's telemetry sink (Phase 3). Capped
// per page load so a tight error loop can't hammer the endpoint; the server also
// rate-limits per IP and length-caps every field.
let sent = 0;
const MAX_PER_LOAD = 20;

function report(message: string, stack: string | null): void {
  if (sent >= MAX_PER_LOAD || !message) return;
  sent += 1;
  try {
    void fetch(`${SERVER_URL}/api/telemetry/error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.slice(0, 2000), stack: stack?.slice(0, 8000) ?? null, url: location.href }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never let error reporting throw */
  }
}

export function installErrorReporter(): void {
  window.addEventListener('error', (e) => {
    report(e.message || 'error', (e.error as Error | undefined)?.stack ?? null);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as { message?: string; stack?: string } | string | undefined;
    const message = typeof r === 'string' ? r : (r?.message ?? 'unhandled rejection');
    report(message, typeof r === 'object' ? (r?.stack ?? null) : null);
  });
}
