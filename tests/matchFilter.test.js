/**
 * tests/matchFilter.test.js
 * Pure unit test for the match-list filter logic in scripts.js (getFilteredMatches).
 * Re-implemented here to keep the test browser-free.
 */

import { test, assert } from './helpers.js';
import { translateMapName } from '../public/utils.js';

function filter(matches, { mapFilter = new Set(), perspectiveFilter = 'all' } = {}) {
  return matches.filter(m => {
    const attr = m.data.attributes;
    const mapName = translateMapName(attr.mapName);
    if (mapFilter.size > 0 && !mapFilter.has(mapName)) return false;
    const gm = (attr.gameMode || '').toLowerCase();
    const isFpp = gm.includes('fpp');
    const isRanked = attr.matchType === 'competitive';
    if (perspectiveFilter === 'fpp'    && !isFpp)    return false;
    if (perspectiveFilter === 'tpp'    &&  isFpp)    return false;
    if (perspectiveFilter === 'ranked' && !isRanked) return false;
    if (perspectiveFilter === 'normal' &&  isRanked) return false;
    return true;
  });
}

const mk = (mapName, gameMode, matchType = 'official') =>
  ({ data: { attributes: { mapName, gameMode, matchType } } });

const matches = [
  mk('Erangel_Main',    'squad-fpp', 'official'),
  mk('Erangel_Main',    'squad',     'official'),
  mk('Desert_Main',     'duo-fpp',   'competitive'),
  mk('Savage_Main',     'solo',      'official'),
  mk('Tiger_Main',      'squad-fpp', 'competitive'),
  mk('Kiki_Main',       'duo',       'official'),
];

// ── No filter ────────────────────────────────────────────────────────────────
test('filter: no filter returns all', () => {
  assert.equal(filter(matches).length, 6);
});

// ── Map filter ───────────────────────────────────────────────────────────────
test('filter: single-map filter', () => {
  const r = filter(matches, { mapFilter: new Set(['Erangel']) });
  assert.equal(r.length, 2);
});

test('filter: multi-map filter', () => {
  const r = filter(matches, { mapFilter: new Set(['Erangel', 'Sanhok']) });
  assert.equal(r.length, 3); // 2 erangel + 1 sanhok (Savage_Main)
});

test('filter: empty map set behaves like no filter', () => {
  assert.equal(filter(matches, { mapFilter: new Set() }).length, 6);
});

test('filter: unknown map yields zero', () => {
  assert.equal(filter(matches, { mapFilter: new Set(['Atlantis']) }).length, 0);
});

// ── Perspective filter ──────────────────────────────────────────────────────
test('filter: FPP only excludes TPP', () => {
  const r = filter(matches, { perspectiveFilter: 'fpp' });
  assert.equal(r.length, 3);
  for (const m of r) {
    assert.ok(m.data.attributes.gameMode.includes('fpp'),
      `FPP filter let through ${m.data.attributes.gameMode}`);
  }
});

test('filter: TPP only excludes FPP', () => {
  const r = filter(matches, { perspectiveFilter: 'tpp' });
  assert.equal(r.length, 3);
  for (const m of r) {
    assert.ok(!m.data.attributes.gameMode.includes('fpp'),
      `TPP filter let through ${m.data.attributes.gameMode}`);
  }
});

test('filter: Ranked only keeps competitive', () => {
  const r = filter(matches, { perspectiveFilter: 'ranked' });
  assert.equal(r.length, 2);
  for (const m of r) {
    assert.equal(m.data.attributes.matchType, 'competitive');
  }
});

test('filter: Normal excludes competitive', () => {
  const r = filter(matches, { perspectiveFilter: 'normal' });
  assert.equal(r.length, 4);
  for (const m of r) {
    assert.notEqual(m.data.attributes.matchType, 'competitive');
  }
});

// ── Combined ────────────────────────────────────────────────────────────────
test('filter: map + perspective combine (AND)', () => {
  const r = filter(matches, {
    mapFilter: new Set(['Erangel']),
    perspectiveFilter: 'fpp',
  });
  assert.equal(r.length, 1);
});

test('filter: map + ranked combine (AND)', () => {
  const r = filter(matches, {
    mapFilter: new Set(['Miramar', 'Taego']),
    perspectiveFilter: 'ranked',
  });
  assert.equal(r.length, 2);
});

// ── Edge: missing gameMode ──────────────────────────────────────────────────
test('filter: missing gameMode does not throw and treats as TPP', () => {
  const broken = [{ data: { attributes: { mapName: 'Erangel_Main', gameMode: undefined, matchType: 'official' } } }];
  const r = filter(broken, { perspectiveFilter: 'tpp' });
  assert.equal(r.length, 1);
  const r2 = filter(broken, { perspectiveFilter: 'fpp' });
  assert.equal(r2.length, 0);
});
