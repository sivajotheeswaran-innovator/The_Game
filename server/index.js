/**
 * Clash Arena — Authoritative WebSocket Game Server
 * 
 * Runs HTTP health check & WebSocket server for 1v1 matchmaking.
 */

'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const Room = require('./room.js');
const { MSG } = require('./protocol.js');

const PORT = process.env.PORT || 8080;

// Active rooms map: roomCode -> Room instance
const rooms = new Map();

/**
 * Generate friendly 4-character room codes (excluding ambiguous 0/O, 1/I)
 */
const ROOM_CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += ROOM_CODE_CHARS.charAt(Math.floor(Math.random() * ROOM_CODE_CHARS.length));
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

// Create HTTP server for health checks & WebSocket upgrades
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'Clash Arena PvP Server',
      activeRooms: rooms.size,
      uptimeSec: Math.floor(process.uptime())
    }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  ws.roomCode = null;
  ws.playerId = null;
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (message) => {
    let msg;
    try {
      msg = JSON.parse(message);
    } catch (e) {
      return; // Discard malformed JSON
    }

    if (!msg || !msg.type) return;

    switch (msg.type) {
      case MSG.PING: {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: MSG.PONG, t: msg.t }));
        }
        break;
      }

      case MSG.CREATE_ROOM: {
        const roomCode = generateRoomCode();
        const room = new Room(roomCode, (code) => {
          rooms.delete(code);
          console.log(`[SERVER] Room ${code} closed. Active rooms: ${rooms.size}`);
        });

        rooms.set(roomCode, room);
        console.log(`[SERVER] Room ${roomCode} created. Total rooms: ${rooms.size}`);

        const result = room.addPlayer(ws, req, msg);
        if (result.success) {
          ws.roomCode = roomCode;
          ws.playerId = result.playerId;

          ws.send(JSON.stringify({
            type: MSG.ROOM_CREATED,
            roomCode: roomCode,
            playerId: result.playerId,
            secret: result.secret
          }));
        } else {
          ws.send(JSON.stringify({
            type: MSG.ROOM_ERROR,
            reason: result.reason
          }));
        }
        break;
      }

      case MSG.JOIN_ROOM: {
        const targetCode = (msg.roomCode || '').toUpperCase().trim();
        const room = rooms.get(targetCode);

        if (!room) {
          ws.send(JSON.stringify({
            type: MSG.ROOM_ERROR,
            reason: `Room "${targetCode}" does not exist or has expired.`
          }));
          return;
        }

        const result = room.addPlayer(ws, req, msg);
        if (result.success) {
          ws.roomCode = targetCode;
          ws.playerId = result.playerId;

          ws.send(JSON.stringify({
            type: MSG.ROOM_JOINED,
            roomCode: targetCode,
            playerId: result.playerId,
            secret: result.secret
          }));
          console.log(`[SERVER] Player ${result.playerId} joined room ${targetCode}. Match starting.`);
        } else {
          ws.send(JSON.stringify({
            type: MSG.ROOM_ERROR,
            reason: result.reason
          }));
        }
        break;
      }

      case MSG.RECONNECT: {
        const targetCode = (msg.roomCode || '').toUpperCase().trim();
        const room = rooms.get(targetCode);

        if (!room) {
          ws.send(JSON.stringify({
            type: MSG.ROOM_ERROR,
            reason: `Cannot reconnect: room "${targetCode}" no longer active.`
          }));
          return;
        }

        const result = room.reconnectPlayer(msg.playerId, msg.secret, ws);
        if (result.success) {
          ws.roomCode = targetCode;
          ws.playerId = result.playerId;
          console.log(`[SERVER] Player ${msg.playerId} successfully reconnected to room ${targetCode}`);
        } else {
          ws.send(JSON.stringify({
            type: MSG.ROOM_ERROR,
            reason: result.reason
          }));
        }
        break;
      }

      case MSG.INPUT: {
        if (!ws.roomCode) return;
        const room = rooms.get(ws.roomCode);
        if (room) {
          room.queueInput(ws.playerId, msg.seq || 0, msg.input);
        }
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    if (ws.roomCode) {
      const room = rooms.get(ws.roomCode);
      if (room) {
        room.handleDisconnect(ws);
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`[SERVER] Socket error:`, err.message);
  });
});

// Periodic heartbeat to terminate dead sockets
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

server.listen(PORT, () => {
  console.log(`========================================`);
  console.log(` Clash Arena Server running on port ${PORT}`);
  console.log(` HTTP Health check: http://localhost:${PORT}/health`);
  console.log(` WebSocket URL: ws://localhost:${PORT}`);
  console.log(`========================================`);
});
