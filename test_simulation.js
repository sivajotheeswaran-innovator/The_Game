const assert = require('assert');
const ClashState = require('./state.js');
const ClashSimulation = require('./simulation.js');

console.log("=== CLASH ARENA: SIMULATION TEST SUITE ===");

// Test 1: State is pure JSON serializable
{
  const state = ClashState.createInitialState();
  const json = JSON.stringify(state);
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.players.length, 2);
  assert.strictEqual(parsed.round.number, 1);
  console.log("✔ Test 1 passed: State is 100% pure JSON serializable data.");
}

// Test 2: Movement and Arena Boundary Clamping
{
  const state = ClashState.createInitialState();
  // Move P1 left into the wall for 5 seconds
  for (let i = 0; i < 300; i++) {
    ClashSimulation.update(state, { 1: { moveX: -1, moveY: 0, attack: false, dodge: false, parry: false } }, 1 / 60);
  }
  const minX = state.arena.minX;
  assert(state.players[0].pos.x >= minX, `P1 pos.x (${state.players[0].pos.x}) should be clamped at minX (${minX})`);
  console.log("✔ Test 2 passed: Movement and arena wall clamping.");
}

// Test 3: Attack State Machine Cycle (Windup -> Active -> Recovery -> Idle)
{
  const state = ClashState.createInitialState();
  // Far apart so no hit happens
  state.players[0].pos = { x: 100, y: 100 };
  state.players[1].pos = { x: 800, y: 800 };

  // Trigger attack
  ClashSimulation.update(state, { 1: { moveX: 0, moveY: 0, attack: true, dodge: false, parry: false } }, 1 / 60);
  assert.strictEqual(state.players[0].actionState, 'WINDUP');

  // Step through windup (~0.22s)
  for (let i = 0; i < 15; i++) {
    ClashSimulation.update(state, {}, 1 / 60);
  }
  assert.strictEqual(state.players[0].actionState, 'ACTIVE');

  // Step through active (~0.10s)
  for (let i = 0; i < 8; i++) {
    ClashSimulation.update(state, {}, 1 / 60);
  }
  assert.strictEqual(state.players[0].actionState, 'RECOVERY');

  // Step through recovery (~0.28s)
  for (let i = 0; i < 20; i++) {
    ClashSimulation.update(state, {}, 1 / 60);
  }
  assert.strictEqual(state.players[0].actionState, 'IDLE');
  console.log("✔ Test 3 passed: Attack state machine cycle (Windup -> Active -> Recovery -> Idle).");
}

// Test 4: Parry Edge Cases
// 4A: Parry meets active attack -> Attacker is STUNNED, Defender recovers to IDLE
{
  const state = ClashState.createInitialState();
  // Position P1 and P2 close facing each other
  state.players[0].pos = { x: 400, y: 300 };
  state.players[0].facing = { x: 1, y: 0 };
  state.players[1].pos = { x: 450, y: 300 };
  state.players[1].facing = { x: -1, y: 0 };

  // P1 attacks -> enters WINDUP
  ClashSimulation.update(state, { 1: { moveX: 0, moveY: 0, attack: true, dodge: false, parry: false } }, 1 / 60);
  assert.strictEqual(state.players[0].actionState, 'WINDUP');

  // Step through windup until just before active
  while (state.players[0].actionTimer > 0.04) {
    ClashSimulation.update(state, {}, 1 / 60);
  }

  // P2 parries into the incoming swing
  ClashSimulation.update(state, { 2: { moveX: 0, moveY: 0, attack: false, dodge: false, parry: true } }, 1 / 60);
  assert.strictEqual(state.players[1].actionState, 'PARRY_ACTIVE', "P2 should be in PARRY_ACTIVE");

  // Step until P1 swings into the parry
  while (state.players[0].actionState === 'WINDUP') {
    ClashSimulation.update(state, {}, 1 / 60);
  }

  // Next frame resolves combat collision
  ClashSimulation.update(state, {}, 1 / 60);

  assert.strictEqual(state.players[0].actionState, 'STUNNED', "Attacker must be STUNNED");
  assert.strictEqual(state.players[1].actionState, 'IDLE', "Parrier must recover immediately to IDLE");
  assert.strictEqual(state.players[1].hitsTaken, 0, "Parrier must take 0 hits");
  console.log("✔ Test 4A passed: Parry meets active attack -> Attacker STUNNED, Defender IDLE.");
}

// 4B: Parry with NO incoming attack -> Whiff -> PARRY_RECOVERY
{
  const state = ClashState.createInitialState();
  // Far apart, no attack
  state.players[0].pos = { x: 100, y: 100 };
  state.players[1].pos = { x: 800, y: 800 };

  // P1 triggers parry
  ClashSimulation.update(state, { 1: { moveX: 0, moveY: 0, attack: false, dodge: false, parry: true } }, 1 / 60);
  assert.strictEqual(state.players[0].actionState, 'PARRY_ACTIVE');

  // Step through parry window (~0.14s)
  for (let i = 0; i < 10; i++) {
    ClashSimulation.update(state, {}, 1 / 60);
  }
  assert.strictEqual(state.players[0].actionState, 'PARRY_RECOVERY', "Whiffed parry must enter PARRY_RECOVERY");
  console.log("✔ Test 4B passed: Whiffed parry enters punishing PARRY_RECOVERY.");
}

// 4C: Simultaneous parry -> Both whiff -> Both enter PARRY_RECOVERY
{
  const state = ClashState.createInitialState();
  ClashSimulation.update(state, {
    1: { moveX: 0, moveY: 0, attack: false, dodge: false, parry: true },
    2: { moveX: 0, moveY: 0, attack: false, dodge: false, parry: true }
  }, 1 / 60);

  assert.strictEqual(state.players[0].actionState, 'PARRY_ACTIVE');
  assert.strictEqual(state.players[1].actionState, 'PARRY_ACTIVE');

  for (let i = 0; i < 10; i++) {
    ClashSimulation.update(state, {}, 1 / 60);
  }
  assert.strictEqual(state.players[0].actionState, 'PARRY_RECOVERY');
  assert.strictEqual(state.players[1].actionState, 'PARRY_RECOVERY');
  console.log("✔ Test 4C passed: Simultaneous parry causes both to enter PARRY_RECOVERY.");
}

// 4D: Parry during opponent's WINDUP -> Whiff
{
  const state = ClashState.createInitialState();
  state.players[0].pos = { x: 400, y: 300 };
  state.players[0].facing = { x: 1, y: 0 };
  state.players[1].pos = { x: 450, y: 300 };
  state.players[1].facing = { x: -1, y: 0 };

  // P1 starts attack (WINDUP)
  ClashSimulation.update(state, { 1: { moveX: 0, moveY: 0, attack: true, dodge: false, parry: false } }, 1 / 60);
  assert.strictEqual(state.players[0].actionState, 'WINDUP');

  // P2 parries too early (during windup)
  ClashSimulation.update(state, { 2: { moveX: 0, moveY: 0, attack: false, dodge: false, parry: true } }, 1 / 60);
  assert.strictEqual(state.players[1].actionState, 'PARRY_ACTIVE');

  // P2's parry window expires before P1 enters active
  for (let i = 0; i < 9; i++) {
    ClashSimulation.update(state, {}, 1 / 60);
  }
  assert.strictEqual(state.players[1].actionState, 'PARRY_RECOVERY', "Early parry during windup must whiff!");
  console.log("✔ Test 4D passed: Parry during windup whiffs and punishes early reaction.");
}

// 4E: Dash i-frames avoid active attack
{
  const state = ClashState.createInitialState();
  state.players[0].pos = { x: 400, y: 300 };
  state.players[0].facing = { x: 1, y: 0 };
  state.players[1].pos = { x: 450, y: 300 };
  state.players[1].facing = { x: -1, y: 0 };

  // P1 enters WINDUP
  ClashSimulation.update(state, { 1: { moveX: 0, moveY: 0, attack: true, dodge: false, parry: false } }, 1 / 60);
  assert.strictEqual(state.players[0].actionState, 'WINDUP');

  // Step through windup until right before active
  while (state.players[0].actionTimer > 0.05) {
    ClashSimulation.update(state, {}, 1 / 60);
  }

  // P2 reacts and initiates DASH (i-frames active)
  ClashSimulation.update(state, { 2: { moveX: 1, moveY: 0, attack: false, dodge: true, parry: false } }, 1 / 60);
  assert.strictEqual(state.players[1].actionState, 'DASH');
  assert.strictEqual(state.players[1].isInvulnerable, true);

  // P1 transitions to ACTIVE and swings
  while (state.players[0].actionState === 'WINDUP') {
    ClashSimulation.update(state, {}, 1 / 60);
  }
  ClashSimulation.update(state, {}, 1 / 60); // ACTIVE frame connects

  assert.strictEqual(state.players[1].hitsTaken, 0, "I-frame dodge must negate attack damage");
  console.log("✔ Test 4E passed: Dash i-frames evade attack damage.");
}

// Test 5: Round & Match rules (First to 3 hits wins round, first to 4 round wins wins match)
{
  const state = ClashState.createInitialState();
  state.players[0].pos = { x: 400, y: 300 };
  state.players[1].pos = { x: 450, y: 300 };

  // P1 lands 3 hits on P2
  for (let hit = 1; hit <= 3; hit++) {
    // Attack
    ClashSimulation.update(state, { 1: { attack: true } }, 1 / 60);
    while (state.players[0].actionState === 'WINDUP') {
      ClashSimulation.update(state, {}, 1 / 60);
    }
    ClashSimulation.update(state, {}, 1 / 60); // ACTIVE connects
    while (state.players[0].actionState !== 'IDLE' && state.mode === 'PLAYING') {
      ClashSimulation.update(state, {}, 1 / 60);
    }
  }

  assert.strictEqual(state.mode, 'ROUND_OVER', "Round must be over after 3 hits");
  assert.strictEqual(state.round.winnerId, 1, "P1 must win the round");
  assert.strictEqual(state.match.winsP1, 1, "Match tally for P1 must be 1");
  console.log("✔ Test 5 passed: Round and Match scoring logic.");
}

console.log("\nALL SIMULATION TESTS PASSED 100%!");
