/**
 * The handful of places the app must behave differently inside the native
 * shell (apps/mobile) than it does in a browser tab.
 *
 * Everything else -- every screen, every rule, every animation -- is the exact
 * same code in both, which is the whole point of shipping the mobile apps as a
 * Capacitor wrapper around this build rather than as a reimplementation.
 */

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

function capacitor(): CapacitorGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** True only inside the Android/iOS shell; false in every browser, including an installed PWA. */
export function isNative(): boolean {
  return capacitor()?.isNativePlatform?.() === true;
}

export function nativePlatform(): 'android' | 'ios' | 'web' {
  const platform = capacitor()?.getPlatform?.();
  return platform === 'android' || platform === 'ios' ? platform : 'web';
}

/**
 * Where the backend lives.
 *
 * In a browser the page and the API share an origin in production, so
 * `window.location.origin` is right. In the native shell that origin is the
 * *local bundle* (capacitor://localhost or http://localhost), so falling back
 * to it would point every socket and /api/* call at the app itself and nothing
 * would ever connect. Native builds must therefore be built with an explicit
 * VITE_SERVER_URL; this throws loudly at startup rather than failing later as
 * a pile of silent connection errors.
 */
export function resolveServerUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured) return configured.replace(/\/+$/, '');
  if (isNative()) {
    throw new Error(
      'VITE_SERVER_URL must be set when building the native app: the webview origin is the local bundle, not the server.',
    );
  }
  return import.meta.env.DEV ? `http://${window.location.hostname}:8080` : window.location.origin;
}

/**
 * Session token store for native builds.
 *
 * The server's session cookie is SameSite=Lax, which browsers will not attach
 * to the cross-site requests a webview makes, so the native app keeps the same
 * token itself and sends it as `Authorization: Bearer` (HTTP) and in the
 * socket.io `auth` payload. On web this stays null and the cookie does its
 * usual job -- see bearerToken() in apps/server/src/auth.ts.
 */
const TOKEN_KEY = 'leekha.authToken.v1';

export function loadAuthToken(): string | null {
  if (!isNative()) return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveAuthToken(token: string | null): void {
  if (!isNative()) return;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore storage failures, same as settings.ts
  }
}

/** Header bag for fetch: a bearer header on native, nothing at all on web. */
export function authHeaders(): Record<string, string> {
  const token = loadAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Android's hardware/gesture back button.
 *
 * Without this, back exits the app from anywhere, including the middle of a
 * match, which is the worst possible moment to lose a session.
 *
 * Screens register handlers rather than sharing one big conditional, because
 * the state back has to unwind is not all in one place: App.tsx owns the
 * landing screens and the Leekha room, but TrixOnlineGame owns its own room
 * drawer. Handlers run highest priority first and the first one to return true
 * wins, so an inner overlay always gets the press before the screen that
 * contains it. If every handler declines, Android closes the app.
 *
 * Reached through the global plugin registry rather than an import so the web
 * bundle carries no Capacitor dependency at all; on web this is inert.
 */
interface BackButtonPlugin {
  addListener(
    event: 'backButton',
    handler: () => void,
  ): Promise<{ remove: () => void }> | { remove: () => void };
  exitApp?: () => void;
}

function backButtonPlugin(): BackButtonPlugin | undefined {
  if (typeof window === 'undefined') return undefined;
  const plugins = (window as unknown as { Capacitor?: { Plugins?: { App?: BackButtonPlugin } } }).Capacitor
    ?.Plugins;
  return plugins?.App;
}

/** Priorities for registerBackHandler. Higher runs first. */
export const BACK_PRIORITY = {
  /** Whole-screen fallback: unwind a screen or leave the room. */
  screen: 0,
  /** Drawers, sheets and other overlays drawn on top of a screen. */
  overlay: 10,
} as const;

type BackHandler = { priority: number; fn: () => boolean };

const backHandlers: BackHandler[] = [];
let backSubscription: { remove: () => void } | null = null;
let backSubscribing = false;

function dispatchBack(): void {
  // Copy before iterating: a handler may unmount a component and deregister
  // another handler mid-dispatch.
  for (const handler of [...backHandlers].sort((a, b) => b.priority - a.priority)) {
    if (handler.fn()) return;
  }
  backButtonPlugin()?.exitApp?.();
}

function ensureBackSubscription(): void {
  if (backSubscription || backSubscribing) return;
  const plugin = backButtonPlugin();
  if (!plugin) return;
  backSubscribing = true;
  Promise.resolve(plugin.addListener('backButton', dispatchBack))
    .then((handle) => {
      backSubscribing = false;
      // Everything deregistered while the listener was still resolving.
      if (backHandlers.length === 0) handle.remove();
      else backSubscription = handle;
    })
    .catch(() => {
      backSubscribing = false;
    });
}

/**
 * Subscribes a back-button handler. Return true to consume the press, false to
 * pass it to the next handler down. Returns an unsubscribe function.
 */
export function registerBackHandler(fn: () => boolean, priority: number = BACK_PRIORITY.screen): () => void {
  if (!isNative()) return () => {};
  const handler: BackHandler = { priority, fn };
  backHandlers.push(handler);
  ensureBackSubscription();

  return () => {
    const index = backHandlers.indexOf(handler);
    if (index !== -1) backHandlers.splice(index, 1);
    if (backHandlers.length === 0 && backSubscription) {
      backSubscription.remove();
      backSubscription = null;
    }
  };
}
