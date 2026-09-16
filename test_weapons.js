/**
 * Clash Arena — Weapon Archetypes Automated Test Suite
 * Validates Bow, Shotgun, and Bomb deterministic simulation behavior.
 */

const assert = require('assert');
const ClashState = require('./state.js');
const ClashSimulation = require('./simulation.js');

const { CONSTANTS, ActionState, createInitialState } = ClashState;
const { update } = ClashSimulation;

const DT = 1 / 60; // 60Hz tick

function simulateTicks(state, inputs, count) {
  for (let i = 0; i < count; i++) {
    update(state, inputs, DT);
  }
}

console.log('=== CLASH ARENA: WEAPON EXPANSION TEST SUITE ===\n');

// Test 1: Bow Projectile Flight and Long-Range Hit
{
  console.log('[Test 1] Testing Bow projectile flight and clean hit at distance...');
  const state = createInitialState(1000, 600);
  const p1 = state.players[0];
  const p2 = state.players[1];

  // Set P1 to Bow, position at x=300, facing right
  p1.weapon = 'BOW';
  p1.pos.x = 300;
  p1.pos.y = 300;
  p1.facing = { x: 1, y: 0 };

  // Set P2 at x=550 (dist = 250px, well outside 40px point-blank range)
  p2.weapon = 'SPEAR';
  p2.pos.x = 550;
  p2.pos.y = 300;
  p2.facing = { x: -1, y: 0 };

  const startHitsTaken = p2.hitsTaken;

  // P1 triggers attack on tick 1
  update(state, { 1: { attack: true }, 2: {} }, DT);
  assert.strictEqual(p1.actionState, ActionState.WINDUP, 'P1 should enter WINDUP');

  // Bow windup is 0.38s (~23 ticks). Simulate 24 ticks for projectile to spawn
  simulateTicks(state, {}, 24);
  assert.strictEqual(p1.actionState, ActionState.ACTIVE, 'P1 should reach ACTIVE state');
  assert.strictEqual(state.projectiles.length, 1, 'Arrow entity should be spawned');
  assert.strictEqual(state.projectiles[0].ownerId, 1, 'Arrow owner should be P1');

  // Arrow travels at 640 px/s. Distance ~220px to reach P2 (radius 22). Takes ~0.35s (~21 ticks).
  let hitDetected = false;
  for (let t = 0; t < 35; t++) {
    update(state, {}, DT);
    const hitEv = state.events.find(e => e.type === 'HIT' && e.weapon === 'BOW');
    if (hitEv) {
      hitDetected = true;
      break;
    }
  }

  assert.strictEqual(hitDetected, true, 'Bow projectile should register a clean HIT');
  assert.strictEqual(p2.hitsTaken, startHitsTaken + 1, 'P2 hitsTaken should increment by 1');
  assert.strictEqual(state.projectiles.length, 0, 'Arrow should be removed after hit');
  console.log('✔ Test 1 Passed: Bow fires arrow and hits opponent cleanly at range.\n');
}

// Test 2: Bow Point-Blank Weakness (Arrow Glances at < 40px)
{
  console.log('[Test 2] Testing Bow point-blank weakness (glance < 40px)...');
  const state = createInitialState(1000, 600);
  const p1 = state.players[0];
  const p2 = state.players[1];

  p1.weapon = 'BOW';
  p1.pos.x = 300;
  p1.pos.y = 300;
  p1.facing = { x: 1, y: 0 };

  // Set P2 immediately in front of P1: distance = 55px (< 75px minEffectiveRange)
  p2.weapon = 'SPEAR';
  p2.pos.x = 355;
  p2.pos.y = 300;
  p2.facing = { x: -1, y: 0 };

  const startHitsTaken = p2.hitsTaken;

  // Trigger attack and wait for release and collision
  update(state, { 1: { attack: true }, 2: {} }, DT);
  let glanceDetected = false;
  for (let t = 0; t < 35; t++) {
    update(state, {}, DT);
    if (state.events.some(e => e.type === 'PROJECTILE_GLANCE')) {
      glanceDetected = true;
      break;
    }
  }

  assert.strictEqual(glanceDetected, true, 'PROJECTILE_GLANCE event should be emitted at point-blank');
  assert.strictEqual(p2.hitsTaken, startHitsTaken, 'Target should NOT take damage on glance');
  assert.strictEqual(state.projectiles.length, 0, 'Arrow should fizzle out on glance');
  console.log('✔ Test 2 Passed: Point-blank shot harmlessly glances off target.\n');
}

// Test 3: Bow vs Dodge i-frames (Arrow Deflected/Passed)
{
  console.log('[Test 3] Testing Bow vs Dodge invulnerability frames...');
  const state = createInitialState(1000, 600);
  const p1 = state.players[0];
  const p2 = state.players[1];

  p1.weapon = 'BOW';
  p1.pos.x = 300;
  p1.pos.y = 300;
  p1.facing = { x: 1, y: 0 };

  p2.weapon = 'SPEAR';
  p2.pos.x = 500;
  p2.pos.y = 300;
  p2.facing = { x: -1, y: 0 };

  const startHitsTaken = p2.hitsTaken;

  // P1 initiates attack
  update(state, { 1: { attack: true }, 2: {} }, DT);

  // Simulate until arrow spawns (~24 ticks)
  simulateTicks(state, {}, 23);

  // Projectile is flying toward P2. P2 dodges as arrow approaches
  let dodgedDetected = false;
  for (let t = 0; t < 25; t++) {
    update(state, { 1: {}, 2: { dodge: true } }, DT);
    if (state.events.some(e => e.type === 'ATTACK_DODGED')) {
      dodgedDetected = true;
      break;
    }
  }

  assert.strictEqual(dodgedDetected, true, 'ATTACK_DODGED event should fire on dodging arrow');
  assert.strictEqual(p2.hitsTaken, startHitsTaken, 'Dodge should prevent any hit from landing');
  console.log('✔ Test 3 Passed: Dodge invulnerability frames successfully evade incoming arrow.\n');
}

// Test 4: Bow vs Parry Interception & Archer Shockwave Stun
{
  console.log('[Test 4] Testing Bow projectile parry interception and shockwave stun...');
  const state = createInitialState(1000, 600);
  const p1 = state.players[0];
  const p2 = state.players[1];

  p1.weapon = 'BOW';
  p1.pos.x = 300;
  p1.pos.y = 300;
  p1.facing = { x: 1, y: 0 };

  // Place P2 at 120px (< 160px shockwave radius)
  p2.weapon = 'SPEAR';
  p2.pos.x = 420;
  p2.pos.y = 300;
  p2.facing = { x: -1, y: 0 };

  // P1 charges bow
  update(state, { 1: { attack: true }, 2: {} }, DT);
  simulateTicks(state, {}, 23); // Arrow about to spawn or just spawned

  // Arrow is in flight. P2 initiates parry right as arrow arrives
  let parryDetected = false;
  for (let t = 0; t < 20; t++) {
    update(state, { 1: {}, 2: { parry: true } }, DT);
    const parryEv = state.events.find(e => e.type === 'PARRY_SUCCESS' && e.isProjectile);
    if (parryEv) {
      parryDetected = true;
      break;
    }
  }

  assert.strictEqual(parryDetected, true, 'Arrow should be parried with PARRY_SUCCESS');
  assert.strictEqual(p2.actionState, ActionState.IDLE, 'Defender returns to IDLE immediately');
  assert.strictEqual(p1.actionState, ActionState.STUNNED, 'Archer within 160px shockwave should be STUNNED');
  assert.strictEqual(state.projectiles.length, 0, 'Arrow should be destroyed on parry');
  console.log('✔ Test 4 Passed: Parry intercepts arrow cleanly and stuns close archer.\n');
}

// Test 5: Shotgun Burst Melee Profile
{
  console.log('[Test 5] Testing Shotgun burst-melee timing and combat...');
  const state = createInitialState(1000, 600);
  const p1 = state.players[0];
  const p2 = state.players[1];

  p1.weapon = 'SHOTGUN';
  p1.pos.x = 300;
  p1.pos.y = 300;
  p1.facing = { x: 1, y: 0 };

  p2.weapon = 'SPEAR';
  p2.pos.x = 340;
  p2.pos.y = 300;
  p2.facing = { x: -1, y: 0 };

  // Shotgun windup is very fast (0.12s ~ 7-8 ticks)
  update(state, { 1: { attack: true }, 2: {} }, DT);
  assert.strictEqual(p1.actionState, ActionState.WINDUP);

  simulateTicks(state, {}, 8);
  assert.strictEqual(p1.actionState, ActionState.ACTIVE, 'Shotgun enters ACTIVE quickly (0.12s)');

  // Advance 1 tick to register hit
  update(state, {}, DT);
  assert.strictEqual(p2.hitsTaken, 1, 'Shotgun should land clean burst hit');

  // Shotgun recovery is long (0.42s ~ 25 ticks)
  simulateTicks(state, {}, 6); // finish ACTIVE (0.08s)
  assert.strictEqual(p1.actionState, ActionState.RECOVERY, 'Shotgun enters RECOVERY');
  assert(p1.actionTimer > 0.30, 'Shotgun recovery is deliberately heavy/punishable');
  console.log('✔ Test 5 Passed: Shotgun exhibits rapid blast and heavy recovery.\n');
}

// Test 6: Bomb Hazard AoE & Unparryable Detonation
{
  console.log('[Test 6] Testing Bomb hazard AoE and unparryable detonation...');
  const state = createInitialState(1000, 600);
  const p1 = state.players[0];
  const p2 = state.players[1];

  p1.weapon = 'BOMB';
  p1.pos.x = 300;
  p1.pos.y = 300;
  p1.facing = { x: 1, y: 0 };

  // Bomb throw distance is 175px -> target ~475px
  p2.weapon = 'SPEAR';
  p2.pos.x = 475;
  p2.pos.y = 300;
  p2.facing = { x: -1, y: 0 };

  // Trigger bomb throw
  update(state, { 1: { attack: true }, 2: {} }, DT);
  // Bomb windup is 0.30s (~18 ticks)
  simulateTicks(state, {}, 19);

  assert.strictEqual(state.hazards.length, 1, 'Bomb hazard entity should spawn on field');
  assert.strictEqual(state.hazards[0].type, 'BOMB');

  // Bomb fuse time is 0.75s (~45 ticks). Simulate 42 ticks
  simulateTicks(state, {}, 42);

  // During detonation, P2 tries to parry. Bomb is unparryable!
  let bombHitDetected = false;
  for (let t = 0; t < 10; t++) {
    update(state, { 1: {}, 2: { parry: true } }, DT);
    if (state.events.some(e => e.type === 'HIT' && e.weapon === 'BOMB')) {
      bombHitDetected = true;
      break;
    }
  }

  assert.strictEqual(bombHitDetected, true, 'Bomb explosion hits target even through PARRY');
  assert.strictEqual(p2.hitsTaken, 1, 'P2 takes 1 hit from bomb detonation');
  assert.strictEqual(state.hazards.length, 0, 'Hazard entity cleans up after detonation');
  console.log('✔ Test 6 Passed: Bomb explodes and penetrates parry as an AoE hazard.\n');
}

console.log('==============================================');
console.log('ALL WEAPON EXPANSION TESTS PASSED 100%!');
console.log('==============================================');
