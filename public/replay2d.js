import { translateMapName } from './utils.js';

export function startModal(telemetryUrl, mapName) {

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
  const backgroundImage = new Image();
  backgroundImage.src = `/images/${translatedMapName.toLowerCase()}map.png`;

  function interpolate(a, b, t) { return a + (b - a) * t; }

  fetch(telemetryUrl)
    .then(r => r.json())
    .then(data => {
      const gameStateData = data.filter(item => item.gameState);
      const characterData = data.filter(item => item._T === 'LogPlayerPosition');

      const playerNames = {};
      characterData.forEach(item => {
        if (item.character?.accountId && item.character?.name)
          playerNames[item.character.accountId] = item.character.name;
      });

      const matchStartEvent = data.find(item => item._T === 'LogMatchStart');
      const matchStartMs = matchStartEvent ? new Date(matchStartEvent._D).getTime() : 0;

      // ── Single source of truth for time conversion ──────────────────────────
      // ALL timestamps use dMsToElapsed(new Date(item._D).getTime())
      // This maps wall-clock time to elapsedTime, same as what the render timer shows.
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

      // ── Death / respawn ─────────────────────────────────────────────────────
      const playerDeathIntervals = {};
      data.forEach(item => {
        if ((item._T === 'LogPlayerKillV2' || item._T === 'LogPlayerKill') &&
          item.victim?.accountId && item._D && !item.victim.isDBNO) {
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

      // ── Position anchors ────────────────────────────────────────────────────
      // Every anchor uses t = dMsToElapsed(_D), so all are in elapsedTime space.
      const players = {};

      // 1. LogPlayerPosition keyframes (~every 10s)
      characterData.forEach(item => {
        const id = item.character.accountId;
        if (!players[id]) players[id] = [];
        const t = dMsToElapsed(new Date(item._D).getTime());
        if (t <= 9) return;
        players[id].push({
          t,
          x: item.character.location.x,
          y: item.character.location.y,
          vehicleType: item.vehicle?.vehicleType || '',
          health: item.character.health,
          isKeyframe: true,
        });
      });

      // 2. Real-time action events (exact positions)
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

      // ── Build byTime / byVehicle / byHp ─────────────────────────────────────
      // All indexed by Math.round(elapsedTime) — same as what the render reads.
      const playerLocationsByTime = {};
      const playerVehicleByTime = {};
      const playerHpByTime = {};

      Object.keys(players).forEach(accountId => {
        const anchors = players[accountId];
        const byTime = {}, byVehicle = {}, byHp = {};

        // Interpolate position between every consecutive anchor pair
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

        // Action points overwrite interpolated (they are exact)
        anchors.filter(a => !a.isKeyframe).forEach(a => {
          byTime[Math.round(a.t)] = { x: a.x, y: a.y };
        });

        // Keyframe points: position + HP
        anchors.filter(a => a.isKeyframe).forEach(a => {
          const t = Math.round(a.t);
          if (!byTime[t]) byTime[t] = { x: a.x, y: a.y };
          if (a.vehicleType && a.vehicleType !== 'TransportAircraft') byVehicle[t] = a.vehicleType;
          if (a.health !== undefined) byHp[t] = a.health;
        });

        // Fill HP gaps: carry last known forward
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

      // ── HP refinement: distribute damage hits within each keyframe interval ──
      // All times in elapsedTime space via dMsToElapsed.
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

        // Keyframe boundaries in elapsedTime space
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

          // Carry each hit's HP forward until the next hit (step function)
          const hitTimes = group.map(h => Math.round(h.t)).sort((a, b) => a - b);
          for (let hi = 0; hi < hitTimes.length; hi++) {
            const from = hitTimes[hi];
            const to = hi + 1 < hitTimes.length ? hitTimes[hi + 1] : kfEnd;
            const hp = byHp[from];
            for (let s = from + 1; s < to; s++) byHp[s] = hp;
          }
        }
      });

      // DEBUG: log Oboneco HP around elapsed 199-215
      const _obonecoId = 'account.79503026482b465a9665f4c763eddc32';
      if (playerHpByTime[_obonecoId]) {
        console.log('[HP DEBUG] Oboneco byHp elapsed 199-215:');
        for (let s = 199; s <= 215; s++) {
          const v = playerHpByTime[_obonecoId][s];
          console.log(`  elapsed=${s}s (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})  hp=${v?.toFixed(1) ?? 'undefined'}`);
        }
      }

      // ── Kill/knock feed ─────────────────────────────────────────────────────
      const feedEvents = [];
      const knockKillByVictim = {};
      data.forEach(item => {
        if ((item._T !== 'LogPlayerKillV2' && item._T !== 'LogPlayerKill') || !item._D) return;
        const killer = item.killer || item.attacker || {};
        const victim = item.victim || {};
        if (!killer.name || !victim.name || !victim.accountId) return;
        knockKillByVictim[victim.accountId] = {
          killerName: killer.name, killerAccountId: killer.accountId,
          victimName: victim.name, victimAccountId: victim.accountId,
          isKnock: victim.isDBNO === true,
        };
      });

      const seen = new Set();
      data.filter(i => i._T === 'LogPlayerTakeDamage' && i._D)
        .sort((a, b) => a._D.localeCompare(b._D))
        .forEach(item => {
          const vic = item.victim || {};
          if (!vic.accountId || vic.health > 0) return;
          const t = dMsToElapsed(new Date(item._D).getTime());
          const key = `${vic.accountId}_${Math.round(t)}`;
          if (seen.has(key)) return;
          seen.add(key);
          const info = knockKillByVictim[vic.accountId];
          if (!info) return;
          feedEvents.push({ ...info, t });
          delete knockKillByVictim[vic.accountId];
        });
      feedEvents.sort((a, b) => a.t - b.t);

      // ── Bullet traces ───────────────────────────────────────────────────────
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

      // ── Loadout ─────────────────────────────────────────────────────────────
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

      // ── Game state timeline (zones) ─────────────────────────────────────────
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

      backgroundImage.onload = function () {
        const fitZoomX = VIEWPORT_WIDTH / (MAP_WIDTH * scaleFactor);
        const fitZoomY = VIEWPORT_HEIGHT / (MAP_HEIGHT * scaleFactor);
        zoomScale = Math.min(fitZoomX, fitZoomY);
        minZoom = zoomScale;
        panX = (MAP_WIDTH - VIEWPORT_WIDTH / (scaleFactor * zoomScale)) / 2;
        panY = (MAP_HEIGHT - VIEWPORT_HEIGHT / (scaleFactor * zoomScale)) / 2;
        updateSafeZone();
      };

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

      window.addEventListener('resize', () => {
        VIEWPORT_WIDTH = viewport.offsetWidth;
        VIEWPORT_HEIGHT = viewport.offsetHeight;
        mapCanvas.width = VIEWPORT_WIDTH; mapCanvas.height = VIEWPORT_HEIGHT;
        drawCanvas.width = VIEWPORT_WIDTH; drawCanvas.height = VIEWPORT_HEIGHT;
        scaleFactor = BASE_SCALE * (VIEWPORT_WIDTH / 800) * (816000 / Math.max(MAP_WIDTH, MAP_HEIGHT));
        panX = (MAP_WIDTH - VIEWPORT_WIDTH / (scaleFactor * zoomScale)) / 2;
        panY = (MAP_HEIGHT - VIEWPORT_HEIGHT / (scaleFactor * zoomScale)) / 2;
        updateSafeZone();
      });

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
      let lastTimestamp = null, timeAccumulator = 0, subProgress = 0;

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
        mapCtx.drawImage(backgroundImage, 0, 0, MAP_WIDTH, MAP_HEIGHT);
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

        // Track lines
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

        const pointSize = 7 / (scaleFactor * zoomScale);
        const borderWidth = 2 / (scaleFactor * zoomScale);
        const nextIndex = Math.min(currentIndex + 1, interpolatedData.length - 1);

        // Bullet traces
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

        // Pass 1: player circles
        const playerRenderData = [];
        Object.keys(playerLocationsByTime).forEach(accountId => {
          const byTime = playerLocationsByTime[accountId];
          const pid = globalMatchData.included.filter(p => p.type === 'participant').find(p => p.attributes.stats.playerId === accountId)?.id;
          const roster = globalMatchData.included.filter(r => r.type === 'roster').find(r => r.relationships.participants.data.some(p => p.id === pid));
          const color = roster ? roster.color : 'white';
          const currentElapsed = Math.round(interpolatedData[currentIndex]?.elapsedTime ?? 0);
          const nextElapsed = Math.round(interpolatedData[nextIndex]?.elapsedTime ?? currentElapsed);
          if (isPlayerDead(accountId, currentElapsed)) return;
          const locA = byTime[currentElapsed];
          const locB = byTime[nextElapsed] || locA;
          if (!locA) return;

          const px = locA.x + (locB.x - locA.x) * subProgress;
          const py = locA.y + (locB.y - locA.y) * subProgress;

          drawCtx.fillStyle = color;
          drawCtx.strokeStyle = 'black';
          drawCtx.lineWidth = borderWidth;
          drawCtx.beginPath();
          drawCtx.arc(px, py, pointSize, 0, 2 * Math.PI);
          drawCtx.fill();
          drawCtx.stroke();

          const hp = playerHpByTime[accountId]?.[currentElapsed] ?? 100;
          const isDead = isPlayerDead(accountId, currentElapsed);
          const isKnocked = !isDead && hp <= 0;

          if (isKnocked) {
            drawCtx.save();
            drawCtx.translate(px, py);
            const r = pointSize * 0.6;
            drawCtx.strokeStyle = 'rgba(255,180,0,0.9)';
            drawCtx.lineWidth = borderWidth * 1.5;
            drawCtx.lineCap = 'round';
            drawCtx.beginPath(); drawCtx.moveTo(0, -r); drawCtx.lineTo(0, r); drawCtx.stroke();
            drawCtx.beginPath(); drawCtx.moveTo(-r * 0.6, r * 0.3); drawCtx.lineTo(0, r); drawCtx.lineTo(r * 0.6, r * 0.3); drawCtx.stroke();
            drawCtx.restore();
          }

          const hpRatio = Math.max(0, Math.min(1, hp / 100));
          if (hpRatio > 0) {
            drawCtx.beginPath();
            drawCtx.arc(px, py, pointSize + borderWidth * 1.2, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * hpRatio);
            drawCtx.strokeStyle = 'rgba(255,255,255,0.9)';
            drawCtx.lineWidth = borderWidth * 1.2;
            drawCtx.lineCap = 'round';
            drawCtx.stroke();
          }

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

        // Pass 2: names
        const fixedFontSize = 11;
        drawCtx.save();
        drawCtx.setTransform(1, 0, 0, 1, 0, 0);
        drawCtx.font = `bold ${fixedFontSize}px Arial`;
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

        // Kill/knock feed
        const feedDuration = 5;
        const activeFeed = feedEvents.filter(e => e.t <= currentTime && e.t + feedDuration > currentTime).slice(-5);
        if (activeFeed.length > 0) {
          const fs = 11, lineH = 18, padX = 8, padY = 6, margin = 8;
          drawCtx.save();
          drawCtx.setTransform(1, 0, 0, 1, 0, 0);
          drawCtx.font = `bold ${fs}px Arial`;
          let maxW = 0;
          activeFeed.forEach(e => { maxW = Math.max(maxW, drawCtx.measureText(`${e.killerName}  X  ${e.victimName}`).width); });
          const boxW = maxW + padX * 2, boxH = activeFeed.length * lineH + padY * 2;
          const boxX = VIEWPORT_WIDTH - boxW - margin, boxY = margin + 30;
          drawCtx.fillStyle = 'rgba(0,0,0,0.55)';
          drawCtx.beginPath(); drawCtx.roundRect(boxX, boxY, boxW, boxH, 4); drawCtx.fill();
          const getColor = (accountId) => {
            const pid = globalMatchData.included.filter(p => p.type === 'participant').find(p => p.attributes?.stats?.playerId === accountId)?.id;
            const roster = pid ? globalMatchData.included.filter(r => r.type === 'roster').find(r => r.relationships.participants.data.some(p => p.id === pid)) : null;
            return roster?.color || '#ffffff';
          };
          activeFeed.forEach((e, i) => {
            const age = (currentTime - e.t) / feedDuration;
            drawCtx.globalAlpha = age > 0.7 ? 1 - (age - 0.7) / 0.3 : 1;
            const y = boxY + padY + i * lineH + fs;
            drawCtx.textBaseline = 'alphabetic';
            drawCtx.fillStyle = getColor(e.killerAccountId);
            drawCtx.textAlign = 'left';
            const kW = drawCtx.measureText(e.killerName).width;
            drawCtx.fillText(e.killerName, boxX + padX, y);
            drawCtx.fillStyle = e.isKnock ? '#f0c040' : '#ff4444';
            drawCtx.textAlign = 'center';
            const iconX = boxX + padX + kW + 16;
            drawCtx.fillText(e.isKnock ? '⬇' : '☠', iconX, y);
            drawCtx.fillStyle = getColor(e.victimAccountId);
            drawCtx.textAlign = 'left';
            drawCtx.fillText(e.victimName, iconX + 16, y);
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
                globalPlayButton.innerHTML = '▶';
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
        if (isPlaying) { isPlaying = false; globalPlayButton.innerHTML = '▶'; }
        currentIndex = parseInt(progressBar.value);
        updateSafeZone();
      });

      globalPlayButton.addEventListener('click', function () {
        isPlaying = !isPlaying;
        globalPlayButton.innerHTML = isPlaying ? '❚❚' : '▶';
        if (isPlaying && currentIndex >= interpolatedData.length - 1) {
          currentIndex = 0; frameAccumulator = 0; timeAccumulator = 0; lastTimestamp = null;
        }
      });

      animate();
    })
    .catch(err => console.error('Error loading telemetry:', err));
}