import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { IllegalAction, type Seat, defaultConfig } from '@leekha/engine';
import { ClientMessageSchema, type ClientMessage } from '@leekha/protocol';
import { RoomManager } from './roomManager.js';
import type { Room } from './room.js';
import { createStaticHandler } from './staticFiles.js';
import { createPersistence } from './persistence.js';

interface SocketState {
  name: string | null;
  roomCode: string | null;
  seat: Seat | null;
}

export function createApp(options: { webDist?: string; redisUrl?: string } = {}) {
  const serveStatic = options.webDist ? createStaticHandler(options.webDist) : null;
  const httpServer = createServer((req, res) => {
    if (serveStatic && !(req.url ?? '').startsWith('/socket.io/')) {
      void serveStatic(req, res);
    }
  });
  const io = new Server(httpServer, { cors: { origin: '*' } });
  const persistence = createPersistence(options.redisUrl);
  const manager = new RoomManager(io, persistence);
  const tokenIndex = new Map<string, { roomCode: string; seat: Seat }>();

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
    const state: SocketState = { name: null, roomCode: null, seat: null };

    function sendError(code: string, message: string) {
      socket.emit('msg', { type: 'error', code, message });
    }

    function currentRoom(): Room | null {
      if (!state.roomCode) return null;
      return manager.get(state.roomCode) ?? null;
    }

    function joinSocketIoRoom(code: string) {
      socket.join(`room:${code}`);
    }

    /** The roster plus (mid-match) a blanked public snapshot — what a socket that holds no seat gets. */
    function sendObserverView(room: Room) {
      socket.emit('msg', room.roomStateMessage());
      const pub = room.publicSnapshotMessage();
      if (pub) socket.emit('msg', pub);
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
            if (msg.seatToken) {
              const found = tokenIndex.get(msg.seatToken);
              const room = found ? manager.get(found.roomCode) : undefined;
              if (found && room) {
                state.roomCode = room.code;
                joinSocketIoRoom(room.code);
                const slot = room.seats[found.seat];
                if (slot.token === msg.seatToken && !slot.isBot) {
                  state.seat = found.seat;
                  room.bindSocket(found.seat, socket.id);
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
              }
            }
            break;
          }

          case 'room.create': {
            const room = manager.create(msg.config);
            const token = room.sit(0, state.name ?? 'Host', socket.id);
            tokenIndex.set(token, { roomCode: room.code, seat: 0 });
            state.roomCode = room.code;
            state.seat = 0;
            joinSocketIoRoom(room.code);
            ack?.({ code: room.code, seatToken: token });
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
            const token = room.sit(seat, state.name ?? 'Guest', socket.id);
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
              const token = room.sit(msg.seat, state.name ?? 'Guest', socket.id);
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
            if (room && mySeat() === room.hostSeat) room.configure(msg.config);
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
            if (seat !== null) currentRoom()?.leave(seat);
            if (state.roomCode) socket.leave(`room:${state.roomCode}`);
            state.roomCode = null;
            state.seat = null;
            break;
          }

          case 'game.pass': {
            const seat = mySeat();
            if (seat !== null) currentRoom()?.pass(seat, msg.cards);
            break;
          }

          case 'game.play': {
            const seat = mySeat();
            if (seat !== null) currentRoom()?.play(seat, msg.card);
            break;
          }

          case 'game.resync': {
            const room = currentRoom();
            if (!room) break;
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
        }
      } catch (err) {
        if (err instanceof IllegalAction) sendError(err.code, err.message);
        else throw err;
      }
    });

    socket.on('disconnect', () => {
      currentRoom()?.disconnectSocket(socket.id);
    });
  });

  return { httpServer, io, manager, defaultConfig };
}
