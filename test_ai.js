const assert = require('assert');
const ClashState = require('./state.js');
const ClashSimulation = require('./simulation.js');
const ClashAIModule = require('./ai.js');

console.log("=== CLASH ARENA: AI OPPONENT TEST SUITE ===");

// Test 1: AI produces valid PlayerInput format
{
  const ai = new ClashAIModule.ClashAI('ADAPTIVE');
  const state = ClashState.createInitialState();
  const input = ai.update(state, 1 / 60);

  assert(typeof input.moveX === 'number', 'moveX must be number');
  assert(typeof input.moveY === 'number', 'moveY must be number');
  assert(typeof input.attack === 'boolean', 'attack must be boolean');
  assert(typeof input.dodge === 'boolean', 'dodge must be boolean');
  assert(typeof input.parry === 'boolean', 'parry must be boolean');
  console.log("✔ Test 1 passed: AI produces valid PlayerInput format.");
}

// Test 2: AI punishes Whiff / Stunned state
{
  const ai = new ClashAIModule.ClashAI('ADAPTIVE');
  const state = ClashState.createInitialState();
  // Put P1 right in front of P2 in PARRY_RECOVERY (vulnerable)
  state.players[0].pos = { x: 630, y: 300 }; // ~70px away from P2 (700, 300)
  state.players[0].actionState = 'PARRY_RECOVERY';
  state.players[0].actionTimer = 0.40;

  const input = ai.update(state, 1 / 60);
  assert.strictEqual(input.attack, true, 'AI must immediately strike to punish whiff recovery');
  console.log("✔ Test 2 passed: AI punishes opponent in whiff recovery.");
}

// Test 3: AI Defensive Reaction to Incoming Attack
{
  const ai = new ClashAIModule.ClashAI('ADAPTIVE');
  const state = ClashState.createInitialState();
  // P1 close to P2 in late WINDUP
  state.players[0].pos = { x: 630, y: 300 };
  state.players[0].facing = { x: 1, y: 0 };
  state.players[0].actionState = 'WINDUP';
  state.players[0].actionTimer = 0.02; // late windup
  state.players[0].actionProgress = 0.95;

  let reacted = false;
  // Over a few ticks, AI should attempt a parry or dodge
  for (let i = 0; i < 5; i++) {
    const input = ai.update(state, 1 / 60);
    if (input.parry || input.dodge) {
      reacted = true;
      break;
    }
  }
  assert(reacted, 'AI must react with parry or dodge against close incoming strike');
  console.log("✔ Test 3 passed: AI defensive reaction against incoming strike.");
}

// Test 4: Habit Tracker registers player patterns
{
  const ai = new ClashAIModule.ClashAI('ADAPTIVE');
  const state = ClashState.createInitialState();
  state.events = [
    { type: 'ATTACK_WINDUP', playerId: 1 },
    { type: 'PARRY_INIT', playerId: 1 },
    { type: 'PARRY_WHIFF', playerId: 1 },
  ];
  ai.update(state, 1 / 60);

  assert.strictEqual(ai.habits.attackAttempts, 1);
  assert.strictEqual(ai.habits.parryAttempts, 1);
  assert.strictEqual(ai.habits.whiffsCount, 1);
  console.log("✔ Test 4 passed: AI habit tracking registers player combat actions.");
}

console.log("\nALL AI TESTS PASSED 100%!");
