/**
 * Clash Arena — State Model (Pure Data)
 * 
 * Strict architectural rule:
 * NO DOM references, NO Canvas references, NO PixiJS references.
 * Plain JS serializable objects only.
 */

(function(root) {
  'use strict';

  const CONSTANTS = {
    // Arena default dimensions
    ARENA_WIDTH: 960,
    ARENA_HEIGHT: 580,
    WALL_THICKNESS: 24,

    // Movement & Combat physics
    PLAYER_RADIUS: 22,
    MOVE_SPEED: 280, // px/sec

    // Attack state timings (in seconds)
    ATTACK_WINDUP_TIME: 0.22,
    ATTACK_ACTIVE_TIME: 0.10,
    ATTACK_RECOVERY_TIME: 0.28,
    ATTACK_REACH: 66, // distance from player center to attack hitbox center
    ATTACK_HITBOX_RADIUS: 34,

    // Dash / Dodge
    DASH_DURATION: 0.16,
    DASH_SPEED: 640,
    DASH_IFRAME_DURATION: 0.12, // invulnerability duration from start of dash
    DASH_COOLDOWN: 1.20,

    // Parry mechanics (per approved spec & edge-case rules)
    PARRY_ACTIVE_WINDOW: 0.14, // tight activation window
    PARRY_WHIFF_RECOVERY: 0.44, // punishing whiff if no attack is parried
    PARRY_STUN_DURATION: 0.55,  // stun inflicted upon successfully parrying an attacker

    // Round & Match Rules
    HITS_TO_WIN_ROUND: 3,
    ROUND_DURATION: 45.0, // seconds
    ROUNDS_TO_WIN_MATCH: 4, // Best of 7 (first to 4)
    MAX_ROUNDS: 7,

    ROUND_RESET_DELAY: 2.2, // seconds before next round starts

    // Weapon Archetype Parameter Table (weapon-system-expansion-plan.md)
    WEAPONS: {
      SPEAR: {
        id: 'SPEAR',
        name: 'Spear',
        type: 'MELEE',
        windupTime: 0.22,
        activeTime: 0.10,
        recoveryTime: 0.28,
        reach: 66,
        hitboxRadius: 34,
      },
      BOW: {
        id: 'BOW',
        name: 'Bow',
        type: 'PROJECTILE',
        windupTime: 0.38, // Charging draw
        activeTime: 0.05, // Release instant
        recoveryTime: 0.25,
        projectileSpeed: 640,
        projectileRadius: 7,
        minEffectiveRange: 75, // Weak at point-blank (< 75px, melee rush range)
      },
      SHOTGUN: {
        id: 'SHOTGUN',
        name: 'Shotgun',
        type: 'BURST_MELEE',
        windupTime: 0.12,
        activeTime: 0.08,
        recoveryTime: 0.42,
        reach: 46,
        hitboxRadius: 48,
      },
      BOMB: {
        id: 'BOMB',
        name: 'Bomb',
        type: 'HAZARD_AOE',
        windupTime: 0.30,
        activeTime: 0.05,
        recoveryTime: 0.45,
        throwDistance: 175,
        fuseTime: 0.75,
        explosionRadius: 65,
      },
    },

    // Character Roster (Part 2: Character-Weapon Binding)
    CHARACTERS: {
      KAELEN: { id: 'KAELEN', name: 'Kaelen', title: 'The Duelist', weapon: 'SPEAR', color: '#00f0ff', altColor: '#ff2a6d' },
      LYRA: { id: 'LYRA', name: 'Lyra', title: 'The Ranger', weapon: 'BOW', color: '#00ff88', altColor: '#ffb703' },
      TORREN: { id: 'TORREN', name: 'Torren', title: 'The Breaker', weapon: 'SHOTGUN', color: '#b5179e', altColor: '#f72585' },
      IGNIS: { id: 'IGNIS', name: 'Ignis', title: 'The Pyrotech', weapon: 'BOMB', color: '#ff4d00', altColor: '#ffaa00' },
    },
  };

  /**
   * Action States
   */
  const ActionState = Object.freeze({
    IDLE: 'IDLE',
    WINDUP: 'WINDUP',
    ACTIVE: 'ACTIVE',
    RECOVERY: 'RECOVERY',
    DASH: 'DASH',
    PARRY_ACTIVE: 'PARRY_ACTIVE',
    PARRY_RECOVERY: 'PARRY_RECOVERY',
    STUNNED: 'STUNNED',
  });

  /**
   * Creates a fresh player state.
   */
  function createPlayer(id, name, color, startX, startY, facingX, facingY, weapon = 'SPEAR', characterId = 'KAELEN') {
    return {
      id: id,
      name: name,
      color: color,
      characterId: characterId,
      weapon: weapon || 'SPEAR',
      pos: { x: startX, y: startY },
      vel: { x: 0, y: 0 },
      facing: { x: facingX, y: facingY },
      radius: CONSTANTS.PLAYER_RADIUS,

      actionState: ActionState.IDLE,
      actionTimer: 0, // countdown timer for current action state
      actionProgress: 0, // 0.0 to 1.0 helper for visual lerping

      dashCooldown: 0,
      isInvulnerable: false,
      hitRegisteredThisSwing: false,
      wasParried: false,

      // Round stats
      hitsTaken: 0, // hits taken this round (0 to 3)
      hitsLanded: 0, // hits landed this round
    };
  }

  /**
   * Returns a complete, pure initial GameState object.
   */
  function createInitialState(customArena) {
    const arenaW = (customArena && customArena.width) || CONSTANTS.ARENA_WIDTH;
    const arenaH = (customArena && customArena.height) || CONSTANTS.ARENA_HEIGHT;

    const p1StartX = arenaW * 0.28;
    const p1StartY = arenaH * 0.50;
    const p2StartX = arenaW * 0.72;
    const p2StartY = arenaH * 0.50;

    return {
      mode: 'PLAYING', // 'MENU' | 'PLAYING' | 'ROUND_OVER' | 'MATCH_OVER'
      timeStep: 1 / 60,
      totalElapsedTime: 0,
      nextEntityId: 1,

      arena: {
        width: arenaW,
        height: arenaH,
        wallThickness: CONSTANTS.WALL_THICKNESS,
        minX: CONSTANTS.WALL_THICKNESS + CONSTANTS.PLAYER_RADIUS,
        maxX: arenaW - CONSTANTS.WALL_THICKNESS - CONSTANTS.PLAYER_RADIUS,
        minY: CONSTANTS.WALL_THICKNESS + CONSTANTS.PLAYER_RADIUS,
        maxY: arenaH - CONSTANTS.WALL_THICKNESS - CONSTANTS.PLAYER_RADIUS,
      },

      round: {
        number: 1,
        maxRounds: CONSTANTS.MAX_ROUNDS,
        targetWins: CONSTANTS.ROUNDS_TO_WIN_MATCH,
        hitsToWin: CONSTANTS.HITS_TO_WIN_ROUND,
        timeRemaining: CONSTANTS.ROUND_DURATION,
        isOver: false,
        winnerId: null, // null | 1 | 2 | 'DRAW'
        reason: null, // 'HITS' | 'TIMEOUT'
        endCountdown: 0,
      },

      match: {
        winsP1: 0,
        winsP2: 0,
        isOver: false,
        winnerId: null, // null | 1 | 2
      },

      players: [
        createPlayer(1, 'Player 1', '#00f0ff', p1StartX, p1StartY, 1, 0, 'SPEAR', 'KAELEN'),
        createPlayer(2, 'Player 2', '#ff2a6d', p2StartX, p2StartY, -1, 0, 'SPEAR', 'KAELEN'),
      ],

      // Pure simulation entities for projectile & hazard weapons (Part 3)
      projectiles: [],
      hazards: [],
      nextEntityId: 1,

      // Ephemeral events array consumed by renderer (audio/VFX triggers)
      events: [],
    };
  }

  /**
   * Resets player positions and round timers for the next round.
   */
  function resetRoundState(state, roundNumber) {
    const arenaW = state.arena.width;
    const arenaH = state.arena.height;

    state.round.number = roundNumber;
    state.round.timeRemaining = CONSTANTS.ROUND_DURATION;
    state.round.isOver = false;
    state.round.winnerId = null;
    state.round.reason = null;
    state.round.endCountdown = 0;

    // Reset Player 1
    const p1 = state.players[0];
    p1.pos.x = arenaW * 0.28;
    p1.pos.y = arenaH * 0.50;
    p1.vel.x = 0;
    p1.vel.y = 0;
    p1.facing.x = 1;
    p1.facing.y = 0;
    p1.actionState = ActionState.IDLE;
    p1.actionTimer = 0;
    p1.actionProgress = 0;
    p1.dashCooldown = 0;
    p1.isInvulnerable = false;
    p1.hitRegisteredThisSwing = false;
    p1.wasParried = false;
    p1.hitsTaken = 0;
    p1.hitsLanded = 0;

    // Reset Player 2
    const p2 = state.players[1];
    p2.pos.x = arenaW * 0.72;
    p2.pos.y = arenaH * 0.50;
    p2.vel.x = 0;
    p2.vel.y = 0;
    p2.facing.x = -1;
    p2.facing.y = 0;
    p2.actionState = ActionState.IDLE;
    p2.actionTimer = 0;
    p2.actionProgress = 0;
    p2.dashCooldown = 0;
    p2.isInvulnerable = false;
    p2.hitRegisteredThisSwing = false;
    p2.wasParried = false;
    p2.hitsTaken = 0;
    p2.hitsLanded = 0;

    // Clear active projectiles & hazards between rounds
    state.projectiles = [];
    state.hazards = [];

    state.mode = 'PLAYING';
    state.events = [{ type: 'ROUND_START', roundNumber: roundNumber }];
  }

  /**
   * Deep clone helper (pure data guarantee)
   */
  function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
  }

  const ClashState = {
    CONSTANTS: CONSTANTS,
    ActionState: ActionState,
    createInitialState: createInitialState,
    resetRoundState: resetRoundState,
    cloneState: cloneState,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ClashState;
  }
  root.ClashState = ClashState;

})(typeof window !== 'undefined' ? window : globalThis);
