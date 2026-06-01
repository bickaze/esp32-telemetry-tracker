let isRecording = false;
let mapPoints = [];
let clickablePoints = [];
let projectedPoints = [];
let selectedPointArrayIndex = -1;
let openedTrackPoints = [];
let openedLapInfo = null;
let optimalAnalysis = null;
let comparisonMode = false;
let currentComparisonLapData = null;

function formatLapTime(ms) {
  if (!ms || ms <= 0) return "--:--.--";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((ms % 1000) / 10);
  return String(minutes).padStart(2, "0") + ":" +
         String(seconds).padStart(2, "0") + "." +
         String(centiseconds).padStart(2, "0");
}

async function startRec() {
  await fetch('/start');
  await update();
  await loadFiles();
}

async function stopRec() {
  await fetch('/stop');
  await update();
  await loadFiles();
}

async function deleteAll() {
  if (!confirm("Удалить все CSV-файлы?")) return;

  const res = await fetch('/delete_all');

  if (!res.ok) {
    alert("Ошибка удаления. Останови запись.");
    return;
  }

  await loadFiles();
  drawTrack([]);
  document.getElementById("mapInfo").innerText = "Файлы удалены";
}

async function update() {
  try {
    const res = await fetch('/data');
    const d = await res.json();

    isRecording = d.recording;

    document.getElementById("recording").innerHTML =
      d.recording ? '<span class="ok">ИДЁТ</span>' : '<span class="bad">СТОП</span>';

    document.getElementById("file").innerText = d.file || "---";

    let gpsClass = "bad";
    let gpsText = "НЕТ FIX / " + d.sats;

    if (d.quality === "good") {
      gpsClass = "ok";
      gpsText = "GOOD FIX / " + d.sats;
    } else if (d.gpsLocationValid || d.fix) {
      gpsClass = "warn";
      gpsText = "СЛАБЫЙ FIX / " + d.sats;
    }

    document.getElementById("gpsStatus").innerHTML =
      '<span class="' + gpsClass + '">' + gpsText + '</span>';

    document.getElementById("hdop").innerHTML =
      d.hdop <= 2.0 ? '<span class="ok">' + Number(d.hdop).toFixed(1) + '</span>' :
      d.hdop <= 3.0 ? '<span class="warn">' + Number(d.hdop).toFixed(1) + '</span>' :
      '<span class="bad">' + Number(d.hdop).toFixed(1) + '</span>';

    document.getElementById("sdStatus").innerHTML =
      d.sd ? '<span class="ok">OK</span>' : '<span class="bad">ОШИБКА</span>';

    document.getElementById("sensorStatus").innerHTML =
      'ADXL: ' + (d.adxl ? '<span class="ok">OK</span>' : '<span class="bad">ERR</span>') +
      ' / ADS: ' + (d.ads ? '<span class="ok">OK</span>' : '<span class="bad">ERR</span>');

    document.getElementById("speed").innerText = Number(d.speed).toFixed(1);
    document.getElementById("throttle").innerText = Number(d.throttle).toFixed(2);

    document.getElementById("accel").innerText =
      Number(d.gx).toFixed(2) + " / " +
      Number(d.gy).toFixed(2) + " / " +
      Number(d.gz).toFixed(2);

    document.getElementById("heap").innerText = d.heap;
  } catch (e) {
    console.log(e);
  }
}

async function loadFiles() {
  try {
    const res = await fetch('/files');
    const files = await res.json();

    const box = document.getElementById("files");
    box.innerHTML = "";

    if (!files.length) {
      box.innerHTML = '<p class="info">Файлов пока нет. Нажми СТАРТ, потом СТОП.</p>';
      return;
    }

    files.reverse().forEach(name => {
      const div = document.createElement("div");
      div.className = "file-row";

      div.innerHTML = `
        <div class="file-title">${name}</div>
        <div class="file-actions">
          <button class="open small" onclick="openTrack('${name}')">Открыть трек</button>
          <a class="btn download small" href="/download?name=${name}">Скачать CSV</a>
        </div>
      `;

      box.appendChild(div);
    });
  } catch (e) {
    document.getElementById("files").innerHTML = '<p class="info">Ошибка чтения файлов</p>';
  }
}

async function openTrack(name) {
  if (isRecording) {
    alert("Сначала нажми СТОП. Во время записи карту лучше не открывать.");
    return;
  }

  const res = await fetch('/view?name=' + name);

  if (!res.ok) {
    alert("Ошибка открытия файла");
    return;
  }

  const text = await res.text();

  const points = parseCsv(text);
  const filtered = filterPoints(points);
  const smoothed = smoothPoints(filtered, 5);

  openedTrackPoints = smoothed;
  openedLapInfo = analyzeLaps(smoothed);
  optimalAnalysis = null;
  comparisonMode = false;
  currentComparisonLapData = null;

  showLapSummary(openedLapInfo);
  showOptimizeControls();
  document.getElementById("lossLegend").style.display = "none";

  document.getElementById("mapInfo").innerText = name;

  drawTrack(smoothed);
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const points = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");

    if (cols.length < 13) continue;

    const time = parseFloat(cols[0]);
    const lat = parseFloat(cols[1]);
    const lng = parseFloat(cols[2]);
    const rawLat = parseFloat(cols[3]);
    const rawLng = parseFloat(cols[4]);
    const speed = parseFloat(cols[5]);
    const gx = parseFloat(cols[6]);
    const gy = parseFloat(cols[7]);
    const gz = parseFloat(cols[8]);
    const throttle = parseFloat(cols[9]);
    const sats = parseInt(cols[10]);
    const hdop = parseFloat(cols[11]);
    const fix = parseInt(cols[12]);
    const quality = cols[13] || (fix === 1 ? "old" : "none");

    if (!isNaN(lat) && !isNaN(lng) && fix === 1 && lat !== 0 && lng !== 0) {
      points.push({ time, lat, lng, rawLat, rawLng, speed, gx, gy, gz, throttle, sats, hdop, fix, quality, index: i });
    }
  }

  return points;
}

function distanceMeters(a, b) {
  const R = 6371000;
  const p1 = a.lat * Math.PI / 180;
  const p2 = b.lat * Math.PI / 180;
  const dp = (b.lat - a.lat) * Math.PI / 180;
  const dl = (b.lng - a.lng) * Math.PI / 180;

  const x =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) *
    Math.sin(dl / 2) * Math.sin(dl / 2);

  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function filterPoints(points) {
  if (points.length <= 2) return points;

  const result = [];
  result.push(points[0]);

  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const cur = points[i];

    // На карте оставляем слабые точки в логах, но не даём им ломать трек.
    // Главное правило: если точка прыгнула дальше 15 метров от прошлой
    // нормальной точки, на карту её не добавляем.
    if (cur.sats > 0 && cur.sats < 3) continue;
    if (cur.hdop > 12.0) continue;

    const dist = distanceMeters(prev, cur);
    const dt = Math.max((cur.time - prev.time) / 1000, 0.1);
    const realSpeedKmh = (dist / dt) * 3.6;

    if (dist < 0.2) continue;
    if (dist > 15) continue;
    if (realSpeedKmh > 120) continue;

    result.push(cur);
  }

  return result;
}

function smoothPoints(points, windowSize) {
  if (points.length <= windowSize) return points;

  const result = [];

  for (let i = 0; i < points.length; i++) {
    let from = Math.max(0, i - Math.floor(windowSize / 2));
    let to = Math.min(points.length - 1, i + Math.floor(windowSize / 2));

    let sumLat = 0;
    let sumLng = 0;
    let count = 0;

    for (let j = from; j <= to; j++) {
      sumLat += points[j].lat;
      sumLng += points[j].lng;
      count++;
    }

    result.push({
      ...points[i],
      lat: sumLat / count,
      lng: sumLng / count
    });
  }

  return result;
}


function analyzeLaps(points) {
  const result = { count: 0, bestMs: 0, lapTimes: [], laps: [] };
  if (!points || points.length < 2) return result;

  const START_RADIUS_METERS = 14;
  const FAR_FROM_START_METERS = 30;
  const MIN_LAP_TIME_MS = 30000;

  const start = points[0];
  let wasFarFromStart = false;
  let lapStartIndex = 0;
  let lapStartTime = start.time;
  let lastTriggerTime = start.time;

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const distToStart = distanceMeters(start, p);

    if (distToStart > FAR_FROM_START_METERS) wasFarFromStart = true;

    const lapTime = p.time - lapStartTime;
    const timeFromLastTrigger = p.time - lastTriggerTime;

    if (wasFarFromStart && distToStart < START_RADIUS_METERS && lapTime >= MIN_LAP_TIME_MS && timeFromLastTrigger >= MIN_LAP_TIME_MS) {
      const lapPoints = points.slice(lapStartIndex, i + 1);
      result.laps.push({
        number: result.laps.length + 1,
        points: lapPoints,
        timeMs: lapTime
      });
      result.lapTimes.push(lapTime);

      lapStartIndex = i;
      lapStartTime = p.time;
      lastTriggerTime = p.time;
      wasFarFromStart = false;
    }
  }

  result.count = result.laps.length;
  if (result.lapTimes.length > 0) result.bestMs = Math.min(...result.lapTimes);
  return result;
}

function showLapSummary(lapInfo) {
  const box = document.getElementById("lapSummary");
  const text = document.getElementById("lapSummaryText");
  box.style.display = "block";

  if (!lapInfo || lapInfo.count === 0) {
    text.innerHTML = "Круги: 0<br>Лучший круг: --:--.--";
    return;
  }

  let html = "Круги: " + lapInfo.count + "<br>Лучший круг: " + formatLapTime(lapInfo.bestMs);
  html += "<br><span style='font-size:15px;font-weight:normal;color:#cbd5e1;'>";
  for (let i = 0; i < lapInfo.lapTimes.length; i++) {
    html += "Круг " + (i + 1) + ": " + formatLapTime(lapInfo.lapTimes[i]);
    if (i < lapInfo.lapTimes.length - 1) html += "<br>";
  }
  html += "</span>";
  text.innerHTML = html;
}

function showOptimizeControls() {
  const panel = document.getElementById("optimalPanel");
  const text = document.getElementById("optimalText");
  const compareBlock = document.getElementById("compareBlock");

  panel.style.display = "block";
  compareBlock.style.display = "none";

  if (!openedLapInfo || openedLapInfo.count < 2) {
    text.innerHTML = "Для оптимального круга нужно минимум 2 найденных круга.";
    return;
  }

  text.innerHTML = "Найдено кругов: " + openedLapInfo.count + "<br>Нажми кнопку, чтобы посчитать theoretical best lap.";
}

function calcSegmentStats(points, startIndex, endIndex, segmentDistanceMeters = 0, segmentDtMs = 0) {
  let count = 0;
  let gpsSpeedSum = 0;
  let throttleSum = 0;
  let gxSum = 0;
  let gySum = 0;
  let gzSum = 0;
  let accelSum = 0;

  for (let i = startIndex; i <= endIndex && i < points.length; i++) {
    const p = points[i];
    if (!p) continue;

    count++;
    gpsSpeedSum += isNaN(p.speed) ? 0 : p.speed;
    throttleSum += isNaN(p.throttle) ? 0 : p.throttle;
    gxSum += isNaN(p.gx) ? 0 : p.gx;
    gySum += isNaN(p.gy) ? 0 : p.gy;
    gzSum += isNaN(p.gz) ? 0 : p.gz;

    const safeGx = isNaN(p.gx) ? 0 : p.gx;
    const safeGy = isNaN(p.gy) ? 0 : p.gy;
    const safeGz = isNaN(p.gz) ? 0 : p.gz;
    const accel = Math.sqrt(safeGx * safeGx + safeGy * safeGy + safeGz * safeGz);

    accelSum += accel;
  }

  const calculatedSpeed = segmentDtMs > 0 && segmentDistanceMeters > 0
    ? (segmentDistanceMeters / (segmentDtMs / 1000)) * 3.6
    : 0;

  if (count === 0) {
    return {
      avgSpeed: calculatedSpeed,
      avgGpsSpeed: 0,
      avgThrottle: 0,
      avgGx: 0,
      avgGy: 0,
      avgGz: 0,
      avgAccel: 0
    };
  }

  return {
    // ВАЖНО: для сравнения сегментов скорость теперь считается как расстояние / время.
    // Раньше тут показывалась средняя speed_kmh из GPS, и она могла противоречить времени сегмента.
    avgSpeed: calculatedSpeed,
    avgGpsSpeed: gpsSpeedSum / count,
    avgThrottle: throttleSum / count,
    avgGx: gxSum / count,
    avgGy: gySum / count,
    avgGz: gzSum / count,
    avgAccel: accelSum / count
  };
}

function prepareLapSegments(lap, segmentLength) {
  const points = lap.points;
  const segments = [];
  if (!points || points.length < 2) return segments;

  // Новый вариант считает границы сегментов точно по дистанции.
  // Если GPS-точка перескочила границу 10 м, время границы интерполируется между двумя точками.
  // Поэтому сегменты становятся одинаковой длины: 0-10 м, 10-20 м, 20-30 м и т.д.

  let totalDist = 0;
  let currentSeg = 0;

  let segStartTime = points[0].time;
  let segStartDist = 0;
  let segStartIndex = 0;

  points[0].segmentIndex = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];

    const stepDist = distanceMeters(prev, cur);
    const stepTime = cur.time - prev.time;

    if (stepDist <= 0 || stepTime <= 0) {
      points[i].segmentIndex = currentSeg;
      continue;
    }

    const prevTotalDist = totalDist;
    const nextTotalDist = totalDist + stepDist;

    // Одна GPS-точка может перескочить сразу несколько границ сегментов.
    while ((currentSeg + 1) * segmentLength <= nextTotalDist) {
      const boundaryDist = (currentSeg + 1) * segmentLength;
      const ratio = (boundaryDist - prevTotalDist) / stepDist;
      const boundaryTime = prev.time + ratio * stepTime;

      const dt = boundaryTime - segStartTime;
      const segmentDistance = boundaryDist - segStartDist;

      if (dt > 0 && segmentDistance > 0) {
        segments[currentSeg] = {
          index: currentSeg,
          dt,
          distance: segmentDistance,
          startIndex: segStartIndex,
          endIndex: i,
          stats: calcSegmentStats(points, segStartIndex, i, segmentDistance, dt)
        };
      }

      currentSeg++;
      segStartTime = boundaryTime;
      segStartDist = boundaryDist;
      segStartIndex = i;
    }

    totalDist = nextTotalDist;
    points[i].segmentIndex = Math.max(0, currentSeg);
  }

  // Последний кусок круга может быть меньше 10 м. Его тоже сохраняем,
  // но только если он не совсем маленький, чтобы не добавлять мусорный сегмент.
  const lastIndex = points.length - 1;
  const lastDistance = totalDist - segStartDist;
  const lastDt = points[lastIndex].time - segStartTime;

  if (lastDistance >= segmentLength * 0.5 && lastDt > 0 && !segments[currentSeg]) {
    segments[currentSeg] = {
      index: currentSeg,
      dt: lastDt,
      distance: lastDistance,
      startIndex: segStartIndex,
      endIndex: lastIndex,
      stats: calcSegmentStats(points, segStartIndex, lastIndex, lastDistance, lastDt)
    };
  }

  return segments;
}

function buildOptimalAnalysis() {
  if (!openedLapInfo || openedLapInfo.count < 2) {
    alert("Нужно минимум 2 круга для сравнения.");
    return;
  }

  const SEGMENT_LENGTH_METERS = 10;
  const bestSegments = [];
  const lapData = [];

  openedLapInfo.laps.forEach(lap => {
    const segments = prepareLapSegments(lap, SEGMENT_LENGTH_METERS);
    lapData.push({ lap, segments });

    segments.forEach(seg => {
      if (!seg) return;
      if (!bestSegments[seg.index] || seg.dt < bestSegments[seg.index].dt) {
        bestSegments[seg.index] = {
          dt: seg.dt,
          lapNumber: lap.number,
          stats: seg.stats
        };
      }
    });
  });

  let theoreticalBestMs = 0;
  bestSegments.forEach(seg => { if (seg) theoreticalBestMs += seg.dt; });

  const optimalShapeLapData = lapData.reduce((best, item) => {
    if (!best) return item;
    return item.lap.timeMs < best.lap.timeMs ? item : best;
  }, null);

  optimalAnalysis = {
    segmentLength: SEGMENT_LENGTH_METERS,
    bestSegments,
    lapData,
    theoreticalBestMs,
    optimalShapeLapData
  };

  const bestReal = openedLapInfo.bestMs;
  const potential = bestReal - theoreticalBestMs;

  document.getElementById("optimalText").innerHTML =
    "Лучший реальный круг: " + formatLapTime(bestReal) + "<br>" +
    "Оптимальный круг: " + formatLapTime(theoreticalBestMs) + "<br>" +
    "Потенциал улучшения: " + (potential / 1000).toFixed(2) + " сек";

  updateCompareSelect();
  document.getElementById("compareBlock").style.display = "block";
  renderSelectedLapComparison();
}

function updateCompareSelect() {
  const select = document.getElementById("compareLapSelect");
  select.innerHTML = "";
  openedLapInfo.laps.forEach(lap => {
    const opt = document.createElement("option");
    opt.value = lap.number;
    opt.textContent = "Круг " + lap.number + " — " + formatLapTime(lap.timeMs);
    select.appendChild(opt);
  });
}

function renderSelectedLapComparison() {
  if (!optimalAnalysis) return;

  const lapNumber = Number(document.getElementById("compareLapSelect").value);
  const data = optimalAnalysis.lapData.find(x => x.lap.number === lapNumber);
  if (!data) return;

  let selectedLapBestPartMs = 0;
  let selectedLapComparedMs = 0;

  data.segments.forEach(seg => {
    if (!seg) return;
    const best = optimalAnalysis.bestSegments[seg.index];
    if (!best) return;
    selectedLapBestPartMs += best.dt;
    selectedLapComparedMs += seg.dt;
  });

  const lossMs = Math.max(0, selectedLapComparedMs - selectedLapBestPartMs);

  document.getElementById("optimalText").innerHTML =
    "Выбран: Круг " + lapNumber + " — " + formatLapTime(data.lap.timeMs) + "<br>" +
    "Оптимальный круг: " + formatLapTime(optimalAnalysis.theoreticalBestMs) + "<br>" +
    "Потеря выбранного круга: +" + (lossMs / 1000).toFixed(2) + " сек";

  comparisonMode = true;
  currentComparisonLapData = data;
  document.getElementById("lossLegend").style.display = "flex";
  drawLapLossMap(data, true);
}

function showAllTrack() {
  comparisonMode = false;
  currentComparisonLapData = null;
  selectedPointArrayIndex = -1;
  document.getElementById("pointLog").style.display = "none";
  document.getElementById("lossLegend").style.display = "none";
  drawTrack(openedTrackPoints);
}

function getLossColor(lossMs) {
  // Потеря считается на 10-метровом сегменте.
  // Пороги специально сделаны мягкими, чтобы были видны зелёные/жёлтые/красные зоны.
  if (lossMs <= 50) return "#16a34a";   // почти без потери
  if (lossMs <= 300) return "#facc15";  // небольшая потеря
  return "#dc2626";                     // большая потеря
}

function drawLapLossMap(lapData, keepSelected = false) {
  // В режиме сравнения НЕ рисуем отдельную форму оптимального круга.
  // Рисуем только выбранный реальный круг и подсвечиваем участки по потерям.
  const points = lapData.lap.points;

  mapPoints = points;
  clickablePoints = [];
  projectedPoints = [];

  if (!keepSelected) {
    selectedPointArrayIndex = -1;
    document.getElementById("pointLog").style.display = "none";
  }

  setupPointSlider(points);

  const canvas = document.getElementById("map");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (points.length < 2) return;

  const centerLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const centerLng = points.reduce((s, p) => s + p.lng, 0) / points.length;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(centerLat * Math.PI / 180);

  const xy = points.map((p, i) => ({
    ...p,
    x: (p.lng - centerLng) * metersPerDegLng,
    y: (p.lat - centerLat) * metersPerDegLat,
    i
  }));

  const minX = Math.min(...xy.map(p => p.x));
  const maxX = Math.max(...xy.map(p => p.x));
  const minY = Math.min(...xy.map(p => p.y));
  const maxY = Math.max(...xy.map(p => p.y));
  const widthM = Math.max(maxX - minX, 1);
  const heightM = Math.max(maxY - minY, 1);

  const pad = 35;
  const scale = Math.min((canvas.width - pad * 2) / widthM, (canvas.height - pad * 2) / heightM);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const toCanvasX = x => canvas.width / 2 + (x - centerX) * scale;
  const toCanvasY = y => canvas.height / 2 - (y - centerY) * scale;

  // Рисуем выбранный круг цветами потерь.
  ctx.lineWidth = 7;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash([]);

  for (let i = 1; i < xy.length; i++) {
    const segIndex = points[i].segmentIndex || 0;
    const seg = lapData.segments[segIndex];
    const best = optimalAnalysis.bestSegments[segIndex];
    const loss = seg && best ? Math.max(0, seg.dt - best.dt) : 0;

    ctx.strokeStyle = getLossColor(loss);
    ctx.beginPath();
    ctx.moveTo(toCanvasX(xy[i - 1].x), toCanvasY(xy[i - 1].y));
    ctx.lineTo(toCanvasX(xy[i].x), toCanvasY(xy[i].y));
    ctx.stroke();
  }

  const pointStep = Math.max(1, Math.floor(xy.length / 120));
  xy.forEach((p, i) => {
    const cx = toCanvasX(p.x);
    const cy = toCanvasY(p.y);
    projectedPoints[i] = { x: cx, y: cy, point: points[i], arrayIndex: i };
    if (i % pointStep === 0 || i === 0 || i === xy.length - 1) {
      clickablePoints.push({ x: cx, y: cy, point: points[i], arrayIndex: i });
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  if (selectedPointArrayIndex >= 0 && projectedPoints[selectedPointArrayIndex]) {
    const selected = projectedPoints[selectedPointArrayIndex];

    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(selected.x, selected.y, 11, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#f97316";
    ctx.beginPath();
    ctx.arc(selected.x, selected.y, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#111827";
    ctx.font = "bold 15px Arial";
    ctx.fillText("Выбрана", selected.x + 14, selected.y - 10);
  }

  ctx.setLineDash([]);
  ctx.fillStyle = "#334155";
  ctx.font = "16px Arial";
  ctx.fillText("Сравнение с оптимальным кругом", 24, 28);
  ctx.fillText("Круг " + lapData.lap.number + " | " + formatLapTime(lapData.lap.timeMs), 24, 52);
}

function drawTrack(points, keepSelected = false) {
  mapPoints = points;
  clickablePoints = [];
  projectedPoints = [];

  if (!keepSelected) {
    selectedPointArrayIndex = -1;
    document.getElementById("pointLog").style.display = "none";
  }

  setupPointSlider(points);

  const canvas = document.getElementById("map");
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#334155";
  ctx.font = "16px Arial";

  if (points.length < 2) {
    document.getElementById("pointControl").style.display = "none";
    ctx.fillText("Недостаточно GPS-точек для построения трека", 24, 34);
    return;
  }

  const centerLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const centerLng = points.reduce((s, p) => s + p.lng, 0) / points.length;

  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos(centerLat * Math.PI / 180);

  const xy = points.map((p, i) => ({
    ...p,
    x: (p.lng - centerLng) * metersPerDegLng,
    y: (p.lat - centerLat) * metersPerDegLat,
    i
  }));

  const minX = Math.min(...xy.map(p => p.x));
  const maxX = Math.max(...xy.map(p => p.x));
  const minY = Math.min(...xy.map(p => p.y));
  const maxY = Math.max(...xy.map(p => p.y));

  const widthM = Math.max(maxX - minX, 1);
  const heightM = Math.max(maxY - minY, 1);

  const pad = 35;
  const scaleX = (canvas.width - pad * 2) / widthM;
  const scaleY = (canvas.height - pad * 2) / heightM;
  const scale = Math.min(scaleX, scaleY);

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  function toCanvasX(x) {
    return canvas.width / 2 + (x - centerX) * scale;
  }

  function toCanvasY(y) {
    return canvas.height / 2 - (y - centerY) * scale;
  }

  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ctx.beginPath();

  xy.forEach((p, i) => {
    const x = toCanvasX(p.x);
    const y = toCanvasY(p.y);

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.stroke();

  const pointStep = Math.max(1, Math.floor(xy.length / 120));

  xy.forEach((p, i) => {
    if (i % pointStep !== 0 && i !== 0 && i !== xy.length - 1) return;

    const cx = toCanvasX(p.x);
    const cy = toCanvasY(p.y);

    projectedPoints[i] = { x: cx, y: cy, point: points[i], arrayIndex: i };
    clickablePoints.push({ x: cx, y: cy, point: points[i], arrayIndex: i });

    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  xy.forEach((p, i) => {
    if (!projectedPoints[i]) {
      projectedPoints[i] = {
        x: toCanvasX(p.x),
        y: toCanvasY(p.y),
        point: points[i],
        arrayIndex: i
      };
    }
  });

  if (selectedPointArrayIndex >= 0 && projectedPoints[selectedPointArrayIndex]) {
    const selected = projectedPoints[selectedPointArrayIndex];

    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(selected.x, selected.y, 11, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#f97316";
    ctx.beginPath();
    ctx.arc(selected.x, selected.y, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#111827";
    ctx.font = "bold 15px Arial";
    ctx.fillText("Выбрана", selected.x + 14, selected.y - 10);
  }

  ctx.fillStyle = "#334155";
  ctx.fillText("Размер трека: " + widthM.toFixed(1) + "м × " + heightM.toFixed(1) + "м", 24, 28);
}

function setupPointSlider(points) {
  const control = document.getElementById("pointControl");
  const slider = document.getElementById("pointSlider");
  const sliderText = document.getElementById("pointSliderText");

  if (!points.length) {
    control.style.display = "none";
    sliderText.innerText = "Точка: ---";
    return;
  }

  control.style.display = "block";
  slider.min = 0;
  slider.max = points.length - 1;

  if (selectedPointArrayIndex < 0 || selectedPointArrayIndex >= points.length) {
    slider.value = 0;
    sliderText.innerText = "Точка: не выбрана";
  } else {
    slider.value = selectedPointArrayIndex;
    sliderText.innerText = "Точка: " + (selectedPointArrayIndex + 1) + " / " + points.length;
  }
}

function selectPointBySlider(value) {
  const index = Number(value);
  if (!mapPoints.length || index < 0 || index >= mapPoints.length) return;
  selectPoint(index);
}

function selectPoint(index) {
  selectedPointArrayIndex = index;
  setupPointSlider(mapPoints);

  if (comparisonMode && currentComparisonLapData) {
    drawLapLossMap(currentComparisonLapData, true);
  } else {
    drawTrack(mapPoints, true);
  }

  showPointLog(mapPoints[index]);
}

function showPointLog(p) {
  const box = document.getElementById("pointLog");
  const text = document.getElementById("pointLogText");

  let output =
    "Лог точки #" + p.index + "\n" +
    "Выбрана на карте: " + (selectedPointArrayIndex + 1) + " / " + mapPoints.length + "\n" +
    "Время: " + (p.time / 1000).toFixed(1) + " сек\n" +
    "Скорость: " + p.speed.toFixed(1) + " км/ч\n" +
    "Газ: " + p.throttle.toFixed(3) + " В\n" +
    "Ускорение X/Y/Z: " + p.gx.toFixed(2) + " / " + p.gy.toFixed(2) + " / " + p.gz.toFixed(2) + " g\n" +
    "Спутники: " + p.sats + "\n" +
    "HDOP: " + p.hdop.toFixed(1);

  if (comparisonMode && currentComparisonLapData && optimalAnalysis) {
    const segmentIndex = p.segmentIndex || 0;
    const selectedSeg = currentComparisonLapData.segments[segmentIndex];
    const bestSeg = optimalAnalysis.bestSegments[segmentIndex];

    if (selectedSeg && bestSeg && selectedSeg.stats && bestSeg.stats) {
      const lossMs = Math.max(0, selectedSeg.dt - bestSeg.dt);

      output +=
        "\n\nСравнение сегмента #" + segmentIndex + "\n" +
        "Выбранный круг:\n" +
        "  время: " + (selectedSeg.dt / 1000).toFixed(2) + " сек\n" +
        "  средняя скорость: " + selectedSeg.stats.avgSpeed.toFixed(1) + " км/ч\n" +
        "  средний газ: " + selectedSeg.stats.avgThrottle.toFixed(3) + " В\n" +
        "  среднее ускорение: " + selectedSeg.stats.avgAccel.toFixed(2) + " g\n" +
        "\nЛучший такой сегмент:\n" +
        "  круг: " + bestSeg.lapNumber + "\n" +
        "  время: " + (bestSeg.dt / 1000).toFixed(2) + " сек\n" +
        "  средняя скорость: " + bestSeg.stats.avgSpeed.toFixed(1) + " км/ч\n" +
        "  средний газ: " + bestSeg.stats.avgThrottle.toFixed(3) + " В\n" +
        "  среднее ускорение: " + bestSeg.stats.avgAccel.toFixed(2) + " g\n" +
        "\nПотеря на сегменте: +" + (lossMs / 1000).toFixed(2) + " сек";
    }
  }

  text.innerText = output;
  box.style.display = "block";
}

document.getElementById("map").addEventListener("click", function(e) {
  if (!clickablePoints.length) return;

  const rect = this.getBoundingClientRect();
  const scaleX = this.width / rect.width;
  const scaleY = this.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;

  let best = null;
  let bestDist = 999999;

  clickablePoints.forEach(item => {
    const dx = item.x - x;
    const dy = item.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < bestDist) {
      bestDist = dist;
      best = item;
    }
  });

  if (best && bestDist <= 18) {
    selectPoint(best.arrayIndex);
  }
});

setInterval(update, 1000);
update();
loadFiles();
drawTrack([]);
