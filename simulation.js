/**
 * Clash Arena — Pure Simulation Engine
 * 
 * Strict architectural rule:
 * PURE LOGIC ONLY.
 * NO DOM, NO Canvas, NO PixiJS, NO Audio references.
 * Takes state + inputs + dt -> updates state deterministically.
 */

(function(root) {
  'use strict';

  // Import or reference ClashState
  const ClashState = (typeof module !== 'undefined' && module.exports)
    ? require('./state.js')
    : root.ClashState;

  const { CONSTANTS, ActionState, resetRoundState } = ClashState;

  /**
   * Helper: Vector magnitude
   */
  function vecLen(x, y) {
    return Math.hypot(x, y);
  }

  /**
   * Helper: Normalize vector
   */
  function vecNorm(x, y) {
    const len = Math.hypot(x, y);
    if (len < 0.0001) return { x: 0, y: 0 };
    return { x: x / len, y: y / len };
  }

  /**
   * Helper: Circle-to-circle overlap check
   */
  function circlesOverlap(x1, y1, r1, x2, y2, r2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distSq = dx * dx + dy * dy;
    const radSum = r1 + r2;
    return distSq <= radSum * radSum;
  }

  /**
   * Clamps player position to arena bounding walls
   */
  function clampToArena(player, arena) {
    if (player.pos.x < arena.minX) {
      player.pos.x = arena.minX;
      player.vel.x = 0;
    } else if (player.pos.x > arena.maxX) {
      player.pos.x = arena.maxX;
      player.vel.x = 0;
    }

    if (player.pos.y < arena.minY) {
      player.pos.y = arena.minY;
      player.vel.y = 0;
    } else if (player.pos.y > arena.maxY) {
      player.pos.y = arena.maxY;
      player.vel.y = 0;
    }
  }

  /**
   * Updates player cooldown timers
   */
  function updateCooldowns(player, dt) {
    if (player.dashCooldown > 0) {
      player.dashCooldown = Math.max(0, player.dashCooldown - dt);
    }
  }

  /**
   * Main simulation step: update(state, inputs, dt)
   * @param {Object} state - The mutable or cloned GameState
   * @param {Object} inputs - Keyed by player id: { [id]: { moveX, moveY, attack, dodge, parry } }
   * @param {number} dt - Fixed delta time in seconds (e.g. 1/60)
   * @returns {Object} the updated state
   */
  function update(state, inputs, dt) {
    // Clear ephemeral events from previous tick
    state.events = [];
    state.totalElapsedTime += dt;

    // Handle Match Over mode
    if (state.mode === 'MATCH_OVER') {
      return state;
    }

    // Handle Round Transition pause
    if (state.mode === 'ROUND_OVER') {
      state.round.endCountdown -= dt;
      if (state.round.endCountdown <= 0) {
        if (state.match.isOver) {
          state.mode = 'MATCH_OVER';
        } else {
          resetRoundState(state, state.round.number + 1);
        }
      }
      return state;
    }

    // --- Active Playing Mode ---
    // 1. Tick round timer
    state.round.timeRemaining = Math.max(0, state.round.timeRemaining - dt);

    const p1 = state.players[0];
    const p2 = state.players[1];
    const inp1 = (inputs && inputs[1]) || { moveX: 0, moveY: 0, attack: false, dodge: false, parry: false };
    const inp2 = (inputs && inputs[2]) || { moveX: 0, moveY: 0, attack: false, dodge: false, parry: false };

    // Update cooldowns
    updateCooldowns(p1, dt);
    updateCooldowns(p2, dt);

    // 2. Process actions and inputs for each player
    processPlayerInputAndAction(p1, p2, inp1, dt, state);
    processPlayerInputAndAction(p2, p1, inp2, dt, state);

    // 3. Move players based on velocity and apply arena boundary collisions
    applyMovement(p1, state.arena, dt);
    applyMovement(p2, state.arena, dt);

    // 4. Player-to-player physical soft collision push
    resolveBodyOverlap(p1, p2);

    // 5. Hit detection & Combat resolution (Telegraph -> Active hit frame -> Parry vs Attack check)
    resolveCombat(p1, p2, state);
    resolveCombat(p2, p1, state);

    // 6. Check round end conditions (First to 3 hits or 45s timeout)
    checkRoundStatus(state);

    return state;
  }

  /**
   * Process state machine for a single player
   */
  function processPlayerInputAndAction(player, opponent, input, dt, state) {
    // Face opponent naturally if idle and not moving, or align facing to movement
    const moveLen = vecLen(input.moveX, input.moveY);
    if (moveLen > 0.1) {
      player.facing = vecNorm(input.moveX, input.moveY);
    } else if (player.actionState === ActionState.IDLE) {
      // Orient facing toward opponent
      const toOpp = vecNorm(opponent.pos.x - player.pos.x, opponent.pos.y - player.pos.y);
      if (toOpp.x !== 0 || toOpp.y !== 0) {
        player.facing = toOpp;
      }
    }

    switch (player.actionState) {
      case ActionState.IDLE: {
        player.isInvulnerable = false;
        player.hitRegisteredThisSwing = false;
        player.wasParried = false;

        // Check for Dodge/Dash request (high priority)
        if (input.dodge && player.dashCooldown <= 0) {
          player.actionState = ActionState.DASH;
          player.actionTimer = CONSTANTS.DASH_DURATION;
          player.dashCooldown = CONSTANTS.DASH_COOLDOWN;
          player.isInvulnerable = true;

          // Dash in input direction if available, else in facing direction
          const dashDir = (moveLen > 0.1) ? vecNorm(input.moveX, input.moveY) : player.facing;
          player.vel.x = dashDir.x * CONSTANTS.DASH_SPEED;
          player.vel.y = dashDir.y * CONSTANTS.DASH_SPEED;

          state.events.push({
            type: 'DASH',
            playerId: player.id,
            x: player.pos.x,
            y: player.pos.y,
            dir: dashDir,
          });
          break;
        }

        // Check for Parry request
        if (input.parry) {
          player.actionState = ActionState.PARRY_ACTIVE;
          player.actionTimer = CONSTANTS.PARRY_ACTIVE_WINDOW;
          player.vel.x = 0;
          player.vel.y = 0;

          state.events.push({
            type: 'PARRY_INIT',
            playerId: player.id,
            x: player.pos.x,
            y: player.pos.y,
          });
          break;
        }

        // Check for Attack request
        if (input.attack) {
          player.actionState = ActionState.WINDUP;
          player.actionTimer = CONSTANTS.ATTACK_WINDUP_TIME;
          player.hitRegisteredThisSwing = false;
          player.wasParried = false;
          // Slight slowdown during windup
          player.vel.x = 0;
          player.vel.y = 0;

          state.events.push({
            type: 'ATTACK_WINDUP',
            playerId: player.id,
            x: player.pos.x,
            y: player.pos.y,
            facing: player.facing,
          });
          break;
        }

        // Normal walk movement
        if (moveLen > 0.1) {
          const norm = vecNorm(input.moveX, input.moveY);
          player.vel.x = norm.x * CONSTANTS.MOVE_SPEED;
          player.vel.y = norm.y * CONSTANTS.MOVE_SPEED;
        } else {
          player.vel.x = 0;
          player.vel.y = 0;
        }
        break;
      }

      case ActionState.WINDUP: {
        player.actionTimer -= dt;
        player.actionProgress = 1.0 - Math.max(0, player.actionTimer / CONSTANTS.ATTACK_WINDUP_TIME);
        // Slight drift in facing direction during windup
        player.vel.x = player.facing.x * (CONSTANTS.MOVE_SPEED * 0.15);
        player.vel.y = player.facing.y * (CONSTANTS.MOVE_SPEED * 0.15);

        if (player.actionTimer <= 0) {
          // Transition to ACTIVE attack hit frame
          player.actionState = ActionState.ACTIVE;
          player.actionTimer = CONSTANTS.ATTACK_ACTIVE_TIME;
          // Small lunge forward
          player.vel.x = player.facing.x * (CONSTANTS.MOVE_SPEED * 0.7);
          player.vel.y = player.facing.y * (CONSTANTS.MOVE_SPEED * 0.7);

          state.events.push({
            type: 'ATTACK_ACTIVE',
            playerId: player.id,
            x: player.pos.x,
            y: player.pos.y,
            facing: player.facing,
          });
        }
        break;
      }

      case ActionState.ACTIVE: {
        player.actionTimer -= dt;
        player.actionProgress = 1.0 - Math.max(0, player.actionTimer / CONSTANTS.ATTACK_ACTIVE_TIME);

        // Decelerate lunge
        player.vel.x *= 0.90;
        player.vel.y *= 0.90;

        if (player.actionTimer <= 0) {
          // Attack window finished -> enter RECOVERY
          player.actionState = ActionState.RECOVERY;
          player.actionTimer = CONSTANTS.ATTACK_RECOVERY_TIME;
          player.vel.x = 0;
          player.vel.y = 0;
        }
        break;
      }

      case ActionState.RECOVERY: {
        player.actionTimer -= dt;
        player.actionProgress = 1.0 - Math.max(0, player.actionTimer / CONSTANTS.ATTACK_RECOVERY_TIME);
        player.vel.x = 0;
        player.vel.y = 0;

        if (player.actionTimer <= 0) {
          player.actionState = ActionState.IDLE;
          player.actionProgress = 0;
        }
        break;
      }

      case ActionState.DASH: {
        player.actionTimer -= dt;
        player.actionProgress = 1.0 - Math.max(0, player.actionTimer / CONSTANTS.DASH_DURATION);

        // Invulnerable during first portion of dash
        const dashElapsed = CONSTANTS.DASH_DURATION - player.actionTimer;
        player.isInvulnerable = (dashElapsed <= CONSTANTS.DASH_IFRAME_DURATION);

        if (player.actionTimer <= 0) {
          player.actionState = ActionState.IDLE;
          player.isInvulnerable = false;
          player.vel.x = 0;
          player.vel.y = 0;
        }
        break;
      }

      case ActionState.PARRY_ACTIVE: {
        player.actionTimer -= dt;
        player.actionProgress = 1.0 - Math.max(0, player.actionTimer / CONSTANTS.PARRY_ACTIVE_WINDOW);
        player.vel.x = 0;
        player.vel.y = 0;

        if (player.actionTimer <= 0) {
          // If no attack triggered a successful parry during this window,
          // the parry WHIFFS! Enters extended punishing recovery.
          player.actionState = ActionState.PARRY_RECOVERY;
          player.actionTimer = CONSTANTS.PARRY_WHIFF_RECOVERY;

          state.events.push({
            type: 'PARRY_WHIFF',
            playerId: player.id,
            x: player.pos.x,
            y: player.pos.y,
          });
        }
        break;
      }

      case ActionState.PARRY_RECOVERY: {
        // Punishing whiff state: player is completely open
        player.actionTimer -= dt;
        player.actionProgress = 1.0 - Math.max(0, player.actionTimer / CONSTANTS.PARRY_WHIFF_RECOVERY);
        player.vel.x = 0;
        player.vel.y = 0;

        if (player.actionTimer <= 0) {
          player.actionState = ActionState.IDLE;
          player.actionProgress = 0;
        }
        break;
      }

      case ActionState.STUNNED: {
        // Stunned after being parried
        player.actionTimer -= dt;
        player.actionProgress = 1.0 - Math.max(0, player.actionTimer / CONSTANTS.PARRY_STUN_DURATION);
        player.vel.x = 0;
        player.vel.y = 0;

        if (player.actionTimer <= 0) {
          player.actionState = ActionState.IDLE;
          player.actionProgress = 0;
        }
        break;
      }
    }
  }

  /**
   * Applies velocity and updates position with boundary clamping
   */
  function applyMovement(player, arena, dt) {
    player.pos.x += player.vel.x * dt;
    player.pos.y += player.vel.y * dt;
    clampToArena(player, arena);
  }

  /**
   * Keeps players from clipping inside each other
   */
  function resolveBodyOverlap(p1, p2) {
    const dx = p2.pos.x - p1.pos.x;
    const dy = p2.pos.y - p1.pos.y;
    const dist = Math.hypot(dx, dy);
    const minDist = p1.radius + p2.radius;

    if (dist < minDist && dist > 0.001) {
      const overlap = minDist - dist;
      const nx = dx / dist;
      const ny = dy / dist;

      // Soft push apart
      p1.pos.x -= nx * (overlap * 0.5);
      p1.pos.y -= ny * (overlap * 0.5);
      p2.pos.x += nx * (overlap * 0.5);
      p2.pos.y += ny * (overlap * 0.5);
    }
  }

  /**
   * Combat resolution: Evaluates attacker against target
   */
  function resolveCombat(attacker, target, state) {
    // Only resolve during the ACTIVE hit frame and once per attack swing
    if (attacker.actionState !== ActionState.ACTIVE || attacker.hitRegisteredThisSwing) {
      return;
    }

    // Calculate attack hitbox position in front of attacker
    const hitboxX = attacker.pos.x + attacker.facing.x * CONSTANTS.ATTACK_REACH;
    const hitboxY = attacker.pos.y + attacker.facing.y * CONSTANTS.ATTACK_REACH;

    // Check overlap with target
    const isContact = circlesOverlap(
      hitboxX, hitboxY, CONSTANTS.ATTACK_HITBOX_RADIUS,
      target.pos.x, target.pos.y, target.radius
    );

    if (!isContact) {
      return;
    }

    // Mark that this swing hit detection has occurred
    attacker.hitRegisteredThisSwing = true;

    // Case 1: Target is dodging with invulnerability frames
    if (target.isInvulnerable) {
      state.events.push({
        type: 'ATTACK_DODGED',
        attackerId: attacker.id,
        targetId: target.id,
        x: hitboxX,
        y: hitboxY,
      });
      return;
    }

    // Case 2: Target is in PARRY_ACTIVE window!
    // PARRY SUCCESS! Per spec rules: Attacker is stunned, parrier recovers immediately.
    if (target.actionState === ActionState.PARRY_ACTIVE) {
      // Attacker enters STUNNED state
      attacker.actionState = ActionState.STUNNED;
      attacker.actionTimer = CONSTANTS.PARRY_STUN_DURATION;
      attacker.vel.x = -attacker.facing.x * 120; // recoil
      attacker.vel.y = -attacker.facing.y * 120;
      attacker.wasParried = true;

      // Defender returns to IDLE immediately (reward: immediate free punish window)
      target.actionState = ActionState.IDLE;
      target.actionTimer = 0;
      target.actionProgress = 0;

      state.events.push({
        type: 'PARRY_SUCCESS',
        parrierId: target.id,
        attackerId: attacker.id,
        x: (hitboxX + target.pos.x) * 0.5,
        y: (hitboxY + target.pos.y) * 0.5,
      });
      return;
    }

    // Case 3: Target is hit! Clean hit lands!
    target.hitsTaken += 1;
    attacker.hitsLanded += 1;

    // Target recoil
    const hitDir = vecNorm(target.pos.x - attacker.pos.x, target.pos.y - attacker.pos.y);
    target.vel.x = hitDir.x * 240;
    target.vel.y = hitDir.y * 240;

    // If target was doing an action other than DASH, interrupt them
    if (target.actionState !== ActionState.DASH) {
      target.actionState = ActionState.RECOVERY;
      target.actionTimer = 0.20; // brief flinch recovery
    }

    state.events.push({
      type: 'HIT',
      attackerId: attacker.id,
      targetId: target.id,
      hitsRemaining: Math.max(0, CONSTANTS.HITS_TO_WIN_ROUND - target.hitsTaken),
      targetHitsTaken: target.hitsTaken,
      x: (hitboxX + target.pos.x) * 0.5,
      y: (hitboxY + target.pos.y) * 0.5,
    });
  }

  /**
   * Checks if round or match has completed
   */
  function checkRoundStatus(state) {
    if (state.mode !== 'PLAYING') return;

    const p1 = state.players[0];
    const p2 = state.players[1];
    const hitsNeeded = CONSTANTS.HITS_TO_WIN_ROUND;

    let roundEnded = false;
    let roundWinner = null;
    let reason = null;

    // Condition A: 3 Clean hits taken
    const p1Dead = p1.hitsTaken >= hitsNeeded;
    const p2Dead = p2.hitsTaken >= hitsNeeded;

    if (p1Dead && p2Dead) {
      // Simultaneous knockout: Round Draw
      roundEnded = true;
      roundWinner = 'DRAW';
      reason = 'HITS_SIMULTANEOUS';
    } else if (p2Dead) {
      roundEnded = true;
      roundWinner = 1; // P1 wins round
      reason = 'HITS';
    } else if (p1Dead) {
      roundEnded = true;
      roundWinner = 2; // P2 wins round
      reason = 'HITS';
    }

    // Condition B: 45s Timeout
    if (!roundEnded && state.round.timeRemaining <= 0) {
      roundEnded = true;
      reason = 'TIMEOUT';

      // Most hits landed wins (equivalent to least hits taken)
      if (p1.hitsTaken < p2.hitsTaken) {
        roundWinner = 1;
      } else if (p2.hitsTaken < p1.hitsTaken) {
        roundWinner = 2;
      } else {
        roundWinner = 'DRAW'; // Replay round if tied on timeout
      }
    }

    if (roundEnded) {
      state.round.isOver = true;
      state.round.winnerId = roundWinner;
      state.round.reason = reason;
      state.round.endCountdown = CONSTANTS.ROUND_RESET_DELAY;
      state.mode = 'ROUND_OVER';

      // Update match tally if not a draw
      if (roundWinner === 1) {
        state.match.winsP1 += 1;
      } else if (roundWinner === 2) {
        state.match.winsP2 += 1;
      }

      // Check Match Victory (Best of 7: First to 4 wins)
      if (state.match.winsP1 >= CONSTANTS.ROUNDS_TO_WIN_MATCH) {
        state.match.isOver = true;
        state.match.winnerId = 1;
      } else if (state.match.winsP2 >= CONSTANTS.ROUNDS_TO_WIN_MATCH) {
        state.match.isOver = true;
        state.match.winnerId = 2;
      }

      state.events.push({
        type: 'ROUND_OVER',
        roundNumber: state.round.number,
        winnerId: roundWinner,
        reason: reason,
        matchWinsP1: state.match.winsP1,
        matchWinsP2: state.match.winsP2,
        isMatchOver: state.match.isOver,
        matchWinnerId: state.match.winnerId,
      });
    }
  }

  const ClashSimulation = {
    update: update,
    clampToArena: clampToArena,
    circlesOverlap: circlesOverlap,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ClashSimulation;
  }
  root.ClashSimulation = ClashSimulation;

})(typeof window !== 'undefined' ? window : globalThis);
