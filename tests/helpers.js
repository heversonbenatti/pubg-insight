/**
 * tests/helpers.js
 * Minimal test harness — no external dependencies, works with Node ESM.
 */

export const results = { passed: 0, failed: 0, errors: [] };

export function test(name, fn) {
  try {
    fn();
    results.passed++;
    console.log(`  ✓  ${name}`);
  } catch (err) {
    results.failed++;
    results.errors.push({ name, message: err.message });
    console.log(`  ✗  ${name}`);
    console.log(`       ${err.message}`);
  }
}

export const assert = {
  ok(value, message = 'Expected value to be truthy') {
    if (!value) throw new Error(message);
  },
  equal(actual, expected, message) {
    if (actual !== expected)
      throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  },
  notEqual(actual, unexpected, message) {
    if (actual === unexpected)
      throw new Error(message || `Expected value NOT to be ${JSON.stringify(unexpected)}`);
  },
  deepEqual(actual, expected, message) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b)
      throw new Error(message || `Expected ${b}, got ${a}`);
  },
  throws(fn, message) {
    try { fn(); } catch { return; }
    throw new Error(message || 'Expected function to throw');
  },
  closeTo(actual, expected, delta = 0.01, message) {
    if (Math.abs(actual - expected) > delta)
      throw new Error(message || `Expected ${actual} to be close to ${expected} (±${delta})`);
  },
};
