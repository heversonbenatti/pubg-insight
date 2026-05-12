import { translateMapName } from './utils.js';
import { clusterTeamPlayers } from './teamOverlay.js';

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

  const teamOverlayButton = document.getElementById('teamOverlayToggle');
  const teamOverlayStatus = document.getElementById('teamOverlayStatus');
  let teamOverlayEnabled = (() => {
    try { return localStorage.getItem('pi_teamOverlay') === '1'; }
    catch (_) { return false; }
  })();
  let teamOverlayStatusText = '';
  const aircraftRouteButton = document.getElementById('aircraftRouteToggle');
  const aircraftRouteStatus = document.getElementById('aircraftRouteStatus');
  let aircraftRouteEnabled = (() => {
    try { return localStorage.getItem('pi_aircraftRoute') !== '0'; }
    catch (_) { return true; }
  })();
  let aircraftRoutePointCount = null;
  let aircraftRouteStatusText = '';
  const aircraftRouteImg = new Image();
  aircraftRouteImg.src = '/images/plane.png';
  let aircraftRouteWhiteImg = null;

  function setTeamOverlayStatus(text) {
    if (!teamOverlayStatus || teamOverlayStatusText === text) return;
    teamOverlayStatusText = text;
    teamOverlayStatus.textContent = text;
  }

  function syncTeamOverlayButton() {
    if (!teamOverlayButton) return;
    teamOverlayButton.classList.toggle('active', teamOverlayEnabled);
    teamOverlayButton.setAttribute('aria-pressed', teamOverlayEnabled ? 'true' : 'false');
    setTeamOverlayStatus(teamOverlayEnabled ? 'ON' : 'OFF');
  }

  syncTeamOverlayButton();

  function setAircraftRouteStatus(text) {
    if (!aircraftRouteStatus || aircraftRouteStatusText === text) return;
    aircraftRouteStatusText = text;
    aircraftRouteStatus.textContent = text;
  }

  function syncAircraftRouteButton() {
    if (!aircraftRouteButton) return;
    aircraftRouteButton.classList.toggle('active', aircraftRouteEnabled);
    aircraftRouteButton.setAttribute('aria-pressed', aircraftRouteEnabled ? 'true' : 'false');
    if (!aircraftRouteEnabled) setAircraftRouteStatus('OFF');
    else if (aircraftRoutePointCount === null) setAircraftRouteStatus('...');
    else if (aircraftRoutePointCount < 2) setAircraftRouteStatus('NO DATA');
    else setAircraftRouteStatus(`${aircraftRoutePointCount} PTS`);
  }

  syncAircraftRouteButton();

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

  // ── Weapon icon lazy-load ────────────────────────────────────────────────────
  // _WEAP_TO_ITEM is built at runtime from the bundled dictionaries.
  // Strategy: direct prefix swap Weap→Item_Weapon_ first; fallback to matching
  // by display name for the handful of cases where the suffixes differ
  // (e.g. WeapMosinNagant_C → "Mosin-Nagant" → Item_Weapon_Mosin_C).
  let _WEAP_TO_ITEM = {};
  const _dictReady = Promise.all([
    fetch('/pubg-api-assets/dictionaries/telemetry/damageCauserName.json').then(r => r.json()),
    fetch('/pubg-api-assets/dictionaries/telemetry/item/itemId.json').then(r => r.json()),
  ]).then(([dcn, items]) => {
    const nameToItem = {};
    for (const [id, name] of Object.entries(items)) {
      if (id.startsWith('Item_Weapon_') && !nameToItem[name]) nameToItem[name] = id;
    }
    for (const [key, name] of Object.entries(dcn)) {
      if (!key.startsWith('Weap')) continue;
      const direct = `Item_Weapon_${key.slice(4)}`;
      const resolved = items[direct] ? direct : (nameToItem[name] ?? null);
      if (resolved) _WEAP_TO_ITEM[key] = resolved;
    }
  });
  const _WEP_HANDGUNS = new Set([
    'Item_Weapon_DesertEagle_C','Item_Weapon_FlareGun_C','Item_Weapon_G18_C',
    'Item_Weapon_M1911_C','Item_Weapon_M9_C','Item_Weapon_NagantM1895_C',
    'Item_Weapon_Rhino_C','Item_Weapon_Sawnoff_C','Item_Weapon_vz61Skorpion_C',
  ]);
  const _WEP_MELEE = new Set([
    'Item_Weapon_Cowbar_C','Item_Weapon_Machete_C','Item_Weapon_Pan_C','Item_Weapon_Sickle_C',
  ]);
  const WEAPON_ICONS = {};
  function getWeaponIcon(causerName) {
    const itemId = _WEAP_TO_ITEM[causerName];
    if (!itemId) return null;
    if (!WEAPON_ICONS[itemId]) {
      const sub = _WEP_HANDGUNS.has(itemId) ? 'Handgun' : _WEP_MELEE.has(itemId) ? 'Melee' : 'Main';
      const img = new Image();
      img.src = `/pubg-api-assets/Assets/Icons/Item/Weapon/${sub}/${itemId}.png`;
      WEAPON_ICONS[itemId] = img;
    }
    return WEAPON_ICONS[itemId];
  }

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
  // telemetryReady guards against the race where z=0 tile loads AFTER the
  // telemetry promise resolves: without it, earlyRender would start after
  // animate() and clear the canvas every frame (showing only "Loading…").
  let earlyFrameId = null;
  let telemetryReady = false;

  function earlyRender() {
    if (telemetryReady) { earlyFrameId = null; return; }

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
    drawCtx.fillStyle = 'rgba(255,255,255,1)';
    drawCtx.textAlign = 'center';
    drawCtx.fillText('Loading telemetry…', VIEWPORT_WIDTH / 2, VIEWPORT_HEIGHT / 2);
    drawCtx.restore();

    earlyFrameId = requestAnimationFrame(earlyRender);
  }

  // Start as soon as z=0 tile is available (cached tile fires instantly).
  // Guard with telemetryReady so earlyRender never starts if telemetry
  // already resolved before the tile loaded.
  const z0tile = getTile(0, 0, 0);
  if (z0tile.complete && z0tile.naturalWidth > 0) {
    if (!telemetryReady) earlyFrameId = requestAnimationFrame(earlyRender);
  } else {
    z0tile.addEventListener('load', () => {
      if (!telemetryReady) earlyFrameId = requestAnimationFrame(earlyRender);
    }, { once: true });
  }

  function interpolate(a, b, t) { return a + (b - a) * t; }

  const POSITION_SPEED = {
    foot: 1350,
    footShort: 2200,
    airborne: 12000,
    dbno: 380,
    swim: 520,
    vehicle: 30000,
    correctionSlack: 2200,
  };

  const PARACHUTE_OPEN = {
    heightAboveLanding: 26000,
    maxHorizontalSpeed: 2200,
    maxVerticalDrop: 2800,
    fallbackSeconds: 18,
  };

  function characterAnchorState(character = {}, vehicle = null, options = {}) {
    const vehicleType = vehicle?.vehicleType || '';
    return {
      isDBNO: !!character.isDBNO,
      isInVehicle: !!character.isInVehicle || !!vehicleType,
      isAirborne: !!options.isAirborne,
      isSwimming: !!options.isSwimming,
      vehicleType,
      health: character.health,
    };
  }

  function isReplayBear(character = {}) {
    return String(character?.accountId || '').startsWith('Monster.Bear');
  }

  function maxAnchorSpeed(curr, next, timeDiff) {
    if (curr.isInVehicle || next.isInVehicle || curr.vehicleType || next.vehicleType) return POSITION_SPEED.vehicle;
    if (curr.isAirborne || next.isAirborne) return POSITION_SPEED.airborne;
    if (curr.isDBNO || next.isDBNO) return POSITION_SPEED.dbno;
    if (curr.isSwimming || next.isSwimming) return POSITION_SPEED.swim;
    return timeDiff <= 3 ? POSITION_SPEED.footShort : POSITION_SPEED.foot;
  }

  function shouldInterpolatePosition(curr, next, timeDiff) {
    const dist = Math.hypot(next.x - curr.x, next.y - curr.y);
    if (dist <= POSITION_SPEED.correctionSlack) return true;
    const speed = dist / Math.max(0.001, timeDiff);
    return speed <= maxAnchorSpeed(curr, next, timeDiff);
  }

  function positionBetweenAnchors(curr, next, elapsed) {
    const timeDiff = next.t - curr.t;
    if (timeDiff <= 0) return { x: curr.x, y: curr.y };
    if (!shouldInterpolatePosition(curr, next, timeDiff)) {
      const midpoint = curr.t + timeDiff / 2;
      return elapsed < midpoint ? { x: curr.x, y: curr.y } : { x: next.x, y: next.y };
    }
    const p = Math.max(0, Math.min(1, (elapsed - curr.t) / timeDiff));
    return {
      x: curr.x + (next.x - curr.x) * p,
      y: curr.y + (next.y - curr.y) * p,
    };
  }

  function damageHpAfter(item) {
    const hpBefore = Number(item.victim?.health);
    const damage = Number(item.damage) || 0;
    if (!Number.isFinite(hpBefore)) return 0;
    return Math.max(0, Math.min(100, hpBefore - damage));
  }

  function inferParachuteOpenTime(anchors, interval) {
    const points = anchors
      .filter(p => p.t >= interval.start - 0.25 && p.t <= interval.end + 0.25 && Number.isFinite(p.z))
      .sort((a, b) => a.t - b.t);

    if (points.length < 2) {
      return Math.max(interval.start, interval.end - PARACHUTE_OPEN.fallbackSeconds);
    }

    const landingPoint = points.find(p => p.t >= interval.end - 1) || points[points.length - 1];
    const landingZ = landingPoint.z;

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const dt = curr.t - prev.t;
      if (dt <= 0 || curr.t <= interval.start + 3) continue;

      const horizontalSpeed = Math.hypot(curr.x - prev.x, curr.y - prev.y) / dt;
      const verticalDrop = Math.max(0, prev.z - curr.z) / dt;
      const heightAboveLanding = curr.z - landingZ;

      if (heightAboveLanding <= PARACHUTE_OPEN.heightAboveLanding ||
          (horizontalSpeed <= PARACHUTE_OPEN.maxHorizontalSpeed &&
           verticalDrop <= PARACHUTE_OPEN.maxVerticalDrop)) {
        return curr.t;
      }
    }

    return Math.max(interval.start, interval.end - PARACHUTE_OPEN.fallbackSeconds);
  }

  // Use preloaded telemetry if available; if it resolved to null (fetch failed), retry fresh.
  const _fetchFresh = () => fetch(`/api/telemetry/${matchId}?platform=${platform}`).then(r => r.json());
  const _preloadedTelemetry = window._telemetryPreload?.[matchId];
  const _telPromise = _preloadedTelemetry ? _preloadedTelemetry.then(d => d ?? _fetchFresh()) : _fetchFresh();
  // Load dictionaries and telemetry in parallel — no extra latency.
  Promise.all([_dictReady, _telPromise]).then(([, data]) => {
      // Stop the early "loading" render loop now that we have data.
      // Set the flag first so earlyRender exits immediately even if it's
      // already queued (covers the race where z0 tile loads after telemetry).
      telemetryReady = true;
      if (earlyFrameId !== null) { cancelAnimationFrame(earlyFrameId); earlyFrameId = null; }

      const gameStateData = data
        .filter(item => item.gameState)
        .sort((a, b) => (a.gameState.elapsedTime ?? 0) - (b.gameState.elapsedTime ?? 0));
      const characterData = data.filter(item => item._T === 'LogPlayerPosition' && !isReplayBear(item.character));

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

      function isFiniteLocation(location) {
        return Number.isFinite(location?.x) && Number.isFinite(location?.y);
      }

      function routeLineForMap(a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.hypot(dx, dy) < 1) return null;

        const hits = [];
        const addHit = (x, y, t) => {
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t)) return;
          if (x < -0.5 || y < -0.5 || x > MAP_WIDTH + 0.5 || y > MAP_HEIGHT + 0.5) return;
          if (hits.some(hit => Math.hypot(hit.x - x, hit.y - y) < 1)) return;
          hits.push({
            x: Math.max(0, Math.min(MAP_WIDTH, x)),
            y: Math.max(0, Math.min(MAP_HEIGHT, y)),
            t,
          });
        };

        if (Math.abs(dx) > 0.0001) {
          let t = (0 - a.x) / dx;
          addHit(0, a.y + dy * t, t);
          t = (MAP_WIDTH - a.x) / dx;
          addHit(MAP_WIDTH, a.y + dy * t, t);
        }
        if (Math.abs(dy) > 0.0001) {
          let t = (0 - a.y) / dy;
          addHit(a.x + dx * t, 0, t);
          t = (MAP_HEIGHT - a.y) / dy;
          addHit(a.x + dx * t, MAP_HEIGHT, t);
        }

        if (hits.length < 2) return null;
        hits.sort((left, right) => left.t - right.t);
        return { start: hits[0], end: hits[hits.length - 1] };
      }

      function buildAircraftRoute(events) {
        const INITIAL_AIRCRAFT_SECONDS = 60;
        const LEAVE_SAMPLE_GRACE_SECONDS = 1.5;
        const LEAVE_SAMPLE_GRACE_MS = 1500;

        const elapsedForEvent = item => {
          const dMs = new Date(item._D).getTime();
          if (!Number.isFinite(dMs)) return null;
          if (gsTimeline.length) {
            const first = gsTimeline[0];
            if (dMs <= first.dMs) {
              return { dMs, elapsed: first.elapsed + (dMs - first.dMs) / 1000 };
            }
            const last = gsTimeline[gsTimeline.length - 1];
            if (dMs >= last.dMs) {
              return { dMs, elapsed: last.elapsed + (dMs - last.dMs) / 1000 };
            }
          }
          return { dMs, elapsed: dMsToElapsed(dMs) };
        };

        const dedupeSamples = points => {
          const ordered = points.slice().sort((a, b) => a.dMs - b.dMs);
          const samples = [];
          const seen = new Set();
          ordered.forEach(point => {
            const key = [
              Math.round(point.dMs / 1000),
              Math.round(point.x / 100),
              Math.round(point.y / 100),
            ].join(':');
            if (seen.has(key)) return;
            seen.add(key);
            samples.push(point);
          });
          return samples;
        };

        const initialLeaves = [];
        events.forEach(item => {
          if (item._T !== 'LogVehicleLeave') return;
          if (item.vehicle?.vehicleType !== 'TransportAircraft') return;
          const accountId = item.character?.accountId;
          if (!accountId || isReplayBear(item.character)) return;
          const timing = elapsedForEvent(item);
          if (!timing || timing.elapsed < 0 || timing.elapsed > INITIAL_AIRCRAFT_SECONDS) return;
          initialLeaves.push({
            accountId,
            name: item.character?.name || '',
            t: timing.elapsed,
            dMs: timing.dMs,
            location: item.vehicle?.location || item.character?.location,
          });
        });

        initialLeaves.sort((a, b) => (b.t - a.t) || (b.dMs - a.dMs));

        const positionPointsByAccount = new Map();
        events.forEach(item => {
          if (item._T !== 'LogPlayerPosition') return;
          if (item.vehicle?.vehicleType !== 'TransportAircraft') return;
          const accountId = item.character?.accountId;
          if (!accountId || isReplayBear(item.character)) return;
          const location = item.vehicle?.location || item.character?.location;
          if (!item._D || !isFiniteLocation(location)) return;
          const timing = elapsedForEvent(item);
          if (!timing || timing.elapsed < 0 || timing.elapsed > INITIAL_AIRCRAFT_SECONDS + LEAVE_SAMPLE_GRACE_SECONDS) return;
          if (!positionPointsByAccount.has(accountId)) positionPointsByAccount.set(accountId, []);
          positionPointsByAccount.get(accountId).push({
            t: timing.elapsed,
            dMs: timing.dMs,
            x: location.x,
            y: location.y,
            z: Number.isFinite(location.z) ? location.z : 0,
            eventType: item._T,
            accountId,
          });
        });

        let selected = null;
        let samples = [];
        for (const leave of initialLeaves) {
          const raw = (positionPointsByAccount.get(leave.accountId) || [])
            .filter(point =>
              point.dMs <= leave.dMs + LEAVE_SAMPLE_GRACE_MS &&
              point.t <= leave.t + LEAVE_SAMPLE_GRACE_SECONDS
            );
          const deduped = dedupeSamples(raw);
          if (deduped.length >= 2) {
            selected = leave;
            samples = deduped;
            break;
          }
        }

        if (!selected && initialLeaves.length >= 2) {
          samples = dedupeSamples(initialLeaves
            .slice()
            .sort((a, b) => a.dMs - b.dMs)
            .filter(leave => isFiniteLocation(leave.location))
            .map(leave => ({
              t: leave.t,
              dMs: leave.dMs,
              x: leave.location.x,
              y: leave.location.y,
              z: Number.isFinite(leave.location.z) ? leave.location.z : 0,
              eventType: 'LogVehicleLeave',
              accountId: leave.accountId,
            })));
        }

        if (!samples.length) return { samples: [], segment: null, selected };

        const seen = new Set();
        samples = samples.filter(point => {
          const key = [
            Math.round(point.x / 100),
            Math.round(point.y / 100),
          ].join(':');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        let start = samples[0] || null;
        let end = samples[samples.length - 1] || null;
        if (samples.length >= 2 && Math.hypot(end.x - start.x, end.y - start.y) < 1000) {
          let best = null;
          for (let i = 0; i < samples.length - 1; i++) {
            for (let j = i + 1; j < samples.length; j++) {
              const dist = Math.hypot(samples[j].x - samples[i].x, samples[j].y - samples[i].y);
              if (!best || dist > best.dist) best = { a: samples[i], b: samples[j], dist };
            }
          }
          if (best) {
            start = best.a.dMs <= best.b.dMs ? best.a : best.b;
            end = best.a.dMs <= best.b.dMs ? best.b : best.a;
          }
        }

        const segment = start && end ? routeLineForMap(start, end) : null;
        return { samples, segment, selected };
      }

      const aircraftRoute = buildAircraftRoute(data);
      aircraftRoutePointCount = aircraftRoute.samples.length;
      syncAircraftRouteButton();

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

      const playerAirborneIntervals = {};
      const playerFirstAircraftExitTime = {};
      data.forEach(item => {
        if (item._T === 'LogVehicleLeave' &&
          item.vehicle?.vehicleType === 'TransportAircraft' &&
          item._D &&
          item.character?.accountId) {
          const id = item.character.accountId;
          const t = dMsToElapsed(new Date(item._D).getTime());
          if (playerFirstAircraftExitTime[id] === undefined || t < playerFirstAircraftExitTime[id]) {
            playerFirstAircraftExitTime[id] = t;
          }
          if (!playerAirborneIntervals[id]) playerAirborneIntervals[id] = [];
          playerAirborneIntervals[id].push({ start: t, end: null });
        }
      });
      data.forEach(item => {
        if (item._T === 'LogParachuteLanding' && item._D && item.character?.accountId) {
          const id = item.character.accountId;
          const t = dMsToElapsed(new Date(item._D).getTime());
          const intervals = playerAirborneIntervals[id];
          if (!intervals) return;
          for (let i = intervals.length - 1; i >= 0; i--) {
            if (intervals[i].end === null && t > intervals[i].start) {
              intervals[i].end = t;
              break;
            }
          }
        }
      });

      function isPlayerAirborne(accountId, elapsed) {
        const intervals = playerAirborneIntervals[accountId];
        if (!intervals) return false;
        for (const iv of intervals)
          if (elapsed >= iv.start && (iv.end === null || elapsed < iv.end)) return true;
        return false;
      }

      function hasPlayerExitedAircraft(accountId, elapsed) {
        const firstExit = playerFirstAircraftExitTime[accountId];
        return firstExit === undefined || elapsed >= firstExit - 0.05;
      }

      const players = {};

      characterData.forEach(item => {
        const id = item.character.accountId;
        if (!players[id]) players[id] = [];
        const t = dMsToElapsed(new Date(item._D).getTime());
        if (t <= 9) return;
        if (!hasPlayerExitedAircraft(id, t)) return;
        if (isPlayerDead(id, t)) return;
        const state = characterAnchorState(item.character, item.vehicle, {
          isAirborne: isPlayerAirborne(id, t),
        });
        players[id].push({
          t,
          x: item.character.location.x,
          y: item.character.location.y,
          z: item.character.location.z,
          vehicleType: state.vehicleType,
          isInVehicle: state.isInVehicle,
          isDBNO: state.isDBNO,
          isAirborne: state.isAirborne,
          isSwimming: state.isSwimming,
          health: state.health,
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
        const addPoint = (character, vehicle = null, options = {}) => {
          const accountId = character?.accountId;
          const location = character?.location;
          if (isReplayBear(character)) return;
          if (!accountId || !location || !players[accountId]) return;
          if (!hasPlayerExitedAircraft(accountId, t)) return;
          if (isPlayerDead(accountId, t)) return;
          const state = characterAnchorState(character, vehicle, {
            ...options,
            isAirborne: options.isAirborne || isPlayerAirborne(accountId, t),
          });
          players[accountId].push({
            t,
            x: location.x,
            y: location.y,
            z: location.z,
            vehicleType: state.vehicleType,
            isInVehicle: state.isInVehicle,
            isDBNO: state.isDBNO,
            isAirborne: state.isAirborne,
            isSwimming: state.isSwimming,
            health: state.health,
            isKeyframe: false,
          });
        };
        if (CHAR_LOC_EVENTS.has(item._T)) {
          addPoint(item.character, item.vehicle, { isSwimming: item._T === 'LogSwimStart' });
        } else if (item._T === 'LogPlayerAttack') {
          addPoint(item.attacker, item.vehicle);
        } else if (['LogPlayerTakeDamage', 'LogPlayerMakeGroggy', 'LogVehicleDamage',
          'LogArmorDestroy', 'LogPlayerUseThrowable'].includes(item._T)) {
          addPoint(item.attacker, item.vehicle);
          addPoint(item.victim, item.vehicle);
        } else if (['LogPlayerRevive', 'LogPlayerKillV2', 'LogPlayerKill'].includes(item._T)) {
          addPoint(item.character, item.vehicle);
          addPoint(item.reviver, item.vehicle);
          addPoint(item.killer || item.attacker, item.vehicle);
          addPoint(item.victim, item.vehicle);
        }
      });

      Object.values(players).forEach(pts => pts.sort((a, b) => a.t - b.t));

      const playerParachuteIntervals = {};
      Object.entries(playerAirborneIntervals).forEach(([accountId, intervals]) => {
        const anchors = players[accountId] || [];
        intervals.forEach(interval => {
          if (interval.end === null || interval.end <= interval.start) return;
          const start = inferParachuteOpenTime(anchors, interval);
          if (start >= interval.end) return;
          if (!playerParachuteIntervals[accountId]) playerParachuteIntervals[accountId] = [];
          playerParachuteIntervals[accountId].push({ start, end: interval.end });
        });
      });

      function isPlayerParachuting(accountId, elapsed) {
        const intervals = playerParachuteIntervals[accountId];
        if (!intervals) return false;
        for (const iv of intervals)
          if (elapsed >= iv.start && elapsed < iv.end) return true;
        return false;
      }

      const playerLocationsByTime = {};
      const playerVehicleByTime = {};
      const playerHpByTime = {};
      const playerHpTimeline = {};
      const playerPositionTimeline = {};

      Object.keys(players).forEach(accountId => {
        const anchors = players[accountId];
        const byTime = {}, byVehicle = {}, byHp = {};

        for (let i = 0; i < anchors.length - 1; i++) {
          const curr = anchors[i], next = anchors[i + 1];
          const timeDiff = next.t - curr.t;
          if (timeDiff <= 0) continue;
          if (!shouldInterpolatePosition(curr, next, timeDiff)) {
            const currT = Math.round(curr.t);
            const nextT = Math.round(next.t);
            if (!byTime[currT]) byTime[currT] = { x: curr.x, y: curr.y };
            if (!byTime[nextT]) byTime[nextT] = { x: next.x, y: next.y };
            if (curr.vehicleType && curr.vehicleType !== 'TransportAircraft') byVehicle[currT] = curr.vehicleType;
            if (next.vehicleType && next.vehicleType !== 'TransportAircraft') byVehicle[nextT] = next.vehicleType;
            continue;
          }
          const steps = Math.max(1, Math.floor(timeDiff));
          for (let j = 0; j <= steps; j++) {
            const t = Math.round(curr.t + j);
            if (byTime[t]) continue;
            const p = j / steps;
            byTime[t] = { x: curr.x + (next.x - curr.x) * p, y: curr.y + (next.y - curr.y) * p };
            const vt = curr.vehicleType || next.vehicleType;
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
          if (a.health !== undefined) byHp[t] = Math.max(0, Math.min(100, a.health));
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
        playerPositionTimeline[accountId] = anchors;
        playerHpTimeline[accountId] = anchors
          .filter(a => a.isKeyframe && a.health !== undefined)
          .map((a, index) => ({ t: a.t, hp: Math.max(0, Math.min(100, a.health)), order: index }))
          .sort((a, b) => a.t - b.t || a.order - b.order);
      });

      const damageByVictim = {};
      data.forEach(item => {
        if (item._T !== 'LogPlayerTakeDamage' || !item._D) return;
        const vic = item.victim;
        if (!vic?.accountId) return;
        const t = dMsToElapsed(new Date(item._D).getTime());
        if (!damageByVictim[vic.accountId]) damageByVictim[vic.accountId] = [];
        damageByVictim[vic.accountId].push({
          t,
          damage: item.damage || 0,
          hpBefore: Number.isFinite(Number(vic.health)) ? Number(vic.health) : undefined,
          hpAfter: damageHpAfter(item),
        });
      });

      Object.entries(damageByVictim).forEach(([accountId, hits]) => {
        const byHp = playerHpByTime[accountId];
        if (!byHp) return;
        hits.sort((a, b) => a.t - b.t);

        const hpTimeline = playerHpTimeline[accountId] || [];
        hits.forEach((hit, index) => {
          hpTimeline.push({ t: hit.t, hp: hit.hpAfter, order: 100000 + index });
        });
        hpTimeline.sort((a, b) => a.t - b.t || a.order - b.order);
        playerHpTimeline[accountId] = hpTimeline;

        const kfTimes = (players[accountId] || [])
          .filter(p => p.isKeyframe)
          .map(p => Math.round(p.t))
          .sort((a, b) => a - b);

        for (let ki = 0; ki < kfTimes.length - 1; ki++) {
          const kfStart = kfTimes[ki];
          const kfEnd = kfTimes[ki + 1];
          const group = hits.filter(h => h.t > kfStart && h.t <= kfEnd);
          if (!group.length) continue;

          group.forEach(hit => {
            byHp[Math.ceil(hit.t - 0.001)] = hit.hpAfter;
          });

          const hitTimes = group.map(h => Math.ceil(h.t - 0.001)).sort((a, b) => a - b);
          for (let hi = 0; hi < hitTimes.length; hi++) {
            const from = hitTimes[hi];
            const to = hi + 1 < hitTimes.length ? hitTimes[hi + 1] : kfEnd;
            const hp = byHp[from];
            for (let s = from + 1; s < to; s++) byHp[s] = hp;
          }
        }
      });

      function getPlayerHpAt(accountId, elapsed) {
        const timeline = playerHpTimeline[accountId];
        if (timeline?.length) {
          let lo = 0, hi = timeline.length - 1, best = -1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (timeline[mid].t <= elapsed + 0.001) {
              best = mid;
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }
          if (best >= 0) return timeline[best].hp;
        }
        const rounded = Math.max(0, Math.floor(elapsed));
        return playerHpByTime[accountId]?.[rounded] ?? 100;
      }

      function getPlayerPositionAt(accountId, elapsed) {
        const timeline = playerPositionTimeline[accountId];
        if (!timeline?.length) return null;

        let lo = 0, hi = timeline.length - 1, prevIndex = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (timeline[mid].t <= elapsed + 0.001) {
            prevIndex = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }

        if (prevIndex < 0) return null;
        const curr = timeline[prevIndex];
        const next = timeline[prevIndex + 1];
        if (!next) return { x: curr.x, y: curr.y };
        return positionBetweenAnchors(curr, next, elapsed);
      }

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
          isKnock: true, eventKind: 'knock', t,
          iconKey: killfeedIconKey(item.damageCauserName, kDmgType, kDmgReason, true),
          weaponId: item.damageCauserName || '',
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
          isKnock: false,
          eventKind: killer.name && killer.accountId !== victim.accountId ? 'kill' : 'death',
          t,
          iconKey: killfeedIconKey(causerName, dmgType, dmgReason, false),
          weaponId: causerName || '',
        });
      });

      feedEvents.sort((a, b) => a.t - b.t);

      // Build accountId → {teamNum, color} from match rosters so the killfeed
      // can show coloured team-number badges next to each name.
      const _acctToTeam = {};
      globalMatchData.included.filter(p => p.type === 'participant').forEach(p => {
        const accountId = p.attributes?.stats?.playerId;
        if (!accountId) return;
        const roster = globalMatchData.included.filter(r => r.type === 'roster')
          .find(r => r.relationships.participants.data.some(ref => ref.id === p.id));
        if (roster) _acctToTeam[accountId] = {
          teamNum:   roster.attributes.stats.rank,
          teamColor: roster.color || '#888',
        };
      });
      feedEvents.forEach(e => {
        const ki = _acctToTeam[e.killerAccountId];
        const vi = _acctToTeam[e.victimAccountId];
        e.killerTeamNum   = ki?.teamNum   ?? null;
        e.killerTeamColor = ki?.teamColor ?? null;
        e.victimTeamNum   = vi?.teamNum   ?? null;
        e.victimTeamColor = vi?.teamColor ?? null;
      });

      const bulletEvents = [];
      data.forEach(item => {
        if (item._T !== 'LogPlayerTakeDamage' || !item._D || item.damageTypeCategory !== 'Damage_Gun') return;
        if (!item.attacker?.accountId || !item.victim?.accountId) return;
        const al = item.attacker?.location;
        const vl = item.victim?.location;
        if (!al || !vl) return;
        const t = dMsToElapsed(new Date(item._D).getTime());
        bulletEvents.push({
          t: Math.max(0, t - 0.12),
          impactT: t,
          duration: 0.62,
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
      const searchedAccountId = _searchedParticipant?.attributes?.stats?.playerId ?? null;
      const searchedTeamId = _searchedRoster?.attributes?.stats?.teamId ?? null;

      const teamIdByAccount = {};
      globalMatchData.included.filter(p => p.type === 'participant').forEach(p => {
        const accountId = p.attributes?.stats?.playerId;
        if (!accountId) return;
        const roster = globalMatchData.included.filter(r => r.type === 'roster')
          .find(r => r.relationships.participants.data.some(ref => ref.id === p.id));
        if (roster) teamIdByAccount[accountId] = roster.attributes?.stats?.teamId ?? null;
      });

      const teamMetaById = {};
      globalMatchData.included.filter(r => r.type === 'roster').forEach(roster => {
        const stats = roster.attributes?.stats || {};
        const teamId = stats.teamId;
        if (teamId === null || teamId === undefined) return;
        teamMetaById[teamId] = {
          teamId,
          teamNum: stats.rank || teamId,
          color: roster.color || '#ffffff',
          totalPlayers: roster.relationships?.participants?.data?.length || 0,
        };
      });

      const gameStatesWithPhase = [];
      let circlePhase = 0;
      let lastWarningRadius = null;
      gameStateData.forEach(item => {
        const gs = item.gameState;
        const warningRadius = gs.poisonGasWarningRadius ?? gs.safetyZoneRadius ?? 0;
        if (warningRadius > 0) {
          if (lastWarningRadius === null || lastWarningRadius <= 0) circlePhase = Math.max(circlePhase, 1);
          else if (warningRadius < lastWarningRadius * 0.85) circlePhase++;
          lastWarningRadius = warningRadius;
        }
        gameStatesWithPhase.push({ ...gs, phase: Math.max(circlePhase, 1) });
      });

      const interpolatedData = [];
      for (let i = 0; i < gameStatesWithPhase.length - 1; i++) {
        const curr = gameStatesWithPhase[i], next = gameStatesWithPhase[i + 1];
        interpolatedData.push(curr);
        const timeDiff = next.elapsedTime - curr.elapsedTime;
        if (timeDiff > 1) {
          for (let j = 1; j < timeDiff; j++) {
            const p = j / timeDiff;
            interpolatedData.push({
              elapsedTime: curr.elapsedTime + j,
              phase: curr.phase,
              safetyZoneRadius: interpolate(curr.safetyZoneRadius, next.safetyZoneRadius, p),
              safetyZonePosition: { x: interpolate(curr.safetyZonePosition.x, next.safetyZonePosition.x, p), y: interpolate(curr.safetyZonePosition.y, next.safetyZonePosition.y, p) },
              poisonGasWarningRadius: curr.poisonGasWarningRadius,
              poisonGasWarningPosition: { x: curr.poisonGasWarningPosition.x, y: curr.poisonGasWarningPosition.y },
            });
          }
        }
      }
      interpolatedData.push(gameStatesWithPhase[gameStatesWithPhase.length - 1]);

      let subProgress = 0;

      const progressBar = document.getElementById('progressBar');
      const progressThumb = document.getElementById('replayProgressThumb');
      progressBar.addEventListener('mousedown', e => e.stopPropagation());
      progressBar.addEventListener('touchstart', e => e.stopPropagation());
      progressBar.max = interpolatedData.length - 1;
      let currentIndex = 0;
      const timerElement = document.getElementById('timer');

      function syncProgressThumb(value = Number(progressBar.value) || 0) {
        if (!progressThumb) return;
        const max = Number(progressBar.max) || 0;
        const ratio = max > 0 ? Math.max(0, Math.min(1, (Number(value) || 0) / max)) : 0;
        const edgePx = 5;
        progressThumb.style.setProperty(
          '--replay-progress-thumb-left',
          `calc(${(ratio * 100).toFixed(4)}% + ${(edgePx - ratio * edgePx * 2).toFixed(3)}px)`
        );
      }

      function drawSafeZone(radius, position, color) {
        drawCtx.lineWidth = 2 / (scaleFactor * zoomScale);
        drawCtx.strokeStyle = color;
        drawCtx.beginPath();
        drawCtx.arc(position.x, position.y, radius, 0, 2 * Math.PI);
        drawCtx.stroke();
      }

      function drawGasOverlay(radius, position) {
        if (!Number.isFinite(radius) || radius <= 0 || !isFiniteLocation(position)) return;
        drawCtx.save();
        drawCtx.fillStyle = 'rgba(0, 0, 255, 0.50)';
        drawCtx.beginPath();
        drawCtx.rect(0, 0, MAP_WIDTH, MAP_HEIGHT);
        drawCtx.arc(position.x, position.y, radius, 0, 2 * Math.PI, true);
        drawCtx.fill('evenodd');
        drawCtx.restore();
      }

      function updateSafeZone() { subProgress = 0; renderFrame(); }

      teamOverlayButton?.addEventListener('click', () => {
        teamOverlayEnabled = !teamOverlayEnabled;
        try { localStorage.setItem('pi_teamOverlay', teamOverlayEnabled ? '1' : '0'); } catch (_) {}
        syncTeamOverlayButton();
        updateSafeZone();
      });

      aircraftRouteButton?.addEventListener('click', () => {
        aircraftRouteEnabled = !aircraftRouteEnabled;
        try { localStorage.setItem('pi_aircraftRoute', aircraftRouteEnabled ? '1' : '0'); } catch (_) {}
        syncAircraftRouteButton();
        updateSafeZone();
      });

      progressBar.addEventListener('input', function () { currentIndex = parseInt(progressBar.value); updateSafeZone(); });

      let isDragging = false, lastX, lastY;
      let _clickOriginX = 0, _clickOriginY = 0;

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

      viewport.addEventListener('mousedown', e => {
        isDragging = true;
        lastX = e.clientX; lastY = e.clientY;
        _clickOriginX = e.clientX; _clickOriginY = e.clientY;
        e.preventDefault();
      });
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

      // Shared hit-test: returns the closest alive player accountId within hit radius, or null.
      function playerAtScreen(clientX, clientY) {
        const rect = viewport.getBoundingClientRect();
        const sx = clientX - rect.left, sy = clientY - rect.top;
        const gx = panX + sx / (scaleFactor * zoomScale);
        const gy = panY + sy / (scaleFactor * zoomScale);
        const ps = window._replayPlayerSize ?? 6;
        const hitRadius = Math.max(ps * 3, 10) / (scaleFactor * zoomScale);
        const currentElapsed = (interpolatedData[currentIndex]?.elapsedTime ?? 0) + subProgress;
        let closest = null, closestDist = hitRadius;
        Object.keys(playerPositionTimeline).forEach(accountId => {
          if (isPlayerDead(accountId, currentElapsed)) return;
          const loc = getPlayerPositionAt(accountId, currentElapsed);
          if (!loc) return;
          const d = Math.hypot(loc.x - gx, loc.y - gy);
          if (d < closestDist) { closestDist = d; closest = accountId; }
        });
        return closest;
      }

      // Cursor: pointer when hovering a player dot, default otherwise.
      viewport.addEventListener('mousemove', function(e) {
        if (isDragging) { viewport.style.cursor = 'grabbing'; return; }
        viewport.style.cursor = playerAtScreen(e.clientX, e.clientY) ? 'pointer' : '';
      });

      // Click on a player dot → pin/unpin their team panel
      viewport.addEventListener('click', function(e) {
        // Ignore if the mouse moved (drag, not click)
        const dx = e.clientX - _clickOriginX, dy = e.clientY - _clickOriginY;
        if (dx * dx + dy * dy > 25) return; // > 5px movement = drag
        const closest = playerAtScreen(e.clientX, e.clientY);
        if (closest) window.pinTeamByAccountId?.(closest);
      });

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

      function alivePlayersAt(elapsed) {
        const players = [];
        Object.keys(playerPositionTimeline).forEach(accountId => {
          if (isPlayerDead(accountId, elapsed)) return;
          const loc = getPlayerPositionAt(accountId, elapsed);
          if (!loc) return;
          const hp = getPlayerHpAt(accountId, elapsed);
          if (hp <= 0) return;
          players.push({
            accountId,
            x: loc.x,
            y: loc.y,
            health: hp,
            teamId: teamIdByAccount[accountId] ?? null,
          });
        });
        return players;
      }

      function teamCentroidAt(alivePlayers, teamId) {
        if (teamId === null || teamId === undefined) return null;
        const own = alivePlayers.filter(p => p.teamId === teamId);
        if (!own.length) return null;
        return {
          x: own.reduce((sum, p) => sum + p.x, 0) / own.length,
          y: own.reduce((sum, p) => sum + p.y, 0) / own.length,
        };
      }

      function teamOverlayPlayersAt(elapsed) {
        const players = [];
        Object.keys(playerPositionTimeline).forEach(accountId => {
          if (isPlayerDead(accountId, elapsed)) return;
          const loc = getPlayerPositionAt(accountId, elapsed);
          if (!loc) return;
          const teamId = teamIdByAccount[accountId] ?? null;
          if (teamId === null || teamId === undefined) return;
          players.push({
            accountId,
            x: loc.x,
            y: loc.y,
            health: getPlayerHpAt(accountId, elapsed),
            knocked: isPlayerKnocked(accountId, elapsed),
            teamId,
          });
        });
        return players;
      }

      function teamSplitDistance() {
        const mapExtent = Math.max(MAP_WIDTH, MAP_HEIGHT);
        return Math.max(12000, Math.min(46000, mapExtent * 0.052));
      }

      function drawTeamBadge(label) {
        const sx = (label.x - panX) * scaleFactor * zoomScale;
        const sy = (label.y - panY) * scaleFactor * zoomScale;
        if (sx < -48 || sy < -32 || sx > VIEWPORT_WIDTH + 48 || sy > VIEWPORT_HEIGHT + 32) return;

        const x = Math.max(8, Math.min(VIEWPORT_WIDTH - 8, sx));
        const y = Math.max(8, Math.min(VIEWPORT_HEIGHT - 8, sy));
        const main = String(label.teamNum);
        const sub = label.split ? `${label.memberCount}/${label.aliveCount}` : String(label.aliveCount);

        drawCtx.font = 'bold 11px "JetBrains Mono", monospace';
        const mainW = drawCtx.measureText(main).width;
        drawCtx.font = 'bold 9px "JetBrains Mono", monospace';
        const subW = drawCtx.measureText(sub).width;
        const w = Math.max(30, Math.ceil(mainW + subW + 18));
        const h = 20;
        const bx = Math.round(x - w / 2);
        const by = Math.round(y - h / 2);

        drawCtx.fillStyle = 'rgba(0,0,0,0.72)';
        drawCtx.strokeStyle = label.color;
        drawCtx.lineWidth = 1;
        drawCtx.beginPath();
        if (drawCtx.roundRect) drawCtx.roundRect(bx, by, w, h, 4);
        else drawCtx.rect(bx, by, w, h);
        drawCtx.fill();
        drawCtx.stroke();

        drawCtx.fillStyle = label.color;
        drawCtx.beginPath();
        if (drawCtx.roundRect) drawCtx.roundRect(bx + 3, by + 4, 4, h - 8, 2);
        else drawCtx.rect(bx + 3, by + 4, 4, h - 8);
        drawCtx.fill();

        drawCtx.textBaseline = 'middle';
        drawCtx.textAlign = 'left';
        drawCtx.font = 'bold 11px "JetBrains Mono", monospace';
        drawCtx.fillStyle = '#ffffff';
        drawCtx.fillText(main, bx + 10, by + h / 2 + 0.5);

        drawCtx.font = 'bold 9px "JetBrains Mono", monospace';
        drawCtx.fillStyle = 'rgba(255,255,255,0.68)';
        drawCtx.fillText(sub, bx + 12 + mainW, by + h / 2 + 0.5);
      }

      function drawTeamOverlayLabels(labels) {
        if (!labels?.length) return;
        drawCtx.save();
        drawCtx.setTransform(1, 0, 0, 1, 0, 0);
        labels.forEach(drawTeamBadge);
        drawCtx.restore();
      }

      function drawTeamOverlay(currentElapsed) {
        if (!teamOverlayEnabled) {
          setTeamOverlayStatus('OFF');
          return [];
        }

        const byTeam = new Map();
        teamOverlayPlayersAt(currentElapsed).forEach(player => {
          if (!byTeam.has(player.teamId)) byTeam.set(player.teamId, []);
          byTeam.get(player.teamId).push(player);
        });

        const splitDistance = teamSplitDistance();
        const labels = [];
        let clusterCount = 0;

        byTeam.forEach((members, teamId) => {
          const meta = teamMetaById[teamId] || {};
          const color = meta.color || '#ffffff';
          const clusters = clusterTeamPlayers(members, { splitDistance, maxClusters: 2 });
          if (!clusters.length) return;
          clusterCount += clusters.length;

          if (clusters.length > 1) {
            const primary = clusters[0];
            drawCtx.save();
            drawCtx.strokeStyle = color;
            drawCtx.globalAlpha = 0.32;
            drawCtx.lineWidth = 1.4 / (scaleFactor * zoomScale);
            drawCtx.setLineDash([8 / (scaleFactor * zoomScale), 7 / (scaleFactor * zoomScale)]);
            clusters.slice(1).forEach(cluster => {
              drawCtx.beginPath();
              drawCtx.moveTo(primary.center.x, primary.center.y);
              drawCtx.lineTo(cluster.center.x, cluster.center.y);
              drawCtx.stroke();
            });
            drawCtx.restore();
          }

          clusters.forEach((cluster, index) => {
            const isPrimary = index === 0;
            const radius = Math.max(
              splitDistance * (cluster.memberCount > 1 ? 0.18 : 0.12),
              cluster.radius + splitDistance * 0.08
            );

            drawCtx.save();
            drawCtx.fillStyle = color;
            drawCtx.globalAlpha = isPrimary ? 0.14 : 0.09;
            drawCtx.beginPath();
            drawCtx.arc(cluster.center.x, cluster.center.y, radius, 0, 2 * Math.PI);
            drawCtx.fill();

            drawCtx.strokeStyle = color;
            drawCtx.globalAlpha = isPrimary ? 0.72 : 0.48;
            drawCtx.lineWidth = (isPrimary ? 2 : 1.4) / (scaleFactor * zoomScale);
            if (!isPrimary) drawCtx.setLineDash([5 / (scaleFactor * zoomScale), 5 / (scaleFactor * zoomScale)]);
            drawCtx.beginPath();
            drawCtx.arc(cluster.center.x, cluster.center.y, radius, 0, 2 * Math.PI);
            drawCtx.stroke();

            if (cluster.memberCount > 1) {
              drawCtx.globalAlpha = 0.18;
              drawCtx.lineWidth = 0.9 / (scaleFactor * zoomScale);
              cluster.players.forEach(player => {
                drawCtx.beginPath();
                drawCtx.moveTo(cluster.center.x, cluster.center.y);
                drawCtx.lineTo(player.x, player.y);
                drawCtx.stroke();
              });
            }
            drawCtx.restore();

            labels.push({
              x: cluster.center.x,
              y: cluster.center.y,
              teamNum: meta.teamNum || teamId,
              memberCount: cluster.memberCount,
              aliveCount: members.length,
              color,
              split: clusters.length > 1,
            });
          });
        });

        setTeamOverlayStatus(`${byTeam.size}T/${clusterCount}G`);
        return labels;
      }

      function drawParachuteIcon(x, y, pointSize) {
        const w = pointSize * 5.1;
        const h = pointSize * 4.2;
        const topY = y - pointSize * 5.7;
        const bottomY = topY + h * 0.62;
        const attachY = y - pointSize * 0.85;
        const left = x - w / 2;
        const right = x + w / 2;
        const ribPoints = [
          { x: left, y: bottomY },
          { x: x - w * 0.25, y: bottomY },
          { x, y: bottomY },
          { x: x + w * 0.25, y: bottomY },
          { x: right, y: bottomY },
        ];

        drawCtx.save();
        drawCtx.lineCap = 'round';
        drawCtx.lineJoin = 'round';

        drawCtx.strokeStyle = 'rgba(0,0,0,0.82)';
        drawCtx.lineWidth = pointSize * 0.32;
        ribPoints.forEach(p => {
          drawCtx.beginPath();
          drawCtx.moveTo(p.x, p.y);
          drawCtx.lineTo(x, attachY);
          drawCtx.stroke();
        });

        drawCtx.beginPath();
        drawCtx.moveTo(left, bottomY);
        drawCtx.quadraticCurveTo(x - w * 0.43, topY + h * 0.06, x, topY);
        drawCtx.quadraticCurveTo(x + w * 0.43, topY + h * 0.06, right, bottomY);
        drawCtx.quadraticCurveTo(x + w * 0.38, bottomY - h * 0.15, x + w * 0.25, bottomY);
        drawCtx.quadraticCurveTo(x + w * 0.13, bottomY - h * 0.15, x, bottomY);
        drawCtx.quadraticCurveTo(x - w * 0.13, bottomY - h * 0.15, x - w * 0.25, bottomY);
        drawCtx.quadraticCurveTo(x - w * 0.38, bottomY - h * 0.15, left, bottomY);
        drawCtx.closePath();
        drawCtx.fillStyle = 'rgba(18,18,20,0.94)';
        drawCtx.strokeStyle = 'rgba(255,255,255,0.95)';
        drawCtx.lineWidth = pointSize * 0.18;
        drawCtx.fill();
        drawCtx.stroke();

        drawCtx.strokeStyle = 'rgba(255,255,255,0.88)';
        drawCtx.lineWidth = pointSize * 0.12;
        ribPoints.slice(1, -1).forEach(p => {
          drawCtx.beginPath();
          drawCtx.moveTo(x, topY + pointSize * 0.1);
          drawCtx.quadraticCurveTo((x + p.x) / 2, topY + h * 0.26, p.x, p.y - pointSize * 0.05);
          drawCtx.stroke();
        });

        drawCtx.strokeStyle = 'rgba(255,255,255,0.70)';
        drawCtx.lineWidth = pointSize * 0.10;
        ribPoints.forEach(p => {
          drawCtx.beginPath();
          drawCtx.moveTo(p.x, p.y + pointSize * 0.12);
          drawCtx.lineTo(x, attachY);
          drawCtx.stroke();
        });

        drawCtx.restore();
      }

      function drawAircraftRoute(currentElapsed) {
        const segment = aircraftRoute?.segment;
        if (!aircraftRouteEnabled || !segment) return;

        const px = 1 / scaleFactor;
        const rawStart = segment.start;
        const rawEnd = segment.end;
        const dx = rawEnd.x - rawStart.x;
        const dy = rawEnd.y - rawStart.y;
        const length = Math.hypot(dx, dy);
        if (length <= 1) return;

        const trim = 0.15;
        const start = {
          x: rawStart.x + dx * trim,
          y: rawStart.y + dy * trim,
        };
        const end = {
          x: rawStart.x + dx * (1 - trim),
          y: rawStart.y + dy * (1 - trim),
        };
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const routeLineWidth = 3.06 * px;
        const dash = 20 * px;
        const gap = dash;
        const dashPeriod = dash + gap;
        const dashSpeedPxPerSecond = 26;
        const dashOffset = -(((performance.now() / 1000) * dashSpeedPxPerSecond) % (dashPeriod / px)) * px;
        const arrowLength = 12 * px;
        const arrowWidth = 7.2 * px;
        const dotRadius = arrowWidth;
        const rawLengthSq = dx * dx + dy * dy;
        const sampleProgress = point => {
          if (!point || rawLengthSq <= 0) return null;
          return ((point.x - rawStart.x) * dx + (point.y - rawStart.y) * dy) / rawLengthSq;
        };
        const samples = (aircraftRoute.samples || [])
          .filter(point => Number.isFinite(point?.t) && Number.isFinite(point?.x) && Number.isFinite(point?.y));
        const projectedSamples = samples
          .map(point => ({ t: point.t, progress: sampleProgress(point) }))
          .filter(point => Number.isFinite(point.t) && Number.isFinite(point.progress));
        let routeStartT = Number.isFinite(projectedSamples[0]?.t) ? projectedSamples[0].t : 0;
        let routeEndT = Number.isFinite(projectedSamples[projectedSamples.length - 1]?.t)
          ? projectedSamples[projectedSamples.length - 1].t
          : routeStartT + 1;
        if (projectedSamples.length >= 2) {
          const meanT = projectedSamples.reduce((sum, point) => sum + point.t, 0) / projectedSamples.length;
          const meanProgress = projectedSamples.reduce((sum, point) => sum + point.progress, 0) / projectedSamples.length;
          let covariance = 0;
          let variance = 0;
          projectedSamples.forEach(point => {
            const progressDelta = point.progress - meanProgress;
            covariance += progressDelta * (point.t - meanT);
            variance += progressDelta * progressDelta;
          });
          const secondsPerProgress = variance > 0 ? covariance / variance : 0;
          if (Number.isFinite(secondsPerProgress) && secondsPerProgress > 0) {
            routeStartT = meanT - meanProgress * secondsPerProgress;
            routeEndT = routeStartT + secondsPerProgress;
          }
        }
        const routeDuration = routeEndT - routeStartT;
        const planeProgress = routeDuration > 0
          ? ((Number(currentElapsed) || 0) - routeStartT) / routeDuration
          : 0;
        const planePosition = {
          x: rawStart.x + dx * planeProgress,
          y: rawStart.y + dy * planeProgress,
        };
        const routeComplete = planeProgress >= 1 - trim;
        const lineOpacity = routeComplete ? 0.40 : 0.90;
        const dashStartProgress = Math.max(trim, Math.min(1 - trim, planeProgress));
        const dashStart = {
          x: rawStart.x + dx * dashStartProgress,
          y: rawStart.y + dy * dashStartProgress,
        };

        function getWhiteAircraftRouteImg() {
          if (aircraftRouteWhiteImg) return aircraftRouteWhiteImg;
          if (!aircraftRouteImg.complete || !aircraftRouteImg.naturalWidth) return null;
          const canvas = document.createElement('canvas');
          canvas.width = aircraftRouteImg.naturalWidth;
          canvas.height = aircraftRouteImg.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(aircraftRouteImg, 0, 0);
          ctx.globalCompositeOperation = 'source-in';
          ctx.fillStyle = 'rgba(255,255,255,0.98)';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          aircraftRouteWhiteImg = canvas;
          return aircraftRouteWhiteImg;
        }

        drawCtx.save();
        drawCtx.lineCap = 'round';
        drawCtx.lineJoin = 'round';

        drawCtx.beginPath();
        drawCtx.moveTo(start.x, start.y);
        drawCtx.lineTo(end.x, end.y);
        drawCtx.strokeStyle = `rgba(255,255,255,${lineOpacity})`;
        drawCtx.lineWidth = routeLineWidth;
        drawCtx.stroke();

        if (!routeComplete) {
          drawCtx.beginPath();
          drawCtx.moveTo(dashStart.x, dashStart.y);
          drawCtx.lineTo(end.x, end.y);
          drawCtx.strokeStyle = 'rgba(225,36,48,0.90)';
          drawCtx.lineWidth = routeLineWidth;
          drawCtx.lineCap = 'butt';
          drawCtx.setLineDash([dash, gap]);
          drawCtx.lineDashOffset = dashOffset;
          drawCtx.stroke();
          drawCtx.setLineDash([]);
          drawCtx.lineDashOffset = 0;
          drawCtx.lineCap = 'round';
        }

        drawCtx.fillStyle = 'rgba(255,255,255,0.98)';
        drawCtx.beginPath();
        drawCtx.arc(start.x, start.y, dotRadius, 0, 2 * Math.PI);
        drawCtx.fill();

        const planeIcon = getWhiteAircraftRouteImg();
        if (planeIcon) {
          const iconW = 61.2 * px;
          const iconH = iconW * (planeIcon.height / planeIcon.width);
          drawCtx.save();
          drawCtx.translate(planePosition.x, planePosition.y);
          drawCtx.rotate(angle - 3 * Math.PI / 4 + Math.PI / 72);
          drawCtx.drawImage(planeIcon, -iconW / 2, -iconH / 2, iconW, iconH);
          drawCtx.restore();
        } else {
          drawCtx.fillStyle = 'rgba(255,255,255,0.98)';
          drawCtx.beginPath();
          drawCtx.arc(planePosition.x, planePosition.y, dotRadius, 0, 2 * Math.PI);
          drawCtx.fill();
        }

        drawCtx.translate(end.x, end.y);
        drawCtx.rotate(angle);
        drawCtx.beginPath();
        drawCtx.moveTo(arrowLength, 0);
        drawCtx.lineTo(-arrowLength * 0.56, arrowWidth);
        drawCtx.lineTo(-arrowLength * 0.56, -arrowWidth);
        drawCtx.closePath();
        drawCtx.fillStyle = 'rgba(255,255,255,0.98)';
        drawCtx.fill();

        drawCtx.restore();
      }

      function renderFrame() {
        const safeZone = interpolatedData[currentIndex];
        syncProgressThumb(currentIndex + subProgress);

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

        const currentTime = interpolatedData[currentIndex]?.elapsedTime ?? 0;
        const currentTimeSmooth = currentTime + subProgress;

        drawGasOverlay(safeZone.safetyZoneRadius, safeZone.safetyZonePosition);
        drawSafeZone(safeZone.safetyZoneRadius, safeZone.safetyZonePosition, 'rgba(0, 0, 255, 0.6)');
        drawSafeZone(safeZone.poisonGasWarningRadius, safeZone.poisonGasWarningPosition, 'rgb(255, 255, 255)');
        drawGrid();
        drawAircraftRoute(currentTimeSmooth);
        const teamOverlayLabels = drawTeamOverlay(currentTimeSmooth);

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
            let lastT = null;
            times.forEach(t => {
              const pos = byTime[t];
              if (!pos) return;
              if (!started || (lastT !== null && t - lastT > 1)) {
                drawCtx.moveTo(pos.x, pos.y);
                started = true;
              } else {
                drawCtx.lineTo(pos.x, pos.y);
              }
              lastT = t;
            });
            drawCtx.stroke();
          });
        }

        const ps = window._replayPlayerSize ?? 6;
        const pointSize  = ps / (scaleFactor * zoomScale);
        const borderWidth = Math.max(1, ps * 0.22) / (scaleFactor * zoomScale);
        const currentElapsedRounded = Math.round(currentTimeSmooth);

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
          const impactT = bullet.impactT ?? bullet.t;
          if (currentTimeSmooth >= impactT) {
            const impactDuration = Math.max(0.18, bullet.t + bullet.duration - impactT);
            const rp = Math.min(1, (currentTimeSmooth - impactT) / impactDuration);
            drawCtx.globalAlpha = (1 - rp) * alpha;
            drawCtx.beginPath();
            drawCtx.arc(bullet.targetX, bullet.targetY, pointSize * 1.5 + pointSize * 4 * rp, 0, 2 * Math.PI);
            drawCtx.strokeStyle = 'rgb(255,80,80)';
            drawCtx.lineWidth = 1.5 / (scaleFactor * zoomScale);
            drawCtx.stroke();
          }
          drawCtx.restore();
        });

        const playerRenderData = [];
        Object.keys(playerPositionTimeline).forEach(accountId => {
          const pid = globalMatchData.included.filter(p => p.type === 'participant').find(p => p.attributes.stats.playerId === accountId)?.id;
          const roster = globalMatchData.included.filter(r => r.type === 'roster').find(r => r.relationships.participants.data.some(p => p.id === pid));
          if (isPlayerDead(accountId, currentTimeSmooth)) return;
          const loc = getPlayerPositionAt(accountId, currentTimeSmooth);
          if (!loc) return;

          const px = loc.x;
          const py = loc.y;

          const knocked = isPlayerKnocked(accountId, currentTimeSmooth);
          const hp      = getPlayerHpAt(accountId, currentTimeSmooth);
          const hpRatio = knocked ? 0 : Math.max(0, Math.min(1, hp / 100));
          const parachuting = isPlayerParachuting(accountId, currentTimeSmooth);

          const isSearchedTeam = roster?.attributes?.stats?.teamId === searchedTeamId;
          const teamColorMode = window._replayPlayerColorMode === 'team';
          // HP mode: knocked → vermelho; time pesquisado → verde; outros → branco. Fundo (vida perdida) → vermelho.
          // Team mode: cada player com a cor do seu time; fundo (vida perdida) → preto.
          const fillColor = teamColorMode
            ? (roster?.color || 'rgb(255,255,255)')
            : (knocked ? 'rgb(215,40,40)'
              : isSearchedTeam ? 'rgb(50,215,80)'
              : 'rgb(255,255,255)');
          const bgColor = teamColorMode ? 'rgb(0,0,0)' : 'rgb(200,30,30)';

          if (parachuting) drawParachuteIcon(px, py, pointSize);

          // 1. Fundo completo (representa vida em falta)
          drawCtx.beginPath();
          drawCtx.arc(px, py, pointSize, 0, 2 * Math.PI);
          drawCtx.fillStyle = bgColor;
          drawCtx.fill();

          // 2. Fatia de HP (branco/verde) do topo em sentido horário — efeito "pizza"
          if (hpRatio > 0) {
            drawCtx.beginPath();
            drawCtx.moveTo(px, py);
            drawCtx.arc(px, py, pointSize, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * hpRatio, false);
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

          if (playerVehicleByTime[accountId]?.[currentElapsedRounded]) {
            const r = pointSize;
            drawCtx.save();
            drawCtx.translate(px, py);
            drawCtx.strokeStyle = teamColorMode ? 'rgba(0,0,0,0.95)' : 'rgba(255,255,255,0.9)';
            drawCtx.lineWidth = teamColorMode ? r * 0.18 : r * 0.32;
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
        drawTeamOverlayLabels(teamOverlayLabels);

        updatePanLimits();
        drawCtx.restore();

        // ── Kill/knock feed — one box per event, right-anchored ──────────────
        const feedDuration = 5;
        const activeFeed = window._replayKillfeedEnabled === false
          ? []
          : feedEvents.filter(e => e.t <= currentTimeSmooth && e.t + feedDuration > currentTimeSmooth).slice(-(window._replayFeedMax ?? 10));
        if (activeFeed.length > 0) {
          const _fs   = window._replayFeedScale ?? 1;
          const fs    = Math.round(12 * _fs);   // name font size
          const iconW = Math.round(20 * _fs);   // event icon — slightly larger than name text
          const wepH  = fs;                     // weapon drawn at font height
          const wepNomW = Math.round(fs * 2.6); // reserved horizontal space for weapon
          const pad   = Math.round(6  * _fs);   // equal padding on all four sides
          const gap   = Math.round(6  * _fs);   // gap between elements
          const rowGap= Math.round(2  * _fs);   // tight vertical gap between boxes
          const bSz   = Math.round(17 * _fs);   // team badge square size
          const bFs   = Math.round(9  * _fs);   // badge font size
          const margin = 10;
          const boxH  = fs + pad * 2;           // tight: content + equal padding top/bottom

          drawCtx.save();
          drawCtx.setTransform(1, 0, 0, 1, 0, 0);

          activeFeed.forEach((e, i) => {
            // ── per-event weapon slot width (use actual ratio if image loaded) ──
            const wepImg = getWeaponIcon(e.weaponId);
            const hasWep = !!_WEAP_TO_ITEM[e.weaponId];
            const wepSlotW = hasWep
              ? ((wepImg?.complete && wepImg.naturalWidth > 0)
                  ? Math.round(wepH * wepImg.naturalWidth / wepImg.naturalHeight)
                  : wepNomW)
              : 0;

            // ── measure row width ──────────────────────────────────────────
            drawCtx.font = `bold ${fs}px "JetBrains Mono", monospace`;
            const kW     = e.killerName ? drawCtx.measureText(e.killerName).width : 0;
            const vW     = drawCtx.measureText(e.victimName).width;
            const kBadge = e.killerName && e.killerTeamNum !== null ? bSz + gap : 0;
            const vBadge = e.victimTeamNum !== null                 ? bSz + gap : 0;
            const kSep   = e.killerName ? gap : 0;
            const rowW   = kBadge + kW + kSep + (hasWep ? wepSlotW + gap : 0) + iconW + gap + vW + vBadge;

            const boxW = rowW + pad * 2;
            const boxX = VIEWPORT_WIDTH - boxW - margin;
            const boxY = margin + 48 + i * (boxH + rowGap);
            const midY = boxY + boxH / 2;

            const age = (currentTimeSmooth - e.t) / feedDuration;
            drawCtx.globalAlpha = age > 0.7 ? 1 - (age - 0.7) / 0.3 : 1;

            // ── background box ────────────────────────────────────────────
            drawCtx.fillStyle = 'rgba(0,0,0,0.65)';
            drawCtx.strokeStyle = 'rgba(255,255,255,0.06)';
            drawCtx.lineWidth = 1;
            drawCtx.beginPath();
            if (drawCtx.roundRect) drawCtx.roundRect(boxX, boxY, boxW, boxH, 3);
            else drawCtx.rect(boxX, boxY, boxW, boxH);
            drawCtx.fill();
            drawCtx.stroke();

            // ── render right → left ───────────────────────────────────────
            let curX = boxX + boxW - pad;
            drawCtx.textBaseline = 'middle';

            // Victim team badge (RIGHT of victim name — drawn first from right)
            if (e.victimTeamNum !== null) {
              const bx = curX - bSz, by = midY - bSz / 2;
              drawCtx.fillStyle = e.victimTeamColor || '#555';
              if (drawCtx.roundRect) { drawCtx.beginPath(); drawCtx.roundRect(bx, by, bSz, bSz, 2); drawCtx.fill(); }
              else { drawCtx.fillRect(bx, by, bSz, bSz); }
              drawCtx.font = `bold ${bFs}px "JetBrains Mono", monospace`;
              drawCtx.fillStyle = '#fff';
              drawCtx.textAlign = 'center';
              drawCtx.fillText(String(e.victimTeamNum), bx + bSz / 2, midY);
              curX -= bSz + gap;
            }

            // Victim name
            drawCtx.font = `bold ${fs}px "JetBrains Mono", monospace`;
            drawCtx.textAlign = 'right';
            drawCtx.fillStyle = 'rgba(255,255,255,0.70)';
            drawCtx.fillText(e.victimName, curX, midY);
            curX -= vW + gap;

            // Event icon
            const iconKey = e.iconKey || (e.isKnock ? 'DBNO' : 'Death');
            const iconImg = KF_ICONS[iconKey];
            if (iconImg?.complete && iconImg.naturalWidth > 0) {
              const ratio = iconImg.naturalWidth / iconImg.naturalHeight;
              const dw = ratio >= 1 ? iconW : iconW * ratio;
              const dh = ratio >= 1 ? iconW / ratio : iconW;
              drawCtx.drawImage(iconImg, curX - iconW + (iconW - dw) / 2, midY - iconW / 2 + (iconW - dh) / 2, dw, dh);
            } else {
              drawCtx.fillStyle = e.isKnock ? '#f0c040' : '#ff4444';
              drawCtx.font = `bold ${iconW}px "JetBrains Mono", monospace`;
              drawCtx.textAlign = 'center';
              drawCtx.fillText(e.isKnock ? '⬇' : '☠', curX - iconW / 2, midY);
            }
            curX -= iconW + gap;

            // Weapon icon — same height as text, flipped horizontally
            if (hasWep) {
              if (wepImg?.complete && wepImg.naturalWidth > 0) {
                const dw = wepSlotW, dh = wepH;
                const dx = curX - dw, dy = midY - dh / 2;
                drawCtx.save();
                drawCtx.scale(-1, 1);
                drawCtx.drawImage(wepImg, -(dx + dw), dy, dw, dh);
                drawCtx.restore();
              }
              curX -= wepSlotW + gap;
            }

            // Killer name
            if (e.killerName) {
              drawCtx.font = `bold ${fs}px "JetBrains Mono", monospace`;
              drawCtx.fillStyle = '#ffffff';
              drawCtx.textAlign = 'right';
              drawCtx.fillText(e.killerName, curX, midY);
              curX -= kW;

              // Killer team badge (LEFT of killer name)
              if (e.killerTeamNum !== null) {
                curX -= gap;
                const bx = curX - bSz, by = midY - bSz / 2;
                drawCtx.fillStyle = e.killerTeamColor || '#555';
                if (drawCtx.roundRect) { drawCtx.beginPath(); drawCtx.roundRect(bx, by, bSz, bSz, 2); drawCtx.fill(); }
                else { drawCtx.fillRect(bx, by, bSz, bSz); }
                drawCtx.font = `bold ${bFs}px "JetBrains Mono", monospace`;
                drawCtx.fillStyle = '#fff';
                drawCtx.textAlign = 'center';
                drawCtx.fillText(String(e.killerTeamNum), bx + bSz / 2, midY);
              }
            }
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

      function frameIndexForElapsed(elapsed) {
        const target = Math.max(0, Number(elapsed) || 0);
        let lo = 0, hi = interpolatedData.length - 1, best = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const t = interpolatedData[mid]?.elapsedTime ?? mid;
          if (t <= target) {
            best = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
        return best;
      }

      function formatEventTime(seconds) {
        const safe = Math.max(0, Math.floor(Number(seconds) || 0));
        const min = Math.floor(safe / 60);
        const sec = safe % 60;
        return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
      }

      function timelineEventKind(event) {
        if (event.isKnock || event.eventKind === 'knock') return 'knock';
        if (searchedAccountId && event.victimAccountId === searchedAccountId) return 'death';
        return event.killerName ? 'kill' : 'death';
      }

      function isSearchedPlayerTimelineEvent(event) {
        if (!searchedAccountId) return false;
        return event.killerAccountId === searchedAccountId || event.victimAccountId === searchedAccountId;
      }

      function timelineEventTitle(event) {
        const kind = timelineEventKind(event).toUpperCase();
        const time = formatEventTime(event.t);
        if (kind === 'DEATH') {
          return event.killerName
            ? `${kind} ${time} - ${event.victimName} by ${event.killerName}`
            : `${kind} ${time} - ${event.victimName}`;
        }
        return `${kind} ${time} - ${event.killerName || 'Unknown'} > ${event.victimName}`;
      }

      function jumpToTimelineEvent(event) {
        currentIndex = frameIndexForElapsed((event.t ?? 0) - 5);
        subProgress = 0;
        timeAccumulator = 0;
        lastTimestamp = null;
        isPlaying = true;
        if (window.globalPlayButton) window.globalPlayButton.innerHTML = ICON_PAUSE;
        progressBar.value = String(currentIndex);
        updateSafeZone();
        renderFrame();
      }

      function renderTimelineEventMarkers() {
        const markerLayer = document.getElementById('replayEventMarkers');
        if (!markerLayer) return;
        markerLayer.innerHTML = '';

        const duration = interpolatedData[interpolatedData.length - 1]?.elapsedTime ?? 0;
        if (!duration) return;

        feedEvents.forEach((event, index) => {
          if (!isSearchedPlayerTimelineEvent(event)) return;
          if (!Number.isFinite(event.t) || event.t < 0) return;
          const kind = timelineEventKind(event);
          const marker = document.createElement('span');
          marker.className = `replay-event-marker ${kind}`;
          marker.style.left = `${Math.max(0, Math.min(100, (event.t / duration) * 100))}%`;
          marker.title = `${timelineEventTitle(event)} - jump to ${formatEventTime(Math.max(0, event.t - 5))}`;
          marker.setAttribute('role', 'button');
          marker.setAttribute('tabindex', '0');
          marker.setAttribute('aria-label', marker.title);
          marker.dataset.eventIndex = String(index);

          marker.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            jumpToTimelineEvent(event);
          });
          marker.addEventListener('keydown', e => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            e.stopPropagation();
            jumpToTimelineEvent(event);
          });

          markerLayer.appendChild(marker);
        });
      }

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
      renderTimelineEventMarkers();

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
