import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { IllegalAction, type Seat, defaultConfig } from '@leekha/engine';
import { ClientMessageSchema, type ClientMessage } from '@leekha/protocol';
import { RoomManager } from './roomManager.js';
import type { Room } from './room.js';
import { createStaticHandler } from './staticFiles.js';

interface SocketState {
  name: string | null;
  roomCode: string | null;
  seat: Seat | null;
}

export function createApp(options: { webDist?: string } = {}) {
  const serveStatic = options.webDist ? createStaticHandler(options.webDist) : null;
  const httpServer = createServer((req, res) => {
    if (serveStatic && !(req.url ?? '').startsWith('/socket.io/')) {
      void serveStatic(req, res);
    }
  });
  const io = new Server(httpServer, { cors: { origin: '*' } });
  const manager = new RoomManager(io);
  const tokenIndex = new Map<string, { roomCode: string; seat: Seat }>();

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

    socket.on('msg', (raw: unknown, ack?: (res: unknown) => void) => {
      const parsed = ClientMessageSchema.safeParse(raw);
      if (!parsed.success) {
        sendError('bad-message', parsed.error.message);
        return;
      }
      const msg: ClientMessage = parsed.data;

      try {
        switch (msg.type) {
          case 'auth': {
            state.name = msg.name;
            if (msg.seatToken) {
              const found = tokenIndex.get(msg.seatToken);
              if (found) {
                const room = manager.get(found.roomCode);
                if (room && room.seats[found.seat].token === msg.seatToken) {
                  state.roomCode = found.roomCode;
                  state.seat = found.seat;
                  joinSocketIoRoom(found.roomCode);
                  room.bindSocket(found.seat, socket.id);
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
            if (room && state.seat === room.hostSeat) room.configure(msg.config);
            break;
          }

          case 'room.ready': {
            if (state.seat !== null) currentRoom()?.setReady(state.seat, msg.ready);
            break;
          }

          case 'room.start': {
            const room = currentRoom();
            if (room && state.seat === room.hostSeat) room.start();
            break;
          }

          case 'room.leave': {
            if (state.seat !== null) currentRoom()?.leave(state.seat);
            if (state.roomCode) socket.leave(`room:${state.roomCode}`);
            state.roomCode = null;
            state.seat = null;
            break;
          }

          case 'game.pass': {
            if (state.seat !== null) currentRoom()?.pass(state.seat, msg.cards);
            break;
          }

          case 'game.play': {
            if (state.seat !== null) currentRoom()?.play(state.seat, msg.card);
            break;
          }

          case 'game.resync': {
            if (state.seat !== null) currentRoom()?.resync(state.seat);
            break;
          }

          case 'emote': {
            const room = currentRoom();
            if (room && state.seat !== null) {
              // Broadcast is intentionally out of band from ServerMessageSchema for MVP scope
              // (emotes are not persisted or validated beyond the client's own id list).
              io.to(`room:${room.code}`).emit('msg', { type: 'emote', seat: state.seat, id: msg.id });
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
