import { translateMapName } from './utils.js';

export function startModal(matchId, platform, mapName) {

  const mapCanvas = document.getElementById("mapCanvas");
  const mapCtx = mapCanvas.getContext("2d");
  const drawCanvas = document.getElementById("drawCanvas");
  const drawCtx = drawCanvas.getContext("2d");
  const viewport = document.getElementById("viewport");
  const MAP_WIDTH = parseInt(viewport.dataset.mapWidth);
  const MAP_HEIGHT = parseInt(viewport.dataset.mapHeight);
  const BASE_SCALE = parseFloat(viewport.dataset.canvasScale);

  let VIEWPORT_WIDTH = viewport.offsetWidth;
  let VIEWPORT_HEIGHT = viewport.offsetHeight;

  mapCanvas.width = VIEWPORT_WIDTH;
  mapCanvas.height = VIEWPORT_HEIGHT;
  drawCanvas.width = VIEWPORT_WIDTH;
  drawCanvas.height = VIEWPORT_HEIGHT;

  let scaleFactor = BASE_SCALE * (VIEWPORT_WIDTH / 800) * (816000 / Math.max(MAP_WIDTH, MAP_HEIGHT));

  let zoomScale = 1;
  let panX = 0;
  let panY = 0;
  const maxZoom = 100;
  let minZoom = 1;
  let isPlaying = false;
  let animationFrameId = null;
  let playbackSpeed = 1;
  let frameAccumulator = 0;

  const speedValues = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 50, 100];

  const speedSlider = document.getElementById('speedSlider');
  const speedDisplay = document.getElementById('speedDisplay');
  speedSlider.addEventListener('input', () => {
    playbackSpeed = speedValues[parseInt(speedSlider.value)];
    speedDisplay.textContent = playbackSpeed + 'x';
  });

  const translatedMapName = translateMapName(mapName);
  const mapLower = translatedMapName.toLowerCase();

  // ── Tile system ──────────────────────────────────────────────────────────────
  // Tiles live at /tiles/{map}/{z}/{tx}_{ty}.jpg
  // z=0 → 1 tile (512px) covering the whole map, loads in <100ms
  // z=5 → 32×32 tiles at native 16384px resolution
  const TILE_PX = 512;
  const MAP_MAX_Z = 5; // all maps are 16384×16384
  const tileImages = new Map();

  // ── Killfeed icon preload ────────────────────────────────────────────────────
  const _KF_NAMES = [
    'Blackzone','Bluezone','DBNO','Death','Drown','Fall','Ferry','Groggy',
    'Headshot','Headshot_DBNO','Kill_Truck','Kill_Truck_Turret','Loot_Truck',
    'Melee_Throw','Punch','Redzone','Train','Vehicle','Vehicle_Explosion','Zombie_Punch',
  ];
  const KF_ICONS = {};
  _KF_NAMES.forEach(name => {
    const img = new Image();
    img.src = `/pubg-api-assets/Assets/Icons/Killfeed/${name}.png`;
    KF_ICONS[name] = img;
  });

  function killfeedIconKey(causerName, damageType, damageReason, isKnock) {
    const head = damageReason === 'HeadShot';
    if (isKnock) return head ? 'Headshot_DBNO' : 'DBNO';
    if (head) return 'Headshot';
    if (damageType === 'Damage_BlueZone' || damageType === 'Damage_BlueZoneGrenade' || damageType === 'Damage_Blizzard') return 'Bluezone';
    if (damageType === 'Damage_Explosion_BlackZone') return 'Blackzone';
    if (damageType === 'Damage_Explosion_RedZone') return 'Redzone';
    if (damageType === 'Damage_Drown') return 'Drown';
    if (damageType === 'Damage_Instant_Fall') return 'Fall';
    if (damageType === 'Damage_ShipHit') return 'Ferry';
    if (damageType === 'Damage_TrainHit') return 'Train';
    if (damageType === 'Damage_KillTruckHit') return 'Kill_Truck';
    if (damageType === 'Damage_KillTruckTurret') return 'Kill_Truck_Turret';
    if (damageType === 'Damage_LootTruckHit' || damageType === 'Damage_Explosion_LootTruck') return 'Loot_Truck';
    if (damageType === 'Damage_Explosion_Vehicle' || damageType === 'Damage_VehicleHit' || damageType === 'Damage_VehicleCrashHit' || damageType === 'Damage_MotorGlider') return 'Vehicle';
    if (damageType === 'Damage_Punch') return 'Punch';
    if (damageType === 'Damage_MeleeThrow' || damageType === 'Damage_Melee') return 'Melee_Throw';
    if (damageType === 'Damage_Monster') return 'Zombie_Punch';
    return 'Death';
  }

  function getTile(z, tx, ty) {
    const key = `${z}/${tx}/${ty}`;
    if (!tileImages.has(key)) {
      const img = new Image();
      img.src = `/tiles/${mapLower}/${z}/${tx}_${ty}.jpg`;
      tileImages.set(key, img);
    }
    return tileImages.get(key);
  }

  function drawTiles(ctx) {
    const vgW = VIEWPORT_WIDTH  / (scaleFactor * zoomScale);
    const vgH = VIEWPORT_HEIGHT / (scaleFactor * zoomScale);

    // z=0 covers the entire map — always draw first as the base layer
    const z0 = getTile(0, 0, 0);
    if (z0.complete && z0.naturalWidth > 0) {
      ctx.drawImage(z0, 0, 0, MAP_WIDTH, MAP_HEIGHT);
    }

    // Choose the zoom level that puts each tile at ~TILE_PX screen pixels
    const screenSpan = Math.max(MAP_WIDTH, MAP_HEIGHT) * scaleFactor * zoomScale;
    const optZ = Math.min(MAP_MAX_Z, Math.max(1, Math.ceil(Math.log2(screenSpan / TILE_PX))));

    const count = 1 << optZ;
    const tgW = MAP_WIDTH  / count;
    const tgH = MAP_HEIGHT / count;

    // Visible tile range
    const txMin = Math.max(0,         Math.floor(panX / tgW));
    const txMax = Math.min(count - 1, Math.floor((panX + vgW) / tgW));
    const tyMin = Math.max(0,         Math.floor(panY / tgH));
    const tyMax = Math.min(count - 1, Math.floor((panY + vgH) / tgH));

    for (let ty = tyMin; ty <= tyMax; ty++) {
      for (let tx = txMin; tx <= txMax; tx++) {
        const tile = getTile(optZ, tx, ty);
        if (tile.complete && tile.naturalWidth > 0) {
          ctx.drawImage(tile, tx * tgW, ty * tgH, tgW, tgH);
        }
        // If tile not yet loaded, z=0 base shows through (good enough)
      }
    }

    // Pre-load next zoom level for smooth zoom-in
    const nextZ = Math.min(MAP_MAX_Z, optZ + 1);
    if (nextZ !== optZ) {
      const nc   = 1 << nextZ;
      const ntgW = MAP_WIDTH  / nc;
      const ntgH = MAP_HEIGHT / nc;
      const ntxMin = Math.max(0,      Math.floor(panX / ntgW));
      const ntxMax = Math.min(nc - 1, Math.floor((panX + vgW) / ntgW));
      const ntyMin = Math.max(0,      Math.floor(panY / ntgH));
      const ntyMax = Math.min(nc - 1, Math.floor((panY + vgH) / ntgH));
      for (let ty = ntyMin; ty <= ntyMax; ty++)
        for (let tx = ntxMin; tx <= ntxMax; tx++)
          getTile(nextZ, tx, ty); // triggers load without blocking render
    }
  }

  // ── Initial view ──────────────────────────────────────────────────────────────
  // Reads canvas/viewport dimensions and snaps zoom+pan to fit the full map.
  // Called via ResizeObserver (not RAF) so aspect-ratio:1/1 is always resolved.
  function snapToFitView() {
    const w = viewport.offsetWidth;
    const h = viewport.offsetHeight;
    if (!w || !h) return;
    VIEWPORT_WIDTH  = w;
    VIEWPORT_HEIGHT = h;
    mapCanvas.width  = VIEWPORT_WIDTH;
    mapCanvas.height = VIEWPORT_HEIGHT;
    drawCanvas.width  = VIEWPORT_WIDTH;
    drawCanvas.height = VIEWPORT_HEIGHT;
    scaleFactor = BASE_SCALE * (VIEWPORT_WIDTH / 800) * (816000 / Math.max(MAP_WIDTH, MAP_HEIGHT));
    const fitZoomX = VIEWPORT_WIDTH  / (MAP_WIDTH  * scaleFactor);
    const fitZoomY = VIEWPORT_HEIGHT / (MAP_HEIGHT * scaleFactor);
    zoomScale = Math.min(fitZoomX, fitZoomY);
    minZoom   = zoomScale;
    panX = (MAP_WIDTH  - VIEWPORT_WIDTH  / (scaleFactor * zoomScale)) / 2;
    panY = (MAP_HEIGHT - VIEWPORT_HEIGHT / (scaleFactor * zoomScale)) / 2;
  }
  // ResizeObserver fires during the layout phase, before RAF callbacks, so
  // viewport.offsetWidth/Height are always the post-layout values (aspect-ratio resolved).
  // This is the reliable fix for the intermittent "map doesn't fill viewport" bug.
  const _initRO = new ResizeObserver(() => {
    if (viewport.offsetWidth && viewport.offsetHeight) {
      snapToFitView();
      _initRO.disconnect();
    }
  });
  _initRO.observe(viewport);

  // ── Early render loop — shows map while telemetry is loading ─────────────────
  // Cancelled as soon as telemetry data is ready.
  let earlyFrameId = null;

  function earlyRender() {
    mapCtx.save();
    mapCtx.setTransform(1, 0, 0, 1, 0, 0);
    mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
    mapCtx.scale(scaleFactor * zoomScale, scaleFactor * zoomScale);
    mapCtx.translate(-panX, -panY);
    drawTiles(mapCtx);
    mapCtx.restore();

    drawCtx.save();
    drawCtx.setTransform(1, 0, 0, 1, 0, 0);
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    drawCtx.font = 'bold 13px "JetBrains Mono", monospace';
    drawCtx.fillStyle = 'rgba(255,255,255,0.5)';
    drawCtx.textAlign = 'center';
    drawCtx.fillText('Loading telemetry…', VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2);
    drawCtx.restore();

    earlyFrameId = requestAnimationFrame(earlyRender);
  }

  // Start as soon as z=0 tile is available (cached tile fires instantly)
  const z0tile = getTile(0, 0, 0);
  if (z0tile.complete && z0tile.naturalWidth > 0) {
    earlyFrameId = requestAnimationFrame(earlyRender);
  } else {
    z0tile.addEventListener('load', () => {
      earlyFrameId = requestAnimationFrame(earlyRender);
    }, { once: true });
  }

  function interpolate(a, b, t) { return a + (b - a) * t; }

  // Use preloaded telemetry if available; if it resolved to null (fetch failed), retry fresh.
  const _fetchFresh = () => fetch(`/api/telemetry/${matchId}?platform=${platform}`).then(r => r.json());
  const _preloadedTelemetry = window._telemetryPreload?.[matchId];
  (_preloadedTelemetry ? _preloadedTelemetry.then(d => d ?? _fetchFresh()) : _fetchFresh())
    .then(data => {
      // Stop the early "loading" render loop now that we have data
      if (earlyFrameId !== null) { cancelAnimationFrame(earlyFrameId); earlyFrameId = null; }

      const gameStateData = data.filter(item => item.gameState);
      const characterData = data.filter(item => item._T === 'LogPlayerPosition');

      const playerNames = {};
      characterData.forEach(item => {
        if (item.character?.accountId && item.character?.name)
          playerNames[item.character.accountId] = item.character.name;
      });

      const matchStartEvent = data.find(item => item._T === 'LogMatchStart');
      const matchStartMs = matchStartEvent ? new Date(matchStartEvent._D).getTime() : 0;

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

      const playerDeathIntervals = {};
      data.forEach(item => {
        if ((item._T === 'LogPlayerKillV2' || item._T === 'LogPlayerKill') &&
          item.victim?.accountId && item._D) {
          const t = dMsToElapsed(new Date(item._D).getTime());
          if (!playerDeathIntervals[item.victim.accountId]) playerDeathIntervals[item.victim.accountId] = [];
          playerDeathIntervals[item.victim.accountId].push({ death: t, respawn: null });
        }
      });
      data.forEach(item => {
        if (item._T === 'LogParachuteLanding' && item._D && item.character?.accountId) {
          const accountId = item.character.accountId;
          const intervals = playerDeathIntervals[accountId];
          if (!intervals) return;
          const t = dMsToElapsed(new Date(item._D).getTime());
          for (let i = intervals.length - 1; i >= 0; i--) {
            if (intervals[i].respawn === null && t > intervals[i].death) {
              intervals[i].respawn = t;
              break;
            }
          }
        }
      });

      function isPlayerDead(accountId, elapsed) {
        const intervals = playerDeathIntervals[accountId];
        if (!intervals) return false;
        for (const iv of intervals)
          if (elapsed >= iv.death && (iv.respawn === null || elapsed < iv.respawn)) return true;
        return false;
      }

      const playerKnockIntervals = {};
      data.forEach(item => {
        if (item._T === 'LogPlayerMakeGroggy' && item._D && item.victim?.accountId) {
          const id = item.victim.accountId;
          const t = dMsToElapsed(new Date(item._D).getTime());
          if (!playerKnockIntervals[id]) playerKnockIntervals[id] = [];
          playerKnockIntervals[id].push({ knock: t, end: null });
        }
      });
      data.forEach(item => {
        if (item._T === 'LogPlayerRevive' && item._D && item.victim?.accountId) {
          const id = item.victim.accountId;
          const t = dMsToElapsed(new Date(item._D).getTime());
          const intervals = playerKnockIntervals[id];
          if (!intervals) return;
          for (let i = intervals.length - 1; i >= 0; i--) {
            if (intervals[i].end === null && t > intervals[i].knock) {
              intervals[i].end = t;
              break;
            }
          }
        }
      });
      Object.entries(playerKnockIntervals).forEach(([id, intervals]) => {
        const deathIntervals = playerDeathIntervals[id];
        if (!deathIntervals) return;
        intervals.forEach(iv => {
          if (iv.end === null) {
            const death = deathIntervals.find(d => d.death >= iv.knock);
            if (death) iv.end = death.death;
          }
        });
      });

      function isPlayerKnocked(accountId, elapsed) {
        const intervals = playerKnockIntervals[accountId];
        if (!intervals) return false;
        for (const iv of intervals)
          if (elapsed >= iv.knock && (iv.end === null || elapsed < iv.end)) return true;
        return false;
      }

      const players = {};

      characterData.forEach(item => {
        const id = item.character.accountId;
        if (!players[id]) players[id] = [];
        const t = dMsToElapsed(new Date(item._D).getTime());
        if (t <= 9) return;
        if (isPlayerDead(id, t)) return;
        players[id].push({
          t,
          x: item.character.location.x,
          y: item.character.location.y,
          vehicleType: item.vehicle?.vehicleType || '',
          health: item.character.health,
          isKeyframe: true,
        });
      });

      const CHAR_LOC_EVENTS = new Set([
        'LogItemPickup', 'LogHeal', 'LogItemEquip', 'LogItemUnequip', 'LogItemUse',
        'LogItemAttach', 'LogItemDetach', 'LogItemDrop', 'LogObjectInteraction',
        'LogWeaponFireCount', 'LogVaultStart', 'LogItemPickupFromLootBox',
        'LogVehicleRide', 'LogVehicleLeave', 'LogObjectDestroy', 'LogParachuteLanding',
        'LogItemPickupFromCarepackage', 'LogItemPutToVehicleTrunk',
        'LogItemPickupFromVehicleTrunk', 'LogSwimStart', 'LogSwimEnd', 'LogCharacterCarry',
      ]);

      data.forEach(item => {
        if (!item._D) return;
        const t = dMsToElapsed(new Date(item._D).getTime());
        if (t <= 9) return;
        const addPoint = (accountId, location) => {
          if (!accountId || !location || !players[accountId]) return;
          if (isPlayerDead(accountId, t)) return;
          players[accountId].push({ t, x: location.x, y: location.y, vehicleType: '', health: undefined, isKeyframe: false });
        };
        if (CHAR_LOC_EVENTS.has(item._T)) {
          addPoint(item.character?.accountId, item.character?.location);
        } else if (item._T === 'LogPlayerAttack') {
          addPoint(item.attacker?.accountId, item.attacker?.location);
        } else if (['LogPlayerTakeDamage', 'LogPlayerMakeGroggy', 'LogVehicleDamage',
          'LogArmorDestroy', 'LogPlayerUseThrowable'].includes(item._T)) {
          addPoint(item.attacker?.accountId, item.attacker?.location);
          addPoint(item.victim?.accountId, item.victim?.location);
        }
      });

      Object.values(players).forEach(pts => pts.sort((a, b) => a.t - b.t));

      const playerLocationsByTime = {};
      const playerVehicleByTime = {};
      const playerHpByTime = {};

      Object.keys(players).forEach(accountId => {
        const anchors = players[accountId];
        const byTime = {}, byVehicle = {}, byHp = {};

        for (let i = 0; i < anchors.length - 1; i++) {
          const curr = anchors[i], next = anchors[i + 1];
          const timeDiff = next.t - curr.t;
          if (timeDiff <= 0) continue;
          const steps = Math.max(1, Math.floor(timeDiff));
          for (let j = 0; j <= steps; j++) {
            const t = Math.round(curr.t + j);
            if (byTime[t]) continue;
            const p = j / steps;
            byTime[t] = { x: curr.x + (next.x - curr.x) * p, y: curr.y + (next.y - curr.y) * p };
            const vt = curr.vehicleType;
            if (vt && vt !== 'TransportAircraft') byVehicle[t] = vt;
          }
        }

        anchors.filter(a => !a.isKeyframe).forEach(a => {
          byTime[Math.round(a.t)] = { x: a.x, y: a.y };
        });

        anchors.filter(a => a.isKeyframe).forEach(a => {
          const t = Math.round(a.t);
          if (!byTime[t]) byTime[t] = { x: a.x, y: a.y };
          if (a.vehicleType && a.vehicleType !== 'TransportAircraft') byVehicle[t] = a.vehicleType;
          if (a.health !== undefined) byHp[t] = a.health;
        });

        const kfTimes = anchors.filter(a => a.isKeyframe).map(a => Math.round(a.t)).sort((a, b) => a - b);
        if (kfTimes.length) {
          let lastHp = 100;
          for (let s = 0; s <= kfTimes[kfTimes.length - 1]; s++) {
            if (byHp[s] !== undefined) lastHp = byHp[s];
            else byHp[s] = lastHp;
          }
        }

        playerLocationsByTime[accountId] = byTime;
        playerVehicleByTime[accountId] = byVehicle;
        playerHpByTime[accountId] = byHp;
      });

      const damageByVictim = {};
      data.forEach(item => {
        if (item._T !== 'LogPlayerTakeDamage' || !item._D) return;
        const vic = item.victim;
        if (!vic?.accountId) return;
        const t = dMsToElapsed(new Date(item._D).getTime());
        if (!damageByVictim[vic.accountId]) damageByVictim[vic.accountId] = [];
        damageByVictim[vic.accountId].push({ t, damage: item.damage || 0, hpAfter: vic.health ?? 0 });
      });

      Object.entries(damageByVictim).forEach(([accountId, hits]) => {
        const byHp = playerHpByTime[accountId];
        if (!byHp) return;
        hits.sort((a, b) => a.t - b.t);

        const kfTimes = (players[accountId] || [])
          .filter(p => p.isKeyframe)
          .map(p => Math.round(p.t))
          .sort((a, b) => a - b);

        for (let ki = 0; ki < kfTimes.length - 1; ki++) {
          const kfStart = kfTimes[ki];
          const kfEnd = kfTimes[ki + 1];
          const group = hits.filter(h => h.t > kfStart && h.t <= kfEnd);
          if (!group.length) continue;

          const hpBefore = byHp[kfStart] ?? 100;
          const hpAfterLast = group[group.length - 1].hpAfter;
          const totalLoss = Math.max(0, hpBefore - hpAfterLast);
          if (totalLoss === 0) continue;

          const totalDamage = group.reduce((s, h) => s + h.damage, 0);
          let runningHp = hpBefore;
          group.forEach(hit => {
            const loss = totalDamage > 0 ? (hit.damage / totalDamage) * totalLoss : totalLoss / group.length;
            runningHp = Math.max(0, runningHp - loss);
            byHp[Math.round(hit.t)] = runningHp;
          });

          const hitTimes = group.map(h => Math.round(h.t)).sort((a, b) => a - b);
          for (let hi = 0; hi < hitTimes.length; hi++) {
            const from = hitTimes[hi];
            const to = hi + 1 < hitTimes.length ? hitTimes[hi + 1] : kfEnd;
            const hp = byHp[from];
            for (let s = from + 1; s < to; s++) byHp[s] = hp;
          }
        }
      });

      const feedEvents = [];

      // Knocks: LogPlayerMakeGroggy tem atacante + timestamp corretos diretamente.
      // Abordagem anterior cruzava com LogPlayerTakeDamage (saúde=0) e gerava
      // entradas duplicadas quando múltiplos hits ocorriam no mesmo frame.
      data.forEach(item => {
        if (item._T !== 'LogPlayerMakeGroggy' || !item._D) return;
        const attacker = item.attacker || {};
        const victim   = item.victim   || {};
        if (!attacker.name || !victim.name || !victim.accountId) return;
        const t = dMsToElapsed(new Date(item._D).getTime());
        const kDmgType = item.damageTypeCategory || '';
        const kDmgReason = item.damageReason || '';
        feedEvents.push({
          killerName: attacker.name, killerAccountId: attacker.accountId,
          victimName: victim.name,   victimAccountId: victim.accountId,
          isKnock: true, t,
          iconKey: killfeedIconKey(item.damageCauserName, kDmgType, kDmgReason, true),
        });
      });

      // Kills
      data.forEach(item => {
        if ((item._T !== 'LogPlayerKillV2' && item._T !== 'LogPlayerKill') || !item._D) return;
        const killer = item.killer || item.attacker || {};
        const victim = item.victim || {};
        if (!victim.name || !victim.accountId) return;
        const t = dMsToElapsed(new Date(item._D).getTime());
        // LogPlayerKillV2 stores damage details in finishDamageInfo / killerDamageInfo
        const dmgInfo = item.finishDamageInfo || item.killerDamageInfo || {};
        const dmgType   = dmgInfo.damageTypeCategory   || item.damageTypeCategory   || '';
        const dmgReason = dmgInfo.damageReason          || item.damageReason          || '';
        const causerName = dmgInfo.damageCauserName     || item.damageCauserName      || '';
        feedEvents.push({
          killerName: killer.name || '', killerAccountId: killer.accountId || '',
          victimName: victim.name,  victimAccountId: victim.accountId,
          isKnock: false, t,
          iconKey: killfeedIconKey(causerName, dmgType, dmgReason, false),
        });
      });

      feedEvents.sort((a, b) => a.t - b.t);

      const bulletEvents = [];
      data.forEach(item => {
        if (item._T !== 'LogPlayerTakeDamage' || !item._D || item.damageTypeCategory !== 'Damage_Gun') return;
        if (!item.attacker?.accountId || !item.victim?.accountId) return;
        const al = item.attacker?.location;
        const vl = item.victim?.location;
        if (!al || !vl) return;
        const t = dMsToElapsed(new Date(item._D).getTime());
        bulletEvents.push({
          t, duration: 0.8,
          originX: al.x, originY: al.y,
          targetX: vl.x, targetY: vl.y,
          shooterAccountId: item.attacker.accountId,
        });
      });
      bulletEvents.sort((a, b) => a.t - b.t);

      const loadoutEvents = {};
      const loadoutEventTypes = new Set(['LogItemEquip', 'LogItemUnequip', 'LogItemAttach', 'LogItemDetach']);
      data.forEach(item => {
        if (!loadoutEventTypes.has(item._T) || !item._D || !item.character?.accountId) return;
        const accountId = item.character.accountId;
        const t = dMsToElapsed(new Date(item._D).getTime());
        if (!loadoutEvents[accountId]) loadoutEvents[accountId] = [];
        loadoutEvents[accountId].push({ t, type: item._T, item: item.item || null, parentItem: item.parentItem || null, childItem: item.childItem || null });
      });
      Object.values(loadoutEvents).forEach(arr => arr.sort((a, b) => a.t - b.t));

      const IGNORED_WEAPONS = new Set(['Item_Weapon_IntegratedRepair_C', 'Item_Weapon_CamoNet_Taego_C', 'Item_Weapon_Mortar_C', 'Item_Weapon_PanzerFaust100M_C']);

      function getLoadoutAt(accountId, elapsed) {
        const events = loadoutEvents[accountId];
        if (!events) return { weapons: {}, equipment: {} };
        const weapons = {}, equipment = {};
        for (const ev of events) {
          if (ev.t > elapsed) break;
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
            else if (equipment[it.subCategory.toLowerCase()] === it.itemId) delete equipment[it.subCategory.toLowerCase()];
          } else if (ev.type === 'LogItemAttach') {
            if (weapons[ev.parentItem.itemId]) weapons[ev.parentItem.itemId].attachments.add(ev.childItem.itemId);
          } else if (ev.type === 'LogItemDetach') {
            if (weapons[ev.parentItem.itemId]) weapons[ev.parentItem.itemId].attachments.delete(ev.childItem.itemId);
          }
        }
        return { weapons, equipment };
      }

      window.getLoadoutAt = getLoadoutAt;
      window.playerNames = playerNames;
      window.playerHpByTime = playerHpByTime;

      // Determina o teamId do jogador pesquisado (computado uma vez, usado no render)
      const _searchedName = document.getElementById('player-name-display')?.textContent?.trim() || '';
      const _searchedParticipant = globalMatchData.included
        .filter(p => p.type === 'participant')
        .find(p => p.attributes?.stats?.name === _searchedName);
      const _searchedRoster = _searchedParticipant
        ? globalMatchData.included.filter(r => r.type === 'roster')
            .find(r => r.relationships.participants.data.some(p => p.id === _searchedParticipant.id))
        : null;
      const searchedTeamId = _searchedRoster?.attributes?.stats?.teamId ?? null;

      const interpolatedData = [];
      for (let i = 0; i < gameStateData.length - 1; i++) {
        const curr = gameStateData[i].gameState, next = gameStateData[i + 1].gameState;
        interpolatedData.push(curr);
        const timeDiff = next.elapsedTime - curr.elapsedTime;
        if (timeDiff > 1) {
          for (let j = 1; j < timeDiff; j++) {
            const p = j / timeDiff;
            interpolatedData.push({
              elapsedTime: curr.elapsedTime + j,
              safetyZoneRadius: interpolate(curr.safetyZoneRadius, next.safetyZoneRadius, p),
              safetyZonePosition: { x: interpolate(curr.safetyZonePosition.x, next.safetyZonePosition.x, p), y: interpolate(curr.safetyZonePosition.y, next.safetyZonePosition.y, p) },
              poisonGasWarningRadius: curr.poisonGasWarningRadius,
              poisonGasWarningPosition: { x: curr.poisonGasWarningPosition.x, y: curr.poisonGasWarningPosition.y },
            });
          }
        }
      }
      interpolatedData.push(gameStateData[gameStateData.length - 1].gameState);

      let subProgress = 0;

      const progressBar = document.getElementById('progressBar');
      progressBar.addEventListener('mousedown', e => e.stopPropagation());
      progressBar.addEventListener('touchstart', e => e.stopPropagation());
      progressBar.max = interpolatedData.length - 1;
      let currentIndex = 0;
      const timerElement = document.getElementById('timer');

      function drawSafeZone(radius, position, color) {
        drawCtx.lineWidth = 2 / (scaleFactor * zoomScale);
        drawCtx.strokeStyle = color;
        drawCtx.beginPath();
        drawCtx.arc(position.x, position.y, radius, 0, 2 * Math.PI);
        drawCtx.stroke();
      }

      function updateSafeZone() { subProgress = 0; renderFrame(); }

      progressBar.addEventListener('input', function () { currentIndex = parseInt(progressBar.value); updateSafeZone(); });

      let isDragging = false, lastX, lastY;

      viewport.addEventListener('wheel', function (e) {
        e.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left, mouseY = e.clientY - rect.top;
        const gameX = panX + mouseX / (scaleFactor * zoomScale);
        const gameY = panY + mouseY / (scaleFactor * zoomScale);
        const newZoom = Math.min(maxZoom, Math.max(minZoom, zoomScale * (1 + -e.deltaY * 0.001)));
        panX = gameX - mouseX / (scaleFactor * newZoom);
        panY = gameY - mouseY / (scaleFactor * newZoom);
        zoomScale = newZoom;
        updatePanLimits();
        updateSafeZone();
      });

      viewport.addEventListener('mousedown', e => { isDragging = true; lastX = e.clientX; lastY = e.clientY; e.preventDefault(); });
      document.addEventListener('mousemove', e => {
        if (!isDragging) return;
        panX -= (e.clientX - lastX) / (scaleFactor * zoomScale);
        panY -= (e.clientY - lastY) / (scaleFactor * zoomScale);
        updatePanLimits();
        lastX = e.clientX; lastY = e.clientY;
        updateSafeZone();
        e.preventDefault();
      });
      document.addEventListener('mouseup', () => { isDragging = false; });

      // Use ResizeObserver instead of window.addEventListener('resize') —
      // fires reliably after layout (aspect-ratio resolved) unlike the resize event.
      const _resizeRO = new ResizeObserver(() => {
        const prevZoom = zoomScale;
        const prevMin  = minZoom;
        snapToFitView();
        if (prevMin > 0 && prevZoom > prevMin) {
          zoomScale = Math.max(minZoom, minZoom * (prevZoom / prevMin));
        }
        updatePanLimits();
        updateSafeZone();
      });
      _resizeRO.observe(viewport);

      function updatePanLimits() {
        const vgW = VIEWPORT_WIDTH / (scaleFactor * zoomScale);
        const vgH = VIEWPORT_HEIGHT / (scaleFactor * zoomScale);
        panX = panX || 0; panY = panY || 0;
        panX = Math.max(0, Math.min(panX, MAP_WIDTH - vgW));
        panY = Math.max(0, Math.min(panY, MAP_HEIGHT - vgH));
        if (vgW > MAP_WIDTH) panX = (MAP_WIDTH - vgW) / 2;
        if (vgH > MAP_HEIGHT) panY = (MAP_HEIGHT - vgH) / 2;
      }

      const MS_PER_GAME_SECOND = 1000;
      let lastTimestamp = null, timeAccumulator = 0;

      function drawGrid() {
        const BASE_MAP_SIZE = 816000, outerCells = 8, innerCells = 10;
        const squareSize = BASE_MAP_SIZE / outerCells;
        const innerSquareSize = squareSize / innerCells;
        const showInner = zoomScale >= 2.5;
        const outerCountX = Math.ceil(MAP_WIDTH / squareSize);
        const outerCountY = Math.ceil(MAP_HEIGHT / squareSize);
        const total = showInner ? Math.max(outerCountX, outerCountY) * innerCells : Math.max(outerCountX, outerCountY);
        const step = showInner ? innerSquareSize : squareSize;
        for (let i = 0; i <= total; i++) {
          const pos = i * step;
          const isOuter = i % (showInner ? innerCells : 1) === 0;
          drawCtx.strokeStyle = isOuter ? 'rgba(0,0,0,0.65)' : 'rgba(200,200,200,0.5)';
          drawCtx.lineWidth = (isOuter ? 1 : 0.5) / (scaleFactor * zoomScale);
          if (pos <= MAP_WIDTH) { drawCtx.beginPath(); drawCtx.moveTo(pos, 0); drawCtx.lineTo(pos, MAP_HEIGHT); drawCtx.stroke(); }
          if (pos <= MAP_HEIGHT) { drawCtx.beginPath(); drawCtx.moveTo(0, pos); drawCtx.lineTo(MAP_WIDTH, pos); drawCtx.stroke(); }
        }
      }

      function renderFrame() {
        const safeZone = interpolatedData[currentIndex];

        mapCtx.save();
        mapCtx.setTransform(1, 0, 0, 1, 0, 0);
        mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
        mapCtx.scale(scaleFactor * zoomScale, scaleFactor * zoomScale);
        mapCtx.translate(-panX, -panY);
        drawTiles(mapCtx);
        mapCtx.restore();

        drawCtx.save();
        drawCtx.setTransform(1, 0, 0, 1, 0, 0);
        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        drawCtx.scale(scaleFactor * zoomScale, scaleFactor * zoomScale);
        drawCtx.translate(-panX, -panY);

        drawSafeZone(safeZone.safetyZoneRadius, safeZone.safetyZonePosition, 'blue');
        drawSafeZone(safeZone.poisonGasWarningRadius, safeZone.poisonGasWarningPosition, 'white');
        drawGrid();

        const currentTime = interpolatedData[currentIndex]?.elapsedTime ?? 0;
        const currentTimeSmooth = currentTime + subProgress;

        if (window.teamTrackVisibility) {
          Object.keys(playerLocationsByTime).forEach(accountId => {
            const pid = globalMatchData.included.filter(p => p.type === 'participant').find(p => p.attributes.stats.playerId === accountId)?.id;
            const roster = globalMatchData.included.filter(r => r.type === 'roster').find(r => r.relationships.participants.data.some(p => p.id === pid));
            if (!roster || !window.teamTrackVisibility[roster.attributes?.stats?.teamId]) return;
            const byTime = playerLocationsByTime[accountId];
            const maxT = Math.round(currentTime);
            const times = Object.keys(byTime).map(Number).sort((a, b) => a - b).filter(t => t <= maxT);
            if (times.length < 2) return;
            drawCtx.beginPath();
            drawCtx.strokeStyle = roster.color || 'white';
            drawCtx.lineWidth = 1.5 / (scaleFactor * zoomScale);
            drawCtx.lineJoin = 'round'; drawCtx.lineCap = 'round';
            let started = false;
            times.forEach(t => {
              const pos = byTime[t];
              if (!pos) return;
              if (!started) { drawCtx.moveTo(pos.x, pos.y); started = true; } else drawCtx.lineTo(pos.x, pos.y);
            });
            drawCtx.stroke();
          });
        }

        const ps = window._replayPlayerSize ?? 6;
        const pointSize  = ps / (scaleFactor * zoomScale);
        const borderWidth = Math.max(1, ps * 0.22) / (scaleFactor * zoomScale);
        const nextIndex = Math.min(currentIndex + 1, interpolatedData.length - 1);

        bulletEvents.filter(b => b.t <= currentTimeSmooth && b.t + b.duration > currentTimeSmooth).forEach(bullet => {
          const age = (currentTimeSmooth - bullet.t) / bullet.duration;
          const alpha = 1 - age;
          const pid = globalMatchData.included.filter(p => p.type === 'participant').find(p => p.attributes?.stats?.playerId === bullet.shooterAccountId)?.id;
          const roster = pid ? globalMatchData.included.filter(r => r.type === 'roster').find(r => r.relationships.participants.data.some(p => p.id === pid)) : null;
          const lineColor = roster?.color || '#ffffff';
          drawCtx.save();
          drawCtx.globalAlpha = alpha;
          drawCtx.beginPath();
          drawCtx.moveTo(bullet.originX, bullet.originY);
          drawCtx.lineTo(bullet.targetX, bullet.targetY);
          drawCtx.strokeStyle = lineColor;
          drawCtx.lineWidth = 2 / (scaleFactor * zoomScale);
          drawCtx.lineCap = 'round';
          drawCtx.stroke();
          const rp = age;
          drawCtx.globalAlpha = (1 - rp) * alpha;
          drawCtx.beginPath();
          drawCtx.arc(bullet.targetX, bullet.targetY, pointSize * 1.5 + pointSize * 4 * rp, 0, 2 * Math.PI);
          drawCtx.strokeStyle = 'rgb(255,80,80)';
          drawCtx.lineWidth = 1.5 / (scaleFactor * zoomScale);
          drawCtx.stroke();
          drawCtx.restore();
        });

        const playerRenderData = [];
        Object.keys(playerLocationsByTime).forEach(accountId => {
          const byTime = playerLocationsByTime[accountId];
          const pid = globalMatchData.included.filter(p => p.type === 'participant').find(p => p.attributes.stats.playerId === accountId)?.id;
          const roster = globalMatchData.included.filter(r => r.type === 'roster').find(r => r.relationships.participants.data.some(p => p.id === pid));
          const currentElapsed = Math.round(interpolatedData[currentIndex]?.elapsedTime ?? 0);
          const nextElapsed = Math.round(interpolatedData[nextIndex]?.elapsedTime ?? currentElapsed);
          if (isPlayerDead(accountId, currentElapsed)) return;
          const locA = byTime[currentElapsed];
          const locB = byTime[nextElapsed] || locA;
          if (!locA) return;

          const px = locA.x + (locB.x - locA.x) * subProgress;
          const py = locA.y + (locB.y - locA.y) * subProgress;

          const knocked = isPlayerKnocked(accountId, currentElapsed);
          const hp      = playerHpByTime[accountId]?.[currentElapsed] ?? 100;
          const hpRatio = knocked ? 0 : Math.max(0, Math.min(1, hp / 100));

          const isSearchedTeam = roster?.attributes?.stats?.teamId === searchedTeamId;
          // knocked → vermelho; time do jogador → verde; todos os outros → branco
          const fillColor = knocked ? 'rgb(215,40,40)'
                          : isSearchedTeam ? 'rgb(50,215,80)'
                          : 'rgb(255,255,255)';

          // 1. Fundo vermelho completo (representa vida em falta)
          drawCtx.beginPath();
          drawCtx.arc(px, py, pointSize, 0, 2 * Math.PI);
          drawCtx.fillStyle = 'rgb(200,30,30)';
          drawCtx.fill();

          // 2. Fatia de HP (branco/verde) do topo em sentido horário — efeito "pizza"
          if (hpRatio > 0) {
            drawCtx.beginPath();
            drawCtx.moveTo(px, py);
            drawCtx.arc(px, py, pointSize, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * hpRatio, true);
            drawCtx.closePath();
            drawCtx.fillStyle = fillColor;
            drawCtx.fill();
          }

          // 3. Contorno preto
          drawCtx.beginPath();
          drawCtx.arc(px, py, pointSize, 0, 2 * Math.PI);
          drawCtx.strokeStyle = 'black';
          drawCtx.lineWidth = borderWidth;
          drawCtx.stroke();

          if (playerVehicleByTime[accountId]?.[currentElapsed]) {
            const r = pointSize;
            drawCtx.save();
            drawCtx.translate(px, py);
            drawCtx.strokeStyle = 'rgba(255,255,255,0.9)';
            drawCtx.lineWidth = r * 0.32;
            drawCtx.lineCap = 'round';
            drawCtx.beginPath(); drawCtx.arc(0, 0, r * 0.72, 0, 2 * Math.PI); drawCtx.stroke();
            drawCtx.beginPath(); drawCtx.arc(0, 0, r * 0.22, 0, 2 * Math.PI); drawCtx.stroke();
            [0, 120, 240].forEach(deg => {
              const rad = deg * Math.PI / 180;
              drawCtx.beginPath();
              drawCtx.moveTo(Math.cos(rad) * r * 0.22, Math.sin(rad) * r * 0.22);
              drawCtx.lineTo(Math.cos(rad) * r * 0.72, Math.sin(rad) * r * 0.72);
              drawCtx.stroke();
            });
            drawCtx.restore();
          }

          const name = playerNames[accountId] || '';
          const teamId = roster?.attributes?.stats?.teamId;
          if (name && window.teamNameVisibility?.[teamId]) playerRenderData.push({ px, py, name, pointSize });
        });

        // Pass 2: names — JetBrains Mono
        const fixedFontSize = 11;
        drawCtx.save();
        drawCtx.setTransform(1, 0, 0, 1, 0, 0);
        drawCtx.font = `bold ${fixedFontSize}px "JetBrains Mono", monospace`;
        drawCtx.textAlign = 'center';
        drawCtx.textBaseline = 'top';
        playerRenderData.forEach(({ px, py, name, pointSize }) => {
          const sx = (px - panX) * scaleFactor * zoomScale;
          const sy = (py - panY) * scaleFactor * zoomScale;
          const ptPx = pointSize * scaleFactor * zoomScale;
          drawCtx.strokeStyle = 'rgba(0,0,0,0.85)';
          drawCtx.lineWidth = fixedFontSize * 0.35;
          drawCtx.lineJoin = 'round';
          drawCtx.strokeText(name, sx, sy + ptPx + 2);
          drawCtx.fillStyle = 'white';
          drawCtx.fillText(name, sx, sy + ptPx + 2);
        });
        drawCtx.restore();

        updatePanLimits();
        drawCtx.restore();

        // Kill/knock feed — JetBrains Mono, styled box
        const feedDuration = 5;
        const activeFeed = feedEvents.filter(e => e.t <= currentTime && e.t + feedDuration > currentTime).slice(-(window._replayFeedMax ?? 5));
        if (activeFeed.length > 0) {
          const _fs = window._replayFeedScale ?? 1;
          const fs = Math.round(11 * _fs), lineH = Math.round(18 * _fs);
          const padX = Math.round(8 * _fs), padY = Math.round(6 * _fs), margin = 8;
          const iconW = Math.round(17 * _fs), iconGap = Math.round(5 * _fs);
          drawCtx.save();
          drawCtx.setTransform(1, 0, 0, 1, 0, 0);
          drawCtx.font = `bold ${fs}px "JetBrains Mono", monospace`;
          let maxW = 0;
          activeFeed.forEach(e => {
            const kW = e.killerName ? drawCtx.measureText(e.killerName).width + iconGap : 0;
            const vW = drawCtx.measureText(e.victimName).width;
            maxW = Math.max(maxW, kW + iconW + iconGap + vW);
          });
          const boxW = maxW + padX * 2, boxH = activeFeed.length * lineH + padY * 2;
          const boxX = VIEWPORT_WIDTH - boxW - margin, boxY = margin + 48;
          // Box with subtle border
          drawCtx.fillStyle = 'rgba(0,0,0,0.55)';
          drawCtx.strokeStyle = 'oklch(1 0 0 / 0.05)';
          drawCtx.lineWidth = 1;
          drawCtx.beginPath();
          if (drawCtx.roundRect) drawCtx.roundRect(boxX, boxY, boxW, boxH, 4);
          else drawCtx.rect(boxX, boxY, boxW, boxH);
          drawCtx.fill();
          drawCtx.stroke();

          activeFeed.forEach((e, i) => {
            const age = (currentTime - e.t) / feedDuration;
            drawCtx.globalAlpha = age > 0.7 ? 1 - (age - 0.7) / 0.3 : 1;
            const y = boxY + padY + i * lineH + fs;
            const iconTopY = y - fs * 0.85 - (iconW - fs) / 2;
            drawCtx.textBaseline = 'alphabetic';
            drawCtx.textAlign = 'left';

            // Killer name (empty for environmental kills)
            let curX = boxX + padX;
            if (e.killerName) {
              drawCtx.fillStyle = '#ffffff';
              drawCtx.fillText(e.killerName, curX, y);
              curX += drawCtx.measureText(e.killerName).width + iconGap;
            }

            // Icon — PNG if loaded, emoji fallback
            const iconKey = e.iconKey || (e.isKnock ? 'DBNO' : 'Death');
            const iconImg = KF_ICONS[iconKey];
            if (iconImg?.complete && iconImg.naturalWidth > 0) {
              drawCtx.drawImage(iconImg, curX, iconTopY, iconW, iconW);
            } else {
              drawCtx.fillStyle = e.isKnock ? '#f0c040' : '#ff4444';
              drawCtx.textAlign = 'center';
              drawCtx.fillText(e.isKnock ? '⬇' : '☠', curX + iconW / 2, y);
              drawCtx.textAlign = 'left';
            }
            curX += iconW + iconGap;

            // Victim name
            drawCtx.fillStyle = 'rgba(255,255,255,0.65)';
            drawCtx.fillText(e.victimName, curX, y);
          });
          drawCtx.globalAlpha = 1;
          drawCtx.restore();
        }

        const elapsedTime = safeZone.elapsedTime;
        window.replayCurrentTime = elapsedTime;
        const minutes = Math.floor(elapsedTime / 60);
        const seconds = Math.floor(elapsedTime % 60);
        timerElement.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      }

      // Play/pause SVG icons
      const ICON_PLAY = `<svg width="10" height="12" viewBox="0 0 10 12"><path d="M0 0 L10 6 L0 12 Z" fill="#111"/></svg>`;
      const ICON_PAUSE = `<svg width="11" height="12" viewBox="0 0 11 12"><rect x="0" y="0" width="4" height="12" rx="1" fill="#111"/><rect x="7" y="0" width="4" height="12" rx="1" fill="#111"/></svg>`;

      function animate(timestamp) {
        if (isPlaying) {
          if (lastTimestamp !== null) {
            timeAccumulator += (timestamp - lastTimestamp) * playbackSpeed;
            while (timeAccumulator >= MS_PER_GAME_SECOND) {
              timeAccumulator -= MS_PER_GAME_SECOND;
              if (currentIndex < interpolatedData.length - 1) {
                currentIndex++;
              } else {
                isPlaying = false;
                globalPlayButton.innerHTML = ICON_PLAY;
                timeAccumulator = 0; subProgress = 0;
                break;
              }
            }
            subProgress = timeAccumulator / MS_PER_GAME_SECOND;
          }
          lastTimestamp = timestamp;
          progressBar.value = currentIndex;
        } else {
          lastTimestamp = null;
        }
        renderFrame();
        animationFrameId = requestAnimationFrame(animate);
      }

      progressBar.max = interpolatedData.length - 1;
      progressBar.addEventListener('input', function () {
        if (isPlaying) { isPlaying = false; globalPlayButton.innerHTML = ICON_PLAY; }
        currentIndex = parseInt(progressBar.value);
        updateSafeZone();
      });

      globalPlayButton.addEventListener('click', function () {
        isPlaying = !isPlaying;
        globalPlayButton.innerHTML = isPlaying ? ICON_PAUSE : ICON_PLAY;
        if (isPlaying) {
          // Garante estado limpo ao retomar — evita NaN em timeAccumulator
          lastTimestamp = null;
          if (!isFinite(timeAccumulator)) timeAccumulator = 0;
          if (currentIndex >= interpolatedData.length - 1) {
            currentIndex = 0; frameAccumulator = 0; timeAccumulator = 0;
          }
        }
      });

      // Auto-play em 8x assim que a telemetria carrega
      const _8xIdx = speedValues.indexOf(8); // = 5
      speedSlider.value = String(_8xIdx);
      speedDisplay.textContent = '8x';
      playbackSpeed = 8;
      isPlaying = true;
      lastTimestamp = null;   // garante que o primeiro frame via RAF não compute delta inválido
      timeAccumulator = 0;
      globalPlayButton.innerHTML = ICON_PAUSE;

      // Usar requestAnimationFrame em vez de animate() direto:
      // chamada direta passa timestamp=undefined → lastTimestamp=undefined →
      // na próxima iteração undefined!==null é true → delta=NaN → tudo quebra.
      animationFrameId = requestAnimationFrame(animate);
    })
    .catch(err => console.error('Error loading telemetry:', err));
}
