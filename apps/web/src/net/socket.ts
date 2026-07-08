import { io, type Socket } from 'socket.io-client';
import type { ClientMessage, ServerMessage } from '@leekha/protocol';

// In production the client and server are the same single-image deployment
// (see root Dockerfile), so whatever host:port served this page is also
// where the socket lives — a hardcoded localhost fallback would only ever
// work on the machine running the container itself. Dev keeps the old
// fallback because the Vite dev server (5173) and apps/server (8080) are
// two different ports on localhost.
export const SERVER_URL: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  (import.meta.env.DEV ? 'http://localhost:8080' : window.location.origin);

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

type Ack = { code: string; seatToken: string } | { seatToken: string } | { observer: true } | { error: string };

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
    this.socket = io(url, { transports: ['websocket', 'polling'] });

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

  /** Ack-returning request, used only for room.create, room.join, and room.sit. */
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
