/**
 * Clash Arena — Visual Renderer
 * 
 * Strict architectural rule:
 * READ ONLY. Reads state and renders to screen. NEVER mutates GameState.
 * Includes:
 * - Dual-focus dynamic camera framing keeping both fighters in view
 * - High-clarity visual telegraphs (Windup, Active swing, Recovery, Dash, Parry Shield)
 * - Hit sparks, slow-mo micro-freeze, screen shake, and dash ghost trails
 * - Cyberpunk neon arena with boundary walls
 * - Match score HUD (Best of 7 pips, 3-hit round gauges, 45s timer)
 */

(function(root) {
  'use strict';

  // Graphics Quality Preset Parameter Table (Phase 1)
  const GRAPHICS_PRESETS = {
    SMOOTH: {
      key: 'SMOOTH',
      label: 'Smooth',
      dprCap: 1.0,
      glowLevel: 'OFF', // 0 passes
      uiBlur: 'OFF',
      particleMultiplier: 0.2,
      screenShakeMultiplier: 0.5,
      bgDetail: 'SIMPLE',
      parrySlowMo: true,
    },
    MAX: {
      key: 'MAX',
      label: 'Max',
      dprCap: 1.5,
      glowLevel: 'REDUCED', // 4-6 key combat passes: strike telegraph/active, shield, stun
      uiBlur: 'OFF',
      particleMultiplier: 0.4,
      screenShakeMultiplier: 1.0,
      bgDetail: 'STANDARD',
      parrySlowMo: true,
    },
    ULTRA: {
      key: 'ULTRA',
      label: 'Ultra',
      dprCap: 2.0,
      glowLevel: 'HIGH', // 10-12 passes: attack, shield, stun, player core, hit nodes, floating text
      uiBlur: 'LIGHT',
      particleMultiplier: 0.75,
      screenShakeMultiplier: 1.0,
      bgDetail: 'ENHANCED',
      parrySlowMo: true,
    },
    ULTRA_MAX: {
      key: 'ULTRA_MAX',
      label: 'Ultra Max',
      dprCap: 999, // Native uncapped
      glowLevel: 'ALL', // All 18 passes
      uiBlur: 'FULL',
      particleMultiplier: 1.0,
      screenShakeMultiplier: 1.2,
      bgDetail: 'ULTRA',
      parrySlowMo: true,
    },
  };

  class ClashRenderer {
    constructor(canvas, initialPresetKey) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');

      // Camera state
      this.camera = {
        x: 480,
        y: 290,
        zoom: 1.0,
        targetZoom: 1.0,
      };

      // Screen shake
      this.shakeIntensity = 0;
      this.shakeDecay = 0.90;

      // Slow-mo micro freeze (Kept across all tiers for game-feel feedback)
      this.freezeTimer = 0;

      // Particle system
      this.particles = [];
      this.floatingTexts = [];
      this.dashGhosts = [];

      // FPS calculation
      this.lastFrameTime = performance.now();
      this.frameCount = 0;
      this.fpsTimer = 0;
      this.fps = 60;

      // Mobile detection for initial suggestion
      this.isMobile = (typeof window !== 'undefined') && (
        ('ontouchstart' in window) ||
        (navigator.maxTouchPoints > 0) ||
        (window.innerWidth <= 900)
      );

      // Phase 4: Auto-detect default on first launch, respect saved preference
      let presetKey = initialPresetKey;
      if (!presetKey && typeof localStorage !== 'undefined') {
        try {
          presetKey = localStorage.getItem('clash_arena_graphics_preset');
        } catch (e) {}
      }
      if (!presetKey || !GRAPHICS_PRESETS[presetKey]) {
        presetKey = this.isMobile ? 'MAX' : 'ULTRA_MAX';
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem('clash_arena_graphics_preset', presetKey);
          } catch (e) {}
        }
      }
      this.preset = GRAPHICS_PRESETS[presetKey] || GRAPHICS_PRESETS.MAX;

      this.resize();
      this._applyUIBlur();
      if (typeof window !== 'undefined') {
        window.addEventListener('resize', () => this.resize());
      }
    }

    setPreset(key) {
      if (!GRAPHICS_PRESETS[key]) return;
      this.preset = GRAPHICS_PRESETS[key];
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('clash_arena_graphics_preset', key);
        } catch (e) {}
      }
      this._applyUIBlur();
      this.resize();

      const hudPreset = (typeof document !== 'undefined') ? document.getElementById('hudGraphicsPreset') : null;
      if (hudPreset) {
        hudPreset.textContent = this.preset.label.toUpperCase();
      }
    }

    _applyUIBlur() {
      if (typeof document !== 'undefined' && document.documentElement && this.preset) {
        document.documentElement.setAttribute('data-graphics', this.preset.key.toLowerCase());
      }
    }

    setGlow(color, blur, category = 'AMBIENT') {
      const level = this.preset ? this.preset.glowLevel : 'OFF';
      let allow = false;
      if (level === 'ALL') {
        allow = true;
      } else if (level === 'HIGH') {
        allow = (category === 'CORE' || category === 'SECONDARY');
      } else if (level === 'REDUCED') {
        allow = (category === 'CORE');
      }
      if (allow) {
        this.ctx.shadowColor = color;
        this.ctx.shadowBlur = blur;
      } else {
        this.ctx.shadowBlur = 0;
      }
    }

    clearGlow() {
      this.ctx.shadowBlur = 0;
    }

    resize() {
      const dprCap = this.preset ? this.preset.dprCap : 1.5;
      const deviceDpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      const dpr = Math.min(deviceDpr, dprCap);
      const rect = this.canvas.parentElement 
        ? this.canvas.parentElement.getBoundingClientRect() 
        : { width: (typeof window !== 'undefined' ? window.innerWidth : 1000), height: (typeof window !== 'undefined' ? window.innerHeight : 600) };

      this.width = rect.width || window.innerWidth;
      this.height = rect.height || window.innerHeight;
      this.canvas.width = Math.round(this.width * dpr);
      this.canvas.height = Math.round(this.height * dpr);
      this.canvas.style.width = this.width + 'px';
      this.canvas.style.height = this.height + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /**
     * Ingests simulation events to spawn transient VFX (sparks, screen shake, slow-mo)
     */
    processEvents(events) {
      if (!events || !events.length) return;

      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        switch (ev.type) {
          case 'HIT':
            this.triggerScreenShake(10);
            this.spawnHitSparks(ev.x, ev.y, '#ff0055');
            this.spawnFloatingText(ev.x, ev.y - 30, 'HIT!', '#ff2a6d');
            break;

          case 'PARRY_SUCCESS':
            // High-impact slow-mo micro freeze as requested by spec!
            this.freezeTimer = 0.12;
            this.triggerScreenShake(18);
            this.spawnParryBurst(ev.x, ev.y);
            this.spawnFloatingText(ev.x, ev.y - 40, 'PARRIED!', '#00f0ff', 24);
            break;

          case 'PARRY_WHIFF':
            this.spawnFloatingText(ev.x, ev.y - 30, 'WHIFF!', '#ffaa00', 16);
            break;

          case 'ATTACK_DODGED':
            this.spawnFloatingText(ev.x, ev.y - 30, 'DODGED!', '#a000ff', 16);
            break;

          case 'PROJECTILE_GLANCE':
            this.spawnFloatingText(ev.x, ev.y - 25, 'GLANCE!', '#aaaaaa', 15);
            this.spawnHitSparks(ev.x, ev.y, '#cccccc');
            break;

          case 'PROJECTILE_WALL':
            this.spawnHitSparks(ev.x, ev.y, '#00f0ff');
            break;

          case 'HAZARD_EXPLODED':
            this.triggerScreenShake(22);
            this.spawnExplosionParticles(ev.x, ev.y, ev.radius || 65);
            this.spawnFloatingText(ev.x, ev.y - 35, 'BOOM!', '#ff4400', 22);
            break;

          case 'DASH':
            this.spawnDashDust(ev.x, ev.y, ev.dir);
            break;

          case 'ROUND_OVER':
            this.triggerScreenShake(15);
            break;
        }
      }
    }

    spawnExplosionParticles(x, y, radius) {
      const mult = this.preset ? this.preset.particleMultiplier : 1.0;
      const count = Math.max(8, Math.round(35 * mult));
      const colors = ['#ff2200', '#ff6600', '#ffbb00', '#ffffff', '#ff0055'];
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 80 + Math.random() * 260;
        this.particles.push({
          x: x,
          y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 4 + Math.random() * 6,
          color: colors[Math.floor(Math.random() * colors.length)],
          alpha: 1.0,
          decay: 1.8 + Math.random() * 1.5,
        });
      }
    }

    triggerScreenShake(intensity) {
      const mult = this.preset ? this.preset.screenShakeMultiplier : 1.0;
      this.shakeIntensity = Math.max(this.shakeIntensity, intensity * mult);
    }

    spawnHitSparks(x, y, color) {
      const mult = this.preset ? this.preset.particleMultiplier : 1.0;
      const count = Math.max(2, Math.round(20 * mult));
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 120 + Math.random() * 260;
        this.particles.push({
          x: x,
          y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 3 + Math.random() * 4,
          color: Math.random() > 0.4 ? color : '#ffffff',
          alpha: 1.0,
          decay: 2.2 + Math.random() * 2.0,
        });
      }
    }

    spawnParryBurst(x, y) {
      const mult = this.preset ? this.preset.particleMultiplier : 1.0;
      const count = Math.max(4, Math.round(35 * mult));
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 160 + Math.random() * 340;
        this.particles.push({
          x: x,
          y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 4 + Math.random() * 5,
          color: Math.random() > 0.3 ? '#00f0ff' : '#ffe600',
          alpha: 1.0,
          decay: 2.0 + Math.random() * 1.5,
        });
      }
    }

    spawnDashDust(x, y, dir) {
      const mult = this.preset ? this.preset.particleMultiplier : 1.0;
      const count = Math.max(1, Math.round(8 * mult));
      for (let i = 0; i < count; i++) {
        const spread = (Math.random() - 0.5) * 1.2;
        const speed = 40 + Math.random() * 80;
        this.particles.push({
          x: x + (Math.random() - 0.5) * 16,
          y: y + (Math.random() - 0.5) * 16,
          vx: -dir.x * speed + Math.cos(spread) * 20,
          vy: -dir.y * speed + Math.sin(spread) * 20,
          size: 4 + Math.random() * 4,
          color: 'rgba(0, 240, 255, 0.4)',
          alpha: 0.8,
          decay: 2.5,
        });
      }
    }

    spawnFloatingText(x, y, text, color, fontSize = 18) {
      this.floatingTexts.push({
        x: x,
        y: y,
        text: text,
        color: color,
        alpha: 1.0,
        fontSize: fontSize,
        vy: -45,
        lifetime: 0.8,
      });
    }

    /**
     * Main Render Pass — strictly reads state, never modifies it!
     */
    render(state, dt) {
      const now = performance.now();
      const elapsed = (now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;
      this.frameCount++;
      this.fpsTimer += elapsed;
      if (this.fpsTimer >= 0.5) {
        this.fps = Math.round((this.frameCount / this.fpsTimer));
        this.frameCount = 0;
        this.fpsTimer = 0;
        const fpsEl = document.getElementById('hudFps');
        if (fpsEl) {
          fpsEl.textContent = `${this.fps} FPS`;
          fpsEl.style.color = this.fps >= 50 ? '#00ff88' : (this.fps >= 30 ? '#ffaa00' : '#ff2a6d');
        }
        const fpsModalEl = document.getElementById('graphicsModalFps');
        if (fpsModalEl) {
          fpsModalEl.textContent = `${this.fps} FPS`;
          fpsModalEl.style.color = this.fps >= 50 ? '#00ff88' : (this.fps >= 30 ? '#ffaa00' : '#ff2a6d');
        }
      }

      // Safety limits on particles and texts
      if (this.particles.length > 120) {
        this.particles.splice(0, this.particles.length - 120);
      }
      if (this.floatingTexts.length > 8) {
        this.floatingTexts.splice(0, this.floatingTexts.length - 8);
      }

      // Handle screen shake
      let offsetX = 0;
      let offsetY = 0;
      if (this.shakeIntensity > 0.2) {
        offsetX = (Math.random() - 0.5) * this.shakeIntensity;
        offsetY = (Math.random() - 0.5) * this.shakeIntensity;
        this.shakeIntensity *= this.shakeDecay;
      } else {
        this.shakeIntensity = 0;
      }

      // Update camera framing: lerp toward center of both players
      const p1 = state.players[0];
      const p2 = state.players[1];
      const midX = (p1.pos.x + p2.pos.x) * 0.5;
      const midY = (p1.pos.y + p2.pos.y) * 0.5;
      const dist = Math.hypot(p2.pos.x - p1.pos.x, p2.pos.y - p1.pos.y);

      // Smooth camera follow
      this.camera.x += (midX - this.camera.x) * 0.08;
      this.camera.y += (midY - this.camera.y) * 0.08;

      // Compute dynamic zoom to frame both players cleanly with margin
      const margin = 260;
      const targetW = Math.max(state.arena.width * 0.6, dist + margin);
      const targetH = Math.max(state.arena.height * 0.6, (dist + margin) * (this.height / this.width));
      const zoomX = this.width / targetW;
      const zoomY = this.height / targetH;
      const idealZoom = Math.min(1.25, Math.max(0.65, Math.min(zoomX, zoomY)));
      this.camera.zoom += (idealZoom - this.camera.zoom) * 0.06;

      const ctx = this.ctx;

      // 1. Clear background
      ctx.fillStyle = '#0a0b10';
      ctx.fillRect(0, 0, this.width, this.height);

      // Camera transformation
      ctx.save();
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.translate(this.width * 0.5 + offsetX, this.height * 0.5 + offsetY);
      ctx.scale(this.camera.zoom, this.camera.zoom);
      ctx.translate(-this.camera.x, -this.camera.y);

      // 3. Render Arena
      this.renderArena(ctx, state.arena);

      // 4. Render Ground Hazard AoE Zones (under players)
      this.renderHazards(ctx, state.hazards, dt);

      // 5. Render Visual Effects Particles & Trails
      this.renderVFX(ctx, dt);

      // 6. Render Players
      this.renderPlayer(ctx, p1, p2);
      this.renderPlayer(ctx, p2, p1);

      // 7. Render Projectiles (e.g. arrows)
      this.renderProjectiles(ctx, state.projectiles, dt);

      // 8. Render Floating combat texts
      this.renderFloatingTexts(ctx, dt);

      ctx.restore();

      // 7. Render Screen-space HUD & Overlays
      this.renderHUD(ctx, state);

      // 8. Render Round & Match Banners
      this.renderBanners(ctx, state);
    }

    renderArena(ctx, arena) {
      const w = arena.width;
      const h = arena.height;
      const wall = arena.wallThickness;
      const bgDetail = this.preset ? this.preset.bgDetail : 'STANDARD';

      if (bgDetail === 'SIMPLE') {
        // High-performance flat floor for Smooth preset
        ctx.fillStyle = '#111322';
        ctx.fillRect(wall, wall, w - wall * 2, h - wall * 2);

        // Simple center ring
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.12)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(w * 0.5, h * 0.5, 90, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        // Arena floor with high-tech radial gradient
        const gradient = ctx.createRadialGradient(w * 0.5, h * 0.5, 40, w * 0.5, h * 0.5, w * 0.6);
        gradient.addColorStop(0, '#16192b');
        gradient.addColorStop(1, '#0c0e17');
        ctx.fillStyle = gradient;
        ctx.fillRect(wall, wall, w - wall * 2, h - wall * 2);

        // Floor Grid Lines
        ctx.strokeStyle = bgDetail === 'ULTRA' ? 'rgba(0, 240, 255, 0.08)' : 'rgba(0, 240, 255, 0.04)';
        ctx.lineWidth = 1;
        const gridSize = 40;
        ctx.beginPath();
        for (let x = wall; x <= w - wall; x += gridSize) {
          ctx.moveTo(x, wall);
          ctx.lineTo(x, h - wall);
        }
        for (let y = wall; y <= h - wall; y += gridSize) {
          ctx.moveTo(wall, y);
          ctx.lineTo(w - wall, y);
        }
        ctx.stroke();

        // Center Duel Octagon / Ring
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.18)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(w * 0.5, h * 0.5, 120, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 42, 109, 0.14)';
        ctx.beginPath();
        ctx.arc(w * 0.5, h * 0.5, 50, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Boundary Walls with Neon Cyber Glow
      ctx.save();
      this.setGlow('#00f0ff', 12, 'AMBIENT');
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 3;
      ctx.strokeRect(wall, wall, w - wall * 2, h - wall * 2);
      ctx.restore();

      // Exterior boundary solid frame
      ctx.fillStyle = '#050609';
      // Top wall
      ctx.fillRect(0, 0, w, wall);
      // Bottom wall
      ctx.fillRect(0, h - wall, w, wall);
      // Left wall
      ctx.fillRect(0, 0, wall, h);
      // Right wall
      ctx.fillRect(w - wall, 0, wall, h);
    }

    renderProjectiles(ctx, projectiles, dt) {
      if (!projectiles || !projectiles.length) return;

      for (let i = 0; i < projectiles.length; i++) {
        const p = projectiles[i];
        if (!p.active) continue;

        const angle = Math.atan2(p.vy, p.vx);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(angle);

        // Arrow energy glow
        this.setGlow('#00ff88', 14, 'CORE');

        // Arrow shaft
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-16, 0);
        ctx.lineTo(8, 0);
        ctx.stroke();

        // Arrow head (sharp chevron)
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(12, 0);
        ctx.lineTo(4, -5);
        ctx.lineTo(6, 0);
        ctx.lineTo(4, 5);
        ctx.closePath();
        ctx.fill();

        // Arrow fletching / trail
        ctx.strokeStyle = 'rgba(0, 255, 136, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-16, 0);
        ctx.lineTo(-20, -3);
        ctx.moveTo(-16, 0);
        ctx.lineTo(-20, 3);
        ctx.stroke();

        ctx.restore();
      }
    }

    renderHazards(ctx, hazards, dt) {
      if (!hazards || !hazards.length) return;

      const now = performance.now() * 0.005;

      for (let i = 0; i < hazards.length; i++) {
        const h = hazards[i];
        if (!h.active) continue;

        const fuseRatio = Math.max(0, h.fuseTimer / (h.totalFuseTime || 0.75));

        ctx.save();
        ctx.translate(h.x, h.y);

        // AoE danger perimeter ring
        ctx.strokeStyle = 'rgba(255, 68, 0, ' + (0.4 + (1 - fuseRatio) * 0.4) + ')';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.arc(0, 0, h.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Danger fill expanding or pulsing
        ctx.fillStyle = 'rgba(255, 68, 0, ' + (0.10 + (1 - fuseRatio) * 0.20) + ')';
        ctx.beginPath();
        ctx.arc(0, 0, h.radius * (1 - fuseRatio * 0.4), 0, Math.PI * 2);
        ctx.fill();

        // Fuse countdown indicator ring
        ctx.strokeStyle = '#ffaa00';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 18, -Math.PI * 0.5, -Math.PI * 0.5 + (1 - fuseRatio) * Math.PI * 2);
        ctx.stroke();

        // Central bomb device
        this.setGlow('#ff3300', 12, 'CORE');
        ctx.fillStyle = '#222533';
        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = fuseRatio < 0.25 ? '#ffffff' : '#ff4400';
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }
    }

    renderPlayer(ctx, player, opponent) {
      const px = player.pos.x;
      const py = player.pos.y;
      const angle = Math.atan2(player.facing.y, player.facing.x);

      ctx.save();
      ctx.translate(px, py);

      // --- 1. State-specific visual indicators & telegraphs ---

      // Dash Ghost / invulnerability effect
      if (player.actionState === 'DASH') {
        ctx.save();
        ctx.fillStyle = player.color;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(-player.facing.x * 20, -player.facing.y * 20, player.radius * 1.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Attack WINDUP Telegraph
      if (player.actionState === 'WINDUP') {
        const weapon = (player.weapon || 'SPEAR').toUpperCase();
        const progress = player.actionProgress || 0;

        ctx.save();
        ctx.rotate(angle);

        if (weapon === 'BOW') {
          // Bow Draw Telegraph: Bow arc + pulling back string with glowing arrow forming
          const bowR = player.radius + 10;
          this.setGlow('#00ff88', 12, 'CORE');
          ctx.strokeStyle = '#00ff88';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(8, 0, bowR, -Math.PI * 0.40, Math.PI * 0.40);
          ctx.stroke();

          // Bow string pulled back
          const pullBack = 4 - progress * 16;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(8 + Math.cos(-Math.PI * 0.40) * bowR, Math.sin(-Math.PI * 0.40) * bowR);
          ctx.lineTo(pullBack, 0);
          ctx.lineTo(8 + Math.cos(Math.PI * 0.40) * bowR, Math.sin(Math.PI * 0.40) * bowR);
          ctx.stroke();

          // Forming Energy Arrow
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(pullBack, 0);
          ctx.lineTo(pullBack + 26 * progress, 0);
          ctx.stroke();

          // Aiming beam line - auto-aim aligns beam through target
          let beamDist = 240;
          if (opponent && opponent.pos) {
            const distToOpp = Math.hypot(opponent.pos.x - player.pos.x, opponent.pos.y - player.pos.y);
            beamDist = Math.max(200, distToOpp + 30);
          }
          ctx.strokeStyle = 'rgba(0, 255, 136, ' + (0.2 + progress * 0.5) + ')';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(pullBack + 26 * progress, 0);
          ctx.lineTo(beamDist, 0);
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (weapon === 'SHOTGUN') {
          // Shotgun Cone Telegraph (close-range blast danger)
          const reach = 46;
          const hitRadius = 48;
          ctx.fillStyle = 'rgba(255, 0, 128, ' + (0.2 + progress * 0.45) + ')';
          ctx.strokeStyle = '#ff0080';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(10, 0);
          ctx.arc(reach, 0, hitRadius * (0.6 + progress * 0.4), -Math.PI * 0.35, Math.PI * 0.35);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (weapon === 'BOMB') {
          // Bomb throw trajectory clamped to opponent position (Auto-aim)
          let throwDist = 175;
          if (opponent && opponent.pos) {
            const distToOpp = Math.hypot(opponent.pos.x - player.pos.x, opponent.pos.y - player.pos.y);
            throwDist = Math.min(distToOpp, 175);
          }
          ctx.strokeStyle = 'rgba(255, 100, 0, ' + (0.3 + progress * 0.5) + ')';
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(10, 0);
          ctx.quadraticCurveTo(throwDist * 0.5, -45 * progress, throwDist, 0);
          ctx.stroke();
          ctx.setLineDash([]);

          // Landing target circle
          ctx.strokeStyle = '#ff4400';
          ctx.fillStyle = 'rgba(255, 68, 0, 0.25)';
          ctx.beginPath();
          ctx.arc(throwDist, 0, 24 * progress, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          // Default Spear / Melee: Pulsing danger telegraph arc
          const reach = 66;
          const hitRadius = 34;
          ctx.fillStyle = 'rgba(255, 170, 0, ' + (0.2 + progress * 0.4) + ')';
          ctx.strokeStyle = '#ffaa00';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(reach, 0, hitRadius * (0.6 + progress * 0.4), 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Telegraph charge beam
          ctx.strokeStyle = 'rgba(255, 230, 0, 0.8)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(10, 0);
          ctx.lineTo(reach - hitRadius * 0.5, 0);
          ctx.stroke();
        }

        ctx.restore();
      }

      // Attack ACTIVE frame
      if (player.actionState === 'ACTIVE') {
        const weapon = (player.weapon || 'SPEAR').toUpperCase();
        ctx.save();
        ctx.rotate(angle);

        if (weapon === 'BOW') {
          // Release bow recoil flash
          this.setGlow('#00ff88', 16, 'CORE');
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(8, 0, player.radius + 12, -Math.PI * 0.35, Math.PI * 0.35);
          ctx.stroke();
        } else if (weapon === 'SHOTGUN') {
          // Massive multi-pellet spread blast
          this.setGlow('#ff0080', 20, 'CORE');
          ctx.fillStyle = 'rgba(255, 0, 128, 0.4)';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(10, 0);
          ctx.arc(0, 0, 70, -Math.PI * 0.4, Math.PI * 0.4);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        } else if (weapon === 'BOMB') {
          // Toss arm release flash
          this.setGlow('#ff6600', 14, 'CORE');
          ctx.fillStyle = '#ffaa00';
          ctx.beginPath();
          ctx.arc(player.radius + 6, 0, 8, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Spear / Melee: Flash strike arc
          const reach = 66;
          ctx.strokeStyle = '#ffffff';
          this.setGlow(player.color, 18, 'CORE');
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.arc(0, 0, reach + 10, -Math.PI * 0.35, Math.PI * 0.35);
          ctx.stroke();

          ctx.fillStyle = player.color;
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, reach + 10, -Math.PI * 0.35, Math.PI * 0.35);
          ctx.closePath();
          ctx.fill();
        }

        ctx.restore();
      }

      // PARRY ACTIVE (Energy Shield)
      if (player.actionState === 'PARRY_ACTIVE') {
        ctx.save();
        this.setGlow('#00f0ff', 20, 'CORE');
        ctx.strokeStyle = '#00f0ff';
        ctx.fillStyle = 'rgba(0, 240, 255, 0.28)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        // Hexagonal energy barrier
        const shieldR = player.radius + 18;
        for (let i = 0; i < 6; i++) {
          const a = (i * Math.PI) / 3;
          const sx = Math.cos(a) * shieldR;
          const sy = Math.sin(a) * shieldR;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // PARRY RECOVERY (Whiff failure warning)
      if (player.actionState === 'PARRY_RECOVERY') {
        ctx.save();
        ctx.strokeStyle = '#ff3300';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(0, 0, player.radius + 14, 0, Math.PI * 2);
        ctx.stroke();

        ctx.font = '900 11px sans-serif';
        ctx.fillStyle = '#ff5522';
        ctx.textAlign = 'center';
        ctx.fillText('WHIFF', 0, -player.radius - 12);
        ctx.restore();
      }

      // STUNNED (Parried feedback)
      if (player.actionState === 'STUNNED') {
        ctx.save();
        const spin = performance.now() * 0.008;
        ctx.strokeStyle = '#ffe600';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, -player.radius - 14, 12, spin, spin + Math.PI * 1.5);
        ctx.stroke();

        ctx.font = '900 12px sans-serif';
        ctx.fillStyle = '#ffe600';
        this.setGlow('#ffe600', 8, 'CORE');
        ctx.textAlign = 'center';
        ctx.fillText('STUNNED', 0, -player.radius - 22);
        ctx.restore();
      }

      // --- 2. Character Core Body ---
      ctx.save();
      // Outer glow
      this.setGlow(player.color, 12, 'SECONDARY');
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
      ctx.fill();

      // Dark core with stylized visor
      ctx.fillStyle = '#11131c';
      ctx.beginPath();
      ctx.arc(0, 0, player.radius - 5, 0, Math.PI * 2);
      ctx.fill();

      // Visor / Direction pointer
      ctx.rotate(angle);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(player.radius - 4, -4);
      ctx.lineTo(player.radius + 6, 0);
      ctx.lineTo(player.radius - 4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // --- 3. Dash Cooldown Ring ---
      if (player.dashCooldown > 0) {
        ctx.save();
        const cdRatio = player.dashCooldown / 1.20;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, player.radius + 6, -Math.PI * 0.5, -Math.PI * 0.5 + (1 - cdRatio) * Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    }

    renderVFX(ctx, dt) {
      // Particles
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.alpha -= p.decay * dt;

        if (p.alpha <= 0) {
          this.particles.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        this.setGlow(p.color, 8, 'AMBIENT');
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    renderFloatingTexts(ctx, dt) {
      for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
        const t = this.floatingTexts[i];
        t.y += t.vy * dt;
        t.alpha -= dt / t.lifetime;

        if (t.alpha <= 0) {
          this.floatingTexts.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, t.alpha);
        ctx.font = '900 ' + t.fontSize + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = t.color;
        this.setGlow(t.color, 10, 'SECONDARY');
        ctx.fillText(t.text, t.x, t.y);
        ctx.restore();
      }
    }

    /**
     * Top-level HUD (Timer, Best-of-7 round dots, 3-hit gauges)
     */
    renderHUD(ctx, state) {
      const topMargin = 24;
      const midX = this.width * 0.5;

      ctx.save();

      // 1. Timer Display
      const timeRemaining = Math.max(0, state.round.timeRemaining);
      const timeStr = timeRemaining.toFixed(1) + 's';
      ctx.textAlign = 'center';
      ctx.font = '900 28px monospace';
      ctx.fillStyle = timeRemaining <= 10 ? '#ff2a6d' : '#ffffff';
      this.setGlow(timeRemaining <= 10 ? '#ff2a6d' : '#00f0ff', 10, 'AMBIENT');
      ctx.fillText(timeStr, midX, topMargin + 20);

      ctx.font = '700 12px sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      this.clearGlow();
      ctx.fillText('ROUND ' + state.round.number + ' / 7', midX, topMargin + 38);

      // 2. Best-of-7 Match Score Pips (First to 4 wins)
      // P1 Round wins (Left of timer)
      const p1Wins = state.match.winsP1;
      for (let i = 0; i < 4; i++) {
        const dotX = midX - 90 - (i * 22);
        ctx.beginPath();
        ctx.arc(dotX, topMargin + 18, 6, 0, Math.PI * 2);
        if (i < p1Wins) {
          ctx.fillStyle = '#00f0ff';
          this.setGlow('#00f0ff', 8, 'AMBIENT');
          ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(0, 240, 255, 0.3)';
          ctx.lineWidth = 2;
          this.clearGlow();
          ctx.stroke();
        }
      }

      // P2 Round wins (Right of timer)
      const p2Wins = state.match.winsP2;
      for (let i = 0; i < 4; i++) {
        const dotX = midX + 90 + (i * 22);
        ctx.beginPath();
        ctx.arc(dotX, topMargin + 18, 6, 0, Math.PI * 2);
        if (i < p2Wins) {
          ctx.fillStyle = '#ff2a6d';
          this.setGlow('#ff2a6d', 8, 'AMBIENT');
          ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(255, 42, 109, 0.3)';
          ctx.lineWidth = 2;
          this.clearGlow();
          ctx.stroke();
        }
      }

      // 3. Current Round Hit Nodes (3 clean hits to defeat)
      const p1 = state.players[0];
      const p2 = state.players[1];

      // P1 Hit Nodes
      this.renderHitNodes(ctx, 40, topMargin + 20, '#00f0ff', p1.name, p1.hitsTaken, 3, false);

      // P2 Hit Nodes
      this.renderHitNodes(ctx, this.width - 40, topMargin + 20, '#ff2a6d', p2.name, p2.hitsTaken, 3, true);

      // 4. FPS / Engine overlay
      ctx.textAlign = 'left';
      ctx.font = '12px monospace';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillText('FPS: ' + this.fps + ' | ENGINE: CANVAS2D/WEBGL | FIXED: 60Hz', 16, this.height - 16);

      ctx.restore();
    }

    renderHitNodes(ctx, x, y, color, name, hitsTaken, maxHits, alignRight) {
      ctx.save();
      ctx.textAlign = alignRight ? 'right' : 'left';
      ctx.font = '900 16px sans-serif';
      ctx.fillStyle = color;
      this.setGlow(color, 8, 'SECONDARY');
      ctx.fillText(name, x, y);

      // 3 nodes representing hits remaining
      const hitsRemaining = Math.max(0, maxHits - hitsTaken);
      const nodeRadius = 7;
      const spacing = 22;

      for (let i = 0; i < maxHits; i++) {
        const nx = alignRight ? x - (i * spacing) - 8 : x + (i * spacing) + 8;
        const ny = y + 18;

        ctx.beginPath();
        ctx.arc(nx, ny, nodeRadius, 0, Math.PI * 2);
        if (i < hitsRemaining) {
          ctx.fillStyle = color;
          ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = 2;
          this.clearGlow();
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    /**
     * Round and Match Conclusion Banners
     */
    renderBanners(ctx, state) {
      if (state.mode === 'ROUND_OVER' || state.mode === 'MATCH_OVER') {
        const midX = this.width * 0.5;
        const midY = this.height * 0.42;

        ctx.save();
        ctx.fillStyle = 'rgba(5, 6, 12, 0.82)';
        ctx.fillRect(0, midY - 90, this.width, 180);

        ctx.textAlign = 'center';

        if (state.mode === 'MATCH_OVER') {
          const winner = state.match.winnerId === 1 ? 'PLAYER 1' : 'PLAYER 2';
          const winnerColor = state.match.winnerId === 1 ? '#00f0ff' : '#ff2a6d';

          ctx.font = '900 48px sans-serif';
          ctx.fillStyle = winnerColor;
          this.setGlow(winnerColor, 24, 'AMBIENT');
          ctx.fillText(winner + ' WINS THE MATCH!', midX, midY);

          ctx.font = '700 20px sans-serif';
          ctx.fillStyle = '#ffffff';
          this.clearGlow();
          ctx.fillText('BEST OF 7 VICTORY (' + state.match.winsP1 + ' - ' + state.match.winsP2 + ')', midX, midY + 40);
        } else {
          // Round Over
          const roundWinner = state.round.winnerId;
          let title = 'ROUND ' + state.round.number + ' ';
          let color = '#ffffff';

          if (roundWinner === 1) {
            title += '— PLAYER 1 WINS';
            color = '#00f0ff';
          } else if (roundWinner === 2) {
            title += '— PLAYER 2 WINS';
            color = '#ff2a6d';
          } else {
            title += '— DRAW / TIMEOUT';
            color = '#ffe600';
          }

          ctx.font = '900 36px sans-serif';
          ctx.fillStyle = color;
          this.setGlow(color, 18, 'AMBIENT');
          ctx.fillText(title, midX, midY);

          const reasonText = state.round.reason === 'TIMEOUT' ? 'TIMEOUT DECISION' : '3 CLEAN HITS LANDED';
          ctx.font = '600 16px sans-serif';
          ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
          this.clearGlow();
          ctx.fillText(reasonText + ' — NEXT ROUND STARTING...', midX, midY + 36);
        }

        ctx.restore();
      }
    }
  }

  const ClashRendererModule = {
    ClashRenderer: ClashRenderer,
    GRAPHICS_PRESETS: GRAPHICS_PRESETS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ClashRendererModule;
  }
  root.ClashRendererModule = ClashRendererModule;

})(typeof window !== 'undefined' ? window : globalThis);
