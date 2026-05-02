const fs = require('fs');
const data = JSON.parse(fs.readFileSync('./public/jsons/last_telemetry.json', 'utf8'));

// Find the players mentioned: keenjaxx, Dbithencorte, Murgabiric, Charllie
const targetNames = ['keenjaxx', 'Dbithencorte', 'Murgabiric', 'Charllie'];
const nameToId = {};

// Build name->accountId map
data.forEach(item => {
  if (item.character?.name && item.character?.accountId) {
    nameToId[item.character.name] = item.character.accountId;
  }
  // Also check attacker/victim/killer
  ['attacker','victim','killer'].forEach(role => {
    if (item[role]?.name && item[role]?.accountId) {
      nameToId[item[role].name] = item[role].accountId;
    }
  });
});

console.log('=== Account IDs ===');
targetNames.forEach(n => console.log(`  ${n}: ${nameToId[n] || 'NOT FOUND'}`));

// Find team info from LogMatchStart
const matchStart = data.find(i => i._T === 'LogMatchStart');
const matchStartMs = new Date(matchStart._D).getTime();

// Build gsTimeline for dMsToElapsed
const gameStateData = data.filter(item => item.gameState);
const gsTimeline = gameStateData.map(g => ({
  dMs: new Date(g._D).getTime(),
  elapsed: g.gameState.elapsedTime
})).sort((a, b) => a.dMs - b.dMs);

function dMsToElapsed(dMs) {
  let lo = 0, hi = gsTimeline.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (gsTimeline[mid].dMs < dMs) lo = mid + 1; else hi = mid;
  }
  if (lo === 0) return gsTimeline[0].elapsed;
  const prev = gsTimeline[lo - 1], next = gsTimeline[lo];
  const ratio = (dMs - prev.dMs) / (next.dMs - prev.dMs);
  return prev.elapsed + (next.elapsed - prev.elapsed) * ratio;
}

function fmtTime(s) {
  return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
}

const targetIds = new Set(targetNames.map(n => nameToId[n]).filter(Boolean));

// Find ALL events involving these players in the 2:00-4:00 range
console.log('\n=== ALL events involving target players (elapsed ~2:00 - 4:00) ===');
const relevantEvents = [];

data.forEach(item => {
  if (!item._D) return;
  const dMs = new Date(item._D).getTime();
  const elapsed = dMsToElapsed(dMs);
  
  // Check if any target player is involved
  let involved = false;
  let details = '';
  
  if (item._T === 'LogPlayerKillV2' || item._T === 'LogPlayerKill') {
    const killer = item.killer || item.attacker || {};
    const victim = item.victim || {};
    if (targetIds.has(killer.accountId) || targetIds.has(victim.accountId)) {
      involved = true;
      details = `killer=${killer.name} victim=${victim.name} isDBNO=${victim.isDBNO} victimHP=${victim.health}`;
      if (item.finisher) details += ` finisher=${item.finisher.name}`;
      if (item.dBNOMaker) details += ` dBNOMaker=${item.dBNOMaker.name}`;
    }
  }
  
  if (item._T === 'LogPlayerMakeGroggy') {
    const attacker = item.attacker || {};
    const victim = item.victim || {};
    if (targetIds.has(attacker.accountId) || targetIds.has(victim.accountId)) {
      involved = true;
      details = `attacker=${attacker.name} victim=${victim.name} victimHP=${victim.health} isDBNO=${victim.isDBNO} dBNOId=${item.dBNOId}`;
    }
  }
  
  if (item._T === 'LogPlayerTakeDamage') {
    const attacker = item.attacker || {};
    const victim = item.victim || {};
    if (targetIds.has(victim.accountId)) {
      involved = true;
      details = `attacker=${attacker.name || 'NONE'} victim=${victim.name} damage=${item.damage?.toFixed(1)} hp=${victim.health?.toFixed(1)} category=${item.damageTypeCategory} reason=${item.damageReason}`;
    }
  }

  if (item._T === 'LogPlayerRevive') {
    const reviver = item.reviver || {};
    const victim = item.victim || {};
    if (targetIds.has(reviver.accountId) || targetIds.has(victim.accountId)) {
      involved = true;
      details = `reviver=${reviver.name} victim=${victim.name}`;
    }
  }

  if (involved && elapsed >= 120 && elapsed <= 240) {
    relevantEvents.push({ elapsed, type: item._T, details, dMs, wallDelta: (dMs - matchStartMs)/1000 });
  }
});

relevantEvents.sort((a, b) => a.elapsed - b.elapsed);
relevantEvents.forEach(e => {
  console.log(`  [${fmtTime(e.elapsed)}] (wall=${fmtTime(e.wallDelta)}) ${e.type}: ${e.details}`);
});

// Now let's specifically look at ALL LogPlayerKillV2/LogPlayerKill for the 3 victims
console.log('\n=== ALL Kill/KillV2 events for Dbithencorte, Murgabiric, Charllie (full match) ===');
data.forEach(item => {
  if (item._T !== 'LogPlayerKillV2' && item._T !== 'LogPlayerKill') return;
  const victim = item.victim || {};
  if (!['Dbithencorte', 'Murgabiric', 'Charllie'].includes(victim.name)) return;
  const dMs = new Date(item._D).getTime();
  const elapsed = dMsToElapsed(dMs);
  const killer = item.killer || item.attacker || {};
  console.log(`  [${fmtTime(elapsed)}] ${item._T}: killer=${killer.name} victim=${victim.name} isDBNO=${victim.isDBNO} finisher=${item.finisher?.name} dBNOMaker=${item.dBNOMaker?.name}`);
});

// Check LogPlayerPosition for these players to see when position data stops
console.log('\n=== Last LogPlayerPosition for each target player ===');
targetNames.forEach(name => {
  const id = nameToId[name];
  if (!id) return;
  const positions = data.filter(i => i._T === 'LogPlayerPosition' && i.character?.accountId === id);
  if (positions.length === 0) { console.log(`  ${name}: no positions`); return; }
  const last = positions[positions.length - 1];
  const elapsed = dMsToElapsed(new Date(last._D).getTime());
  console.log(`  ${name}: last position at elapsed=${fmtTime(elapsed)} hp=${last.character.health}`);
});

// Check for LogPlayerDestroyProp or any other death-related events
console.log('\n=== Other potentially relevant event types for these players ===');
const otherTypes = new Set();
data.forEach(item => {
  if (!item._D) return;
  ['character','attacker','victim','killer','reviver'].forEach(role => {
    if (item[role]?.accountId && targetIds.has(item[role].accountId)) {
      if (!['LogPlayerPosition','LogPlayerTakeDamage','LogPlayerKillV2','LogPlayerKill',
            'LogPlayerMakeGroggy','LogItemPickup','LogItemEquip','LogItemUnequip',
            'LogItemAttach','LogItemDetach','LogItemDrop','LogHeal','LogItemUse',
            'LogWeaponFireCount','LogPlayerAttack','LogVaultStart','LogParachuteLanding',
            'LogObjectInteraction','LogVehicleRide','LogVehicleLeave'].includes(item._T)) {
        const dMs = new Date(item._D).getTime();
        const elapsed = dMsToElapsed(dMs);
        if (elapsed >= 120 && elapsed <= 240) {
          const who = item.character?.name || item.victim?.name || item.attacker?.name || '';
          console.log(`  [${fmtTime(elapsed)}] ${item._T} (${who})`);
        }
      }
    }
  });
});
