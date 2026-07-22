import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Server, type Socket } from 'socket.io';
import geoip from 'geoip-lite';
import { IllegalAction, type Seat, defaultConfig } from '@leekha/engine';
import { defaultTrixConfig, IllegalTrixAction } from '@leekha/trix';
import { ClientMessageSchema, type ClientMessage } from '@leekha/protocol';
import { RoomManager, TrixRoom, type AnyRoom } from './roomManager.js';
import { createStaticHandler } from './staticFiles.js';
import { createPersistence } from './persistence.js';
import { openDb } from './db.js';
import { createAuthHandler, resolveSessionFromCookieHeader } from './auth.js';
import { createAdminHandler } from './admin.js';

interface SocketState {
  name: string | null;
  roomCode: string | null;
  seat: Seat | null;
  country: string | null;
  /** Registered account id resolved from the session cookie at connection time; null for guests. Identity tag only -- per-action trust still runs through mySeat()'s socketId check, never this. */
  userId: string | null;
}

/**
 * Resolves the connecting player's country (ISO 3166-1 alpha-2) once per
 * socket. GeoIP on the peer address first (x-forwarded-for aware for reverse
 * proxies); private/LAN addresses resolve to nothing there, so fall back to
 * the region subtag of the browser's Accept-Language (e.g. ar-SY -> SY),
 * which is also what makes the feature visible when testing on a home
 * network. Null when neither yields anything.
 */
function regionFromLanguageTag(tag: string | undefined | null): string | null {
  const m = typeof tag === 'string' ? /([a-zA-Z]{2,3})-([a-zA-Z]{2})\b/.exec(tag) : null;
  if (!m) return null;
  const language = m[1].toLowerCase();
  const region = m[2].toUpperCase();
  // en-US is the factory-default locale of browsers everywhere on Earth, so
  // as country evidence it is pure noise -- a Syrian on an English Windows
  // install reports it too. Any OTHER region means someone actually
  // configured it (ar-SY, fr-FR, even en-GB), so those are kept. Real US
  // players still resolve through GeoIP once the server is reachable from
  // outside the LAN.
  if (language === 'en' && region === 'US') return null;
  return region;
}

function detectCountry(socket: Socket): string | null {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  const raw =
    (typeof forwarded === 'string' && forwarded.length > 0 ? forwarded.split(',')[0].trim() : null) ??
    socket.handshake.address;
  const ip = raw?.replace(/^::ffff:/, '');
  const geo = ip ? geoip.lookup(ip) : null;
  if (geo?.country) return geo.country;
  // Only present when the handshake came in over polling; a websocket-first
  // connect (the client's default) carries no usable Accept-Language, which
  // is why AuthMsg.locale exists as the real fallback.
  return regionFromLanguageTag(socket.handshake.headers['accept-language'] as string | undefined);
}

// Telemetry visit tracking: a reconnect within the grace window is the same
// visit; visits older than the retention window are pruned on startup so the
// table can't grow without bound on the shared box.
const SESSION_GRACE_MS = 5 * 60_000;
const SESSION_RETENTION_MS = 90 * 86_400_000;
const ERROR_RETENTION_MS = 30 * 86_400_000;
const MAX_ERROR_ROWS = 5000;

export function createApp(options: { webDist?: string; redisUrl?: string; databasePath?: string } = {}) {
  const serveStatic = options.webDist ? createStaticHandler(options.webDist) : null;
  // No databasePath means an ephemeral in-memory store (used by tests); the
  // real entrypoint (index.ts) always passes an explicit DATABASE_PATH.
  const db = openDb(options.databasePath ?? ':memory:');
  db.pruneSessions(Date.now() - SESSION_RETENTION_MS);
  db.pruneErrors(Date.now() - ERROR_RETENTION_MS, MAX_ERROR_ROWS);
  const handleAuthRequest = createAuthHandler(db);
  // Assigned just below once io/manager exist (getHealth needs them). Requests
  // only arrive after listen(), so it is always set by the time it is called.
  let handleAdminRequest: ((req: IncomingMessage, res: ServerResponse) => Promise<boolean>) | null = null;
  const httpServer = createServer((req, res) => {
    if ((req.url ?? '').startsWith('/socket.io/')) return;
    if ((req.url ?? '').startsWith('/api/')) {
      // In production the client is served from this same origin (see
      // staticFiles.ts), so the browser never preflights these requests and
      // this block is a no-op. In dev, apps/web (5173) and apps/server (8080)
      // are two different origins, and the client sends `credentials:
      // include` for the session cookie -- which means Access-Control-Allow-
      // Origin can't be '*' (the spec forbids pairing a wildcard origin with
      // credentials), so the request's actual Origin has to be reflected
      // back, plus Access-Control-Allow-Credentials, or every /api/* call
      // (including the register/login preflight) fails with a CORS error
      // before it ever reaches the handler.
      const origin = req.headers.origin;
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.writeHead(204);
        res.end();
        return;
      }
      void (async () => {
        // Admin router first (it only claims /api/admin/* and returns false
        // otherwise), then the accounts router, then a 404.
        if (handleAdminRequest && (await handleAdminRequest(req, res))) return;
        if (await handleAuthRequest(req, res)) return;
        res.writeHead(404);
        res.end('not found');
      })();
      return;
    }
    if (serveStatic) void serveStatic(req, res);
  });
  const io = new Server(httpServer, { cors: { origin: '*' } });
  const persistence = createPersistence(options.redisUrl);
  const manager = new RoomManager(io, persistence, db);
  const tokenIndex = new Map<string, { roomCode: string; seat: Seat }>();

  // Admin/telemetry API. Off unless ADMIN_TOKEN is set in the environment.
  handleAdminRequest = createAdminHandler(db, {
    token: process.env.ADMIN_TOKEN ?? null,
    getHealth: () => {
      const s = manager.stats();
      return {
        connectedSockets: io.engine.clientsCount,
        activeRooms: s.activeRooms,
        playersInGame: s.playersInGame,
        uptimeSec: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1_048_576),
      };
    },
    getLive: () => manager.liveGames(),
  });

  if (persistence) {
    manager
      .restore()
      .then((tokens) => {
        for (const t of tokens) tokenIndex.set(t.token, { roomCode: t.roomCode, seat: t.seat });
        console.log(`[redis] restored ${tokens.length} seat token(s) across recovered rooms`);
      })
      .catch((err) => console.error('[redis] room restore failed:', err));
  }

  const sweepInterval = setInterval(() => manager.sweep(), 60_000);
  sweepInterval.unref?.();

  io.on('connection', (socket: Socket) => {
    const cookieHeader = socket.handshake.headers.cookie;
    const state: SocketState = {
      name: null,
      roomCode: null,
      seat: null,
      country: detectCountry(socket),
      userId: resolveSessionFromCookieHeader(db, cookieHeader)?.id ?? null,
    };

    // Telemetry visit tracking (Phase 2). visitorId is a stable per-browser id
    // the client sends in the handshake; a reconnect within SESSION_GRACE_MS
    // extends the same visit instead of counting a new one.
    const q = socket.handshake.query;
    const visitorId = typeof q.visitorId === 'string' ? q.visitorId.slice(0, 64) : null;
    const visitorName = typeof q.name === 'string' ? q.name.slice(0, 40) : null;
    if (visitorId) db.recordSessionPing(visitorId, visitorName, state.country, Date.now(), SESSION_GRACE_MS);

    function sendError(code: string, message: string) {
      socket.emit('msg', { type: 'error', code, message });
    }

    function currentRoom(): AnyRoom | null {
      if (!state.roomCode) return null;
      return manager.get(state.roomCode) ?? null;
    }

    function joinSocketIoRoom(code: string) {
      socket.join(`room:${code}`);
    }

    /** The roster plus (mid-match) a blanked public snapshot — what a socket that holds no seat gets. Also registers the socket as a spectator, which rebroadcasts the watcher count to the whole room. */
    function sendObserverView(room: AnyRoom) {
      socket.emit('msg', room.roomStateMessage());
      const pub = room.publicSnapshotMessage();
      if (pub) socket.emit('msg', pub);
      room.addSpectator(socket.id, state.country);
      socket.emit('msg', room.spectatorsMessage());
    }

    /**
     * Re-validates state.seat against the room's live SeatSlot before trusting
     * it. Two ways a seat stops being this connection's to act on, neither of
     * which ever touches this connection's own state directly: a takeover
     * (Room.sit) repoints seats[seat].socketId to the new occupant, and AFK
     * strikes (Room.flipToBot) flip isBot to true while this socket is still
     * connected and its socketId is still on file. Without checking isBot too,
     * an idle-flipped player who never disconnected could keep playing turns
     * through the bot that's now supposed to be covering their seat.
     */
    function mySeat(): Seat | null {
      if (state.seat === null) return null;
      const room = currentRoom();
      if (!room || room.seats[state.seat].socketId !== socket.id || room.seats[state.seat].isBot) {
        state.seat = null;
        return null;
      }
      return state.seat;
    }

    socket.on('msg', (raw: unknown, ack?: (res: unknown) => void) => {
      const parsed = ClientMessageSchema.safeParse(raw);
      if (!parsed.success) {
        // Never relay parsed.error.message: zod's ZodError.message is the raw
        // JSON-stringified issues array, meant for developers, not a string
        // fit to show a player (see the client's Home.tsx joinError render).
        sendError('bad-message', 'That message was malformed.');
        return;
      }
      const msg: ClientMessage = parsed.data;

      try {
        switch (msg.type) {
          case 'auth': {
            state.name = msg.name;
            if (!state.country) state.country = regionFromLanguageTag(msg.locale);
            if (msg.seatToken) {
              const found = tokenIndex.get(msg.seatToken);
              const room = found ? manager.get(found.roomCode) : undefined;
              if (found && room) {
                state.roomCode = room.code;
                joinSocketIoRoom(room.code);
                const slot = room.seats[found.seat];
                if (slot.token === msg.seatToken && !slot.isBot) {
                  state.seat = found.seat;
                  room.bindSocket(found.seat, socket.id, state.country, state.userId);
                } else {
                  // Our seat moved on without us: AFK-flipped to a bot, or claimed
                  // outright by someone else while we were away. It is no longer
                  // ours to walk back into automatically - land as an observer,
                  // same as any fresh joiner mid-match (SPEC.md 11). Claiming a
                  // seat back now goes through room.sit like anyone else on the
                  // sidelines; there is no separate, silent reclaim-on-reconnect.
                  state.seat = null;
                  sendObserverView(room);
                }
              } else {
                // The token doesn't resolve to any live room -- most commonly a
                // server restart wiped the in-memory room/tokenIndex out from
                // under a browser tab that still has an old seat token stashed
                // in localStorage. Silently doing nothing here left the client
                // waiting forever on its "reconnecting" screen (it never gets a
                // room.state/game.snapshot to move past); tell it plainly so it
                // can drop the stale session and offer the main menu again.
                sendError('session-expired', 'That game session is no longer available.');
              }
            }
            break;
          }

          case 'room.create': {
            const room =
              msg.gameType === 'trix'
                ? manager.createTrix(msg.trixConfig ?? defaultTrixConfig, msg.isPublic ?? false)
                : manager.create(msg.config, msg.isPublic ?? false);
            if (msg.allowSpectatorVoice !== undefined) room.allowSpectatorVoice = msg.allowSpectatorVoice;
            const token = room.sit(0, state.name ?? 'Host', socket.id, state.country, state.userId);
            tokenIndex.set(token, { roomCode: room.code, seat: 0 });
            state.roomCode = room.code;
            state.seat = 0;
            joinSocketIoRoom(room.code);
            ack?.({ code: room.code, seatToken: token });
            break;
          }

          case 'room.list': {
            ack?.({ rooms: manager.listPublic() });
            break;
          }

          case 'room.join': {
            const room = manager.get(msg.code);
            if (!room) {
              ack?.({ error: 'not-found' });
              break;
            }
            if (room.phase !== 'lobby') {
              // Match already running: joining by code makes you an observer, not
              // a seat (SPEC.md 11). Only an explicit room.sit claiming a specific
              // bot-controlled seat actually seats you from here.
              state.roomCode = room.code;
              state.seat = null;
              joinSocketIoRoom(room.code);
              sendObserverView(room);
              ack?.({ observer: true });
              break;
            }
            const seat = room.findOpenSeat();
            if (seat === null) {
              ack?.({ error: 'room-full' });
              break;
            }
            const token = room.sit(seat, state.name ?? 'Guest', socket.id, state.country, state.userId);
            tokenIndex.set(token, { roomCode: room.code, seat });
            state.roomCode = room.code;
            state.seat = seat;
            joinSocketIoRoom(room.code);
            ack?.({ seatToken: token });
            break;
          }

          case 'room.sit': {
            const room = currentRoom();
            if (!room) {
              ack?.({ error: 'not-found' });
              break;
            }
            const seatNow = mySeat();
            if (seatNow !== null && seatNow !== msg.seat) {
              ack?.({ error: 'already-seated' });
              break;
            }
            try {
              const token = room.sit(msg.seat, state.name ?? 'Guest', socket.id, state.country, state.userId);
              tokenIndex.set(token, { roomCode: room.code, seat: msg.seat });
              state.seat = msg.seat;
              ack?.({ seatToken: token });
            } catch (err) {
              if (err instanceof IllegalAction) ack?.({ error: err.code });
              else throw err;
            }
            break;
          }

          case 'room.addBot': {
            currentRoom()?.addBot(msg.seat, msg.level);
            break;
          }

          case 'room.removeBot': {
            currentRoom()?.removeBot(msg.seat);
            break;
          }

          case 'room.configure': {
            const room = currentRoom();
            if (room && mySeat() === room.hostSeat) {
              if (room instanceof TrixRoom) {
                if (msg.trixConfig) room.configure(msg.trixConfig);
              } else if (msg.config) {
                room.configure(msg.config);
              }
              if (msg.allowSpectatorVoice !== undefined) room.setAllowSpectatorVoice(msg.allowSpectatorVoice);
              if (msg.isPublic !== undefined) {
                room.isPublic = msg.isPublic;
                room.broadcastRoomState();
              }
            }
            break;
          }

          case 'room.ready': {
            const seat = mySeat();
            if (seat !== null) currentRoom()?.setReady(seat, msg.ready);
            break;
          }

          case 'room.start': {
            const room = currentRoom();
            if (room && mySeat() === room.hostSeat) room.start();
            break;
          }

          case 'room.rematch': {
            const seat = mySeat();
            if (seat !== null) currentRoom()?.voteRematch(seat);
            break;
          }

          case 'room.leave': {
            const seat = mySeat();
            currentRoom()?.voiceLeave(socket.id);
            if (seat !== null) currentRoom()?.leave(seat);
            currentRoom()?.removeSpectator(socket.id);
            if (state.roomCode) socket.leave(`room:${state.roomCode}`);
            state.roomCode = null;
            state.seat = null;
            break;
          }

          case 'game.pass': {
            const seat = mySeat();
            const room = currentRoom();
            if (seat !== null && room && !(room instanceof TrixRoom)) room.pass(seat, msg.cards);
            break;
          }

          case 'game.play': {
            const seat = mySeat();
            const room = currentRoom();
            if (seat !== null && room && !(room instanceof TrixRoom)) room.play(seat, msg.card);
            break;
          }

          case 'trix.chooseContract': {
            const seat = mySeat();
            const room = currentRoom();
            if (seat !== null && room instanceof TrixRoom) room.chooseContract(seat, msg.contracts);
            break;
          }

          case 'trix.expose': {
            const seat = mySeat();
            const room = currentRoom();
            if (seat !== null && room instanceof TrixRoom) room.expose(seat, msg.card);
            break;
          }

          case 'trix.pass': {
            const seat = mySeat();
            const room = currentRoom();
            if (seat !== null && room instanceof TrixRoom) room.passAction(seat);
            break;
          }

          case 'trix.play': {
            const seat = mySeat();
            const room = currentRoom();
            if (seat !== null && room instanceof TrixRoom) room.playAction(seat, msg.card);
            break;
          }

          case 'game.resync': {
            const room = currentRoom();
            if (!room) {
              sendError('session-expired', 'That game session is no longer available.');
              break;
            }
            const seat = mySeat();
            if (seat !== null) {
              room.resync(seat);
            } else {
              // Observer resync: no seat to hand to Room.resync, so deliver the
              // room snapshot plus (if a match is running) a public spectator
              // snapshot directly to this socket instead of the seated path.
              sendObserverView(room);
            }
            break;
          }

          case 'emote': {
            const room = currentRoom();
            const seat = mySeat();
            if (room && seat !== null) {
              // Broadcast is intentionally out of band from ServerMessageSchema for MVP scope
              // (emotes are not persisted or validated beyond the client's own id list).
              io.to(`room:${room.code}`).emit('msg', { type: 'emote', seat, id: msg.id });
            }
            break;
          }

          case 'voice.join': {
            const room = currentRoom();
            if (!room) {
              sendError('not-in-room', 'Join a room before opening voice.');
              break;
            }
            const seat = mySeat();
            const name =
              seat !== null ? room.seats[seat].name ?? state.name ?? 'Player' : state.name ?? 'Spectator';
            const res = room.voiceJoin(socket.id, seat, name);
            if ('error' in res) sendError(res.error, res.error === 'voice-full' ? 'The voice lobby is full.' : 'Spectator voice is off.');
            break;
          }

          case 'voice.leave': {
            currentRoom()?.voiceLeave(socket.id);
            break;
          }

          case 'voice.signal': {
            // Relayed only between two current voice members (room enforces it);
            // no seat check, since spectators are legitimate voice peers.
            currentRoom()?.voiceRelay(socket.id, msg.to, msg.signal);
            break;
          }

          case 'voice.state': {
            currentRoom()?.voiceSetMuted(socket.id, msg.muted);
            break;
          }
        }
      } catch (err) {
        if (err instanceof IllegalAction || err instanceof IllegalTrixAction) {
          sendError(err.code, err.message);
        } else {
          // Unexpected server-side error while handling a message: capture it to
          // telemetry (Phase 3) and answer with a generic error instead of
          // re-throwing, which would crash the process and drop every live game.
          const e = err as Error;
          db.insertError({
            source: 'server',
            message: e?.message ?? String(err),
            stack: e?.stack ?? null,
            url: `msg:${msg.type}`,
            userAgent: null,
            createdAt: Date.now(),
          });
          console.error('[server error]', msg.type, err);
          sendError('server-error', 'Something went wrong on the server.');
        }
      }
    });

    socket.on('disconnect', () => {
      currentRoom()?.disconnectSocket(socket.id);
      if (visitorId) db.endSession(visitorId, Date.now());
    });
  });

  return { httpServer, io, manager, defaultConfig, db };
}
