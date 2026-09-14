/**
 * Clash Arena — Client Network & Prediction Engine
 * 
 * Manages WebSocket connection, client-side prediction, input sequencing,
 * server state reconciliation, and opponent entity interpolation.
 */

(function(root) {
  'use strict';

  const MSG = {
    CREATE_ROOM: 'create_room',
    JOIN_ROOM: 'join_room',
    INPUT: 'input',
    PING: 'ping',
    RECONNECT: 'reconnect',

    ROOM_CREATED: 'room_created',
    ROOM_JOINED: 'room_joined',
    ROOM_ERROR: 'room_error',
    MATCH_START: 'match_start',
    STATE: 'state',
    PONG: 'pong',
    OPPONENT_DISCONNECTED: 'opponent_disconnected',
    MATCH_PAUSED: 'match_paused',
    MATCH_RESUMED: 'match_resumed'
  };

  class NetworkClient {
    constructor() {
      this.ws = null;
      this.serverUrl = null;

      this.isConnected = false;
      this.isOnlineMatch = false;

      this.roomCode = null;
      this.playerId = 1; // 1 or 2
      this.secret = null;

      // Monotonic sequence number for client inputs
      this.seq = 0;

      // Client-side prediction buffer: list of { seq, input, dt }
      this.inputBuffer = [];

      // Last server acknowledged sequence number for this client
      this.lastAckSeq = 0;

      // Authoritative snapshots for entity interpolation of opponent
      // Array of { timestamp, playerState }
      this.opponentSnapshots = [];
      this.interpolationDelayMs = 35; // Interpolate opponent ~35ms in the past for buttery smoothness

      // Network diagnostics
      this.pingMs = 0;
      this.pingInterval = null;

      // Callbacks
      this.callbacks = {
        onRoomCreated: null,
        onRoomJoined: null,
        onRoomError: null,
        onMatchStart: null,
        onStateUpdate: null,
        onMatchPaused: null,
        onMatchResumed: null,
        onOpponentDisconnected: null,
        onConnectionLost: null,
        onPingUpdate: null
      };

      // Auto-reconnect configuration
      this.reconnectAttempts = 0;
      this.maxReconnectAttempts = 3;
      this.isReconnecting = false;
    }

    /**
     * Connect to server and initiate room creation or joining
     */
    connect(serverUrl) {
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return Promise.resolve();
      }

      this.serverUrl = serverUrl || this._getDefaultServerUrl();

      return new Promise((resolve, reject) => {
        try {
          this.ws = new WebSocket(this.serverUrl);
        } catch (err) {
          return reject(err);
        }

        this.ws.onopen = () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.isReconnecting = false;
          this._startPingHeartbeat();
          resolve();
        };

        this.ws.onmessage = (event) => {
          this._handleMessage(event.data);
        };

        this.ws.onerror = (err) => {
          console.error('[NET] WebSocket error:', err);
        };

        this.ws.onclose = () => {
          this.isConnected = false;
          this._stopPingHeartbeat();
          this._handleClose();
        };
      });
    }

    _getDefaultServerUrl() {
      // If served via http://localhost or file://, default to ws://localhost:8080
      const loc = window.location;
      if (!loc || loc.protocol === 'file:' || loc.hostname === 'localhost' || loc.hostname === '127.0.0.1') {
        return 'ws://localhost:8080';
      }
      // If deployed on HTTPS (e.g. Render / Vercel), use wss://
      const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${loc.host}`;
    }

    _startPingHeartbeat() {
      this._stopPingHeartbeat();
      this.pingInterval = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: MSG.PING, t: performance.now() }));
        }
      }, 1000);
    }

    _stopPingHeartbeat() {
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
    }

    createRoom() {
      this.send({ type: MSG.CREATE_ROOM });
    }

    joinRoom(roomCode) {
      this.send({ type: MSG.JOIN_ROOM, roomCode: roomCode });
    }

    send(data) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(data));
      }
    }

    /**
     * Send player input with incremental sequence number
     */
    sendInput(input, dt) {
      this.seq++;
      const packet = {
        type: MSG.INPUT,
        seq: this.seq,
        timestamp: Date.now(),
        input: input
      };

      // Store in prediction buffer
      this.inputBuffer.push({
        seq: this.seq,
        input: Object.assign({}, input),
        dt: dt
      });

      // Keep buffer bounded (max 120 unacknowledged inputs, ~2 sec)
      if (this.inputBuffer.length > 120) {
        this.inputBuffer.shift();
      }

      this.send(packet);
      return this.seq;
    }

    _handleMessage(raw) {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (e) {
        return;
      }

      if (!msg || !msg.type) return;

      switch (msg.type) {
        case MSG.PONG: {
          this.pingMs = Math.round(performance.now() - msg.t);
          if (this.callbacks.onPingUpdate) {
            this.callbacks.onPingUpdate(this.pingMs);
          }
          break;
        }

        case MSG.ROOM_CREATED: {
          this.roomCode = msg.roomCode;
          this.playerId = msg.playerId;
          this.secret = msg.secret;
          if (this.callbacks.onRoomCreated) {
            this.callbacks.onRoomCreated(msg);
          }
          break;
        }

        case MSG.ROOM_JOINED: {
          this.roomCode = msg.roomCode;
          this.playerId = msg.playerId;
          this.secret = msg.secret;
          if (this.callbacks.onRoomJoined) {
            this.callbacks.onRoomJoined(msg);
          }
          break;
        }

        case MSG.ROOM_ERROR: {
          if (this.callbacks.onRoomError) {
            this.callbacks.onRoomError(msg.reason);
          }
          break;
        }

        case MSG.MATCH_START: {
          this.isOnlineMatch = true;
          this.roomCode = msg.roomCode;
          this.playerId = msg.playerRole;
          this.secret = msg.secret;
          this.seq = 0;
          this.inputBuffer = [];
          this.opponentSnapshots = [];
          if (this.callbacks.onMatchStart) {
            this.callbacks.onMatchStart(msg);
          }
          break;
        }

        case MSG.STATE: {
          this._handleServerState(msg);
          break;
        }

        case MSG.MATCH_PAUSED: {
          if (this.callbacks.onMatchPaused) {
            this.callbacks.onMatchPaused(msg);
          }
          break;
        }

        case MSG.MATCH_RESUMED: {
          if (this.callbacks.onMatchResumed) {
            this.callbacks.onMatchResumed(msg);
          }
          break;
        }

        case MSG.OPPONENT_DISCONNECTED: {
          this.isOnlineMatch = false;
          if (this.callbacks.onOpponentDisconnected) {
            this.callbacks.onOpponentDisconnected(msg);
          }
          break;
        }

        default:
          break;
      }
    }

    /**
     * Reconciles client prediction with server authoritative state
     */
    _handleServerState(msg) {
      const serverState = msg.state;
      const ackSeq = (msg.lastProcessedSeq && msg.lastProcessedSeq[this.playerId]) || 0;
      this.lastAckSeq = ackSeq;

      // 1. Cull inputs acknowledged by server
      this.inputBuffer = this.inputBuffer.filter(entry => entry.seq > ackSeq);

      // 2. Buffer opponent state for entity interpolation
      const oppId = this.playerId === 1 ? 2 : 1;
      const oppServerState = serverState.players[oppId - 1];
      if (oppServerState) {
        this.opponentSnapshots.push({
          time: performance.now(),
          pos: { x: oppServerState.pos.x, y: oppServerState.pos.y },
          vel: { x: oppServerState.vel.x, y: oppServerState.vel.y },
          facing: { x: oppServerState.facing.x, y: oppServerState.facing.y },
          actionState: oppServerState.actionState,
          actionTimer: oppServerState.actionTimer,
          actionProgress: oppServerState.actionProgress,
          hitsTaken: oppServerState.hitsTaken,
          isInvulnerable: oppServerState.isInvulnerable
        });

        // Keep last 10 snapshots (~160ms history)
        if (this.opponentSnapshots.length > 10) {
          this.opponentSnapshots.shift();
        }
      }

      // 3. Callback into game loop for reconciliation
      if (this.callbacks.onStateUpdate) {
        this.callbacks.onStateUpdate(serverState, this.inputBuffer);
      }
    }

    /**
     * Interpolates opponent position smoothly between recent server snapshots
     */
    getInterpolatedOpponent() {
      if (this.opponentSnapshots.length === 0) return null;
      if (this.opponentSnapshots.length === 1) return this.opponentSnapshots[0];

      const renderTime = performance.now() - this.interpolationDelayMs;

      // Find the two snapshots surrounding renderTime
      let s0 = this.opponentSnapshots[0];
      let s1 = this.opponentSnapshots[this.opponentSnapshots.length - 1];

      for (let i = 0; i < this.opponentSnapshots.length - 1; i++) {
        if (this.opponentSnapshots[i].time <= renderTime && renderTime <= this.opponentSnapshots[i + 1].time) {
          s0 = this.opponentSnapshots[i];
          s1 = this.opponentSnapshots[i + 1];
          break;
        }
      }

      const totalSpan = s1.time - s0.time;
      const t = totalSpan > 0 ? Math.max(0, Math.min(1, (renderTime - s0.time) / totalSpan)) : 1;

      return {
        pos: {
          x: s0.pos.x + (s1.pos.x - s0.pos.x) * t,
          y: s0.pos.y + (s1.pos.y - s0.pos.y) * t
        },
        facing: t > 0.5 ? s1.facing : s0.facing,
        vel: s1.vel,
        actionState: s1.actionState,
        actionTimer: s1.actionTimer,
        actionProgress: s1.actionProgress,
        hitsTaken: s1.hitsTaken,
        isInvulnerable: s1.isInvulnerable
      };
    }

    _handleClose() {
      if (this.isOnlineMatch && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.isReconnecting = true;
        this.reconnectAttempts++;
        if (this.callbacks.onConnectionLost) {
          this.callbacks.onConnectionLost(this.reconnectAttempts, this.maxReconnectAttempts);
        }

        setTimeout(() => {
          this.connect(this.serverUrl).then(() => {
            if (this.roomCode && this.secret) {
              this.send({
                type: MSG.RECONNECT,
                roomCode: this.roomCode,
                playerId: this.playerId,
                secret: this.secret
              });
            }
          }).catch(() => {
            this._handleClose();
          });
        }, 1000);
      } else {
        if (this.callbacks.onConnectionLost) {
          this.callbacks.onConnectionLost(this.reconnectAttempts, this.maxReconnectAttempts);
        }
      }
    }

    disconnect() {
      this.isOnlineMatch = false;
      this._stopPingHeartbeat();
      if (this.ws) {
        try {
          this.ws.close();
        } catch (e) {}
        this.ws = null;
      }
    }
  }

  const ClashNetwork = {
    MSG: MSG,
    NetworkClient: NetworkClient
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ClashNetwork;
  }
  root.ClashNetwork = ClashNetwork;

})(typeof window !== 'undefined' ? window : globalThis);
