/**
 * Clash Arena — Authoritative Game Room
 * 
 * Manages match lifecycle, fixed 60Hz authoritative simulation loop,
 * input delay buffering (fairness against ping disparities),
 * and disconnect/reconnect grace periods.
 */

'use strict';

const ClashState = require('../state.js');
const ClashSimulation = require('../simulation.js');
const { MSG, sanitizeInput } = require('./protocol.js');

const INPUT_DELAY_TICKS = 2; // ~33ms at 60Hz for combat fairness
const TICK_RATE_HZ = 60;
const FIXED_DT = 1 / TICK_RATE_HZ;
const RECONNECT_GRACE_MS = 5000; // 5-second grace window

class Room {
  constructor(roomCode, onRoomClose) {
    this.roomCode = roomCode;
    this.onRoomClose = onRoomClose; // Callback to index.js to remove from registry

    this.state = ClashState.createInitialState();
    this.status = 'WAITING'; // 'WAITING' | 'PLAYING' | 'PAUSED' | 'ENDED'

    this.players = {
      1: null, // { ws, secret, connected: bool, ip: string }
      2: null
    };

    this.lastProcessedSeq = { 1: 0, 2: 0 };
    this.currentInputs = {
      1: { moveX: 0, moveY: 0, attack: false, dodge: false, parry: false },
      2: { moveX: 0, moveY: 0, attack: false, dodge: false, parry: false }
    };

    // Input buffer: queue of { targetTick, seq, input, playerId }
    this.inputQueue = [];

    this.tickCount = 0;
    this.tickInterval = null;
    this.reconnectTimer = null;
    this.lastTickTime = 0;
  }

  /**
   * Generates a random alphanumeric secret token for reconnect authentication
   */
  static generateSecret() {
    return Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
  }

  /**
   * Adds a player to the room
   */
  addPlayer(ws, req) {
    if (this.players[1] && this.players[2]) {
      return { success: false, reason: 'Room is already full' };
    }

    const playerId = !this.players[1] ? 1 : 2;
    const secret = Room.generateSecret();
    const ip = req && req.socket ? req.socket.remoteAddress : 'unknown';

    this.players[playerId] = {
      ws: ws,
      secret: secret,
      connected: true,
      ip: ip
    };

    // Both players now present -> start the match!
    if (this.players[1] && this.players[2]) {
      this.status = 'PLAYING';
      this._notifyMatchStart();
      this.startLoop();
    }

    return { success: true, playerId: playerId, secret: secret };
  }

  /**
   * Handles reconnecting player with matching secret
   */
  reconnectPlayer(playerId, secret, ws) {
    const p = this.players[playerId];
    if (!p) return { success: false, reason: 'Player not found in room' };
    if (p.secret !== secret) return { success: false, reason: 'Invalid player secret' };

    p.ws = ws;
    p.connected = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.status === 'PAUSED') {
      this.status = 'PLAYING';
      this.broadcast({
        type: MSG.MATCH_RESUMED,
        state: this.state
      });
    }

    return { success: true, playerId: playerId };
  }

  /**
   * Queues player input with fairness delay buffer
   */
  queueInput(playerId, seq, rawInput) {
    if (this.status !== 'PLAYING') return;

    const cleanInput = sanitizeInput(rawInput);
    const targetTick = this.tickCount + INPUT_DELAY_TICKS;

    this.inputQueue.push({
      playerId: playerId,
      seq: seq,
      targetTick: targetTick,
      input: cleanInput
    });
  }

  /**
   * Fixed 60Hz server authoritative loop
   */
  startLoop() {
    if (this.tickInterval) return;

    const msPerTick = 1000 / TICK_RATE_HZ;
    let expected = Date.now() + msPerTick;

    const tick = () => {
      if (this.status === 'PLAYING') {
        this.tickCount++;

        // 1. Drain inputs whose targetTick has arrived
        const remainingQueue = [];
        for (let i = 0; i < this.inputQueue.length; i++) {
          const item = this.inputQueue[i];
          if (this.tickCount >= item.targetTick) {
            this.currentInputs[item.playerId] = item.input;
            if (item.seq > this.lastProcessedSeq[item.playerId]) {
              this.lastProcessedSeq[item.playerId] = item.seq;
            }
          } else {
            remainingQueue.push(item);
          }
        }
        this.inputQueue = remainingQueue;

        // 2. Run authoritative simulation step
        ClashSimulation.update(this.state, this.currentInputs, FIXED_DT);

        // 3. Clear one-shot input triggers from the authoritative current input
        for (let pid = 1; pid <= 2; pid++) {
          this.currentInputs[pid].attack = false;
          this.currentInputs[pid].dodge = false;
          this.currentInputs[pid].parry = false;
        }

        // 4. Broadcast state snapshot to both clients at 30Hz (every 2 ticks)
        // or immediately if critical combat events occurred (HIT, PARRY)
        const hasEvents = this.state.events && this.state.events.length > 0;
        if (this.tickCount % 2 === 0 || hasEvents) {
          this.broadcast({
            type: MSG.STATE,
            tick: this.tickCount,
            lastProcessedSeq: {
              1: this.lastProcessedSeq[1],
              2: this.lastProcessedSeq[2]
            },
            state: this.state
          });

          // Clean up events on server after broadcast
          this.state.events = [];
        }

        // 6. If match finished, stop loop after delay
        if (this.state.match.isOver) {
          this.status = 'ENDED';
          setTimeout(() => this.close(), 10000);
        }
      }

      if (this.status !== 'ENDED') {
        const drift = Date.now() - expected;
        expected += msPerTick;
        this.tickInterval = setTimeout(tick, Math.max(0, msPerTick - drift));
      }
    };

    this.tickInterval = setTimeout(tick, msPerTick);
  }

  stopLoop() {
    if (this.tickInterval) {
      clearTimeout(this.tickInterval);
      this.tickInterval = null;
    }
  }

  /**
   * Broadcasts JSON message to all connected clients in the room
   */
  broadcast(msgObj) {
    const data = JSON.stringify(msgObj);
    for (let id = 1; id <= 2; id++) {
      const p = this.players[id];
      if (p && p.connected && p.ws && p.ws.readyState === 1 /* OPEN */) {
        try {
          p.ws.send(data);
        } catch (err) {
          // Socket write failed
        }
      }
    }
  }

  _notifyMatchStart() {
    for (let id = 1; id <= 2; id++) {
      const p = this.players[id];
      if (p && p.ws && p.ws.readyState === 1) {
        p.ws.send(JSON.stringify({
          type: MSG.MATCH_START,
          roomCode: this.roomCode,
          playerRole: id,
          secret: p.secret,
          state: this.state
        }));
      }
    }
  }

  /**
   * Handles player disconnection (socket close or network drop)
   */
  handleDisconnect(ws) {
    let disconnectedId = null;
    for (let id = 1; id <= 2; id++) {
      if (this.players[id] && this.players[id].ws === ws) {
        disconnectedId = id;
        this.players[id].connected = false;
        break;
      }
    }

    if (!disconnectedId) return;

    const remainingId = disconnectedId === 1 ? 2 : 1;
    const remainingPlayer = this.players[remainingId];

    // If game has not started yet or is already over
    if (this.status === 'WAITING' || this.status === 'ENDED') {
      if (!this.players[1]?.connected && !this.players[2]?.connected) {
        this.close();
      }
      return;
    }

    // Match is in progress -> Pause match and give 5s grace for reconnect
    this.status = 'PAUSED';
    if (remainingPlayer && remainingPlayer.connected && remainingPlayer.ws?.readyState === 1) {
      remainingPlayer.ws.send(JSON.stringify({
        type: MSG.MATCH_PAUSED,
        reason: 'Opponent disconnected. Reconnect grace period active (5s)...',
        timeoutMs: RECONNECT_GRACE_MS
      }));
    }

    // Start 5-second countdown timer
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this._onGracePeriodExpired(disconnectedId, remainingId);
    }, RECONNECT_GRACE_MS);
  }

  _onGracePeriodExpired(disconnectedId, remainingId) {
    if (this.status !== 'PAUSED') return;

    this.status = 'ENDED';
    this.stopLoop();

    // Award match to remaining player
    this.state.match.isOver = true;
    this.state.match.winnerId = remainingId;

    const remainingPlayer = this.players[remainingId];
    if (remainingPlayer && remainingPlayer.connected && remainingPlayer.ws?.readyState === 1) {
      remainingPlayer.ws.send(JSON.stringify({
        type: MSG.OPPONENT_DISCONNECTED,
        winnerId: remainingId,
        reason: 'Opponent disconnected permanently. Victory awarded.'
      }));
    }

    // Clean up room
    setTimeout(() => this.close(), 2000);
  }

  close() {
    this.status = 'ENDED';
    this.stopLoop();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Close any open sockets
    for (let id = 1; id <= 2; id++) {
      const p = this.players[id];
      if (p && p.ws && p.ws.readyState === 1) {
        try { p.ws.close(); } catch (e) {}
      }
    }

    if (typeof this.onRoomClose === 'function') {
      this.onRoomClose(this.roomCode);
    }
  }
}

module.exports = Room;
