const mapCanvas = document.getElementById("mapCanvas");
const mapCtx = mapCanvas.getContext("2d");

const drawCanvas = document.getElementById("drawCanvas");
const drawCtx = drawCanvas.getContext("2d");

const viewport = document.getElementById("viewport");
const MAP_WIDTH = parseInt(viewport.dataset.mapWidth);
const MAP_HEIGHT = parseInt(viewport.dataset.mapHeight);
const BASE_SCALE = parseFloat(viewport.dataset.canvasScale);

// Get telemetry URL and map name from script element's dataset
const scriptElement = document.currentScript;
const TELEMETRY_URL = scriptElement.dataset.telemetryUrl;
const MAP_NAME = scriptElement.dataset.mapName;

// Dynamic viewport dimensions
let VIEWPORT_WIDTH = viewport.offsetWidth;
let VIEWPORT_HEIGHT = viewport.offsetHeight;

// Set canvas sizes
mapCanvas.width = VIEWPORT_WIDTH;
mapCanvas.height = VIEWPORT_HEIGHT;
drawCanvas.width = VIEWPORT_WIDTH;
drawCanvas.height = VIEWPORT_HEIGHT;

let scaleFactor = BASE_SCALE * (VIEWPORT_WIDTH / 800);

let zoomScale = 1;
let panX = 0;
let panY = 0;
const maxZoom = 30;
const minZoom = 1;

// Use translated map name for background image
const translatedMapName = translateMapName(MAP_NAME);
const backgroundImage = new Image();
backgroundImage.src = `/images/${translatedMapName.toLowerCase()}map.png`;

function interpolate(startValue, endValue, progress) {
  return startValue + (endValue - startValue) * progress;
}

fetch(TELEMETRY_URL)
  .then(response => response.json())
  .then(data => {
    const gameStateData = data.filter(item => item.gameState);
    const characterData = data.filter(item => item._T === "LogPlayerPosition");

    const players = {};
    characterData.forEach(item => {
      const accountId = item.character.accountId;
      if (!players[accountId]) {
        players[accountId] = [];
      }
      if (item.elapsedTime > 9) {
        players[accountId].push(item);
      }
    });

    function interpolateLocation(start, end, steps) {
      const locations = [];
      const stepSize = 1 / steps;
      for (let i = 0; i <= steps; i++) {
        const x = start.x + (end.x - start.x) * (i * stepSize);
        const y = start.y + (end.y - start.y) * (i * stepSize);
        const z = start.z + (end.z - start.z) * (i * stepSize);
        locations.push({ x, y, z });
      }
      return locations;
    }

    const interpolatedLocationsByPlayer = {};
    Object.keys(players).forEach(accountId => {
      const playerData = players[accountId];
      const interpolatedLocations = [];
      for (let i = 0; i < playerData.length - 1; i++) {
        const current = playerData[i];
        const next = playerData[i + 1];
        const timeDiff = next.elapsedTime - current.elapsedTime;
        if (timeDiff > 1) {
          const steps = Math.floor(timeDiff);
          const interpolated = interpolateLocation(current.character.location, next.character.location, steps);
          interpolatedLocations.push(...interpolated);
        } else {
          interpolatedLocations.push(current.character.location);
        }
      }
      interpolatedLocationsByPlayer[accountId] = interpolatedLocations;
    });

    Object.keys(interpolatedLocationsByPlayer).forEach(accountId => {
      const locations = interpolatedLocationsByPlayer[accountId];
      if (locations.length > 0) {
        locations.pop();
      }
    });

    let index = gameStateData.findIndex(obj => obj.gameState.poisonGasWarningRadius !== 0);
    if (index === -1) return;

    const interpolatedData = [];
    for (let i = 0; i < gameStateData.length - 1; i++) {
      const current = gameStateData[i].gameState;
      const next = gameStateData[i + 1].gameState;
      interpolatedData.push(current);
      const timeDiff = next.elapsedTime - current.elapsedTime;
      if (timeDiff > 1) {
        for (let j = 1; j < timeDiff; j++) {
          const interpolatedTime = current.elapsedTime + j;
          const progress = j / timeDiff;
          interpolatedData.push({
            elapsedTime: interpolatedTime,
            safetyZoneRadius: interpolate(current.safetyZoneRadius, next.safetyZoneRadius, progress),
            safetyZonePosition: {
              x: interpolate(current.safetyZonePosition.x, next.safetyZonePosition.x, progress),
              y: interpolate(current.safetyZonePosition.y, next.safetyZonePosition.y, progress),
            },
            poisonGasWarningRadius: current.poisonGasWarningRadius,
            poisonGasWarningPosition: {
              x: current.poisonGasWarningPosition.x,
              y: current.poisonGasWarningPosition.y,
            },
          });
        }
      }
    }
    interpolatedData.push(gameStateData[gameStateData.length - 1].gameState);

    

    backgroundImage.onload = function() {
      // Initial pan to center
      panX = (MAP_WIDTH - VIEWPORT_WIDTH / (scaleFactor * zoomScale)) / 2;
      panY = (MAP_HEIGHT - VIEWPORT_HEIGHT / (scaleFactor * zoomScale)) / 2;
      updateSafeZone();
    };

    const progressBar = document.getElementById("progressBar");
    progressBar.addEventListener('mousedown', (e) => {
      e.stopPropagation(); // Prevent map pan from triggering
    });
    progressBar.addEventListener('touchstart', (e) => {
      e.stopPropagation(); // For mobile touch support
    });
    progressBar.max = interpolatedData.length - 1;
    let currentIndex = 0;
    const timerElement = document.getElementById("timer");

    function drawSafeZone(radius, position, color) {
      const lineWidth = 2 / (scaleFactor * zoomScale); // Maintain 2px line width
      drawCtx.lineWidth = lineWidth;
      drawCtx.strokeStyle = color;
      drawCtx.beginPath();
      drawCtx.arc(position.x, position.y, radius, 0, 2 * Math.PI);
      drawCtx.stroke();
    }

    function updateSafeZone() {
      const safeZone = interpolatedData[currentIndex];
      
      // Update map canvas
      mapCtx.save();
      mapCtx.setTransform(1, 0, 0, 1, 0, 0);
      mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
      mapCtx.scale(scaleFactor * zoomScale, scaleFactor * zoomScale);
      mapCtx.translate(-panX, -panY);
      mapCtx.drawImage(backgroundImage, 0, 0, MAP_WIDTH, MAP_HEIGHT);
      mapCtx.restore();

      // Update draw canvas
      drawCtx.save();
      drawCtx.setTransform(1, 0, 0, 1, 0, 0);
      drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
      drawCtx.scale(scaleFactor * zoomScale, scaleFactor * zoomScale);
      drawCtx.translate(-panX, -panY);

      drawSafeZone(safeZone.safetyZoneRadius, safeZone.safetyZonePosition, "blue");
      drawSafeZone(safeZone.poisonGasWarningRadius, safeZone.poisonGasWarningPosition, "white");

      Object.keys(interpolatedLocationsByPlayer).forEach(accountId => {
        const playerLocations = interpolatedLocationsByPlayer[accountId];
        let id = globalMatchData.included
        .filter(participant => participant.type === "participant")
        .find(item => item.attributes.stats.playerId === accountId)?.id;
        let roster = globalMatchData.included
        .filter(item => item.type === 'roster')
        .find(item => item.relationships.participants.data.some(participant => participant.id === id));
        let color = roster ? roster.color : null;

        if (playerLocations.length > 0) {
          const playerLocation = playerLocations[currentIndex];
          if (playerLocation && playerLocation.x != null && playerLocation.y != null) {
            const pointSize = 5 / (scaleFactor * zoomScale);
            const borderWidth = 2 / (scaleFactor * zoomScale);
            drawCtx.fillStyle = color;
            drawCtx.strokeStyle = 'black';
            drawCtx.lineWidth = borderWidth;
            drawCtx.beginPath();
            drawCtx.arc(playerLocation.x, playerLocation.y, pointSize, 0, 2 * Math.PI);
            drawCtx.fill();
            drawCtx.stroke();
          }
        }
      });
      updatePanLimits();

      drawCtx.restore();

      const elapsedTime = safeZone.elapsedTime;
      const minutes = Math.floor(elapsedTime / 60);
      const seconds = Math.floor(elapsedTime % 60);
      timerElement.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    progressBar.addEventListener("input", function () {
      currentIndex = parseInt(progressBar.value);
      updateSafeZone();
    });

    // Zoom and Pan with Canvas Transform
    let isDragging = false;
    let lastX, lastY;

    // Modified wheel handler
    viewport.addEventListener('wheel', function(e) {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Convert mouse position to game coordinates before zoom
      const gameX = panX + (mouseX / (scaleFactor * zoomScale));
      const gameY = panY + (mouseY / (scaleFactor * zoomScale));

      const zoomAmount = -e.deltaY * 0.001;
      const newZoom = Math.min(maxZoom, Math.max(minZoom, zoomScale * (1 + zoomAmount)));

      // Calculate new pan to keep cursor position stable
      const newPanX = gameX - (mouseX / (scaleFactor * newZoom));
      const newPanY = gameY - (mouseY / (scaleFactor * newZoom));

      // Apply changes
      zoomScale = newZoom;
      panX = newPanX;
      panY = newPanY;

      // Enforce pan limits
      updatePanLimits();
      updateSafeZone();
    });

    viewport.addEventListener('mousedown', (e) => {
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      e.preventDefault();
    });

    // Modified mouse move handler
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      
      // Convert screen delta to game coordinates
      const gameDx = dx / (scaleFactor * zoomScale);
      const gameDy = dy / (scaleFactor * zoomScale);
      
      panX -= gameDx;
      panY -= gameDy;

      // Enforce pan limits
      updatePanLimits();
      
      lastX = e.clientX;
      lastY = e.clientY;
      updateSafeZone();
      e.preventDefault();
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });

    window.addEventListener('resize', () => {
      VIEWPORT_WIDTH = viewport.offsetWidth;
      VIEWPORT_HEIGHT = viewport.offsetHeight;
      
      mapCanvas.width = VIEWPORT_WIDTH;
      mapCanvas.height = VIEWPORT_HEIGHT;
      drawCanvas.width = VIEWPORT_WIDTH;
      drawCanvas.height = VIEWPORT_HEIGHT;
      
      // Recalculate scale factor on resize
      scaleFactor = BASE_SCALE * (VIEWPORT_WIDTH / 800);
      
      // Reset pan to center
      panX = (MAP_WIDTH - VIEWPORT_WIDTH / (scaleFactor * zoomScale)) / 2;
      panY = (MAP_HEIGHT - VIEWPORT_HEIGHT / (scaleFactor * zoomScale)) / 2;
      
      updateSafeZone();
    });

    function updatePanLimits() {
      const viewportGameWidth = VIEWPORT_WIDTH / (scaleFactor * zoomScale);
      const viewportGameHeight = VIEWPORT_HEIGHT / (scaleFactor * zoomScale);

      // Handle initial undefined values
      panX = panX || 0;
      panY = panY || 0;
    
      panX = Math.max(0, Math.min(panX, MAP_WIDTH - viewportGameWidth));
      panY = Math.max(0, Math.min(panY, MAP_HEIGHT - viewportGameHeight));
    
      // Center if smaller than viewport
      if (viewportGameWidth > MAP_WIDTH) {
        panX = (MAP_WIDTH - viewportGameWidth) / 2;
      }
      if (viewportGameHeight > MAP_HEIGHT) {
        panY = (MAP_HEIGHT - viewportGameHeight) / 2;
      }
    }

    function animate() {
      updateSafeZone();
      requestAnimationFrame(animate);
    }

    progressBar.max = interpolatedData.length - 1;
    progressBar.addEventListener("input", function() {
        currentIndex = parseInt(this.value);
        updateSafeZone();
    });

    animate();
  })
  .catch(error => console.error("Erro ao carregar o JSON:", error));