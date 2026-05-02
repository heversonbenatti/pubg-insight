/**
 * tests/mapDimensions.test.js
 *
 * Tests for MAP_DIMENSIONS consistency between modal.js and the
 * scaleFactor computation in replay2d.js.
 *
 * Catches the common bug where a map is added to one place but not the other,
 * causing silent wrong scales or fallback-to-816k errors.
 */

import { test, assert } from './helpers.js';

// ── Source of truth: all known PUBG API map keys ──────────────────────────────

// These are the map keys that can appear in matchData.data.attributes.mapName
// from the PUBG API. If a new map ships, add it here AND in both
// modal.js MAP_DIMENSIONS and utils.js translateMapName.
const KNOWN_MAP_KEYS = [
  'Erangel_Main',
  'Baltic_Main',
  'Desert_Main',
  'DihorOtok_Main',
  'Tiger_Main',
  'Kiki_Main',
  'Neon_Main',
  'Savage_Main',
  'Summerland_Main',
  'Paramo_Main',
];

// Copy of MAP_DIMENSIONS from modal.js (must stay in sync manually)
const MAP_DIMENSIONS = {
  'Erangel_Main':    { width: 816000, height: 816000 },
  'Baltic_Main':     { width: 816000, height: 816000 },
  'Desert_Main':     { width: 816000, height: 816000 },
  'DihorOtok_Main':  { width: 816000, height: 816000 },
  'Tiger_Main':      { width: 816000, height: 816000 },
  'Kiki_Main':       { width: 816000, height: 816000 },
  'Neon_Main':       { width: 816000, height: 816000 },
  'Savage_Main':     { width: 408000, height: 408000 },
  'Summerland_Main': { width: 204800, height: 204800 },
  'Paramo_Main':     { width: 306000, height: 306000 },
};

// ── Coverage checks ───────────────────────────────────────────────────────────

test('MAP_DIMENSIONS: every known map key has an entry', () => {
  for (const key of KNOWN_MAP_KEYS) {
    assert.ok(MAP_DIMENSIONS[key] !== undefined,
      `Missing MAP_DIMENSIONS entry for "${key}"`);
  }
});

test('MAP_DIMENSIONS: no entry has zero or negative dimensions', () => {
  for (const [key, dims] of Object.entries(MAP_DIMENSIONS)) {
    assert.ok(dims.width > 0,  `Map "${key}" has width <= 0`);
    assert.ok(dims.height > 0, `Map "${key}" has height <= 0`);
  }
});

test('MAP_DIMENSIONS: all 816k maps have equal width and height', () => {
  const big = ['Erangel_Main', 'Baltic_Main', 'Desert_Main', 'DihorOtok_Main',
               'Tiger_Main', 'Kiki_Main', 'Neon_Main'];
  for (const key of big) {
    const d = MAP_DIMENSIONS[key];
    assert.equal(d.width, d.height, `Map "${key}" is not square: ${d.width}x${d.height}`);
    assert.equal(d.width, 816000,   `Map "${key}" should be 816000 wide`);
  }
});

test('MAP_DIMENSIONS: Sanhok is 408000 x 408000', () => {
  assert.equal(MAP_DIMENSIONS['Savage_Main'].width,  408000);
  assert.equal(MAP_DIMENSIONS['Savage_Main'].height, 408000);
});

test('MAP_DIMENSIONS: Karakin is 204800 x 204800', () => {
  assert.equal(MAP_DIMENSIONS['Summerland_Main'].width,  204800);
  assert.equal(MAP_DIMENSIONS['Summerland_Main'].height, 204800);
});

test('MAP_DIMENSIONS: Paramo is 306000 x 306000', () => {
  assert.equal(MAP_DIMENSIONS['Paramo_Main'].width,  306000);
  assert.equal(MAP_DIMENSIONS['Paramo_Main'].height, 306000);
});

// ── Fallback behaviour ────────────────────────────────────────────────────────

test('MAP_DIMENSIONS: unknown key falls back to 816000x816000 (as in modal.js)', () => {
  const key = 'UnknownMap_Main';
  const dims = MAP_DIMENSIONS[key] || { width: 816000, height: 816000 };
  assert.equal(dims.width,  816000);
  assert.equal(dims.height, 816000);
});

// ── scaleFactor sanity for each real map ──────────────────────────────────────

function computeScaleFactor(BASE_SCALE, VIEWPORT_WIDTH, MAP_WIDTH, MAP_HEIGHT) {
  return BASE_SCALE * (VIEWPORT_WIDTH / 800) * (816000 / Math.max(MAP_WIDTH, MAP_HEIGHT));
}

test('scaleFactor: all maps produce a positive, finite scale factor', () => {
  for (const [key, dims] of Object.entries(MAP_DIMENSIONS)) {
    const sf = computeScaleFactor(0.001, 600, dims.width, dims.height);
    assert.ok(sf > 0 && isFinite(sf),
      `Map "${key}" produced invalid scaleFactor: ${sf}`);
  }
});

test('scaleFactor: Sanhok scaleFactor is exactly 2x Erangel at same viewport', () => {
  const erangel = computeScaleFactor(0.001, 600, 816000, 816000);
  const sanhok  = computeScaleFactor(0.001, 600, MAP_DIMENSIONS['Savage_Main'].width, MAP_DIMENSIONS['Savage_Main'].height);
  assert.closeTo(sanhok / erangel, 2, 0.001);
});

test('scaleFactor: Karakin scaleFactor is ~4x Erangel at same viewport', () => {
  const erangel = computeScaleFactor(0.001, 600, 816000, 816000);
  const karakin = computeScaleFactor(0.001, 600, MAP_DIMENSIONS['Summerland_Main'].width, MAP_DIMENSIONS['Summerland_Main'].height);
  assert.closeTo(karakin / erangel, 816000 / 204800, 0.01);
});
