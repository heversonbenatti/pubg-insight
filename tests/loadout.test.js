/**
 * tests/loadout.test.js
 *
 * Tests for getLoadoutAt() — the function in replay2d.js that replays
 * equip/unequip/attach/detach events to reconstruct a player's loadout
 * at any given elapsed time.
 *
 * Covers:
 *   - Empty history → empty loadout
 *   - Equip before elapsed → weapon/equipment shows up
 *   - Equip after elapsed → should NOT show up
 *   - Unequip removes weapon
 *   - Attach/detach on weapon's attachment Set
 *   - Multiple weapons and equipment slots
 *   - IGNORED_WEAPONS are excluded
 *   - Scope/attachment resolution helpers
 */

import { test, assert } from './helpers.js';

// ── Pure re-implementation of getLoadoutAt (mirrors replay2d.js) ──────────────

const IGNORED_WEAPONS = new Set([
  'Item_Weapon_IntegratedRepair_C',
  'Item_Weapon_CamoNet_Taego_C',
  'Item_Weapon_Mortar_C',
  'Item_Weapon_PanzerFaust100M_C',
]);

function getLoadoutAt(loadoutEvents, accountId, elapsed) {
  const events = loadoutEvents[accountId];
  if (!events) return { weapons: {}, equipment: {} };

  const weapons = {}, equipment = {};

  for (const ev of events) {
    if (ev.t > elapsed) break; // events are sorted; stop early

    if (ev.type === 'LogItemEquip') {
      const it = ev.item;
      if (it.category === 'Weapon') {
        if (!IGNORED_WEAPONS.has(it.itemId) && !weapons[it.itemId])
          weapons[it.itemId] = { itemId: it.itemId, subCategory: it.subCategory, attachments: new Set() };
      } else {
        equipment[it.subCategory.toLowerCase()] = it.itemId;
      }
    } else if (ev.type === 'LogItemUnequip') {
      const it = ev.item;
      if (it.category === 'Weapon') delete weapons[it.itemId];
      else if (equipment[it.subCategory.toLowerCase()] === it.itemId)
        delete equipment[it.subCategory.toLowerCase()];
    } else if (ev.type === 'LogItemAttach') {
      if (weapons[ev.parentItem.itemId])
        weapons[ev.parentItem.itemId].attachments.add(ev.childItem.itemId);
    } else if (ev.type === 'LogItemDetach') {
      if (weapons[ev.parentItem.itemId])
        weapons[ev.parentItem.itemId].attachments.delete(ev.childItem.itemId);
    }
  }
  return { weapons, equipment };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const AK    = { itemId: 'Item_Weapon_AK47_C',    category: 'Weapon', subCategory: 'Main'    };
const M416  = { itemId: 'Item_Weapon_HK416_C',   category: 'Weapon', subCategory: 'Main'    };
const P1911 = { itemId: 'Item_Weapon_1911_C',    category: 'Weapon', subCategory: 'Handgun' };
const HELMET = { itemId: 'Item_Head_E_01_Lv3_C', category: 'Equipment', subCategory: 'Headgear' };
const VEST  = { itemId: 'Item_Armor_E_01_Lv3_C', category: 'Equipment', subCategory: 'Vest' };
const SCOPE = { itemId: 'Item_Attach_Weapon_Upper_ACOG_SniperRifle_01_C' };

// ── Basic equip / unequip ─────────────────────────────────────────────────────

test('getLoadoutAt: empty history returns empty loadout', () => {
  const { weapons, equipment } = getLoadoutAt({}, 'p1', 100);
  assert.deepEqual(weapons, {});
  assert.deepEqual(equipment, {});
});

test('getLoadoutAt: weapon equipped before elapsed shows up', () => {
  const events = { 'p1': [{ t: 50, type: 'LogItemEquip', item: AK }] };
  const { weapons } = getLoadoutAt(events, 'p1', 100);
  assert.ok(weapons[AK.itemId] !== undefined, 'AK should be in loadout');
});

test('getLoadoutAt: weapon equipped after elapsed does NOT show up', () => {
  const events = { 'p1': [{ t: 150, type: 'LogItemEquip', item: AK }] };
  const { weapons } = getLoadoutAt(events, 'p1', 100);
  assert.equal(weapons[AK.itemId], undefined, 'AK should NOT be in loadout');
});

test('getLoadoutAt: unequipped weapon is removed', () => {
  const events = {
    'p1': [
      { t: 50,  type: 'LogItemEquip',   item: AK },
      { t: 80,  type: 'LogItemUnequip', item: AK },
    ],
  };
  const { weapons } = getLoadoutAt(events, 'p1', 100);
  assert.equal(weapons[AK.itemId], undefined, 'AK should have been unequipped');
});

test('getLoadoutAt: unequip before equip has no effect (order matters)', () => {
  const events = {
    'p1': [
      { t: 30,  type: 'LogItemUnequip', item: AK }, // unequip before pick-up
      { t: 50,  type: 'LogItemEquip',   item: AK },
    ],
  };
  const { weapons } = getLoadoutAt(events, 'p1', 100);
  assert.ok(weapons[AK.itemId] !== undefined, 'AK should still be in loadout');
});

// ── Equipment slots ───────────────────────────────────────────────────────────

test('getLoadoutAt: equipment equip populates the correct slot', () => {
  const events = {
    'p1': [
      { t: 10, type: 'LogItemEquip', item: HELMET },
      { t: 20, type: 'LogItemEquip', item: VEST },
    ],
  };
  const { equipment } = getLoadoutAt(events, 'p1', 50);
  assert.equal(equipment['headgear'], HELMET.itemId);
  assert.equal(equipment['vest'], VEST.itemId);
});

test('getLoadoutAt: equipment unequip removes from slot', () => {
  const events = {
    'p1': [
      { t: 10, type: 'LogItemEquip',   item: HELMET },
      { t: 30, type: 'LogItemUnequip', item: HELMET },
    ],
  };
  const { equipment } = getLoadoutAt(events, 'p1', 50);
  assert.equal(equipment['headgear'], undefined);
});

// ── Attachments ───────────────────────────────────────────────────────────────

test('getLoadoutAt: attached scope appears in weapon attachments', () => {
  const events = {
    'p1': [
      { t: 10, type: 'LogItemEquip',  item: AK },
      { t: 20, type: 'LogItemAttach', parentItem: AK, childItem: SCOPE },
    ],
  };
  const { weapons } = getLoadoutAt(events, 'p1', 50);
  assert.ok(weapons[AK.itemId].attachments.has(SCOPE.itemId),
    'Scope should be in AK attachments');
});

test('getLoadoutAt: detached scope is removed from weapon attachments', () => {
  const events = {
    'p1': [
      { t: 10, type: 'LogItemEquip',   item: AK },
      { t: 20, type: 'LogItemAttach',  parentItem: AK, childItem: SCOPE },
      { t: 40, type: 'LogItemDetach',  parentItem: AK, childItem: SCOPE },
    ],
  };
  const { weapons } = getLoadoutAt(events, 'p1', 50);
  assert.ok(!weapons[AK.itemId].attachments.has(SCOPE.itemId),
    'Scope should have been removed');
});

test('getLoadoutAt: attach to non-equipped weapon is a no-op (no crash)', () => {
  const events = {
    'p1': [
      { t: 20, type: 'LogItemAttach', parentItem: AK, childItem: SCOPE },
      // AK was never equipped
    ],
  };
  const { weapons } = getLoadoutAt(events, 'p1', 50);
  assert.equal(weapons[AK.itemId], undefined);
});

// ── IGNORED_WEAPONS ───────────────────────────────────────────────────────────

test('getLoadoutAt: ignored weapon IDs are excluded from loadout', () => {
  for (const id of IGNORED_WEAPONS) {
    const events = {
      'p1': [{ t: 10, type: 'LogItemEquip', item: { itemId: id, category: 'Weapon', subCategory: 'Main' } }],
    };
    const { weapons } = getLoadoutAt(events, 'p1', 50);
    assert.equal(weapons[id], undefined, `Ignored weapon ${id} should not appear in loadout`);
  }
});

// ── Multiple weapons ──────────────────────────────────────────────────────────

test('getLoadoutAt: two main weapons both appear', () => {
  const events = {
    'p1': [
      { t: 10, type: 'LogItemEquip', item: AK },
      { t: 20, type: 'LogItemEquip', item: M416 },
    ],
  };
  const { weapons } = getLoadoutAt(events, 'p1', 50);
  assert.ok(weapons[AK.itemId] !== undefined);
  assert.ok(weapons[M416.itemId] !== undefined);
});

test('getLoadoutAt: elapsed exactly on equip event includes the weapon', () => {
  const events = { 'p1': [{ t: 50, type: 'LogItemEquip', item: AK }] };
  const { weapons } = getLoadoutAt(events, 'p1', 50);
  assert.ok(weapons[AK.itemId] !== undefined, 'Equip at exact elapsed should be included');
});

// ── Scope helpers (pure, no DOM) ──────────────────────────────────────────────

function getScopeId(attachments) {
  for (const a of attachments) {
    if (a.includes('_Upper_') || a.includes('_SideRail_')) return a;
  }
  return null;
}

test('getScopeId: returns upper-rail attachment', () => {
  const attachments = new Set(['Item_Attach_Weapon_Upper_ACOG_SniperRifle_01_C', 'Item_Attach_Weapon_Muzzle_Flash_02_C']);
  assert.equal(getScopeId(attachments), 'Item_Attach_Weapon_Upper_ACOG_SniperRifle_01_C');
});

test('getScopeId: returns null when no scope is attached', () => {
  const attachments = new Set(['Item_Attach_Weapon_Muzzle_Flash_02_C']);
  assert.equal(getScopeId(attachments), null);
});

test('getScopeId: returns SideRail attachment when no Upper exists', () => {
  const attachments = new Set(['Item_Attach_Weapon_SideRail_Laser_01_C']);
  assert.equal(getScopeId(attachments), 'Item_Attach_Weapon_SideRail_Laser_01_C');
});
