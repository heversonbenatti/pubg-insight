/**
 * tests/utils.test.js
 * Tests for public/utils.js — translateMapName, generateUniqueColor
 */

import { translateMapName, generateUniqueColor } from '../public/utils.js';
import { test, assert } from './helpers.js';

// ── translateMapName ──────────────────────────────────────────────────────────

test('translateMapName: known maps return friendly name', () => {
  assert.equal(translateMapName('Erangel_Main'),    'Erangel');
  assert.equal(translateMapName('Desert_Main'),     'Miramar');
  assert.equal(translateMapName('Savage_Main'),     'Sanhok');
  assert.equal(translateMapName('DihorOtok_Main'),  'Vikendi');
  assert.equal(translateMapName('Summerland_Main'), 'Karakin');
  assert.equal(translateMapName('Tiger_Main'),      'Taego');
  assert.equal(translateMapName('Kiki_Main'),       'Deston');
  assert.equal(translateMapName('Neon_Main'),       'Rondo');
  assert.equal(translateMapName('Baltic_Main'),     'Erangel');
});

test('translateMapName: Paramo returns a value (not empty/undefined)', () => {
  // Paramo is in MAP_DIMENSIONS but not in translateMapName — if someone queries it,
  // it should gracefully return the original key rather than crashing.
  const result = translateMapName('Paramo_Main');
  assert.ok(typeof result === 'string' && result.length > 0,
    `translateMapName('Paramo_Main') returned ${JSON.stringify(result)}`);
});

test('translateMapName: unknown key returns the original string (no crash)', () => {
  assert.equal(translateMapName('SomeUnknown_Main'), 'SomeUnknown_Main');
});

test('translateMapName: empty string returns empty string', () => {
  assert.equal(translateMapName(''), '');
});

test('translateMapName: all map keys that appear in modal.js MAP_DIMENSIONS resolve to something', () => {
  // These keys come from modal.js MAP_DIMENSIONS — all must translate or fall back gracefully.
  const modalDimensionKeys = [
    'Erangel_Main', 'Baltic_Main', 'Desert_Main', 'DihorOtok_Main',
    'Tiger_Main', 'Kiki_Main', 'Neon_Main', 'Savage_Main',
    'Summerland_Main', 'Paramo_Main',
  ];
  for (const key of modalDimensionKeys) {
    const result = translateMapName(key);
    assert.ok(typeof result === 'string' && result.length > 0,
      `translateMapName('${key}') returned invalid value: ${JSON.stringify(result)}`);
  }
});

// ── generateUniqueColor ───────────────────────────────────────────────────────

test('generateUniqueColor: returns an hsl string', () => {
  const color = generateUniqueColor(0);
  assert.ok(color.startsWith('hsl('), `Expected hsl string, got: ${color}`);
});

test('generateUniqueColor: first 100 indices all produce unique colors', () => {
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    const c = generateUniqueColor(i);
    assert.ok(!seen.has(c), `Duplicate color at index ${i}: ${c}`);
    seen.add(c);
  }
});

test('generateUniqueColor: deterministic — same index always gives same color', () => {
  for (let i = 0; i < 20; i++) {
    assert.equal(generateUniqueColor(i), generateUniqueColor(i),
      `generateUniqueColor(${i}) is not deterministic`);
  }
});

test('generateUniqueColor: index 0 is a valid CSS color string', () => {
  // Regex: hsl(<hue>, <s>%, <l>%) or hsl(<hue>, <s>%, <l>%, <a>)
  const color = generateUniqueColor(0);
  assert.ok(/^hsl\([\d.]+,\s*[\d.]+%,\s*[\d.]+%/.test(color),
    `Color does not look like a valid hsl string: ${color}`);
});
