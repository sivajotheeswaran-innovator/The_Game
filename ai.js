/**
 * Clash Arena — Adaptive AI Opponent (Phase 5)
 * 
 * Strict architectural rule:
 * Generates standard PlayerInput object { moveX, moveY, attack, dodge, parry }
 * Reads state snapshot, outputs inputs. Zero renderer dependencies.
 * 
 * Features:
 * - Player habit tracking (aggression, parry frequency, dodge timing, attack range)
 * - Counter-play (punishes whiff recovery & parry whiff, times parry against predictable attacks)
 * - Wildcard human factor (non-deterministic reaction variance)
 * - Selectable tiers: EASY | MEDIUM | ADAPTIVE (self-scaling)
 */

(function(root) {
  'use strict';

  class ClashAI {
    constructor(difficulty = 'ADAPTIVE') {
      this.difficulty = difficulty; // 'EASY' | 'MEDIUM' | 'ADAPTIVE'

      // Player 1 Habit Tracking
      this.habits = {
        attackAttempts: 0,
        parryAttempts: 0,
        dashAttempts: 0,
        whiffsCount: 0,
        avgAttackDistance: 90,
        aggressionRatio: 0.5,
        roundsLost: 0,
        roundsWon: 0,
      };

      // AI internal state & timers
      this.stateTimer = 0;
      this.decisionTimer = 0;
      this.aimDir = { x: -1, y: 0 };
      this.subGoal = 'NEUTRAL'; // 'NEUTRAL' | 'PUNISH' | 'DEFEND' | 'RETREAT' | 'BAIT'
      this.reactionDelay = 0.12; // seconds
      this.reactionTimer = 0;

      // Desired spacing
      this.idealSpacing = 110;
      this.strafeDir = 1; // 1 or -1
      this.strafeTimer = 0;
    }

    setDifficulty(diff) {
      this.difficulty = diff;
      this.resetRound();
    }

    resetRound() {
      this.subGoal = 'NEUTRAL';
      this.reactionTimer = 0;
      this.decisionTimer = 0;
    }

    /**
     * Observes events to update habit model
     */
    trackPlayerEvents(events, p1, p2) {
      if (!events || !events.length) return;

      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (ev.type === 'ATTACK_WINDUP' && ev.playerId === 1) {
          this.habits.attackAttempts++;
          const dist = Math.hypot(p2.pos.x - p1.pos.x, p2.pos.y - p1.pos.y);
          this.habits.avgAttackDistance = (this.habits.avgAttackDistance * 0.8) + (dist * 0.2);
        } else if (ev.type === 'PARRY_INIT' && ev.playerId === 1) {
          this.habits.parryAttempts++;
        } else if (ev.type === 'DASH' && ev.playerId === 1) {
          this.habits.dashAttempts++;
        } else if (ev.type === 'PARRY_WHIFF' && ev.playerId === 1) {
          this.habits.whiffsCount++;
        }
      }
    }

    /**
     * Generates PlayerInput for Player 2
     * @param {Object} state - Current GameState snapshot
     * @param {number} dt - Delta time
     * @returns {Object} { moveX, moveY, attack, dodge, parry }
     */
    update(state, dt) {
      const p1 = state.players[0];
      const p2 = state.players[1];

      // Track habits from events
      this.trackPlayerEvents(state.events, p1, p2);

      // If game is not active playing or P2 is stunned/recovering, do nothing
      if (state.mode !== 'PLAYING' || p2.actionState === 'STUNNED') {
        return { moveX: 0, moveY: 0, attack: false, dodge: false, parry: false };
      }

      // Compute geometric relationships
      const dx = p1.pos.x - p2.pos.x;
      const dy = p1.pos.y - p2.pos.y;
      const dist = Math.hypot(dx, dy);
      const toP1 = dist > 0.001 ? { x: dx / dist, y: dy / dist } : { x: -1, y: 0 };
      const perp = { x: -toP1.y * this.strafeDir, y: toP1.x * this.strafeDir };

      // Difficulty-specific parameters
      let parrySkill = 0.65;
      let dodgeSkill = 0.50;
      let aggression = 0.55;
      let reactionSpeed = 0.14; // seconds

      if (this.difficulty === 'EASY') {
        parrySkill = 0.15;
        dodgeSkill = 0.25;
        aggression = 0.35;
        reactionSpeed = 0.32;
      } else if (this.difficulty === 'MEDIUM') {
        parrySkill = 0.50;
        dodgeSkill = 0.50;
        aggression = 0.60;
        reactionSpeed = 0.18;
      } else if (this.difficulty === 'ADAPTIVE') {
        // Self-scaling adaptive: adapts based on score & player habits
        const scoreDiff = (p1.hitsTaken - p2.hitsTaken); // positive if AI is winning
        if (scoreDiff > 0) {
          // Player is struggling, soften up slightly
          parrySkill = 0.60;
          aggression = 0.50;
          reactionSpeed = 0.16;
        } else if (scoreDiff < 0) {
          // Player is leading, AI locks in!
          parrySkill = 0.85;
          dodgeSkill = 0.75;
          aggression = 0.75;
          reactionSpeed = 0.08;
        } else {
          parrySkill = 0.70;
          dodgeSkill = 0.60;
          aggression = 0.65;
          reactionSpeed = 0.12;
        }

        // If player parries heavily, AI feints more and delays attacks
        if (this.habits.parryAttempts > 4) {
          aggression *= 0.8;
        }
      }

      // Strafe timer update
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeDir = Math.random() > 0.5 ? 1 : -1;
        this.strafeTimer = 0.8 + Math.random() * 1.4;
      }

      // Input variables to produce
      let moveX = 0;
      let moveY = 0;
      let attack = false;
      let dodge = false;
      let parry = false;

      // Attack reach constants
      const attackReach = 66 + 34; // reach + radius = ~100px

      // --- CRITICAL DECISION MATRIX ---

      // 1. PUNISH OPPORTUNITIES (P1 is Vulnerable)
      // When P1 is in PARRY_RECOVERY (0.44s whiff penalty), RECOVERY, or STUNNED
      const p1IsVulnerable = (
        p1.actionState === 'PARRY_RECOVERY' ||
        p1.actionState === 'STUNNED' ||
        p1.actionState === 'RECOVERY'
      );

      if (p1IsVulnerable && p2.actionState === 'IDLE') {
        if (dist <= attackReach * 1.1) {
          // In range -> Strike immediately for punish!
          attack = true;
        } else {
          // Close in aggressively
          moveX = toP1.x;
          moveY = toP1.y;
        }
        return { moveX, moveY, attack, dodge, parry };
      }

      // 2. DEFENSIVE REACTIONS (P1 is attacking)
      if (p1.actionState === 'WINDUP' && p2.actionState === 'IDLE') {
        this.reactionTimer += dt;
        const windupProgress = p1.actionProgress || 0;

        // Is P1 close enough to hit P2?
        if (dist <= attackReach + 15) {
          // Time parry near the tail of windup right as active strikes
          if (windupProgress >= (1.0 - reactionSpeed)) {
            const roll = Math.random();
            if (roll < parrySkill) {
              // Execute parry!
              parry = true;
              return { moveX: 0, moveY: 0, attack: false, dodge: false, parry: true };
            } else if (p2.dashCooldown <= 0 && roll < parrySkill + dodgeSkill) {
              // Dodge through or backwards with i-frames
              dodge = true;
              moveX = -toP1.x;
              moveY = -toP1.y;
              return { moveX, moveY, attack: false, dodge: true, parry: false };
            }
          }
        }
      }

      // 2.5 PROJECTILE EVASION / PARRY
      if (state.projectiles && state.projectiles.length > 0 && p2.actionState === 'IDLE') {
        for (let i = 0; i < state.projectiles.length; i++) {
          const proj = state.projectiles[i];
          if (!proj.active || proj.ownerId === p2.id) continue;

          const projDist = Math.hypot(p2.pos.x - proj.x, p2.pos.y - proj.y);
          if (projDist < 130) {
            const roll = Math.random();
            if (roll < parrySkill) {
              return { moveX: 0, moveY: 0, attack: false, dodge: false, parry: true };
            } else if (p2.dashCooldown <= 0 && roll < parrySkill + dodgeSkill) {
              return { moveX: perp.x, moveY: perp.y, attack: false, dodge: true, parry: false };
            }
          }
        }
      }

      // 2.6 BOMB HAZARD EVASION (Unparryable -> must dodge or flee!)
      if (state.hazards && state.hazards.length > 0 && p2.actionState === 'IDLE') {
        for (let i = 0; i < state.hazards.length; i++) {
          const haz = state.hazards[i];
          if (!haz.active) continue;
          const hazDist = Math.hypot(p2.pos.x - haz.x, p2.pos.y - haz.y);
          if (hazDist < haz.radius + 20 && haz.fuseTimer < 0.4) {
            const awayX = p2.pos.x - haz.x;
            const awayY = p2.pos.y - haz.y;
            const awayLen = Math.hypot(awayX, awayY) || 1;
            return {
              moveX: awayX / awayLen,
              moveY: awayY / awayLen,
              attack: false,
              dodge: p2.dashCooldown <= 0,
              parry: false,
            };
          }
        }
      }

      // 3. NEUTRAL GAME & SPACING
      if (p2.actionState === 'IDLE') {
        this.decisionTimer -= dt;

        // Maintain sweet spot spacing adapted to opponent weapon
        let targetSpacing = this.idealSpacing;
        if (p1.weapon === 'BOW') {
          // Rush archer to trigger point-blank glance weakness (< 75px)
          targetSpacing = 55;
        } else if (p1.weapon === 'SHOTGUN') {
          // Keep spacing slightly outside shotgun burst cone
          targetSpacing = 135;
        }

        if (dist > targetSpacing + 25) {
          // Move toward player with strafe blending
          moveX = toP1.x * 0.75 + perp.x * 0.25;
          moveY = toP1.y * 0.75 + perp.y * 0.25;
        } else if (dist < targetSpacing - 20) {
          // Back up slightly or circle
          moveX = -toP1.x * 0.65 + perp.x * 0.35;
          moveY = -toP1.y * 0.65 + perp.y * 0.35;
        } else {
          // In spacing zone: circle strafe
          moveX = perp.x * 0.7;
          moveY = perp.y * 0.7;

          // Offensive Strike Initiation
          if (this.decisionTimer <= 0) {
            this.decisionTimer = 0.4 + Math.random() * 0.6;
            const attackChance = aggression;

            // Don't attack mindlessly if P1 is baiting parry
            if (Math.random() < attackChance) {
              attack = true;
            }
          }
        }
      }

      // Wildcard jitter / human unpredictability factor (15%)
      if (Math.random() < 0.15 && p2.actionState === 'IDLE' && !attack && !parry && !dodge) {
        moveX += (Math.random() - 0.5) * 0.3;
        moveY += (Math.random() - 0.5) * 0.3;
      }

      // Normalize movement output
      const len = Math.hypot(moveX, moveY);
      if (len > 1) {
        moveX /= len;
        moveY /= len;
      }

      return {
        moveX: moveX,
        moveY: moveY,
        attack: attack,
        dodge: dodge,
        parry: parry,
      };
    }
  }

  const ClashAIModule = {
    ClashAI: ClashAI,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ClashAIModule;
  }
  root.ClashAIModule = ClashAIModule;

})(typeof window !== 'undefined' ? window : globalThis);
