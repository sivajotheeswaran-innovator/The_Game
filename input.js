/**
 * Clash Arena — Input System
 * 
 * Provides unified input abstraction for:
 * - Keyboard (Player 1 WASD + Player 2 Arrows / Numpad / IJKL)
 * - Touch (Virtual joystick + Action buttons for mobile)
 * - Dummy mode toggle (for single-player Phase 2 spacing & timing testing)
 * - Network-ready format: returns standard { moveX, moveY, attack, dodge, parry }
 */

(function(root) {
  'use strict';

  class InputController {
    constructor() {
      this.keysDown = {};
      this.justPressed = {};

      // Player 2 Dummy / AI mode toggle
      this.p2DummyMode = true; // Defaults to static dummy for testing Phase 2/3

      // Touch controls state
      this.touchStick = {
        active: false,
        identifier: null,
        startX: 0,
        startY: 0,
        currX: 0,
        currY: 0,
        maxDist: 48,
      };

      // Touch action buttons state
      this.touchButtons = {
        attack: false,
        dodge: false,
        parry: false,
      };

      // Input buffer timestamps (seconds) to prevent dropped inputs
      this.bufferTimes = {
        attack: 0,
        dodge: 0,
        parry: 0,
      };
      this.bufferWindow = 0.14; // 140ms input buffer

      this._bindEvents();
    }

    _bindEvents() {
      window.addEventListener('keydown', (e) => {
        // Prevent scroll on arrow keys or space
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
          e.preventDefault();
        }
        if (!this.keysDown[e.code]) {
          this.justPressed[e.code] = true;

          // Buffer combat actions
          const now = performance.now() / 1000;
          if (e.code === 'Space' || e.code === 'KeyF') this.bufferTimes.attack = now;
          if (e.code === 'ShiftLeft' || e.code === 'KeyQ') this.bufferTimes.dodge = now;
          if (e.code === 'KeyE') this.bufferTimes.parry = now;
        }
        this.keysDown[e.code] = true;
      });

      window.addEventListener('keyup', (e) => {
        this.keysDown[e.code] = false;
        // Do NOT clear justPressed on keyup — let simulation consume it!
      });

      // Window blur resets keys to prevent stuck keys when tabbing out
      window.addEventListener('blur', () => {
        this.keysDown = {};
        this.justPressed = {};
      });
    }

    /**
     * Consumes buffered action triggers once processed by simulation
     */
    postUpdate() {
      this.justPressed = {};
      this.touchButtons.attack = false;
      this.touchButtons.dodge = false;
      this.touchButtons.parry = false;
      this.bufferTimes.attack = 0;
      this.bufferTimes.dodge = 0;
      this.bufferTimes.parry = 0;
    }

    /**
     * Polls inputs for all players and returns the simulation-ready inputs object:
     * { 1: PlayerInput, 2: PlayerInput }
     */
    poll() {
      // --- PLAYER 1 (Keyboard WASD + Space/F/E/Q, plus Touch) ---
      let p1X = 0;
      let p1Y = 0;
      if (this.keysDown['KeyA'] || this.keysDown['Keya']) p1X -= 1;
      if (this.keysDown['KeyD'] || this.keysDown['Keyd']) p1X += 1;
      if (this.keysDown['KeyW'] || this.keysDown['Keyw']) p1Y -= 1;
      if (this.keysDown['KeyS'] || this.keysDown['Keys']) p1Y += 1;

      // Add touch joystick input if active
      if (this.touchStick.active) {
        const dx = this.touchStick.currX - this.touchStick.startX;
        const dy = this.touchStick.currY - this.touchStick.startY;
        const dist = Math.hypot(dx, dy);
        if (dist > 6) {
          const ratio = Math.min(1.0, dist / this.touchStick.maxDist);
          p1X += (dx / dist) * ratio;
          p1Y += (dy / dist) * ratio;
        }
      }

      // Normalization
      const p1Len = Math.hypot(p1X, p1Y);
      if (p1Len > 1) {
        p1X /= p1Len;
        p1Y /= p1Len;
      }

      const now = performance.now() / 1000;
      const isBuffered = (t) => (t > 0 && (now - t) <= this.bufferWindow);

      const p1Attack = !!(
        this.justPressed['Space'] ||
        this.justPressed['KeyF'] ||
        this.touchButtons.attack ||
        isBuffered(this.bufferTimes.attack)
      );
      const p1Dodge = !!(
        this.justPressed['ShiftLeft'] ||
        this.justPressed['KeyQ'] ||
        this.touchButtons.dodge ||
        isBuffered(this.bufferTimes.dodge)
      );
      const p1Parry = !!(
        this.justPressed['KeyE'] ||
        this.touchButtons.parry ||
        isBuffered(this.bufferTimes.parry)
      );

      // --- PLAYER 2 (Local duel on same keyboard or Dummy target) ---
      let p2X = 0;
      let p2Y = 0;
      let p2Attack = false;
      let p2Dodge = false;
      let p2Parry = false;

      if (!this.p2DummyMode) {
        // Arrow Keys / IJKL / Numpad
        if (this.keysDown['ArrowLeft'] || this.keysDown['KeyJ']) p2X -= 1;
        if (this.keysDown['ArrowRight'] || this.keysDown['KeyL']) p2X += 1;
        if (this.keysDown['ArrowUp'] || this.keysDown['KeyI']) p2Y -= 1;
        if (this.keysDown['ArrowDown'] || this.keysDown['KeyK']) p2Y += 1;

        const p2Len = Math.hypot(p2X, p2Y);
        if (p2Len > 1) {
          p2X /= p2Len;
          p2Y /= p2Len;
        }

        p2Attack = !!(this.justPressed['KeyO'] || this.justPressed['Numpad1'] || this.justPressed['Enter']);
        p2Dodge = !!(this.justPressed['KeyP'] || this.justPressed['Numpad2'] || this.justPressed['ShiftRight']);
        p2Parry = !!(this.justPressed['KeyU'] || this.justPressed['Numpad3'] || this.justPressed['Slash']);
      }

      return {
        1: {
          moveX: p1X,
          moveY: p1Y,
          attack: p1Attack,
          dodge: p1Dodge,
          parry: p1Parry,
        },
        2: {
          moveX: p2X,
          moveY: p2Y,
          attack: p2Attack,
          dodge: p2Dodge,
          parry: p2Parry,
        }
      };
    }
  }

  const ClashInput = {
    InputController: InputController,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ClashInput;
  }
  root.ClashInput = ClashInput;

})(typeof window !== 'undefined' ? window : globalThis);
