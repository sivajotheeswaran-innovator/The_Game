/**
 * Automated Verification Script for graphics-quality-presets-spec.md
 */

const assert = require('assert');
const fs = require('fs');
const { GRAPHICS_PRESETS, ClashRenderer } = require('./renderer.js');

console.log('=== GRAPHICS QUALITY PRESETS AUDIT ===\n');

// Check 1: All 4 presets defined
const expectedKeys = ['SMOOTH', 'MAX', 'ULTRA', 'ULTRA_MAX'];
assert.deepStrictEqual(Object.keys(GRAPHICS_PRESETS), expectedKeys, 'Must have exactly the 4 defined tiers');
console.log('✔ Check 1 Passed: Exactly 4 presets defined (Smooth, Max, Ultra, Ultra Max).');

// Check 2: Parameter table matches spec
assert.strictEqual(GRAPHICS_PRESETS.SMOOTH.dprCap, 1.0);
assert.strictEqual(GRAPHICS_PRESETS.SMOOTH.glowLevel, 'OFF');
assert.strictEqual(GRAPHICS_PRESETS.SMOOTH.uiBlur, 'OFF');
assert.strictEqual(GRAPHICS_PRESETS.SMOOTH.parrySlowMo, true);

assert.strictEqual(GRAPHICS_PRESETS.MAX.dprCap, 1.5);
assert.strictEqual(GRAPHICS_PRESETS.MAX.glowLevel, 'REDUCED');
assert.strictEqual(GRAPHICS_PRESETS.MAX.uiBlur, 'OFF');
assert.strictEqual(GRAPHICS_PRESETS.MAX.parrySlowMo, true);

assert.strictEqual(GRAPHICS_PRESETS.ULTRA.dprCap, 2.0);
assert.strictEqual(GRAPHICS_PRESETS.ULTRA.glowLevel, 'HIGH');
assert.strictEqual(GRAPHICS_PRESETS.ULTRA.uiBlur, 'LIGHT');
assert.strictEqual(GRAPHICS_PRESETS.ULTRA.parrySlowMo, true);

assert(GRAPHICS_PRESETS.ULTRA_MAX.dprCap >= 999.0);
assert.strictEqual(GRAPHICS_PRESETS.ULTRA_MAX.glowLevel, 'ALL');
assert.strictEqual(GRAPHICS_PRESETS.ULTRA_MAX.uiBlur, 'FULL');
assert.strictEqual(GRAPHICS_PRESETS.ULTRA_MAX.parrySlowMo, true);
console.log('✔ Check 2 Passed: Parameter table matches Phase 1 spec completely.');

// Check 3: Zero simulation contamination (Hard rule of spec)
const simCode = fs.readFileSync('./simulation.js', 'utf8');
assert(!simCode.includes('GRAPHICS_PRESETS'), 'simulation.js must not reference GRAPHICS_PRESETS');
assert(!simCode.includes('preset'), 'simulation.js must not reference preset');
assert(!simCode.includes('shadowBlur'), 'simulation.js must not reference shadowBlur');
assert(!simCode.includes('dprCap'), 'simulation.js must not reference dprCap');
console.log('✔ Check 3 Passed: Hard rule verified — pure simulation has 0 references to graphics presets.');

// Check 4: Parry slow-mo retained on all tiers
for (const key of expectedKeys) {
  assert.strictEqual(GRAPHICS_PRESETS[key].parrySlowMo, true, `${key} must retain parrySlowMo`);
}
console.log('✔ Check 4 Passed: Parry slow-mo micro-freeze is retained on all tiers.');

// Check 5: Mock canvas to test setGlow tier gating
function createMockCanvas() {
  const ctx = {
    shadowColor: '',
    shadowBlur: 0,
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    save: () => {},
    restore: () => {},
    setTransform: () => {},
  };
  return {
    getContext: () => ctx,
    parentElement: { getBoundingClientRect: () => ({ width: 1000, height: 600 }) },
    width: 1000,
    height: 600,
    style: {},
  };
}

const mockCanvas = createMockCanvas();
const renderer = new ClashRenderer(mockCanvas, 'SMOOTH');

// Test SMOOTH: All glows 0
renderer.setPreset('SMOOTH');
renderer.setGlow('#00f0ff', 15, 'CORE');
assert.strictEqual(mockCanvas.getContext().shadowBlur, 0, 'Smooth must disable all shadowBlur');

// Test MAX: Only CORE glows
renderer.setPreset('MAX');
renderer.setGlow('#00f0ff', 15, 'CORE');
assert.strictEqual(mockCanvas.getContext().shadowBlur, 15, 'Max must allow CORE glow');
renderer.setGlow('#00f0ff', 15, 'SECONDARY');
assert.strictEqual(mockCanvas.getContext().shadowBlur, 0, 'Max must suppress SECONDARY glow');
renderer.setGlow('#00f0ff', 15, 'AMBIENT');
assert.strictEqual(mockCanvas.getContext().shadowBlur, 0, 'Max must suppress AMBIENT glow');

// Test ULTRA: CORE and SECONDARY glow, AMBIENT suppressed
renderer.setPreset('ULTRA');
renderer.setGlow('#00f0ff', 15, 'SECONDARY');
assert.strictEqual(mockCanvas.getContext().shadowBlur, 15, 'Ultra must allow SECONDARY glow');
renderer.setGlow('#00f0ff', 15, 'AMBIENT');
assert.strictEqual(mockCanvas.getContext().shadowBlur, 0, 'Ultra must suppress AMBIENT glow');

// Test ULTRA_MAX: All glow
renderer.setPreset('ULTRA_MAX');
renderer.setGlow('#00f0ff', 15, 'AMBIENT');
assert.strictEqual(mockCanvas.getContext().shadowBlur, 15, 'Ultra Max must allow AMBIENT glow');
console.log('✔ Check 5 Passed: setGlow tier gating works accurately across all presets.');

// Check 6: HTML & CSS UI bindings
const html = fs.readFileSync('./index.html', 'utf8');
assert(html.includes('id="openGraphicsModalBtn"'), 'Must have open button');
assert(html.includes('id="graphicsModal"'), 'Must have graphics modal');
assert(html.includes('data-preset="SMOOTH"'), 'Must have SMOOTH button');
assert(html.includes('data-preset="MAX"'), 'Must have MAX button');
assert(html.includes('data-preset="ULTRA"'), 'Must have ULTRA button');
assert(html.includes('data-preset="ULTRA_MAX"'), 'Must have ULTRA_MAX button');

const css = fs.readFileSync('./style.css', 'utf8');
assert(css.includes('.graphics-card'), 'Must style graphics card');
assert(css.includes('.preset-btn'), 'Must style preset buttons');
assert(css.includes('[data-graphics="ultra"]'), 'Must support ultra blur');
assert(css.includes('[data-graphics="ultra_max"]'), 'Must support ultra_max blur');
console.log('✔ Check 6 Passed: HTML and CSS bindings for modal and dynamic blur are complete.');

console.log('\n=============================================');
console.log('ALL GRAPHICS QUALITY PRESETS SPECS PASSED 100%');
console.log('=============================================');
