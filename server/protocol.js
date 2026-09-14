/**
 * Clash Arena — Network Protocol & Message Definitions
 * 
 * Shared between Node.js server and client browser.
 */

(function(root) {
  'use strict';

  const MSG = {
    // Client -> Server
    CREATE_ROOM: 'create_room',
    JOIN_ROOM: 'join_room',
    INPUT: 'input',
    PING: 'ping',
    RECONNECT: 'reconnect',

    // Server -> Client
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

  /**
   * Sanitizes and bounds-checks client input to prevent malicious or corrupted values.
   */
  function sanitizeInput(rawInput) {
    if (!rawInput || typeof rawInput !== 'object') {
      return { moveX: 0, moveY: 0, attack: false, dodge: false, parry: false };
    }

    let moveX = Number(rawInput.moveX) || 0;
    let moveY = Number(rawInput.moveY) || 0;

    // Clamp joystick/vector inputs
    const len = Math.hypot(moveX, moveY);
    if (len > 1.0) {
      moveX /= len;
      moveY /= len;
    }

    return {
      moveX: Math.max(-1, Math.min(1, moveX)),
      moveY: Math.max(-1, Math.min(1, moveY)),
      attack: Boolean(rawInput.attack),
      dodge: Boolean(rawInput.dodge || rawInput.dash),
      parry: Boolean(rawInput.parry)
    };
  }

  const Protocol = {
    MSG: MSG,
    sanitizeInput: sanitizeInput
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Protocol;
  }
  root.ClashProtocol = Protocol;

})(typeof window !== 'undefined' ? window : globalThis);
