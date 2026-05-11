/**
 * tests/run.js
 *
 * Test runner — execute with:
 *   node tests/run.js          (from project root)
 *
 * Imports each test module in order. Each module self-registers tests
 * via the shared `results` object in helpers.js.
 * At the end, prints a summary and exits with code 1 if any test failed.
 */

import { results } from './helpers.js';

// ── Import all test modules (order doesn't matter for correctness) ────────────
import './utils.test.js';
import './timing.test.js';
import './death.test.js';
import './knock.test.js';
import './interpolation.test.js';
import './loadout.test.js';
import './mapDimensions.test.js';
import './telemetry.test.js';
import './matchFilter.test.js';
import './platform.test.js';
import './teamOverlay.test.js';

// ── Summary ───────────────────────────────────────────────────────────────────

const total = results.passed + results.failed;
console.log('');
console.log('─'.repeat(50));
console.log(`  Tests: ${total}  |  ✓ Passed: ${results.passed}  |  ✗ Failed: ${results.failed}`);
console.log('─'.repeat(50));

if (results.failed > 0) {
  console.log('\nFailed tests:');
  results.errors.forEach(({ name, message }) => {
    console.log(`  ✗  ${name}`);
    console.log(`       ${message}`);
  });
  process.exit(1);
} else {
  console.log('\n  All tests passed! ✓');
  process.exit(0);
}
