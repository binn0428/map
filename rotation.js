// Map rotation toggle and scale logic
let mapRotationEnabled = false;
let mapRotationDeg = 0; // fallback if currentBearing is unavailable
// 超採樣縮放比例，用於旋轉時覆蓋四角缺口與提升可視範圍
const MAP_ROTATION_OVERSCAN = (typeof window !== 'undefined' && typeof window.rotationOverscanScale === 'number' && isFinite(window.rotationOverscanScale))
  ? window.rotationOverscanScale
  : 1.25;
// 旋轉時的常數縮放，避免角度變化導致縮放忽大忽小
let rotationScaleConstant = 1;

// 抖動抑制與平滑參數
const HEADING_SMOOTHING_ALPHA = 0.92   // 越大越平滑（0.8~0.92 建議值）
const HEADING_DEADZONE_DEG = 5        // 小於此角度變化則忽略更新
const MIN_ROTATION_INTERVAL_MS = 200; // 最小更新間隔，避免過於頻繁
let displayRotationDeg = 0;           // 平滑後實際套用的角度
let lastRotationUpdateTs = 0;         // 最後一次更新時間戳

function normalizeAngle(angle) {
  let a = angle % 360;
  if (a > 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

function shortestAngleDelta(from, to) {
  const a = normalizeAngle(to) - normalizeAngle(from);
  return normalizeAngle(a);
}

function toggleMapRotation() {
  const container = document.querySelector('.map-container');
  const mapEl = document.getElementById('map');
  const btn = document.getElementById('rotateBtn');
  if (!container || !mapEl) return;

  mapRotationEnabled = !mapRotationEnabled;

  if (mapRotationEnabled) {
    container.classList.add('map-rotated');
    // 啟用時固定縮放為最大需求值，避免旋轉時忽大忽小
    recomputeRotationScaleConstant();
    // 若沒有可用方位或為 0，給一個預設角度以提供視覺回饋
    const hasBearing = (typeof window.currentBearing === 'number' && isFinite(window.currentBearing));
    if (!hasBearing || window.currentBearing === 0) {
      mapRotationDeg = 30; // 預設 30 度
    }
    updateMapRotation();
    if (btn) btn.classList.add('active');
  } else {
    container.classList.remove('map-rotated');
    container.style.setProperty('--map-rotation-deg', '0deg');
    container.style.setProperty('--map-rotation-scale', '1');
    container.style.setProperty('--inverse-map-rotation-scale', '1');
    if (btn) btn.classList.remove('active');
  }
}

function updateMapRotation() {
  if (!mapRotationEnabled) return;
  const container = document.querySelector('.map-container');
  const mapEl = document.getElementById('map');
  if (!container || !mapEl) return;

  let deg = (typeof window.currentBearing === 'number' && isFinite(window.currentBearing))
    ? window.currentBearing
    : mapRotationDeg;

  if (!isFinite(deg)) deg = 0;
  mapRotationDeg = deg;

  // 抑制抖動：角度平滑 + 死區 + 節流
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (now - lastRotationUpdateTs < MIN_ROTATION_INTERVAL_MS) {
    return; // 節流：太快則略過本次更新
  }

  const delta = shortestAngleDelta(displayRotationDeg, deg);
  if (Math.abs(delta) < HEADING_DEADZONE_DEG) {
    // 死區：變化太小不更新，避免晃動
    return;
  }

  // 指數平滑：向目標角度逼近，避免瞬間跳動
  const smoothFactor = 1 - HEADING_SMOOTHING_ALPHA; // 例如 0.15
  displayRotationDeg = normalizeAngle(displayRotationDeg + delta * smoothFactor);
  lastRotationUpdateTs = now;
  container.style.setProperty('--map-rotation-deg', `${displayRotationDeg}deg`);
  // 縮放固定為常數，避免旋轉時忽大忽小
  // （rotationScaleConstant 於啟用時或視窗尺寸/方向變更時重算）
}

// Recompute on viewport changes
window.addEventListener('resize', () => {
  if (mapRotationEnabled) {
    recomputeRotationScaleConstant();
    updateMapRotation();
  }
});

window.addEventListener('orientationchange', () => {
  if (mapRotationEnabled) setTimeout(() => {
    recomputeRotationScaleConstant();
    updateMapRotation();
  }, 300);
});

// Optional: if other code updates currentBearing, refresh rotation
document.addEventListener('bearingUpdated', () => {
  if (mapRotationEnabled) updateMapRotation();
});

// 保證全域可呼叫，並在 DOM 準備好後綁定按鈕事件
window.toggleMapRotation = toggleMapRotation;
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('rotateBtn');
  if (btn) {
    btn.addEventListener('click', toggleMapRotation);
    // 在部分手機瀏覽器上，使用 touchend 可提升點擊反應可靠度
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      toggleMapRotation();
    }, { passive: false });
  }
});
// 計算在任意角度皆可覆蓋的最大邊界縮放，並設定為常數
function recomputeRotationScaleConstant() {
  const container = document.querySelector('.map-container');
  if (!container) return;
  const w = container.clientWidth || window.innerWidth || 1;
  const h = container.clientHeight || window.innerHeight || 1;
  const aspect = h / w;
  // 最大縮放發生在 45 度（cos=sin=1/√2），推導後取兩者較大者
  const maxScaleX = (1 + aspect) / Math.SQRT2;     // wPrime/w at 45°
  const maxScaleY = (1 + (1 / aspect)) / Math.SQRT2; // hPrime/h at 45°
  const baseMaxScale = Math.max(maxScaleX, maxScaleY);
  rotationScaleConstant = baseMaxScale * MAP_ROTATION_OVERSCAN;
  container.style.setProperty('--map-rotation-scale', `${rotationScaleConstant}`);
  container.style.setProperty('--inverse-map-rotation-scale', `${1 / rotationScaleConstant}`);
}