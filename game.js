/**
 * Clash Arena — Main Game Orchestrator & Loop
 * 
 * Strict architectural rule:
 * Orchestrates loop:
 *   inputs = inputController.poll()
 *   ClashSimulation.update(state, inputs, fixedDt)
 *   renderer.render(state, dt)
 * 
 * Supports:
 * - Offline Single Player: Adaptive AI, Medium AI, Easy AI, Static Dummy
 * - Offline 2-Player Local: Shared keyboard / controls
 * - Stage B Online 1v1 PvP: Authoritative WebSocket server, Client-Side Prediction,
 *   Reconciliation, Entity Interpolation, Ping diagnostics, and Disconnect handling.
 */

(function() {
  'use strict';

  // --- Sound Effects Synthesizer (Web Audio API) ---
  class SoundManager {
    constructor() {
      this.ctx = null;
      this.enabled = true;
    }

    _init() {
      if (!this.ctx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          this.ctx = new AudioContext();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }

    playHit() {
      this._init();
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(30, t + 0.16);

      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 0.18);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.18);
    }

    playParry() {
      this._init();
      if (!this.ctx) return;
      const t = this.ctx.currentTime;

      // High metallic chime
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';
      osc1.frequency.setValueAtTime(1200, t);
      osc1.frequency.exponentialRampToValueAtTime(540, t + 0.35);

      osc2.frequency.setValueAtTime(2400, t);
      osc2.frequency.exponentialRampToValueAtTime(800, t + 0.35);

      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + 0.38);
      osc2.stop(t + 0.38);
    }

    playWhiff() {
      this._init();
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(80, t + 0.15);

      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.16);
    }

    playDash() {
      this._init();
      if (!this.ctx) return;
      const t = this.ctx.currentTime;

      const bufferSize = this.ctx.sampleRate * 0.12;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(800, t);
      filter.frequency.exponentialRampToValueAtTime(200, t + 0.12);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      noise.start(t);
    }

    playSwing() {
      this._init();
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(380, t);
      osc.frequency.exponentialRampToValueAtTime(110, t + 0.10);

      gain.gain.setValueAtTime(0.18, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.11);
    }

    playVictory() {
      this._init();
      if (!this.ctx) return;
      const notes = [440, 554, 659, 880];
      const startT = this.ctx.currentTime;
      notes.forEach((freq, idx) => {
        const t = startT + idx * 0.10;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + 0.35);
      });
    }

    processEvents(events) {
      if (!events || !events.length) return;
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (ev.type === 'HIT') this.playHit();
        else if (ev.type === 'PARRY_SUCCESS') this.playParry();
        else if (ev.type === 'PARRY_WHIFF') this.playWhiff();
        else if (ev.type === 'DASH') this.playDash();
        else if (ev.type === 'ATTACK_ACTIVE') this.playSwing();
        else if (ev.type === 'ROUND_OVER' && ev.isMatchOver) this.playVictory();
      }
    }
  }

  // --- Main Application Class ---
  class ClashGame {
    constructor() {
      this.canvas = document.getElementById('gameCanvas');
      this.renderer = new ClashRendererModule.ClashRenderer(this.canvas);
      this.input = new ClashInput.InputController();
      this.sound = new SoundManager();
      this.ai = new ClashAIModule.ClashAI('ADAPTIVE');
      this.network = new ClashNetwork.NetworkClient();

      // Opponent Modes: 'AI_ADAPTIVE' | 'AI_MEDIUM' | 'AI_EASY' | 'DUMMY' | 'LOCAL_2P' | 'ONLINE'
      this.opponentMode = 'AI_ADAPTIVE';
      this.isPaused = false;
      this.isTabHidden = false;

      // State is completely separated
      this.state = ClashState.createInitialState();

      // Fixed timestep configuration (60 updates/second)
      this.fixedDt = 1 / 60;
      this.accumulator = 0;
      this.lastTime = performance.now();

      // Reusable simulation input buffers to prevent GC thrashing on mobile
      this._simInputs = { 1: null, 2: null };
      this._idleInput = { moveX: 0, moveY: 0, attack: false, dodge: false, parry: false };

      this._setupUI();
      this._setupOnlineNetworking();
      this._setupTouch();
      this._setupVisibility();
    }

    _setupUI() {
      const modeBtn = document.getElementById('toggleP2ModeBtn');
      const resetBtn = document.getElementById('resetMatchBtn');
      const overlayResetBtn = document.getElementById('overlayPlayAgainBtn');
      const overlayEl = document.getElementById('matchEndOverlay');
      const openOnlineBtn = document.getElementById('openOnlineModalBtn');
      const onlineModal = document.getElementById('onlineModal');
      const closeOnlineBtn = document.getElementById('closeOnlineModalBtn');
      const leaveOnlineBtn = document.getElementById('leaveOnlineBtn');
      const oppDiscReturnBtn = document.getElementById('oppDiscReturnBtn');

      const modeCycle = ['AI_ADAPTIVE', 'AI_MEDIUM', 'AI_EASY', 'DUMMY', 'LOCAL_2P'];
      const modeLabels = {
        'AI_ADAPTIVE': 'OPPONENT: ADAPTIVE AI',
        'AI_MEDIUM': 'OPPONENT: AI (MEDIUM)',
        'AI_EASY': 'OPPONENT: AI (EASY)',
        'DUMMY': 'OPPONENT: STATIC DUMMY',
        'LOCAL_2P': 'OPPONENT: 2-PLAYER DUEL',
      };

      const updateModeBtn = () => {
        if (!modeBtn) return;
        modeBtn.textContent = modeLabels[this.opponentMode] || 'OPPONENT: ' + this.opponentMode;
        modeBtn.classList.toggle('active-2p', this.opponentMode === 'LOCAL_2P');
        modeBtn.classList.toggle('active-ai', this.opponentMode.startsWith('AI'));
      };

      if (modeBtn) {
        updateModeBtn();
        modeBtn.addEventListener('click', () => {
          if (this.opponentMode === 'ONLINE') return;
          const nextIdx = (modeCycle.indexOf(this.opponentMode) + 1) % modeCycle.length;
          this.opponentMode = modeCycle[nextIdx];
          if (this.opponentMode === 'AI_ADAPTIVE') this.ai.setDifficulty('ADAPTIVE');
          else if (this.opponentMode === 'AI_MEDIUM') this.ai.setDifficulty('MEDIUM');
          else if (this.opponentMode === 'AI_EASY') this.ai.setDifficulty('EASY');
          updateModeBtn();
          modeBtn.blur();
        });
      }

      const doReset = () => {
        if (this.opponentMode === 'ONLINE') return;
        this.state = ClashState.createInitialState();
        this.ai.resetRound();
        if (overlayEl) overlayEl.classList.remove('visible');
      };

      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          doReset();
          resetBtn.blur();
        });
      }
      if (overlayResetBtn) {
        overlayResetBtn.addEventListener('click', () => {
          if (this.opponentMode === 'ONLINE') {
            this.leaveOnlineMatch();
          } else {
            doReset();
          }
          overlayResetBtn.blur();
        });
      }

      // Online modal toggle
      if (openOnlineBtn && onlineModal) {
        openOnlineBtn.addEventListener('click', () => {
          this._openOnlineModal();
        });
      }
      if (closeOnlineBtn && onlineModal) {
        closeOnlineBtn.addEventListener('click', () => {
          this._closeOnlineModal();
        });
      }
      if (leaveOnlineBtn) {
        leaveOnlineBtn.addEventListener('click', () => {
          this.leaveOnlineMatch();
        });
      }
      if (oppDiscReturnBtn) {
        oppDiscReturnBtn.addEventListener('click', () => {
          document.getElementById('opponentDisconnectedOverlay')?.classList.remove('visible');
          this.leaveOnlineMatch();
        });
      }

      // Re-focus canvas on click so user never loses keyboard focus
      this.canvas.addEventListener('click', () => {
        window.focus();
        if (document.activeElement && document.activeElement.blur) {
          document.activeElement.blur();
        }
      });

      window.addEventListener('keydown', (e) => {
        if (e.code === 'KeyR' && this.state.mode === 'MATCH_OVER' && this.opponentMode !== 'ONLINE') {
          doReset();
        }
      });
    }

    _openOnlineModal() {
      const modal = document.getElementById('onlineModal');
      const choiceView = document.getElementById('onlineChoiceView');
      const waitingView = document.getElementById('onlineWaitingView');
      const statusMsg = document.getElementById('onlineModalStatus');

      if (modal) modal.classList.add('visible');
      if (choiceView) choiceView.style.display = 'flex';
      if (waitingView) waitingView.style.display = 'none';
      if (statusMsg) statusMsg.textContent = '';
    }

    _closeOnlineModal() {
      const modal = document.getElementById('onlineModal');
      if (modal) modal.classList.remove('visible');
      if (this.network && !this.network.isOnlineMatch) {
        this.network.disconnect();
      }
    }

    _setupOnlineNetworking() {
      const btnCreate = document.getElementById('btnCreateRoom');
      const btnJoin = document.getElementById('btnJoinRoom');
      const joinInput = document.getElementById('joinRoomInput');
      const btnCancel = document.getElementById('btnCancelRoom');
      const choiceView = document.getElementById('onlineChoiceView');
      const waitingView = document.getElementById('onlineWaitingView');
      const displayRoomCode = document.getElementById('displayRoomCode');
      const statusMsg = document.getElementById('onlineModalStatus');

      const serverUrlInput = document.getElementById('serverUrlInput');
      if (serverUrlInput) {
        try {
          const savedUrl = localStorage.getItem('clash_arena_server_url');
          if (savedUrl) {
            serverUrlInput.value = savedUrl;
          } else {
            serverUrlInput.value = this.network._getDefaultServerUrl();
          }
        } catch (e) {}
      }

      const getTargetServerUrl = () => {
        const customUrl = serverUrlInput?.value.trim();
        if (customUrl) {
          try { localStorage.setItem('clash_arena_server_url', customUrl); } catch (e) {}
          return customUrl;
        }
        return undefined;
      };

      // Create Room Button
      if (btnCreate) {
        btnCreate.addEventListener('click', () => {
          if (statusMsg) statusMsg.textContent = 'Connecting to server...';
          const targetUrl = getTargetServerUrl();
          this.network.connect(targetUrl).then(() => {
            if (statusMsg) statusMsg.textContent = '';
            this.network.createRoom();
          }).catch(err => {
            if (statusMsg) statusMsg.textContent = 'Could not connect to game server. Is it running?';
          });
        });
      }

      // Join Room Button
      if (btnJoin && joinInput) {
        btnJoin.addEventListener('click', () => {
          const code = (joinInput.value || '').trim().toUpperCase();
          if (code.length !== 4) {
            if (statusMsg) statusMsg.textContent = 'Please enter a valid 4-letter room code.';
            return;
          }

          if (statusMsg) statusMsg.textContent = 'Connecting to server...';
          const targetUrl = getTargetServerUrl();
          this.network.connect(targetUrl).then(() => {
            if (statusMsg) statusMsg.textContent = 'Joining room ' + code + '...';
            this.network.joinRoom(code);
          }).catch(err => {
            if (statusMsg) statusMsg.textContent = 'Could not connect to game server.';
          });
        });

        joinInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            btnJoin.click();
          }
        });
      }

      // Cancel Room
      if (btnCancel) {
        btnCancel.addEventListener('click', () => {
          this.network.disconnect();
          if (waitingView) waitingView.style.display = 'none';
          if (choiceView) choiceView.style.display = 'flex';
          if (statusMsg) statusMsg.textContent = '';
        });
      }

      // Setup Network Callbacks
      this.network.callbacks.onRoomCreated = (msg) => {
        if (choiceView) choiceView.style.display = 'none';
        if (waitingView) waitingView.style.display = 'block';
        if (displayRoomCode) displayRoomCode.textContent = msg.roomCode;
      };

      this.network.callbacks.onRoomJoined = (msg) => {
        if (statusMsg) statusMsg.textContent = 'Joined room ' + msg.roomCode + '! Starting match...';
      };

      this.network.callbacks.onRoomError = (reason) => {
        if (statusMsg) statusMsg.textContent = reason;
      };

      this.network.callbacks.onMatchStart = (msg) => {
        this._closeOnlineModal();
        this.opponentMode = 'ONLINE';
        this.isPaused = false;

        // Ingest server initial state
        this.state = JSON.parse(JSON.stringify(msg.state));

        // Update Top HUD
        const soloActions = document.getElementById('soloToolbarActions');
        const onlineStatus = document.getElementById('onlineMatchStatus');
        const hudRoom = document.getElementById('hudRoomCode');
        const hudRole = document.getElementById('hudRoleChip');
        const p2Guide = document.getElementById('p2GuideSection');

        if (soloActions) soloActions.style.display = 'none';
        if (onlineStatus) onlineStatus.style.display = 'flex';
        if (hudRoom) hudRoom.textContent = msg.roomCode;
        if (hudRole) {
          hudRole.textContent = `YOU: P${msg.playerRole} (${msg.playerRole === 1 ? 'CYAN' : 'CRIMSON'})`;
          hudRole.style.color = msg.playerRole === 1 ? 'var(--cyan)' : 'var(--crimson)';
        }
        if (p2Guide) p2Guide.style.display = 'none';
      };

      // Server Events & State Reconciliation
      this.network.callbacks.onEvents = (events) => {
        if (this.opponentMode !== 'ONLINE') return;
        this.sound.processEvents(events);
        this.renderer.processEvents(events);
      };

      this.network.callbacks.onStateUpdate = (serverState, unackedInputs) => {
        if (this.opponentMode !== 'ONLINE') return;

        // Process any events on the server state
        if (serverState.events && serverState.events.length) {
          this.sound.processEvents(serverState.events);
          this.renderer.processEvents(serverState.events);
        }

        // Snap client to authoritative server state directly (NO redundant JSON stringify/parse!)
        this.state = serverState;

        // Replay unacknowledged local inputs on top of authoritative state
        const myId = this.network.playerId;
        for (let i = 0; i < unackedInputs.length; i++) {
          const replayPacket = unackedInputs[i];
          this._simInputs[1] = myId === 1 ? replayPacket.input : this._idleInput;
          this._simInputs[2] = myId === 2 ? replayPacket.input : this._idleInput;
          ClashSimulation.update(this.state, this._simInputs, replayPacket.dt);
        }
      };

      // Disconnect / Pause Handlers (Phase 6.5)
      this.network.callbacks.onMatchPaused = (msg) => {
        this.isPaused = true;
        const pauseOverlay = document.getElementById('onlinePauseOverlay');
        const reasonText = document.getElementById('pauseReasonText');
        if (reasonText) reasonText.textContent = msg.reason || 'Opponent disconnected. Grace period active (5s)...';
        if (pauseOverlay) pauseOverlay.classList.add('visible');
      };

      this.network.callbacks.onMatchResumed = (msg) => {
        this.isPaused = false;
        const pauseOverlay = document.getElementById('onlinePauseOverlay');
        if (pauseOverlay) pauseOverlay.classList.remove('visible');
        if (msg.state) {
          this.state = JSON.parse(JSON.stringify(msg.state));
        }
      };

      this.network.callbacks.onOpponentDisconnected = (msg) => {
        // Freeze the match cleanly
        this.isPaused = false;
        this.state.mode = 'MATCH_OVER';
        this.state.match.isOver = true;
        this.state.match.winnerId = this.network.playerId;

        document.getElementById('onlinePauseOverlay')?.classList.remove('visible');
        const oppDiscOverlay = document.getElementById('opponentDisconnectedOverlay');
        const oppDiscSubtitle = document.getElementById('oppDiscSubtitle');
        if (oppDiscSubtitle) {
          oppDiscSubtitle.textContent = msg.reason || 'Opponent disconnected permanently. Victory awarded!';
        }
        if (oppDiscOverlay) {
          oppDiscOverlay.classList.add('visible');
        }
      };

      this.network.callbacks.onPingUpdate = (pingMs) => {
        const hudPing = document.getElementById('hudPing');
        const pingDot = document.getElementById('pingDot');
        if (hudPing) hudPing.textContent = `${pingMs} ms`;
        if (pingDot) {
          pingDot.classList.toggle('amber', pingMs > 70 && pingMs <= 150);
          pingDot.classList.toggle('red', pingMs > 150);
        }
      };

      this.network.callbacks.onConnectionLost = (attempt, max) => {
        if (this.opponentMode === 'ONLINE' && !this.state.match.isOver) {
          const pauseOverlay = document.getElementById('onlinePauseOverlay');
          const reasonText = document.getElementById('pauseReasonText');
          if (reasonText) {
            reasonText.textContent = `Connection lost. Reconnecting attempt ${attempt}/${max}...`;
          }
          if (pauseOverlay) pauseOverlay.classList.add('visible');
        }
      };
    }

    leaveOnlineMatch() {
      this.network.disconnect();
      this.opponentMode = 'AI_ADAPTIVE';
      this.isPaused = false;
      this.state = ClashState.createInitialState();
      this.ai.resetRound();

      // Restore UI elements
      document.getElementById('onlinePauseOverlay')?.classList.remove('visible');
      document.getElementById('opponentDisconnectedOverlay')?.classList.remove('visible');
      document.getElementById('matchEndOverlay')?.classList.remove('visible');

      const soloActions = document.getElementById('soloToolbarActions');
      const onlineStatus = document.getElementById('onlineMatchStatus');
      const p2Guide = document.getElementById('p2GuideSection');
      const modeBtn = document.getElementById('toggleP2ModeBtn');

      if (soloActions) soloActions.style.display = 'flex';
      if (onlineStatus) onlineStatus.style.display = 'none';
      if (p2Guide) p2Guide.style.display = 'flex';
      if (modeBtn) {
        modeBtn.textContent = 'OPPONENT: ADAPTIVE AI';
        modeBtn.classList.add('active-ai');
        modeBtn.classList.remove('active-2p');
      }
    }

    _setupTouch() {
      const stickZone = document.getElementById('touchStickZone');
      const stickThumb = document.getElementById('touchStickThumb');
      const btnAtk = document.getElementById('btnTouchAttack');
      const btnDodge = document.getElementById('btnTouchDodge');
      const btnParry = document.getElementById('btnTouchParry');

      if (!stickZone) return;

      const onTouchStart = (e) => {
        e.preventDefault();
        const touch = e.changedTouches[0];
        this.input.touchStick.active = true;
        this.input.touchStick.identifier = touch.identifier;
        const rect = stickZone.getBoundingClientRect();
        this.input.touchStick.startX = rect.left + rect.width * 0.5;
        this.input.touchStick.startY = rect.top + rect.height * 0.5;
        this.input.touchStick.currX = touch.clientX;
        this.input.touchStick.currY = touch.clientY;
        this._updateThumb(stickThumb);
      };

      const onTouchMove = (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const touch = e.changedTouches[i];
          if (touch.identifier === this.input.touchStick.identifier) {
            this.input.touchStick.currX = touch.clientX;
            this.input.touchStick.currY = touch.clientY;
            this._updateThumb(stickThumb);
            break;
          }
        }
      };

      const onTouchEnd = (e) => {
        e.preventDefault();
        this.input.touchStick.active = false;
        this.input.touchStick.currX = this.input.touchStick.startX;
        this.input.touchStick.currY = this.input.touchStick.startY;
        if (stickThumb) {
          stickThumb.style.transform = 'translate(-50%, -50%)';
        }
      };

      stickZone.addEventListener('touchstart', onTouchStart, { passive: false });
      stickZone.addEventListener('touchmove', onTouchMove, { passive: false });
      stickZone.addEventListener('touchend', onTouchEnd, { passive: false });
      stickZone.addEventListener('touchcancel', onTouchEnd, { passive: false });

      if (btnAtk) {
        btnAtk.addEventListener('touchstart', (e) => {
          e.preventDefault();
          this.input.touchButtons.attack = true;
        });
      }
      if (btnDodge) {
        btnDodge.addEventListener('touchstart', (e) => {
          e.preventDefault();
          this.input.touchButtons.dodge = true;
        });
      }
      if (btnParry) {
        btnParry.addEventListener('touchstart', (e) => {
          e.preventDefault();
          this.input.touchButtons.parry = true;
        });
      }
    }

    _updateThumb(thumb) {
      if (!thumb) return;
      const dx = this.input.touchStick.currX - this.input.touchStick.startX;
      const dy = this.input.touchStick.currY - this.input.touchStick.startY;
      const dist = Math.hypot(dx, dy);
      const max = this.input.touchStick.maxDist;
      const angle = Math.atan2(dy, dx);
      const clampedDist = Math.min(dist, max);
      const cx = Math.cos(angle) * clampedDist;
      const cy = Math.sin(angle) * clampedDist;
      thumb.style.transform = `translate(calc(-50% + ${cx}px), calc(-50% + ${cy}px))`;
    }

    _setupVisibility() {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.isTabHidden = true;
        } else {
          this.isTabHidden = false;
          this.lastTime = performance.now();
          this.accumulator = 0;
        }
      });
    }

    start() {
      const loop = (currentTime) => {
        requestAnimationFrame(loop);

        if (this.isTabHidden) {
          this.lastTime = currentTime;
          return;
        }

        let wallDt = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;

        // Prevent spiral of death on tab blur / lag spike
        if (wallDt > 0.08) wallDt = 0.08;

        // Micro-freeze for parry impact: smooth time-dilation
        let simDt = wallDt;
        if (this.renderer.freezeTimer > 0) {
          this.renderer.freezeTimer -= wallDt;
          simDt = wallDt * 0.15;
        }

        // When paused for network reconnect grace, freeze accumulator
        if (this.isPaused) {
          this.renderer.render(this.state, wallDt);
          return;
        }

        this.accumulator += simDt;

        // 1. Poll inputs
        const inputs = this.input.poll();
        let didTick = false;

        // 2. Fixed-timestep simulation step
        while (this.accumulator >= this.fixedDt) {
          didTick = true;

          if (this.opponentMode === 'ONLINE') {
            // ONLINE MODE: Send local input over network & run local prediction
            const myInput = inputs[1]; // P1 keys (WASD/touch) always control local player
            this.network.sendInput(myInput, this.fixedDt);

            const myId = this.network.playerId;
            this._simInputs[1] = myId === 1 ? myInput : this._idleInput;
            this._simInputs[2] = myId === 2 ? myInput : this._idleInput;

            ClashSimulation.update(this.state, this._simInputs, this.fixedDt);
            // In online mode, sound/events are also triggered from authoritative updates
          } else {
            // OFFLINE MODES: AI, Dummy, or Local 2-Player
            if (this.opponentMode.startsWith('AI')) {
              inputs[2] = this.ai.update(this.state, this.fixedDt);
            } else if (this.opponentMode === 'DUMMY') {
              inputs[2] = { moveX: 0, moveY: 0, attack: false, dodge: false, parry: false };
            }

            ClashSimulation.update(this.state, inputs, this.fixedDt);
            this.sound.processEvents(this.state.events);
            this.renderer.processEvents(this.state.events);
            this.state.events = []; // Ingested once, never re-triggered
          }

          this.accumulator -= this.fixedDt;
        }

        // Consume one-shot input triggers ONLY when the simulation actually ticked
        if (didTick) {
          this.input.postUpdate();
        }

        // Opponent Entity Interpolation (smooth network movement rendering)
        if (this.opponentMode === 'ONLINE') {
          const oppInterp = this.network.getInterpolatedOpponent();
          if (oppInterp) {
            const oppIdx = this.network.playerId === 1 ? 1 : 0;
            const opp = this.state.players[oppIdx];
            if (opp) {
              opp.pos.x = oppInterp.pos.x;
              opp.pos.y = oppInterp.pos.y;
              opp.facing = oppInterp.facing;
            }
          }
        }

        // 3. Render pass (reads state, never mutates)
        this.renderer.render(this.state, wallDt);

        // Update Match End DOM Overlay
        const overlayEl = document.getElementById('matchEndOverlay');
        const overlayText = document.getElementById('overlayWinnerText');
        const overlaySub = document.getElementById('overlaySubtitle');
        if (overlayEl && overlayText) {
          if (this.state.mode === 'MATCH_OVER') {
            overlayEl.classList.add('visible');
            const p1Won = this.state.match.winnerId === 1;
            if (this.opponentMode === 'ONLINE') {
              const isWinner = this.state.match.winnerId === this.network.playerId;
              overlayText.textContent = isWinner ? 'VICTORY!' : 'DEFEAT!';
              overlayText.style.color = isWinner ? 'var(--cyan)' : 'var(--crimson)';
              if (overlaySub) overlaySub.textContent = isWinner ? 'You won the match!' : 'Opponent claimed match victory.';
            } else {
              overlayText.textContent = p1Won ? 'PLAYER 1 WINS!' : 'PLAYER 2 WINS!';
              overlayText.style.color = p1Won ? '#00f0ff' : '#ff2a6d';
              if (overlaySub) overlaySub.textContent = 'First to 4 round victories achieved.';
            }
          } else {
            overlayEl.classList.remove('visible');
          }
        }
      };

      requestAnimationFrame(loop);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    const game = new ClashGame();
    game.start();
    window.gameInstance = game;
  });

})();
