import { io, type Socket } from 'socket.io-client';
import type { ClientMessage, PublicRoom, ServerMessage } from '@leekha/protocol';
import { loadSettings } from '../settings';

// A stable per-browser id so the server can group reconnects into one visit for
// telemetry (see SESSION_GRACE_MS in apps/server/src/server.ts). Anonymous and
// non-identifying on its own; it just distinguishes this browser from others.
function visitorQuery(): Record<string, string> {
  try {
    let id = localStorage.getItem('leekha_visitor_id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('leekha_visitor_id', id);
    }
    return { visitorId: id, name: loadSettings().displayName || '' };
  } catch {
    return {};
  }
}

// In production the client and server are the same single-image deployment
// (see root Dockerfile), so whatever host:port served this page is also
// where the socket lives. In dev, the Vite dev server (5173) and apps/server
// (8080) are two different ports, but a hardcoded "localhost" fallback only
// works when the browser is on the same machine as the dev server: opening
// the page from another device on the LAN (e.g. http://192.168.x.x:5173)
// would then have "localhost" resolve to THAT device, not the dev machine,
// and every socket/API call would fail with connection refused. Reusing the
// hostname the page was actually loaded from (whatever it is) fixes both
// cases at once.
export const SERVER_URL: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  (import.meta.env.DEV ? `http://${window.location.hostname}:8080` : window.location.origin);

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

type Ack =
  | { code: string; seatToken: string }
  | { seatToken: string }
  | { observer: true }
  | { error: string }
  | { rooms: PublicRoom[] }
  | { gameType: 'leekha' | 'trix' };

/**
 * Thin typed wrapper around a single socket.io connection. Every protocol message,
 * in both directions, travels over one event name: "msg" (see packages/protocol
 * and apps/server/src/server.ts). This class does not know about game rules; it
 * only offers fire-and-forget send, ack-returning request, and message
 * subscription, plus a connection status subscription for reconnect UI.
 */
export class GameSocket {
  private socket: Socket;
  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private msgListeners = new Set<(msg: ServerMessage) => void>();
  status: ConnectionStatus = 'connecting';

  constructor(url: string = SERVER_URL) {
    this.socket = io(url, { transports: ['websocket', 'polling'], query: visitorQuery() });

    this.socket.on('connect', () => this.setStatus('connected'));
    this.socket.on('disconnect', () => this.setStatus('disconnected'));
    this.socket.io.on('reconnect_attempt', () => this.setStatus('connecting'));

    this.socket.on('msg', (raw: unknown) => {
      // The server only ever sends well-formed messages (it validates its own
      // outbound shapes implicitly by construction); we trust it here rather
      // than re-validating with the zod schema on every inbound message, to
      // keep the hot path (game.turn/game.played during a fast trick) cheap.
      for (const listener of this.msgListeners) listener(raw as ServerMessage);
    });
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onMessage(listener: (msg: ServerMessage) => void): () => void {
    this.msgListeners.add(listener);
    return () => this.msgListeners.delete(listener);
  }

  /** Fire-and-forget send: everything except room.create/room.join. */
  send(msg: ClientMessage): void {
    this.socket.emit('msg', msg);
  }

  /** Ack-returning request, used only for room.create, room.join, room.sit, and room.list. */
  request<T extends Ack>(msg: ClientMessage, timeoutMs = 8000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
      this.socket.emit('msg', msg, (res: T) => {
        window.clearTimeout(timer);
        resolve(res);
      });
    });
  }

  close(): void {
    this.socket.close();
  }
}
