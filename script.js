// 全域變數
console.log('Script.js version: 20240926-2 loaded');

// 移動設備兼容性檢查
function checkMobileCompatibility() {
    const isMobile = window.DeviceMotionEvent !== undefined;
    const userAgent = navigator.userAgent;
    const isAndroid = /Android/i.test(userAgent);
    const isWebView = /wv/i.test(userAgent);
    
    console.log('設備兼容性檢查:', {
        isMobile: isMobile,
        isAndroid: isAndroid,
        isWebView: isWebView,
        userAgent: userAgent,
        screen: {
            width: screen.width,
            height: screen.height,
            pixelRatio: window.devicePixelRatio
        },
        viewport: {
            width: window.innerWidth,
            height: window.innerHeight
        }
    });
    
    // 移動設備檢測（已移除提示）
    // 保留檢測功能但不顯示提示
    
    return { isMobile, isAndroid, isWebView };
}
let map;
let currentPosition = null;
let currentLocationMarker = null; // 當前位置標記
let watchId = null;
let isAddingMarker = false;
let isTracking = false;
let markers = [];
let groups = [];
let currentGroup = null;
let currentSubgroup = null;
let alertDistance = 100; // 預設提醒距離（公尺）
let alertInterval = 30; // 預設提醒間隔時間（秒）
let lastAlerts = new Set(); // 記錄已經提醒過的標註點
let lastAlertTimes = new Map(); // 記錄每個標註點的最後提醒時間
let alertTimers = new Map(); // 記錄每個標註點的定時器
let markersInRange = new Set(); // 記錄當前在範圍內的標註點
let trackingTarget = null; // 當前追蹤的目標標註點
let currentFilter = null; // 當前過濾設定 { type: 'marker'|'group'|'subgroup', id: string }

// 調試：監控 displayedRouteLines 的變化
let originalDisplayedRouteLines = null;
function setupRouteLineMonitoring() {
    // 創建一個代理來監控 displayedRouteLines 的變化
    if (typeof window.displayedRouteLines === 'undefined') {
        window.displayedRouteLines = {};
    }
    
    const handler = {
        set(target, property, value) {
            console.log(`displayedRouteLines 變化: ${property} = `, value);
            console.trace('變化來源:');
            target[property] = value;
            return true;
        },
        deleteProperty(target, property) {
            console.log(`displayedRouteLines 刪除: ${property}`);
            console.trace('刪除來源:');
            delete target[property];
            return true;
        }
    };
    
    // 如果還沒有設置代理，則設置
    if (!originalDisplayedRouteLines) {
        originalDisplayedRouteLines = window.displayedRouteLines;
        window.displayedRouteLines = new Proxy(window.displayedRouteLines, handler);
    }
}

// 即時定位設定
let enableHighAccuracy = true; // 高精度模式
// 是否在中國境內套用座標偏移校正（WGS84→GCJ-02），以貼齊Google在中國區域圖資的偏移
let applyChinaOffset = true;
let autoStartTracking = true; // 自動開始追蹤（修改為預設開啟）
let keepMapCentered = false; // 保持地圖中央（預設關閉）
let markerNotificationsEnabled = false; // 標註點通知開關（新增）
let centeringInterval = 5000; // 定位居中間隔時間（毫秒）（新增）
let centeringTimer = null; // 定位居中定時器（新增）

let locationUpdateFrequency = 3000; // 定位更新頻率（毫秒）
let locationTimeout = 20000; // 定位超時時間（毫秒）
let lastLocationUpdate = null; // 最後一次定位更新時間
let locationUpdateTimer = null; // 定位更新定時器
let lastPosition = null; // 上一次位置（用於計算方向）
let currentBearing = 0; // 當前行進方向（角度）

// 路徑顯示相關變數
let routeLine = null; // 當前顯示的路徑線
let routeDistance = 0; // 路徑總距離
let routeInfoControl = null; // 路徑資訊控制項

// 路線追蹤相關變數
let isRecordingRoute = false; // 是否正在記錄路線
let currentRouteData = null; // 當前記錄的路線數據
let routeRecordingStartTime = null; // 路線記錄開始時間
let displayedRoutes = new Map(); // 當前顯示在地圖上的路線 (routeId -> leaflet polyline)
let routeRecordingInterval = null; // 路線記錄定時器

// ==================== 手動繪製路線 ====================
let isDrawingRoute = false;
let drawnRoutePoints = [];
let drawnRouteLine = null;
let drawRouteTipControl = null;
let drawRouteActionsControl = null;
let isPointerDownForDraw = false;
let drawnRouteStrokeBreaks = [];
let currentStrokeStartIdx = 0;
let isDrawingPaused = false; // 新增：暫停狀態，允許移動畫面

function initManualRouteDrawingUI() {
  const btn = document.getElementById('drawRouteBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!isDrawingRoute) {
      startManualRouteDrawing();
    } else {
      finishManualRouteDrawing();
    }
  });
}

document.addEventListener('DOMContentLoaded', initManualRouteDrawingUI);

function startManualRouteDrawing() {
  if (!map) return;
  isDrawingRoute = true;
  drawnRoutePoints = [];
  drawnRouteStrokeBreaks = [];
  currentStrokeStartIdx = 0;
  // 提示控制項
  drawRouteTipControl = L.control({ position: 'topleft' });
  drawRouteTipControl.onAdd = function () {
    const div = L.DomUtil.create('div', 'route-info-control');
    div.style.padding = '6px 8px';
    div.style.fontSize = '12px';
    div.style.color = '#ffffff';
    div.innerHTML = '✍️ 手繪中：按住拖曳描畫；放開可斷筆；可暫停以移動畫面；再次按按鈕完成';
    return div;
  };
  drawRouteTipControl.addTo(map);
  // 額外控制項：提供清除暫時路線
  drawRouteActionsControl = L.control({ position: 'topleft' });
  drawRouteActionsControl.onAdd = function () {
    const wrap = L.DomUtil.create('div', 'route-info-control');
    wrap.style.padding = '4px 6px';
    wrap.style.fontSize = '12px';
    try {
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation(wrap);
    } catch (e) {}

    // 暫停/繼續
    const btnPause = document.createElement('button');
    btnPause.textContent = '⏸️ 暫停繪製';
    btnPause.type = 'button';
    btnPause.style.padding = '4px 6px';
    btnPause.style.fontSize = '12px';
    btnPause.style.marginTop = '4px';
    btnPause.style.cursor = 'pointer';
    btnPause.style.pointerEvents = 'auto';
    const togglePause = (e) => {
      e.preventDefault();
      e.stopPropagation();
      isDrawingPaused = !isDrawingPaused;
      try {
        if (isDrawingPaused) {
          map.dragging.enable();
          btnPause.textContent = '▶️ 繼續繪製';
          isPointerDownForDraw = false; // 停止當前描畫
          if (drawRouteTipControl && drawRouteTipControl._container) {
            drawRouteTipControl._container.innerHTML = '⏸️ 已暫停：可拖動地圖；點「▶️ 繼續繪製」恢復';
          }
        } else {
          map.dragging.disable();
          btnPause.textContent = '⏸️ 暫停繪製';
          if (drawRouteTipControl && drawRouteTipControl._container) {
            drawRouteTipControl._container.innerHTML = '✍️ 手繪中：按住拖曳描畫；放開可斷筆；可暫停以移動畫面；再次按按鈕完成';
          }
        }
      } catch (err) {}
    };
    // 統一事件處理：優先使用 Pointer Events，避免手機與桌面重複觸發造成狀態來回切換
    btnPause.addEventListener('pointerup', togglePause);
    if (!window.PointerEvent) {
      // 舊版瀏覽器備援：沒有 PointerEvent 才綁 touchend/click
      btnPause.addEventListener('touchend', togglePause, { passive: false });
      btnPause.addEventListener('click', togglePause);
    }

    // 撤銷最後點
    const btnUndoPoint = document.createElement('button');
    btnUndoPoint.textContent = '↩️ 撤銷最後點';
    btnUndoPoint.type = 'button';
    btnUndoPoint.style.padding = '4px 6px';
    btnUndoPoint.style.fontSize = '12px';
    btnUndoPoint.style.marginTop = '4px';
    btnUndoPoint.style.cursor = 'pointer';
    btnUndoPoint.style.pointerEvents = 'auto';
    const handleUndoPoint = (e) => {
      e.preventDefault();
      e.stopPropagation();
      undoLastPoint();
    };
    btnUndoPoint.addEventListener('click', handleUndoPoint);
    btnUndoPoint.addEventListener('touchend', handleUndoPoint, { passive: false });
    btnUndoPoint.addEventListener('pointerup', handleUndoPoint);

    // 撤銷上一段
    const btnUndoStroke = document.createElement('button');
    btnUndoStroke.textContent = '⤺ 撤銷上一段';
    btnUndoStroke.type = 'button';
    btnUndoStroke.style.padding = '4px 6px';
    btnUndoStroke.style.fontSize = '12px';
    btnUndoStroke.style.marginTop = '4px';
    btnUndoStroke.style.cursor = 'pointer';
    btnUndoStroke.style.pointerEvents = 'auto';
    const handleUndoStroke = (e) => {
      e.preventDefault();
      e.stopPropagation();
      undoLastStroke();
    };
    btnUndoStroke.addEventListener('click', handleUndoStroke);
    btnUndoStroke.addEventListener('touchend', handleUndoStroke, { passive: false });
    btnUndoStroke.addEventListener('pointerup', handleUndoStroke);

    const btnClear = document.createElement('button');
    btnClear.textContent = '🗑 清除暫時路線';
    btnClear.type = 'button';
    btnClear.style.padding = '4px 6px';
    btnClear.style.fontSize = '12px';
    btnClear.style.marginTop = '4px';
    btnClear.style.cursor = 'pointer';
    btnClear.style.pointerEvents = 'auto';
    btnClear.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearTemporaryDrawnRoute();
    });
    btnClear.addEventListener('touchend', (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearTemporaryDrawnRoute();
    }, { passive: false });
    btnClear.addEventListener('pointerup', (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearTemporaryDrawnRoute();
    });
    wrap.appendChild(btnPause);
    wrap.appendChild(btnUndoPoint);
    wrap.appendChild(btnUndoStroke);
    wrap.appendChild(btnClear);
    return wrap;
  };
  drawRouteActionsControl.addTo(map);

  // 在手繪期間，暫時關閉地圖拖曳，避免干擾描畫
  try { map.dragging.disable(); } catch (e) {}

  // 滑動描畫事件（滑鼠）
  map.on('mousedown', onDrawMouseDown);
  map.on('mousemove', onDrawMouseMove);
  map.on('mouseup', onDrawMouseUp);
  // 觸控描畫事件（手機）
  map.on('touchstart', onDrawTouchStart);
  map.on('touchmove', onDrawTouchMove);
  map.on('touchend', onDrawTouchEnd);

  // 觸控事件的底層備援：直接綁定到地圖容器，確保部分瀏覽器能取得非被動事件
  const container = map.getContainer();
  if (container) {
    // 禁止點擊/滾動傳播以免干擾
    try {
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
    } catch (e) {}
    container.addEventListener('touchstart', handleContainerTouchStart, { passive: false });
    container.addEventListener('touchmove', handleContainerTouchMove, { passive: false });
    container.addEventListener('touchend', handleContainerTouchEnd, { passive: false });
  }
}

function onDrawMouseDown(e) {
  if (isDrawingPaused) return;
  isPointerDownForDraw = true;
  currentStrokeStartIdx = drawnRoutePoints.length;
  addPointFromEvent(e);
}

function onDrawMouseMove(e) {
  if (!isPointerDownForDraw || isDrawingPaused) return;
  addPointFromEvent(e);
}

function onDrawMouseUp() {
  isPointerDownForDraw = false;
  const end = drawnRoutePoints.length;
  if (end > currentStrokeStartIdx) {
    drawnRouteStrokeBreaks.push({ start: currentStrokeStartIdx, end });
  }
}

function onDrawTouchStart(e) {
  if (isDrawingPaused) { e.preventDefault(); return; }
  isPointerDownForDraw = true;
  currentStrokeStartIdx = drawnRoutePoints.length;
  addPointFromEvent(e);
  e.preventDefault();
}

function onDrawTouchMove(e) {
  if (!isPointerDownForDraw || isDrawingPaused) return;
  addPointFromEvent(e);
  e.preventDefault();
}

function onDrawTouchEnd() {
  isPointerDownForDraw = false;
  const end = drawnRoutePoints.length;
  if (end > currentStrokeStartIdx) {
    drawnRouteStrokeBreaks.push({ start: currentStrokeStartIdx, end });
  }
}

// 直接用容器座標推算經緯度，提升手機觸控相容性
function handleContainerTouchStart(e) {
  if (isDrawingPaused) { e.preventDefault(); return; }
  isPointerDownForDraw = true;
  currentStrokeStartIdx = drawnRoutePoints.length;
  const ll = getLatLngFromTouch(e);
  if (ll) addPointFromLatLng(ll);
  e.preventDefault();
}

function handleContainerTouchMove(e) {
  if (!isPointerDownForDraw || isDrawingPaused) return;
  const ll = getLatLngFromTouch(e);
  if (ll) addPointFromLatLng(ll);
  e.preventDefault();
}

function handleContainerTouchEnd(e) {
  isPointerDownForDraw = false;
  const end = drawnRoutePoints.length;
  if (end > currentStrokeStartIdx) {
    drawnRouteStrokeBreaks.push({ start: currentStrokeStartIdx, end });
  }
  e.preventDefault();
}

function getLatLngFromTouch(e) {
  try {
    const container = map.getContainer();
    const rect = container.getBoundingClientRect();
    const touch = e.touches && e.touches[0] ? e.touches[0] : (e.changedTouches && e.changedTouches[0]);
    if (!touch) return null;
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    const latlng = map.containerPointToLatLng([x, y]);
    return latlng ? { lat: latlng.lat, lng: latlng.lng } : null;
  } catch (err) {
    return null;
  }
}

function addPointFromLatLng(ll) {
  if (isDrawingPaused) return;
  const { lat, lng } = ll;
  const last = drawnRoutePoints[drawnRoutePoints.length - 1];
  if (last) {
    const d = calculateDistance(last[0], last[1], lat, lng);
    if (d < 0.5) return;
  }
  drawnRoutePoints.push([lat, lng]);
  if (!drawnRouteLine) {
    drawnRouteLine = L.polyline(drawnRoutePoints, {
      color: '#1E90FF',
      weight: 4,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);
  } else {
    drawnRouteLine.setLatLngs(drawnRoutePoints);
  }
}

function addPointFromEvent(e) {
  if (isDrawingPaused) return;
  if (!e || !e.latlng) return;
  const { lat, lng } = e.latlng;
  const last = drawnRoutePoints[drawnRoutePoints.length - 1];
  // 降噪：兩點距離過近則忽略，避免建立過多點
  if (last) {
    const d = calculateDistance(last[0], last[1], lat, lng);
    if (d < 0.5) return; // 小於 0.5 公尺忽略
  }
  drawnRoutePoints.push([lat, lng]);
  if (!drawnRouteLine) {
    drawnRouteLine = L.polyline(drawnRoutePoints, {
      color: '#1E90FF',
      weight: 4,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);
  } else {
    drawnRouteLine.setLatLngs(drawnRoutePoints);
  }
}

function finishManualRouteDrawing() {
  if (!isDrawingRoute) return;
  isDrawingRoute = false;
  isDrawingPaused = false;
  map.off('mousedown', onDrawMouseDown);
  map.off('mousemove', onDrawMouseMove);
  map.off('mouseup', onDrawMouseUp);
  map.off('touchstart', onDrawTouchStart);
  map.off('touchmove', onDrawTouchMove);
  map.off('touchend', onDrawTouchEnd);
  const container = map && map.getContainer ? map.getContainer() : null;
  if (container) {
    container.removeEventListener('touchstart', handleContainerTouchStart);
    container.removeEventListener('touchmove', handleContainerTouchMove);
    container.removeEventListener('touchend', handleContainerTouchEnd);
  }
  if (drawRouteTipControl) {
    drawRouteTipControl.remove();
    drawRouteTipControl = null;
  }
  if (drawRouteActionsControl) {
    drawRouteActionsControl.remove();
    drawRouteActionsControl = null;
  }
  try { map.dragging.enable(); } catch (e) {}
  if (!drawnRoutePoints || drawnRoutePoints.length < 2) {
    showNotification('至少需要兩個點才能保存路線', 'warning');
    cleanupDrawnRouteLine();
    return;
  }
  // 完成後詢問起點與終點（依距離列出最近）
  promptSelectStartEndMarkers(drawnRoutePoints);
}

function cleanupDrawnRouteLine() {
  if (drawnRouteLine) {
    map.removeLayer(drawnRouteLine);
    drawnRouteLine = null;
  }
  drawnRoutePoints = [];
  drawnRouteStrokeBreaks = [];
}

function clearTemporaryDrawnRoute() {
  cleanupDrawnRouteLine();
  showNotification('暫時路線已清除', 'info');
}

function updateDrawnPolylineAfterEdit() {
  if (!map) return;
  if (drawnRoutePoints.length === 0) {
    cleanupDrawnRouteLine();
    return;
  }
  if (!drawnRouteLine) {
    drawnRouteLine = L.polyline(drawnRoutePoints, {
      color: '#1E90FF',
      weight: 4,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);
  } else {
    drawnRouteLine.setLatLngs(drawnRoutePoints);
  }
}

function undoLastPoint() {
  if (!drawnRoutePoints || drawnRoutePoints.length === 0) {
    showNotification('沒有可撤銷的點', 'warning');
    return;
  }
  drawnRoutePoints.pop();
  // 如果最後一段被完全移除，同步移除段落紀錄
  const lastBreak = drawnRouteStrokeBreaks[drawnRouteStrokeBreaks.length - 1];
  if (lastBreak && drawnRoutePoints.length <= lastBreak.start) {
    drawnRouteStrokeBreaks.pop();
  }
  updateDrawnPolylineAfterEdit();
}

function undoLastStroke() {
  if (!drawnRouteStrokeBreaks || drawnRouteStrokeBreaks.length === 0) {
    // 若尚無段落紀錄，退回最後點
    undoLastPoint();
    return;
  }
  const last = drawnRouteStrokeBreaks.pop();
  if (last && last.start >= 0) {
    drawnRoutePoints.splice(last.start, drawnRoutePoints.length - last.start);
  }
  updateDrawnPolylineAfterEdit();
  showNotification('已撤銷上一段', 'info');
}

function promptSelectStartEndMarkers(points) {
  const first = points[0];
  const last = points[points.length - 1];
  const startCandidates = getNearestMarkers(first[0], first[1], 10);
  const endCandidates = getNearestMarkers(last[0], last[1], 10);

  const modal = document.createElement('div');
  modal.style.position = 'fixed';
  modal.style.left = '50%';
  modal.style.top = '50%';
  modal.style.transform = 'translate(-50%, -50%)';
  modal.style.background = '#fff';
  modal.style.border = '1px solid #ddd';
  modal.style.borderRadius = '10px';
  modal.style.boxShadow = '0 10px 30px rgba(0,0,0,0.15)';
  modal.style.zIndex = '9999';
  modal.style.minWidth = '320px';
  modal.style.maxWidth = '92vw';
  modal.style.maxHeight = '72vh';
  modal.style.overflow = 'auto';

  const header = document.createElement('div');
  header.style.padding = '10px 12px';
  header.style.borderBottom = '1px solid #eee';
  header.style.fontSize = '13px';
  header.style.fontWeight = '600';
  header.textContent = '選擇起點與終點（依距離排序）';

  const body = document.createElement('div');
  body.style.display = 'grid';
  body.style.gridTemplateColumns = '1fr 1fr';
  body.style.gap = '8px';
  body.style.padding = '8px 12px';

  const startCol = document.createElement('div');
  const startTitle = document.createElement('div');
  startTitle.textContent = '起點（靠近第一個筆劃）';
  startTitle.style.fontSize = '12px';
  startTitle.style.fontWeight = '600';
  startTitle.style.marginBottom = '6px';
  startCol.appendChild(startTitle);
  const startList = document.createElement('div');
  startCandidates.forEach(m => {
    const item = document.createElement('div');
    item.style.padding = '6px 8px';
    item.style.cursor = 'pointer';
    item.style.border = '1px solid #f2f2f2';
    item.style.borderRadius = '6px';
    item.style.marginBottom = '6px';
    const dist = calculateDistance(first[0], first[1], m.lat, m.lng).toFixed(1);
    item.innerHTML = `${m.icon || '📍'} ${m.name} <small>(${dist}m)</small>`;
    item.addEventListener('click', () => {
      startList.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      item.style.borderColor = '#3b82f6';
      item.dataset.selectedId = m.id;
      startList.dataset.selectedId = m.id;
    });
    startList.appendChild(item);
  });
  startCol.appendChild(startList);

  const endCol = document.createElement('div');
  const endTitle = document.createElement('div');
  endTitle.textContent = '終點（靠近最後一個筆劃）';
  endTitle.style.fontSize = '12px';
  endTitle.style.fontWeight = '600';
  endTitle.style.marginBottom = '6px';
  endCol.appendChild(endTitle);
  const endList = document.createElement('div');
  endCandidates.forEach(m => {
    const item = document.createElement('div');
    item.style.padding = '6px 8px';
    item.style.cursor = 'pointer';
    item.style.border = '1px solid #f2f2f2';
    item.style.borderRadius = '6px';
    item.style.marginBottom = '6px';
    const dist = calculateDistance(last[0], last[1], m.lat, m.lng).toFixed(1);
    item.innerHTML = `${m.icon || '📍'} ${m.name} <small>(${dist}m)</small>`;
    item.addEventListener('click', () => {
      endList.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      item.style.borderColor = '#3b82f6';
      endList.dataset.selectedId = m.id;
    });
    endList.appendChild(item);
  });
  endCol.appendChild(endList);

  body.appendChild(startCol);
  body.appendChild(endCol);

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '8px';
  actions.style.padding = '8px 12px';
  actions.style.justifyContent = 'flex-end';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '取消';
  cancelBtn.style.padding = '6px 10px';
  cancelBtn.style.fontSize = '12px';
  cancelBtn.addEventListener('click', () => {
    document.body.removeChild(modal);
    cleanupDrawnRouteLine();
  });
  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = '保存';
  confirmBtn.style.padding = '6px 10px';
  confirmBtn.style.fontSize = '12px';
  confirmBtn.addEventListener('click', () => {
    const startId = startList.dataset.selectedId;
    const endId = endList.dataset.selectedId;
    if (!startId || !endId) {
      showNotification('請選擇起點與終點', 'warning');
      return;
    }
    const startMarker = markers.find(m => m.id === startId);
    const endMarker = markers.find(m => m.id === endId);
    if (!startMarker || !endMarker) {
      showNotification('選擇標註點無效', 'error');
      return;
    }
    saveManualRouteWithStartEnd(startMarker, endMarker, points);
    document.body.removeChild(modal);
  });
  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(actions);
  document.body.appendChild(modal);
}

function getNearestMarkers(lat, lng, limit = 10) {
  if (!Array.isArray(markers)) return [];
  const list = markers.map(m => ({
    id: m.id,
    name: m.name,
    icon: m.icon,
    lat: m.lat,
    lng: m.lng,
    dist: calculateDistance(lat, lng, m.lat, m.lng)
  }));
  list.sort((a, b) => a.dist - b.dist);
  return list.slice(0, limit);
}

function saveManualRouteWithStartEnd(startMarker, endMarker, points) {
  const selectedColor = (typeof getSavedPathColor === 'function' && getSavedPathColor() && getSavedPathColor() !== 'random')
    ? getSavedPathColor() : generateRandomColor();
  // 計算總距離
  let totalDistance = 0;
  for (let i = 1; i < points.length; i++) {
    const [lat1, lng1] = points[i - 1];
    const [lat2, lng2] = points[i];
    totalDistance += calculateDistance(lat1, lng1, lat2, lng2);
  }
  const routeRecord = {
    id: `${startMarker.id}_manual_${Date.now()}`,
    name: `手繪路線 ${new Date().toLocaleString()}`,
    coordinates: points.map(p => ({ lat: p[0], lng: p[1], timestamp: Date.now() })),
    distance: totalDistance,
    duration: 0,
    color: selectedColor,
    createdAt: new Date().toISOString(),
    startMarkerId: startMarker.id,
    startMarkerName: startMarker.name,
    targetMarkerId: endMarker.id,
    targetMarkerName: endMarker.name
  };
  if (!startMarker.routeRecords) startMarker.routeRecords = [];
  if (startMarker.routeRecords.length >= 10) startMarker.routeRecords.shift();
  startMarker.routeRecords.push(routeRecord);
  const polyline = L.polyline(points, {
    color: selectedColor,
    weight: 4,
    opacity: 0.9,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(map);
  // 附加刪除事件（點擊線後可刪除）
  polyline.routeRecordId = routeRecord.id;
  polyline.on('click', (evt) => {
    const latlng = evt.latlng;
    const popupContent = document.createElement('div');
    const delBtn = document.createElement('button');
    delBtn.textContent = '刪除此路線';
    delBtn.style.padding = '4px 6px';
    delBtn.style.fontSize = '12px';
    delBtn.addEventListener('click', () => {
      deleteSavedManualRoute(routeRecord.id);
      map.closePopup();
    });
    popupContent.appendChild(delBtn);
    L.popup().setLatLng(latlng).setContent(popupContent).openOn(map);
  });
  displayedRoutes.set(routeRecord.id, polyline);
  // 同步到通用顯示集合，讓「隱藏路線」可立即作用
  try {
    const routeIndex = startMarker.routeRecords.length - 1;
    if (!window.displayedRouteLines) window.displayedRouteLines = {};
    const displayedKey = `${startMarker.id}_${routeIndex}`;
    window.displayedRouteLines[displayedKey] = polyline;
  } catch (e) {
    console.warn('同步顯示路線至 displayedRouteLines 失敗：', e);
  }
  // 立即更新標註點彈窗內容，顯示最新路線管理按鈕
  try { if (typeof updateMarkerPopup === 'function') updateMarkerPopup(startMarker); } catch (e) {}
  showNotification(`✅ 手繪路線已保存：起點「${startMarker.name}」 → 終點「${endMarker.name}」`, 'success');
  cleanupDrawnRouteLine();
  try { if (typeof saveData === 'function') saveData(); } catch (e) { console.warn('保存資料時發生例外：', e); }
}

function deleteSavedManualRoute(routeId) {
  // 從地圖移除
  const polyline = displayedRoutes.get(routeId);
  if (polyline) {
    try { map.removeLayer(polyline); } catch (e) {}
    displayedRoutes.delete(routeId);
  }
  // 從標註紀錄中移除
  if (Array.isArray(markers)) {
    for (const m of markers) {
      if (Array.isArray(m.routeRecords)) {
        const idx = m.routeRecords.findIndex(r => r.id === routeId);
        if (idx !== -1) {
          // 同步從通用顯示集合移除，使隱藏狀態一致
          try {
            const key = `${m.id}_${idx}`;
            if (window.displayedRouteLines && window.displayedRouteLines[key]) {
              try { map.removeLayer(window.displayedRouteLines[key]); } catch (e2) {}
              delete window.displayedRouteLines[key];
            }
          } catch (e) { /* 忽略同步錯誤 */ }
          m.routeRecords.splice(idx, 1);
          showNotification('🗑 路線已刪除', 'success');
          try { if (typeof saveData === 'function') saveData(); } catch (e) {}
          break;
        }
      }
    }
  }
}

// 螢幕恆亮相關變數
let wakeLock = null; // 螢幕恆亮鎖定物件
let isWakeLockEnabled = false; // 螢幕恆亮是否啟用

// 資料結構
class Group {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.subgroups = [];
        this.markers = [];
    }
    
    addSubgroup(subgroup) {
        this.subgroups.push(subgroup);
    }
    
    removeSubgroup(subgroupId) {
        this.subgroups = this.subgroups.filter(sg => sg.id !== subgroupId);
    }
    
    addMarker(marker) {
        this.markers.push(marker);
    }
    
    removeMarker(markerId) {
        this.markers = this.markers.filter(m => m.id !== markerId);
    }
}

class Subgroup {
    constructor(id, name, groupId) {
        this.id = id;
        this.name = name;
        this.groupId = groupId;
        this.markers = [];
    }
    
    addMarker(marker) {
        this.markers.push(marker);
    }
    
    removeMarker(markerId) {
        this.markers = this.markers.filter(m => m.id !== markerId);
    }
}

class Marker {
    constructor(id, name, description, lat, lng, groupId, subgroupId = null, color = 'red', icon = '📍', imageData = null) {
        this.id = id;
        this.name = name;
        this.description = description;
        this.lat = lat;
        this.lng = lng;
        this.groupId = groupId;
        this.subgroupId = subgroupId;
        this.color = color;
        this.icon = icon;
        this.imageData = imageData; // base64編碼的圖片數據
        this.leafletMarker = null;
        
        // 路線記錄數據結構 - 支持最多10筆路線
        this.routeRecords = []; // 存儲路線記錄的陣列
        this.maxRoutes = 10; // 最大路線記錄數量
    }
    
    // 添加新的路線記錄
    addRoute(routeData) {
        // 如果已達到最大數量，移除最舊的記錄
        if (this.routeRecords.length >= this.maxRoutes) {
            this.routeRecords.shift();
        }
        
        // 生成隨機顏色
        const randomColor = this.generateRandomColor();
        
        // 創建路線記錄對象
        const route = {
            id: Date.now() + Math.random(), // 唯一ID
            name: routeData.name || `路線 ${this.routeRecords.length + 1}`,
            color: randomColor,
            coordinates: routeData.coordinates || [], // 座標點陣列 [{lat, lng, timestamp}]
            distance: routeData.distance || 0, // 總距離（公尺）
            duration: routeData.duration || 0, // 總時間（毫秒）
            createdAt: new Date().toISOString(),
            isActive: false // 是否為當前活動路線
        };
        
        this.routeRecords.push(route);
        return route;
    }
    
    // 刪除指定路線
    removeRoute(routeId) {
        this.routeRecords = this.routeRecords.filter(route => route.id !== routeId);
    }
    
    // 獲取所有路線
    getRoutes() {
        return this.routeRecords;
    }
    
    // 獲取指定路線
    getRoute(routeId) {
        return this.routeRecords.find(route => route.id === routeId);
    }
    
    // 設置活動路線
    setActiveRoute(routeId) {
        this.routeRecords.forEach(route => {
            route.isActive = route.id === routeId;
        });
    }
    
    // 清除所有活動路線
    clearActiveRoutes() {
        this.routeRecords.forEach(route => {
            route.isActive = false;
        });
    }
    
    // 生成隨機顏色或使用選擇的顏色
    generateRandomColor() {
        // 檢查是否有選擇的顏色
        const selectedColorRadio = document.querySelector('input[name="pathColor"]:checked');
        
        if (selectedColorRadio && selectedColorRadio.value !== 'random') {
            return selectedColorRadio.value;
        } else {
            // 隨機顏色
            const colors = [
                '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
                '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
                '#F8C471', '#82E0AA', '#F1948A', '#85C1E9', '#D7BDE2'
            ];
            return colors[Math.floor(Math.random() * colors.length)];
        }
    }
    
    // 檢查是否有路線記錄
    hasRoutes() {
        return this.routeRecords.length > 0;
    }
}

// 輔助函數：獲取設定元素（優先使用浮動設定窗口的元素）
function getSettingsElement(elementId) {
    // 映射舊的元素ID到新的浮動設定元素ID
    const elementMapping = {
        'enableNotifications': 'floatingEnableNotifications',
        'alertDistance': 'floatingAlertDistance',
        'alertInterval': 'floatingAlertInterval',
        'keepMapCentered': 'floatingKeepMapCentered',
        'enableNotificationSound': 'floatingEnableNotificationSound',
        'notificationVolume': 'floatingNotificationVolume'
    };
    
    const floatingId = elementMapping[elementId];
    if (floatingId) {
        const floatingElement = document.getElementById(floatingId);
        if (floatingElement) {
            return floatingElement;
        }
    }
    
    // 如果浮動元素不存在，嘗試原始元素（向後兼容）
    return document.getElementById(elementId);
}

// 初始化控制按鈕


// 初始化應用程式
async function initializeApp() {
    console.log('=== 應用程式初始化開始 - 版本 2024.01.20 ===');
    initMap();
    // 嘗試申請持久化儲存，降低 iOS/Safari 清空機率
    try {
        if (navigator.storage && typeof navigator.storage.persist === 'function') {
            const persisted = await navigator.storage.persist();
            console.log('Storage persist 狀態:', persisted);
        }
    } catch (e) {
        console.warn('Storage persist 申請失敗或不支援:', e);
    }
    // 將現有 localStorage 資料遷移到 IndexedDB（主存）
    try { await migrateLocalStorageToIndexedDB(); } catch (e) { console.warn('資料遷移失敗:', e); }
    await loadData();
    updateGroupsList();
    updateMarkersList();
    
    // 初始化Service Worker消息監聽
    initServiceWorkerMessaging();
    
    // 初始化設定按鈕
    initSettingsButtons();
    
    // 初始化螢幕恆亮功能
    initWakeLock();
    
    // 自動定位功能 - 在頁面載入時自動獲取當前位置（無論是否完成初始設定）
    setTimeout(async () => {
        autoGetCurrentLocation();
    }, 500);

    // 啟動裝置指南針監聽（DeviceOrientation）
    initCompassOrientation();
    
    // 檢查是否是第一次使用（優先 IndexedDB）
    const hasSeenSetup = await appStorageGet('hasSeenSetup');
    if (!hasSeenSetup) {
        showInitialSetup();
    } else {
        requestNotificationPermission();
        
        // 如果啟用自動開始追蹤，延遲一秒後開始追蹤
        if (autoStartTracking) {
            setTimeout(() => {
                if (!isTracking) {
                    startTracking();
                    showNotification('🎯 自動開始即時定位追蹤', 'info');
                }
            }, 1000);
        }
    }

    // 解析並應用共享連結（若存在）
    handleSharedLinkOnInit();
}

// 自動獲取當前位置函數
async function autoGetCurrentLocation() {
    if (!('geolocation' in navigator)) {
        showNotification('❌ 您的瀏覽器不支援地理定位功能', 'error');
        setDefaultLocation();
        return;
    }

    // 檢查權限狀態
    if ('permissions' in navigator) {
        try {
            const permission = await navigator.permissions.query({name: 'geolocation'});
            
            if (permission.state === 'denied') {
                showNotification('❌ 位置權限已被拒絕。請在瀏覽器設定中允許位置存取，然後重新整理頁面。', 'error');
                setDefaultLocation();
                return;
            }
            
            if (permission.state === 'prompt') {
                showNotification('📍 請允許位置存取以獲得更好的體驗', 'info');
            }
        } catch (e) {
            console.log('無法檢查權限狀態:', e);
        }
    }
    
    // 顯示定位中的提示
    showNotification('📍 正在獲取您的位置...', 'info');
    
    // 設定定位選項
    const options = {
        enableHighAccuracy: true, // 始終使用高精度定位
        timeout: 30000, // 增加超時時間到30秒
        maximumAge: 0 // 不使用緩存，強制獲取新的位置
    };
    
    navigator.geolocation.getCurrentPosition(
        function(position) {
            currentPosition = {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracy: position.coords.accuracy,
                timestamp: position.timestamp
            };
            
            // 更新位置顯示
            updateLocationDisplay();
            
            // 更新當前位置標記（會自動處理居中）
            updateCurrentLocationMarker();
            
            // 初次定位時強制居中到合適的縮放級別
            centerMapToCurrentPosition(true, 15);
            
            // 顯示成功通知
            const accuracy = Math.round(currentPosition.accuracy);
            showNotification(`🎯 定位成功！精度: ±${accuracy}公尺`, 'success');
            
            // 自動啟動追蹤功能
            if (autoStartTracking && !isTracking) {
                setTimeout(() => {
                    startTracking();
                    isTracking = true;
                    
                    // 更新追蹤按鈕狀態
                    const btn = document.getElementById('trackingBtn');
                    if (btn) {
                        btn.classList.add('active');
                        btn.innerHTML = '<span>🎯</span>自動追蹤';
                    }
                    
                    showNotification('📍 位置追蹤已自動啟動', 'info');
                }, 1000); // 延遲1秒啟動追蹤
            }
            
            console.log('自動定位成功:', currentPosition);
        },
        function(error) {
            console.error('自動定位失敗:', {
                code: error.code,
                message: error.message,
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                isSecureContext: window.isSecureContext,
                protocol: window.location.protocol
            });
            
            // 根據錯誤類型顯示不同的提示
            let errorMessage = '📍 無法獲取位置';
            let showRetryButton = false;
            let technicalInfo = '';
            
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    if (isMobileDevice()) {
                        errorMessage = '❌ 位置權限被拒絕。請在手機設定中允許此網站存取位置，或點擊地址欄的位置圖示重新授權。';
                    } else {
                        errorMessage = '❌ 位置權限被拒絕。請點擊瀏覽器地址欄的位置圖示重新授權。';
                    }
                    technicalInfo = '錯誤代碼: PERMISSION_DENIED (1)';
                    break;
                case error.POSITION_UNAVAILABLE:
                    errorMessage = '📍 位置信息不可用。請檢查GPS是否開啟，或確認網路連接正常。';
                    technicalInfo = '錯誤代碼: POSITION_UNAVAILABLE (2)';
                    showRetryButton = true;
                    break;
                case error.TIMEOUT:
                    errorMessage = '⏰ 定位超時（30秒）。請確認GPS訊號良好，或稍後再試。';
                    technicalInfo = '錯誤代碼: TIMEOUT (3)';
                    showRetryButton = true;
                    break;
                default:
                    errorMessage = '📍 定位失敗。請檢查網路連接或手動點擊定位按鈕重試。';
                    technicalInfo = `錯誤代碼: ${error.code}`;
                    showRetryButton = true;
                    break;
            }
            
            // 檢查是否為HTTPS環境
            if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
                errorMessage += '\n⚠️ 注意：定位功能需要HTTPS環境才能正常工作。';
                technicalInfo += ' | 非HTTPS環境';
            }
            
            showNotification(errorMessage, 'warning');
            
            // 在控制台顯示技術信息
            console.warn(`定位失敗詳情: ${technicalInfo} | ${error.message}`);
            
            if (showRetryButton && isMobileDevice()) {
                // 在手機上顯示重試提示
                setTimeout(() => {
                    showNotification('💡 提示：您可以點擊右下角的定位按鈕手動重試定位', 'info');
                }, 3000);
            }
            
            setDefaultLocation();
        },
        options
    );
}

function setDefaultLocation() {
    // 設定為預設位置（台北市中心）
    const defaultLat = 25.0330;
    const defaultLng = 121.5654;
    map.setView([defaultLat, defaultLng], 16);
    showNotification('已自動設定為台北市中心。您可以點擊地圖來添加標記。', 'info');
}

// 初始化Service Worker消息傳遞
function initServiceWorkerMessaging() {
    if ('serviceWorker' in navigator) {
        // 監聽來自Service Worker的消息
        navigator.serviceWorker.addEventListener('message', function(event) {
            console.log('Received message from Service Worker:', event.data);
            
            if (event.data && event.data.type === 'FOCUS_MARKER') {
                const markerId = event.data.markerId;
                focusMarker(markerId);
            }
            
            if (event.data && event.data.type === 'BACKGROUND_LOCATION_CHECK') {
                // 執行背景位置檢查
                if (isTracking && currentPosition) {
                    checkProximityAlerts();
                }
            }
            
            if (event.data && event.data.type === 'PLAY_NOTIFICATION_SOUND') {
                // 播放通知音效
                if (window.notificationSound && typeof window.notificationSound.playNotificationSound === 'function') {
                    window.notificationSound.playNotificationSound().then(() => {
                        console.log('Service Worker 觸發的通知音效播放成功');
                    }).catch(error => {
                        console.warn('Service Worker 觸發的通知音效播放失敗:', error);
                    });
                } else {
                    console.log('通知音效功能不可用');
                }
            }
        });
        
        // 定期向Service Worker發送保持活躍信號
        setInterval(() => {
            if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({
                    type: 'KEEP_ALIVE',
                    timestamp: Date.now()
                });
            }
        }, 25000); // 每25秒發送一次
        
        // 當頁面即將關閉時，嘗試註冊背景同步
        window.addEventListener('beforeunload', function() {
            if (navigator.serviceWorker.controller && 'sync' in window.ServiceWorkerRegistration.prototype) {
                navigator.serviceWorker.ready.then(function(registration) {
                    return registration.sync.register('location-check');
                }).catch(function(error) {
                    console.log('Background sync registration failed:', error);
                });
            }
        });
        
        // 當頁面變為隱藏時，增加保持活躍頻率並啟動後台位置檢查
        let backgroundCheckInterval = null;
        
        document.addEventListener('visibilitychange', function() {
            if (document.hidden) {
                console.log('Page hidden, increasing Service Worker keep-alive frequency');
                
                // 頁面隱藏時，更頻繁地發送保持活躍信號
                const hiddenInterval = setInterval(() => {
                    if (navigator.serviceWorker.controller) {
                        navigator.serviceWorker.controller.postMessage({
                            type: 'KEEP_ALIVE',
                            timestamp: Date.now(),
                            hidden: true
                        });
                    }
                }, 10000); // 每10秒發送一次
                
                // 啟動後台位置檢查機制
                if (isTracking && currentPosition && trackingTarget) {
                    // 清除可能存在的舊間隔
                    if (backgroundCheckInterval) {
                        clearInterval(backgroundCheckInterval);
                    }
                    
                    // 設定後台檢查間隔，頻率較低以節省電池
                    backgroundCheckInterval = setInterval(() => {
                        if (!document.hidden) {
                            clearInterval(backgroundCheckInterval);
                            backgroundCheckInterval = null;
                            return;
                        }
                        
                        // 在後台模式下進行位置檢查
                        console.log('後台位置檢查');
                        checkProximityAlerts();
                        
                        // 向Service Worker發送後台位置檢查信號
                        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                            navigator.serviceWorker.controller.postMessage({
                                type: 'BACKGROUND_LOCATION_CHECK',
                                timestamp: Date.now(),
                                trackingTarget: trackingTarget ? {
                                    id: trackingTarget.id,
                                    name: trackingTarget.name,
                                    lat: trackingTarget.lat,
                                    lng: trackingTarget.lng
                                } : null,
                                currentPosition: currentPosition
                            });
                        }
                    }, 15000); // 每15秒檢查一次，平衡效能和電池消耗
                }
                
                // 當頁面重新可見時，清除高頻率間隔
                const visibilityHandler = function() {
                    if (!document.hidden) {
                        console.log('Page visible, reducing Service Worker keep-alive frequency');
                        clearInterval(hiddenInterval);
                        
                        // 清除後台檢查間隔
                        if (backgroundCheckInterval) {
                            clearInterval(backgroundCheckInterval);
                            backgroundCheckInterval = null;
                        }
                        
                        document.removeEventListener('visibilitychange', visibilityHandler);
                    }
                };
                document.addEventListener('visibilitychange', visibilityHandler);
            }
        });
    }
}



// 初始化地圖
function initMap() {
    // 預設位置（台北101）
    const defaultLat = 25.0330;
    const defaultLng = 121.5654;
    
    // 設定地圖初始縮放級別為18，適合查看建築物和街道細節
    map = L.map('map', {
        maxZoom: 22,  // 設定地圖最大縮放級別，符合Google地圖標準
        minZoom: 3,   // 設定地圖最小縮放級別，允許查看更大範圍
        // 性能優化設置
        preferCanvas: true,        // 使用Canvas渲染以提升性能
        zoomAnimation: true,       // 啟用縮放動畫
        fadeAnimation: true,       // 啟用淡入淡出動畫
        markerZoomAnimation: true, // 啟用標記縮放動畫
        zoomSnap: 0.25,           // 縮放步進設置，更細緻的縮放控制
        wheelPxPerZoomLevel: 60,  // 滾輪縮放靈敏度
        // 觸控優化
        tap: true,                // 啟用觸控點擊
        tapTolerance: 15,         // 觸控容錯範圍
        touchZoom: true,          // 啟用觸控縮放
        bounceAtZoomLimits: false // 禁用縮放邊界彈跳效果以提升性能
    }).setView([defaultLat, defaultLng], 18);
    
    // 添加地圖圖層 - 使用Google地圖圖資
    // Google街道地圖
    const googleStreetLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        attribution: '© Google',
        subdomains: ['0', '1', '2', '3'],
        maxZoom: 22,  // 街道地圖最大縮放級別22
        minZoom: 3,
        // 性能優化
        updateWhenIdle: false,    // 地圖移動時持續更新圖層
        updateWhenZooming: true,  // 縮放時更新圖層
        keepBuffer: 8,            // 保持額外的圖層緩存
        updateInterval: 100       // 更新間隔（毫秒）
    });
    
    // Google衛星圖
    const googleSatelliteLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
        attribution: '© Google',
        subdomains: ['0', '1', '2', '3'],
        maxZoom: 23,  // 衛星圖最大縮放級別23，在某些地區可達到建築物細節
        minZoom: 3,
        // 性能優化
        updateWhenIdle: false,    // 地圖移動時持續更新圖層
        updateWhenZooming: true,  // 縮放時更新圖層
        keepBuffer: 8,            // 保持額外的圖層緩存
        updateInterval: 100       // 更新間隔（毫秒）
    });
    
    // Google混合圖 (衛星+標籤) - 設為預設圖層
    const googleHybridLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        attribution: '© Google',
        subdomains: ['0', '1', '2', '3'],
        maxZoom: 23,  // 混合圖最大縮放級別23
        minZoom: 3,
        // 性能優化
        updateWhenIdle: false,    // 地圖移動時持續更新圖層
        updateWhenZooming: true,  // 縮放時更新圖層
        keepBuffer: 8,            // 保持額外的圖層緩存
        updateInterval: 100       // 更新間隔（毫秒）
    }).addTo(map);
    
    // Google地形圖
    const googleTerrainLayer = L.tileLayer('https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
        attribution: '© Google',
        subdomains: ['0', '1', '2', '3'],
        maxZoom: 20,  // 地形圖最大縮放級別20
        minZoom: 3,
        // 性能優化
        updateWhenIdle: false,    // 地圖移動時持續更新圖層
        updateWhenZooming: true,  // 縮放時更新圖層
        keepBuffer: 8,            // 保持額外的圖層緩存
        updateInterval: 100       // 更新間隔（毫秒）
    });
    
    // 備用圖層 - OpenStreetMap
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,  // OSM最大縮放級別19
        minZoom: 3,
        // 性能優化
        updateWhenIdle: false,    // 地圖移動時持續更新圖層
        updateWhenZooming: true,  // 縮放時更新圖層
        keepBuffer: 8,            // 保持額外的圖層緩存
        updateInterval: 100       // 更新間隔（毫秒）
    });
    
    // 地圖圖層控制
    const baseMaps = {
        "Google 街道地圖": googleStreetLayer,
        "Google 衛星圖": googleSatelliteLayer,
        "Google 混合圖": googleHybridLayer,
        "Google 地形圖": googleTerrainLayer,
        "OpenStreetMap": osmLayer
    };
    
    // 添加圖層控制器（移到右下角避免被下拉式選單遮擋）
    L.control.layers(baseMaps, null, {position: 'bottomright'}).addTo(map);
    
    // 地圖點擊事件
    map.on('click', function(e) {
        if (isAddingMarker) {
            showMarkerModal(e.latlng.lat, e.latlng.lng);
        }
    });
}

// ===== 座標系轉換與區域判定（解決中國區域圖資與GPS座標偏移） =====
// 判斷是否在「中國大陸」範圍（排除台灣、香港、澳門），避免在非偏移區域套用GCJ-02校正
function isInMainlandChina(lat, lng) {
    // 粗略大陸邊界盒（先快速排除）
    const inChinaBox = (lng >= 72.004 && lng <= 137.8347 && lat >= 0.8293 && lat <= 55.8271);
    if (!inChinaBox) return false;
    // 排除台灣
    const inTaiwan = (lng >= 119.3 && lng <= 122.5 && lat >= 21.5 && lat <= 25.6);
    if (inTaiwan) return false;
    // 排除香港
    const inHongKong = (lng >= 113.7 && lng <= 114.5 && lat >= 22.15 && lat <= 22.6);
    if (inHongKong) return false;
    // 排除澳門
    const inMacau = (lng >= 113.5 && lng <= 113.7 && lat >= 22.1 && lat <= 22.25);
    if (inMacau) return false;
    return true;
}

function transformLat(x, y) {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320.0 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
    return ret;
}

function transformLon(x, y) {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
    return ret;
}

// WGS84 → GCJ-02（僅在中國境內時應用）
function wgs84ToGcj02(lat, lng) {
    if (!isInMainlandChina(lat, lng)) return { lat, lng };
    const a = 6378245.0;
    const ee = 0.00669342162296594323;
    let dLat = transformLat(lng - 105.0, lat - 35.0);
    let dLng = transformLon(lng - 105.0, lat - 35.0);
    const radLat = lat / 180.0 * Math.PI;
    let magic = Math.sin(radLat);
    magic = 1 - ee * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
    dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
    const mgLat = lat + dLat;
    const mgLng = lng + dLng;
    return { lat: mgLat, lng: mgLng };
}

// 取得用於地圖顯示的座標（根據設定與區域自動校正）
function getMapDisplayCoord(lat, lng) {
    if (applyChinaOffset && isInMainlandChina(lat, lng)) {
        return wgs84ToGcj02(lat, lng);
    }
    return { lat, lng };
}

// 取得用於資料儲存的實際座標（將地圖顯示座標轉回 WGS84）
function getMapActualCoord(lat, lng) {
    if (applyChinaOffset && isInMainlandChina(lat, lng)) {
        return gcj02ToWgs84(lat, lng);
    }
    return { lat, lng };
}

// GCJ-02 → WGS84（反向轉換，用於拖曳後正確儲存）
function gcj02ToWgs84(lat, lng) {
    if (!isInMainlandChina(lat, lng)) return { lat, lng };
    const a = 6378245.0;
    const ee = 0.00669342162296594323;
    let dLat = transformLat(lng - 105.0, lat - 35.0);
    let dLng = transformLon(lng - 105.0, lat - 35.0);
    const radLat = lat / 180.0 * Math.PI;
    let magic = Math.sin(radLat);
    magic = 1 - ee * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
    dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
    const mgLat = lat + dLat;
    const mgLng = lng + dLng;
    // 反推回原始 WGS84 座標
    return { lat: lat * 2 - mgLat, lng: lng * 2 - mgLng };
}

// 創建當前位置圖示
function createCurrentLocationIcon() {
    return L.divIcon({
        className: 'current-location-marker',
        html: `
            <div class="location-pulse">
                <div class="location-dot"></div>
            </div>
        `,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
}

// 創建自定義標示點圖示
function createCustomMarkerIcon(color, icon) {
    const colorMap = {
        red: '#ef4444',
        blue: '#3b82f6',
        green: '#10b981',
        orange: '#f97316',
        purple: '#8b5cf6',
        yellow: '#eab308'
    };
    
    const bgColor = colorMap[color] || colorMap.red;
    
    return L.divIcon({
        html: `<div style="
            background-color: ${bgColor}; 
            width: 24px; 
            height: 24px; 
            border-radius: 50%; 
            border: 2px solid white; 
            box-shadow: 0 2px 6px rgba(0,0,0,0.25);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
        ">${icon}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        className: 'custom-marker-icon',
    });
}

// 初始化事件監聽器
function initEventListeners() {
    // 新增組別按鈕
    document.getElementById('addGroupBtn').addEventListener('click', addGroup);
    
    // 為新增組別按鈕添加隨機顏色
    applyRandomColorToAddBtn();
    
    // 顯示所有標記按鈕
    document.getElementById('showAllMarkersBtn').addEventListener('click', function() {
        clearFilter();
        selectGroup(null); // 重置群組選擇
    });
    document.getElementById('groupNameInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') addGroup();
    });
    
    // 控制按鈕
    document.getElementById('addMarkerBtn').addEventListener('click', toggleAddMarkerMode);
    // 追蹤按鈕可能被移除（自動追蹤啟用且不顯示圖示），綁定事件需判斷存在
    const trackingBtnEl = document.getElementById('trackingBtn');
    if (trackingBtnEl) {
        trackingBtnEl.addEventListener('click', toggleTracking);
    }
    document.getElementById('notificationBtn').addEventListener('click', toggleNotifications);
    document.getElementById('centerMapBtn').addEventListener('click', centerMapToCurrentLocation);

    // 分享目前位置按鈕（快速操作）
    const shareLocationBtn = document.getElementById('shareLocationBtn');
    if (shareLocationBtn) {
        shareLocationBtn.addEventListener('click', shareCurrentLocation);
    }

    // 當前位置顯示區域點擊事件
    const currentLocationDiv = document.getElementById('currentLocation');
    if (currentLocationDiv) {
        console.log('✅ 找到 currentLocation 元素，正在綁定點擊事件...');
        currentLocationDiv.addEventListener('click', handleCurrentLocationClick);
        // 添加CSS樣式使其看起來可點擊
        currentLocationDiv.style.cursor = 'pointer';
        currentLocationDiv.style.userSelect = 'none';
        console.log('✅ currentLocation 點擊事件已綁定，樣式已設定');
        
        // 測試事件綁定
        currentLocationDiv.addEventListener('click', function() {
            console.log('🔥 currentLocation 被點擊了！');
        });
    } else {
        console.error('❌ 找不到 currentLocation 元素');
    }
    
    // 提醒設定 - 使用浮動設定窗口的元素
    const enableNotificationsEl = document.getElementById('floatingEnableNotifications');
    if (enableNotificationsEl) {
        enableNotificationsEl.addEventListener('change', function(e) {
            const newState = e.target.checked;
            
            // 同步更新右上角通知按鈕狀態（icon-only）
            const notificationBtnEl = document.getElementById('notificationBtn');
            markerNotificationsEnabled = newState;
            
            if (newState) {
                if (notificationBtnEl) {
                    notificationBtnEl.classList.add('active');
                    notificationBtnEl.innerHTML = '<span>🔔</span>';
                }
                
                // 請求通知權限
                requestNotificationPermission();
                
                // 如果追蹤正在進行，重新啟動距離檢查
                if (isTracking && trackingTarget) {
                    startProximityCheck();
                }
                
                showNotification('🔔 標註點通知已開啟', 'info');
            } else {
                if (notificationBtnEl) {
                    notificationBtnEl.classList.remove('active');
                    notificationBtnEl.innerHTML = '<span>🔕</span>';
                }
                
                // 停止所有提醒定時器
                alertTimers.forEach((timer, markerId) => {
                    clearInterval(timer);
                });
                alertTimers.clear();
                markersInRange.clear();
                lastAlerts.clear();
                lastAlertTimes.clear();
                
                showNotification('🔕 標註點通知已關閉', 'info');
            }
        });
    }
    
    const alertDistanceEl = document.getElementById('floatingAlertDistance');
    if (alertDistanceEl) {
        alertDistanceEl.addEventListener('change', function(e) {
            alertDistance = parseInt(e.target.value);
            saveData();
        });
    }
    
    // 提醒間隔設定
    const alertIntervalEl = document.getElementById('floatingAlertInterval');
    if (alertIntervalEl) {
        alertIntervalEl.addEventListener('change', function(e) {
            alertInterval = parseInt(e.target.value);
            saveData();
            
            // 如果正在追蹤，重新啟動距離檢查定時器以使用新間隔
            if (trackingTarget && proximityCheckTimer) {
                startProximityCheck();
            }
        });
    }
    
    // 彈窗控制
    document.querySelectorAll('.close').forEach(closeBtn => {
        closeBtn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            
            // 如果是初始設定彈窗，關閉時也要標記為已看過
                if (modal.id === 'initialSetupModal') {
                    try { appStorageSet('hasSeenSetup', true); } catch (e) {}
                    requestLocationPermission();
                    requestNotificationPermission();
                }
            
            // 如果modal在全螢幕容器中，將其移回body
            const fullscreenContainer = document.querySelector('.map-container.fullscreen');
            if (fullscreenContainer && fullscreenContainer.contains(modal)) {
                document.body.appendChild(modal);
            }
            modal.style.display = 'none';
        });
    });
    
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                // 如果是初始設定彈窗，關閉時也要標記為已看過
                if (this.id === 'initialSetupModal') {
                    try { appStorageSet('hasSeenSetup', true); } catch (e) {}
                    requestLocationPermission();
                    requestNotificationPermission();
                }
                
                // 如果modal在全螢幕容器中，將其移回body
                const fullscreenContainer = document.querySelector('.map-container.fullscreen');
                if (fullscreenContainer && fullscreenContainer.contains(this)) {
                    document.body.appendChild(this);
                }
                this.style.display = 'none';
            }
        });
    });
    
    // 取消按鈕事件
    document.querySelectorAll('.cancel').forEach(cancelBtn => {
        cancelBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const modal = this.closest('.modal');
            if (modal) {
                // 如果modal在全螢幕容器中，將其移回body
                const fullscreenContainer = document.querySelector('.map-container.fullscreen');
                if (fullscreenContainer && fullscreenContainer.contains(modal)) {
                    document.body.appendChild(modal);
                }
                modal.style.display = 'none';
                
                // 如果是標記模態視窗且當前正在添加標記模式，才關閉標記模式
                if (modal.id === 'markerModal' && isAddingMarker) {
                    isAddingMarker = false;
                    const btn = document.getElementById('addMarkerBtn');
                    btn.classList.remove('active');
                    btn.innerHTML = '<span>📍</span>標註模式';
                    map.getContainer().style.cursor = '';
                }
            }
        });
    });
    
    // 標註表單
    document.getElementById('markerForm').addEventListener('submit', saveMarker);
    document.getElementById('deleteMarkerBtn').addEventListener('click', deleteCurrentMarker);
    
    // 圖片上傳相關事件
    document.getElementById('uploadImageBtn').addEventListener('click', function() {
        document.getElementById('markerImages').click();
    });
    
    document.getElementById('cameraBtn').addEventListener('click', function() {
        document.getElementById('cameraInput').click();
    });
    
    document.getElementById('markerImages').addEventListener('change', handleImageUpload);
    document.getElementById('cameraInput').addEventListener('change', handleImageUpload);
    
    // 初始設定相關事件
    document.getElementById('startUsingBtn').addEventListener('click', handleInitialSetup);
    document.getElementById('skipSetupBtn').addEventListener('click', skipInitialSetup);
    document.getElementById('createFirstGroupBtn').addEventListener('click', showCreateGroupModal);
    
    // 建立組別表單
document.getElementById('createGroupForm').addEventListener('submit', handleCreateGroup);


    
    // 組別詳情模態框按鈕事件監聽器
    document.getElementById('showAllGroupMarkersBtn').addEventListener('click', showAllMarkersInGroup);
    document.getElementById('hideAllGroupMarkersBtn').addEventListener('click', hideAllMarkersInGroup);
    document.getElementById('centerToGroupBtn').addEventListener('click', centerToGroupMarkers);
    
    // 全部詳情按鈕事件監聽器
    document.getElementById('showAllDetailsBtn').addEventListener('click', showAllDetailsModal);
    
    // 匯入選項模態框按鈕事件監聽器
    document.getElementById('confirmImportBtn').addEventListener('click', function() {
        const selectedRadio = document.querySelector('input[name="importMode"]:checked');
        if (!selectedRadio) {
            showNotification('請選擇匯入模式', 'error');
            return;
        }
        const selectedOption = selectedRadio.value;
        handleImportOption(selectedOption);
    });
    
    document.getElementById('cancelImportBtn').addEventListener('click', function() {
        closeImportOptionsModal();
    });
    
    document.getElementById('showDuplicatesBtn').addEventListener('click', function() {
        const duplicateDetails = document.getElementById('duplicateDetails');
        if (duplicateDetails.style.display === 'none') {
            duplicateDetails.style.display = 'block';
            this.textContent = '隱藏重複詳情';
        } else {
            duplicateDetails.style.display = 'none';
            this.textContent = '查看重複詳情';
        }
    });
    
    // 為匯入選項添加視覺反饋
    document.querySelectorAll('input[name="importMode"]').forEach(radio => {
        radio.addEventListener('change', function() {
            // 移除所有選項的選中樣式
            document.querySelectorAll('.import-option').forEach(option => {
                option.classList.remove('selected');
            });
            
            // 為當前選中的選項添加選中樣式
            if (this.checked) {
                this.closest('.import-option').classList.add('selected');
            }
        });
    });
    
    // 即時定位設定事件監聽器
    const enableHighAccuracyEl = document.getElementById('enableHighAccuracy');
    if (enableHighAccuracyEl) {
        enableHighAccuracyEl.addEventListener('change', function(e) {
            enableHighAccuracy = e.target.checked;
            saveData();
        });
    }
    
    const autoStartTrackingEl = document.getElementById('autoStartTracking');
    if (autoStartTrackingEl) {
        autoStartTrackingEl.addEventListener('change', function(e) {
            autoStartTracking = e.target.checked;
            saveData();
        });
    }
    
    const keepMapCenteredEl = document.getElementById('keepMapCentered');
    if (keepMapCenteredEl) {
        keepMapCenteredEl.addEventListener('change', function(e) {
            keepMapCentered = e.target.checked;
            saveData();
        });
    }
    

    
    const locationUpdateFrequencyEl = document.getElementById('locationUpdateFrequency');
    if (locationUpdateFrequencyEl) {
        locationUpdateFrequencyEl.addEventListener('change', function(e) {
            locationUpdateFrequency = parseInt(e.target.value); // 已經是毫秒
            
            // 如果正在追蹤，重新啟動定時器以應用新的更新頻率
            if (isTracking && locationUpdateTimer) {
                clearInterval(locationUpdateTimer);
                
                locationUpdateTimer = setInterval(() => {
                    // 強制重新獲取當前位置
                    if (navigator.geolocation && isTracking) {
                        navigator.geolocation.getCurrentPosition(
                            function(position) {
                                const now = Date.now();
                                
                                // 檢查是否真的是新的位置數據
                                if (!lastLocationUpdate || (now - lastLocationUpdate) >= (locationUpdateFrequency * 0.8)) {
                                    lastLocationUpdate = now;
                                    
                                    // 計算速度（如果有前一個位置）
                                    let speed = null;
                                    if (currentPosition && position.coords.speed !== null) {
                                        speed = position.coords.speed;
                                    } else if (currentPosition) {
                                        const timeDiff = (now - currentPosition.timestamp) / 1000; // 秒
                                        const distance = calculateDistance(
                                            currentPosition.lat, currentPosition.lng,
                                            position.coords.latitude, position.coords.longitude
                                        );
                                        if (timeDiff > 0) {
                                            speed = distance / timeDiff; // 公尺/秒
                                        }
                                    }
                                    
                                    // 保存當前位置作為下次計算的參考
                                    lastPosition = currentPosition ? {
                                        lat: currentPosition.lat,
                                        lng: currentPosition.lng
                                    } : null;
                                    

                                    
                                    currentPosition = {
                                        lat: position.coords.latitude,
                                        lng: position.coords.longitude,
                                        accuracy: position.coords.accuracy,
                                        timestamp: now,
                                        speed: speed
                                    };
                                    
                                    updateLocationDisplay();
                                    updateCurrentLocationMarker();
                                    
                                    // 更新路線記錄（如果正在記錄）
                                    updateRouteRecording(currentPosition);
                                    
                                    refreshAllMarkerPopups(); // 更新所有標記的提示窗距離顯示
                                    updateLocationStatus('追蹤中 (強制更新)');
                                }
                            },
                            function(error) {
                                console.warn('定時器位置更新失敗:', error);
                            },
                            {
                                enableHighAccuracy: enableHighAccuracy,
                                timeout: Math.min(locationTimeout, Math.max(locationUpdateFrequency - 100, 1000)),
                                maximumAge: 0 // 強制獲取最新位置
                            }
                        );
                    }
                }, locationUpdateFrequency);
                
                showNotification(`更新頻率已變更為 ${locationUpdateFrequency/1000} 秒`);
            }
            
            saveData();
        });
    }
    
    const locationTimeoutEl = document.getElementById('locationTimeout');
    if (locationTimeoutEl) {
        locationTimeoutEl.addEventListener('change', function(e) {
            locationTimeout = parseInt(e.target.value) * 1000; // 轉換為毫秒
            saveData();
        });
    }
    
    // 組別詳情模態框事件監聽器
    const groupDetailsModal = document.getElementById('groupDetailsModal');
    if (groupDetailsModal) {
        // 關閉按鈕事件
        const groupDetailsCloseBtn = groupDetailsModal.querySelector('.close');
        if (groupDetailsCloseBtn) {
            groupDetailsCloseBtn.addEventListener('click', closeGroupDetailsModal);
        }
        
        // 點擊模態框背景關閉
        groupDetailsModal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeGroupDetailsModal();
            }
        });
        
        // 組別詳情按鈕事件
        const showAllBtn = document.getElementById('showAllGroupMarkersBtn');
        const hideAllBtn = document.getElementById('hideAllGroupMarkersBtn');
        const centerBtn = document.getElementById('centerToGroupBtn');
        
        if (showAllBtn) {
            showAllBtn.addEventListener('click', showAllMarkersInGroup);
        }
        if (hideAllBtn) {
            hideAllBtn.addEventListener('click', hideAllMarkersInGroup);
        }
        if (centerBtn) {
            centerBtn.addEventListener('click', centerToGroupMarkers);
        }
    }
    
    // 全部詳情模態框事件監聽器
    const allDetailsModal = document.getElementById('allDetailsModal');
    if (allDetailsModal) {
        // 關閉按鈕事件
        const allDetailsCloseBtn = allDetailsModal.querySelector('.close');
        if (allDetailsCloseBtn) {
            allDetailsCloseBtn.addEventListener('click', closeAllDetailsModal);
        }
        
        // 點擊模態框背景關閉
        allDetailsModal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeAllDetailsModal();
            }
        });
    }
    
    // 音效設定事件監聽器
    const enableNotificationSoundEl = document.getElementById('floatingEnableNotificationSound');
    if (enableNotificationSoundEl) {
        enableNotificationSoundEl.addEventListener('change', function() {
            if (window.notificationSound) {
                window.notificationSound.setEnabled(this.checked);
            }
        });
    }
    
    const notificationVolumeEl = document.getElementById('floatingNotificationVolume');
    if (notificationVolumeEl) {
        notificationVolumeEl.addEventListener('input', function() {
            const volume = parseFloat(this.value);
            // 更新音量顯示
            const volumeValueEl = document.querySelector('.volume-value');
            if (volumeValueEl) {
                volumeValueEl.textContent = Math.round(volume * 1) + '%';
            }
            // 更新音效系統音量
            if (window.notificationSound) {
                window.notificationSound.setVolume(volume);
            }
        });
    }
    
}

// ===== 分享功能：連結生成 / 解析 =====
function base64EncodeUnicode(str) {
    try {
        return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function(match, p1) {
            return String.fromCharCode('0x' + p1);
        }));
    } catch (e) {
        try {
            const uint8array = new TextEncoder().encode(str);
            let binary = '';
            uint8array.forEach((b) => binary += String.fromCharCode(b));
            return btoa(binary);
        } catch (err) {
            console.error('base64EncodeUnicode failed:', err);
            return '';
        }
    }
}

function base64DecodeUnicode(str) {
    try {
        let s = (str || '');
        // 正規化：空白視為 '+'、處理 base64url 與補齊 '='，並移除非 base64 字元
        s = s.replace(/\s+/g, '+').replace(/-/g, '+').replace(/_/g, '/');
        s = s.replace(/[^A-Za-z0-9+/=]/g, '');
        if (s.length % 4 !== 0) s += '='.repeat(4 - (s.length % 4));
        return decodeURIComponent(atob(s).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
    } catch (e) {
        try {
            let s = (str || '');
            s = s.replace(/\s+/g, '+').replace(/-/g, '+').replace(/_/g, '/');
            s = s.replace(/[^A-Za-z0-9+/=]/g, '');
            if (s.length % 4 !== 0) s += '='.repeat(4 - (s.length % 4));
            const binary = atob(s);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            return new TextDecoder().decode(bytes);
        } catch (err) {
            console.error('base64DecodeUnicode failed:', err);
            return '';
        }
    }
}

// 進一步縮短連結：base64url 與 gzip（pako）
function bytesToBase64Url(bytes) {
    try {
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const b64 = btoa(binary);
        return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    } catch (e) {
        console.error('bytesToBase64Url failed:', e);
        return '';
    }
}

function base64UrlToBytes(str) {
    try {
        let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
        const pad = b64.length % 4;
        if (pad) b64 += '='.repeat(4 - pad);
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    } catch (e) {
        console.error('base64UrlToBytes failed:', e);
        return new Uint8Array();
    }
}

function buildShareLink(payload) {
    const encoded = base64EncodeUnicode(JSON.stringify(payload));
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}?shared=${encoded}`;
}

function buildCompressedShareLink(payload) {
    try {
        const json = JSON.stringify(payload);
        const deflated = (typeof pako !== 'undefined' && pako && typeof pako.deflate === 'function') ? pako.deflate(json) : null;
        if (!deflated) return buildShareLink(payload);
        const b64url = bytesToBase64Url(deflated);
        const baseUrl = window.location.origin + window.location.pathname;
        return `${baseUrl}?shared_gz=${b64url}`;
    } catch (e) {
        console.warn('buildCompressedShareLink 失敗，回退普通連結：', e);
        return buildShareLink(payload);
    }
}

// 壓縮路線座標：均勻取樣至最多 maxPoints，並只保留 lat/lng
function simplifyRouteCoordinates(coords, maxPoints = 200) {
    try {
        if (!Array.isArray(coords) || coords.length === 0) return [];
        const total = coords.length;
        if (total <= maxPoints) {
            return coords.map(c => ({ lat: c.lat, lng: c.lng }));
        }
        const step = Math.max(1, Math.floor(total / maxPoints));
        const simplified = [];
        for (let i = 0; i < total; i += step) {
            const c = coords[i];
            simplified.push({ lat: c.lat, lng: c.lng });
        }
        // 確保最後一點存在
        const last = coords[coords.length - 1];
        if (simplified.length === 0 || simplified[simplified.length - 1].lat !== last.lat || simplified[simplified.length - 1].lng !== last.lng) {
            simplified.push({ lat: last.lat, lng: last.lng });
        }
        return simplified;
    } catch (e) {
        console.warn('simplifyRouteCoordinates 失敗：', e);
        return [];
    }
}

// 將現有路線記錄轉為分享摘要（包含距離、時長、起迄名稱、顏色與簡化座標）
function buildRouteSummaryForShare(route) {
    if (!route) return null;
    return {
        name: route.name || '',
        distance: route.distance || 0,
        duration: route.duration || 0,
        color: route.color || undefined,
        createdAt: route.createdAt || undefined,
        startMarkerName: route.startMarkerName || undefined,
        targetMarkerName: route.targetMarkerName || undefined,
        points: Array.isArray(route.coordinates) ? simplifyRouteCoordinates(route.coordinates) : []
    };
}

// 變體：可指定最大座標點數，避免網址過長
function buildRouteSummaryForShareWithLimit(route, maxPoints) {
    if (!route) return null;
    return {
        name: route.name || '',
        distance: route.distance || 0,
        duration: route.duration || 0,
        color: route.color || undefined,
        createdAt: route.createdAt || undefined,
        startMarkerName: route.startMarkerName || undefined,
        targetMarkerName: route.targetMarkerName || undefined,
        points: Array.isArray(route.coordinates) ? simplifyRouteCoordinates(route.coordinates, maxPoints) : []
    };
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showNotification('🔗 連結已複製到剪貼簿', 'success');
    } catch (e) {
        // 回退方案
        const temp = document.createElement('textarea');
        temp.value = text;
        document.body.appendChild(temp);
        temp.select();
        try { document.execCommand('copy'); } catch {}
        document.body.removeChild(temp);
        showNotification('🔗 已複製連結（回退方案）', 'success');
    }
}

async function tryWebShare(title, text, url) {
    if (navigator.share) {
        try {
            await navigator.share({ title, text, url });
            return true;
        } catch (e) {
            console.warn('Web Share 失敗，改用複製剪貼簿:', e);
        }
    }
    return false;
}

// 建立含圖片與路線的單一標註分享資料（與匯入格式相容）
async function buildFullMarkerShareData(marker) {
    try {
        // 壓縮圖片資料到 ~50KB 以降低檔案大小
        let compressedImageData = null;
        if (marker.imageData) {
            if (Array.isArray(marker.imageData)) {
                compressedImageData = await Promise.all(
                    marker.imageData.map(async (imageData) => {
                        if (typeof imageData === 'string' && imageData.startsWith('data:image/')) {
                            try { return await compressImage(imageData, 50); } catch (e) { return imageData; }
                        }
                        return imageData;
                    })
                );
            } else if (typeof marker.imageData === 'string' && marker.imageData.startsWith('data:image/')) {
                try { compressedImageData = await compressImage(marker.imageData, 50); } catch (e) { compressedImageData = marker.imageData; }
            } else {
                compressedImageData = marker.imageData;
            }
        }

        const group = groups ? groups.find(g => g.id === marker.groupId) : null;
        const subgroup = group && group.subgroups ? group.subgroups.find(sg => sg.id === marker.subgroupId) : null;

        const exportMarker = {
            id: marker.id,
            name: marker.name,
            description: marker.description,
            lat: marker.lat,
            lng: marker.lng,
            groupId: marker.groupId,
            subgroupId: marker.subgroupId || null,
            color: marker.color || 'red',
            icon: marker.icon || '📍',
            imageData: compressedImageData || null,
            routeRecords: marker.routeRecords || []
        };

        const exportGroup = group ? {
            id: group.id,
            name: group.name,
            subgroups: subgroup ? [{ id: subgroup.id, name: subgroup.name, groupId: group.id }] : []
        } : { id: 'group_' + Date.now().toString(36), name: '共享群組', subgroups: [] };

        return {
            version: '1.0',
            exportDate: new Date().toISOString(),
            markers: [exportMarker],
            groups: [exportGroup]
        };
    } catch (e) {
        console.error('buildFullMarkerShareData 失敗：', e);
        return {
            version: '1.0',
            exportDate: new Date().toISOString(),
            markers: [],
            groups: []
        };
    }
}

async function shareMarkerById(markerId) {
    const marker = markers.find(m => m.id === markerId);
    if (!marker) {
        showNotification('❌ 找不到要分享的標註點', 'error');
        return;
    }
    const MAX_URL_LENGTH_FOR_SHARE = 8000; // 安全上限，避免過長網址在不同瀏覽器失效
    // 取得群組/子群組名稱（以名稱為準，避免跨裝置 ID 不一致）
    const group = groups ? groups.find(g => g.id === marker.groupId) : null;
    const subgroup = group && group.subgroups ? group.subgroups.find(sg => sg.id === marker.subgroupId) : null;
    // 擷取目前地圖縮放層級
    const currentZoom = (typeof map !== 'undefined' && map && typeof map.getZoom === 'function') ? map.getZoom() : null;
    // 擷取目前此標記的路線選擇（若存在則一併分享意圖）
    let selectedRouteIndex = null;
    let selectedRouteSummary = null;
    try {
        if (typeof window.getSelectedRouteIndex === 'function') {
            const idx = window.getSelectedRouteIndex(markerId);
            if (typeof idx === 'number' && !Number.isNaN(idx)) selectedRouteIndex = idx;
        } else if (window.routeSelectIndex && typeof window.routeSelectIndex[marker.id] === 'number') {
            selectedRouteIndex = window.routeSelectIndex[marker.id];
        }
        if (selectedRouteIndex !== null && marker.routeRecords && marker.routeRecords[selectedRouteIndex]) {
            selectedRouteSummary = buildRouteSummaryForShare(marker.routeRecords[selectedRouteIndex]);
        }
    } catch (e) {
        // 忽略路線索引取得失敗
    }
    // 先嘗試：以網址分享「含圖片與完整路線摘要」
    // 構建含圖片的 payload（壓縮每張至 ~15KB，避免網址過長）
    let images = null;
    try {
        if (marker.imageData) {
            if (Array.isArray(marker.imageData)) {
                images = await Promise.all(
                    marker.imageData.map(async (img) => {
                        if (typeof img === 'string' && img.startsWith('data:image/')) {
                            try { return await compressImage(img, 15); } catch (e) { return img; }
                        }
                        return img;
                    })
                );
            } else if (typeof marker.imageData === 'string' && marker.imageData.startsWith('data:image/')) {
                try { images = [await compressImage(marker.imageData, 15)]; } catch (e) { images = [marker.imageData]; }
            } else {
                images = Array.isArray(marker.imageData) ? marker.imageData : [marker.imageData];
            }
        }
    } catch (e) { images = null; }

    // 建立所有路線的分享摘要（座標簡化，預設最多 300 點）
    let routeSummaries = [];
    try {
        if (Array.isArray(marker.routeRecords)) {
            routeSummaries = marker.routeRecords
                .map(r => buildRouteSummaryForShare(r))
                .filter(Boolean);
        }
    } catch (e) { routeSummaries = []; }

    const fullPayload = {
        type: 'marker',
        name: marker.name || '',
        description: marker.description || '',
        lat: marker.lat,
        lng: marker.lng,
        color: marker.color || 'red',
        icon: marker.icon || '📍',
        zoom: currentZoom,
        filter: subgroup ? { type: 'subgroup', groupName: group?.name || '', subgroupName: subgroup?.name || '' } : (group ? { type: 'group', groupName: group.name || '' } : null),
        trackingEnabled: !!isTracking,
        route: (selectedRouteIndex !== null ? { index: selectedRouteIndex, action: 'use' } : null),
        images: images || [],
        routes: routeSummaries
    };

    let shareUrl = buildShareLink(fullPayload);
    if (shareUrl.length <= MAX_URL_LENGTH_FOR_SHARE) {
        const ok = await tryWebShare('分享標註（含圖片與路線）', `${marker.icon} ${marker.name}`, shareUrl);
        if (!ok) await copyToClipboard(shareUrl);
        showNotification('🔗 已生成共享連結（含圖片與路線）', 'success');
        return;
    }

    // 漸進式精簡：僅保留首張圖片（壓縮至 ~8KB），並降低路線點數
    try {
        const limitedImages = Array.isArray(images) && images.length > 0 ? [images[0]] : [];
        const slimImages = limitedImages.length ? [await compressImage(limitedImages[0], 8)] : [];
        const slimRoutes = (Array.isArray(routeSummaries) ? routeSummaries.map(r => ({
            name: r.name,
            distance: r.distance,
            duration: r.duration,
            color: r.color,
            createdAt: r.createdAt,
            startMarkerName: r.startMarkerName,
            targetMarkerName: r.targetMarkerName,
            points: simplifyRouteCoordinates(r.points, 150)
        })) : []);
        const slimPayload = { ...fullPayload, images: slimImages, routes: slimRoutes };
        shareUrl = buildShareLink(slimPayload);
        if (shareUrl.length <= MAX_URL_LENGTH_FOR_SHARE) {
            const ok = await tryWebShare('分享標註（含首圖與路線）', `${marker.icon} ${marker.name}`, shareUrl);
            if (!ok) await copyToClipboard(shareUrl);
            showNotification('🔗 已生成共享連結（含首圖與路線）', 'success');
            return;
        }
    } catch (e) { /* 忽略精簡失敗，進入下一回退 */ }

    // 回退一：移除圖片，僅保留路線（再降低點數至 80）
    try {
        const ultraRoutes = (Array.isArray(routeSummaries) ? routeSummaries.map(r => ({
            name: r.name,
            distance: r.distance,
            duration: r.duration,
            color: r.color,
            createdAt: r.createdAt,
            startMarkerName: r.startMarkerName,
            targetMarkerName: r.targetMarkerName,
            points: simplifyRouteCoordinates(r.points, 80)
        })) : []);
        const routeOnlyPayload = { ...fullPayload, images: [], routes: ultraRoutes };
        shareUrl = buildShareLink(routeOnlyPayload);
        if (shareUrl.length <= MAX_URL_LENGTH_FOR_SHARE) {
            const ok = await tryWebShare('分享標註（含路線，不含圖片）', `${marker.icon} ${marker.name}`, shareUrl);
            if (!ok) await copyToClipboard(shareUrl);
            showNotification('🔗 已生成共享連結（含路線，圖片過長已省略）', 'info');
            return;
        }
    } catch (e) { /* 忽略 */ }

    // 最終回退：提供完整資料的檔案分享 / 下載，並附上簡短連結
    const minimalPayload = {
        type: 'marker',
        name: marker.name || '',
        description: marker.description || '',
        lat: marker.lat,
        lng: marker.lng,
        color: marker.color || 'red',
        icon: marker.icon || '📍',
        zoom: currentZoom,
        filter: subgroup ? { type: 'subgroup', groupName: group?.name || '', subgroupName: subgroup?.name || '' } : (group ? { type: 'group', groupName: group.name || '' } : null),
        trackingEnabled: !!isTracking,
        route: (selectedRouteIndex !== null ? { index: selectedRouteIndex, action: 'use' } : null),
        routes: (selectedRouteSummary ? [selectedRouteSummary] : [])
    };
    const minimalUrl = buildShareLink(minimalPayload);

    try {
        const fullData = await buildFullMarkerShareData(marker);
        let dataStr;
        try {
            dataStr = JSON.stringify(fullData, null, 2);
        } catch (jsonErr) {
            console.warn('分享資料序列化失敗，改用安全序列化：', jsonErr);
            const seen = new WeakSet();
            const replacer = (key, value) => {
                if (typeof value === 'object' && value !== null) {
                    if (seen.has(value)) return undefined;
                    if (value._map || value._leaflet_id || value._layers || value._path) return undefined;
                    if (typeof value.addTo === 'function' || typeof value.on === 'function') return undefined;
                    seen.add(value);
                }
                return value;
            };
            dataStr = JSON.stringify(fullData, replacer, 2);
        }

        const blob = new Blob([dataStr], { type: 'application/json' });
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
        const safeName = (marker.name || '標註').replace(/[\\/:*?"<>|]/g, '_');
        const fileName = `分享標註_${safeName}_${year}-${month}-${day}_${timeStr}.json`;
        const file = new File([blob], fileName, { type: 'application/json' });

        const canShareFiles = typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] });
        if (canShareFiles && navigator.share) {
            try {
                await navigator.share({ title: '分享標註（完整資料檔案）', text: `${marker.icon} ${marker.name}`, files: [file] });
                showNotification('📤 已透過系統分享完整檔案（含圖片與路線）', 'success');
            } catch (e) {
                console.warn('檔案分享失敗，改用下載：', e);
                const urlObj = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = urlObj;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(urlObj);
                showNotification('📥 已下載分享檔案（含圖片與路線）', 'info');
            }
        } else {
            const urlObj = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = urlObj;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(urlObj);
            showNotification('📥 已下載分享檔案（含圖片與路線）', 'info');
        }
    } catch (e) {
        console.warn('建立完整分享資料失敗：', e);
    }

    // 附上簡短連結作為備援（不含圖片，避免過長）
    const ok = await tryWebShare('分享標註（備援連結）', `${marker.icon} ${marker.name}`, minimalUrl);
    if (!ok) await copyToClipboard(minimalUrl);
}

// 新增：僅網址分享（含圖片與路線），不觸發檔案分享回退
async function shareMarkerByIdUrl(markerId) {
    const marker = markers.find(m => m.id === markerId);
    if (!marker) { showNotification('❌ 找不到要分享的標註點', 'error'); return; }
    const MAX_URL_LENGTH_FOR_SHARE = 8000;
    const group = groups ? groups.find(g => g.id === marker.groupId) : null;
    const subgroup = group && group.subgroups ? group.subgroups.find(sg => sg.id === marker.subgroupId) : null;
    const currentZoom = (typeof map !== 'undefined' && map && typeof map.getZoom === 'function') ? map.getZoom() : null;
    let selectedRouteIndex = null;
    let selectedRouteSummary = null;
    try {
        if (typeof window.getSelectedRouteIndex === 'function') {
            const idx = window.getSelectedRouteIndex(markerId);
            if (typeof idx === 'number' && !Number.isNaN(idx)) selectedRouteIndex = idx;
        } else if (window.routeSelectIndex && typeof window.routeSelectIndex[marker.id] === 'number') {
            selectedRouteIndex = window.routeSelectIndex[marker.id];
        }
        if (selectedRouteIndex !== null && marker.routeRecords && marker.routeRecords[selectedRouteIndex]) {
            selectedRouteSummary = buildRouteSummaryForShareWithLimit(marker.routeRecords[selectedRouteIndex], 120);
        }
    } catch {}
    let images = null;
    try {
        if (marker.imageData) {
            if (Array.isArray(marker.imageData)) {
                images = await Promise.all(
                    marker.imageData.map(async (img) => {
                        if (typeof img === 'string' && img.startsWith('data:image/')) {
                            try { return await compressImageForShare(img, 5, 480); } catch (e) { return img; }
                        }
                        return img;
                    })
                );
            } else if (typeof marker.imageData === 'string' && marker.imageData.startsWith('data:image/')) {
                try { images = [await compressImageForShare(marker.imageData, 5, 480)]; } catch (e) { images = [marker.imageData]; }
            } else {
                images = Array.isArray(marker.imageData) ? marker.imageData : [marker.imageData];
            }
        }
    } catch (e) { images = null; }
    let routeSummaries = [];
    try {
        if (Array.isArray(marker.routeRecords)) {
            routeSummaries = marker.routeRecords.map(r => buildRouteSummaryForShareWithLimit(r, 120)).filter(Boolean);
        }
    } catch (e) { routeSummaries = []; }
    const basePayload = {
        type: 'marker',
        name: marker.name || '',
        description: truncateString(marker.description || '', 250),
        lat: marker.lat,
        lng: marker.lng,
        color: marker.color || 'red',
        icon: marker.icon || '📍',
        zoom: currentZoom,
        filter: subgroup ? { type: 'subgroup', groupName: group?.name || '', subgroupName: subgroup?.name || '' } : (group ? { type: 'group', groupName: group.name || '' } : null),
        trackingEnabled: !!isTracking,
        route: (selectedRouteIndex !== null ? { index: selectedRouteIndex, action: 'use' } : null)
    };
    // 嘗試：完整圖片與路線
    let payload = { ...basePayload, images: images || [], routes: routeSummaries };
    let url = buildCompressedShareLink(payload);
    if (url.length <= MAX_URL_LENGTH_FOR_SHARE) {
        const ok = await tryWebShare('分享標註（含圖片與路線）', `${marker.icon} ${marker.name}`, url);
        if (!ok) await copyToClipboard(url);
        showNotification('🔗 已生成共享連結（含圖片與路線）', 'success');
        return;
    }
    // 精簡：首圖 + 路線降點
    try {
        const limitedImages = Array.isArray(images) && images.length > 0 ? [images[0]] : [];
        const slimImages = limitedImages.length ? [await compressImageForShare(limitedImages[0], 4, 420)] : [];
        const slimRoutes = (Array.isArray(routeSummaries) ? routeSummaries.map(r => ({
            name: r.name,
            distance: r.distance,
            duration: r.duration,
            color: r.color,
            createdAt: r.createdAt,
            startMarkerName: r.startMarkerName,
            targetMarkerName: r.targetMarkerName,
            points: simplifyRouteCoordinates(r.points, 120)
        })) : []);
        payload = { ...basePayload, images: slimImages, routes: slimRoutes };
        url = buildCompressedShareLink(payload);
        if (url.length <= MAX_URL_LENGTH_FOR_SHARE) {
            const ok = await tryWebShare('分享標註（含首圖與路線）', `${marker.icon} ${marker.name}`, url);
            if (!ok) await copyToClipboard(url);
            showNotification('🔗 已生成共享連結（含首圖與路線）', 'success');
            return;
        }
    } catch {}
    // 僅路線（降至 80 點）
    try {
        const ultraRoutes = (Array.isArray(routeSummaries) ? routeSummaries.map(r => ({
            name: r.name,
            distance: r.distance,
            duration: r.duration,
            color: r.color,
            createdAt: r.createdAt,
            startMarkerName: r.startMarkerName,
            targetMarkerName: r.targetMarkerName,
            points: simplifyRouteCoordinates(r.points, 80)
        })) : []);
        payload = { ...basePayload, images: [], routes: ultraRoutes };
        url = buildCompressedShareLink(payload);
        if (url.length <= MAX_URL_LENGTH_FOR_SHARE) {
            const ok = await tryWebShare('分享標註（含路線，不含圖片）', `${marker.icon} ${marker.name}`, url);
            if (!ok) await copyToClipboard(url);
            showNotification('🔗 已生成共享連結（含路線，圖片過長已省略）', 'info');
            return;
        }
    } catch {}
    // 最小：僅基本資訊與目前選擇路線摘要（若有）
    const minimalPayload = { ...basePayload, routes: (selectedRouteSummary ? [selectedRouteSummary] : []) };
    const minimalUrl = buildCompressedShareLink(minimalPayload);
    const ok2 = await tryWebShare('分享標註（精簡連結）', `${marker.icon} ${marker.name}`, minimalUrl);
    if (!ok2) await copyToClipboard(minimalUrl);
    showNotification('ℹ️ 連結過長，已以精簡模式分享（可能不含圖片）', 'warning');
}

// 新增：僅完整檔案分享（含所有圖片與路線），不產生網址
async function shareMarkerByIdFile(markerId) {
    const marker = markers.find(m => m.id === markerId);
    if (!marker) { showNotification('❌ 找不到要分享的標註點', 'error'); return; }
    try {
        const fullData = await buildFullMarkerShareData(marker);
        const dataStr = JSON.stringify(fullData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
        const safeName = (marker.name || '標註').replace(/[\\/:*?"<>|]/g, '_');
        const fileName = `分享標註_${safeName}_${year}-${month}-${day}_${timeStr}.json`;
        const file = new File([blob], fileName, { type: 'application/json' });
        const canShareFiles = typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] });
        if (canShareFiles && navigator.share) {
            try {
                await navigator.share({ title: '分享標註（完整資料檔案）', text: `${marker.icon} ${marker.name}`, files: [file] });
                showNotification('📤 已透過系統分享完整檔案（含圖片與路線）', 'success');
                return;
            } catch (e) {
                console.warn('系統檔案分享失敗，改用下載：', e);
            }
        }
        // 下載備援
        const urlObj = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = urlObj;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(urlObj);
        showNotification('📥 已下載分享檔案（含圖片與路線）', 'info');
    } catch (e) {
        console.error('建立完整分享資料失敗：', e);
        showNotification('❌ 建立分享檔案失敗', 'error');
    }
}

// 新增：僅定位點的網址分享（只含經緯度與名稱）
async function shareMarkerByIdPointUrl(markerId) {
    const marker = markers.find(m => m.id === markerId);
    if (!marker) { showNotification('❌ 找不到要分享的標註點', 'error'); return; }
    const currentZoom = (typeof map !== 'undefined' && map && typeof map.getZoom === 'function') ? map.getZoom() : null;
    // 僅包含必要欄位：type、name、lat、lng（可選：zoom）
    const payload = {
        type: 'marker',
        name: marker.name || '',
        lat: marker.lat,
        lng: marker.lng,
        zoom: currentZoom
    };
    const url = buildShareLink(payload); // 使用 shared 參數，確保舊頁面相容
    const ok = await tryWebShare('分享定位點（僅座標/名稱）', `${marker.name}`, url);
    if (!ok) await copyToClipboard(url);
    showNotification('🔗 已生成共享連結（僅座標/名稱）', 'success');
}

function shareCurrentLocation() {
    let latlng = null;
    if (currentPosition && currentPosition.lat && currentPosition.lng) {
        latlng = { lat: currentPosition.lat, lng: currentPosition.lng };
    } else if (map) {
        const c = map.getCenter();
        latlng = { lat: c.lat, lng: c.lng };
    }
    if (!latlng) {
        showNotification('📍 尚未取得位置，請稍後再試', 'warning');
        return;
    }
    const payload = {
        type: 'location',
        lat: latlng.lat,
        lng: latlng.lng,
        ts: Date.now(),
        // 額外資訊：縮放層級與目前追蹤狀態
        zoom: (typeof map !== 'undefined' && map && typeof map.getZoom === 'function') ? map.getZoom() : null,
        trackingEnabled: !!isTracking
    };
    const url = buildShareLink(payload);
    tryWebShare('分享我的位置', `座標：${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`, url)
        .then((shared) => { if (!shared) copyToClipboard(url); });
}

function addTemporarySharedLocationMarker(lat, lng) {
    const tempIcon = createCustomMarkerIcon('blue', '🔗');
    const temp = L.marker([lat, lng], { icon: tempIcon }).addTo(map);
    temp.bindPopup(`<div style="text-align:center;">
        <div style="font-size:16px; margin-bottom:6px;">🔗 共享位置</div>
        <div style="font-size:12px; color:#555;">${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
    </div>`).openPopup();
    map.setView([lat, lng], Math.max(map.getZoom(), 15), { animate: true });
    setTimeout(() => { try { map.removeLayer(temp); } catch {} }, 30000);
}

function prefillMarkerFormFromPayload(payload) {
    // 打開新增標註點視窗並預填
    showMarkerModal(payload.lat, payload.lng);
    const nameEl = document.getElementById('markerName');
    const descEl = document.getElementById('markerDescription');
    if (nameEl) nameEl.value = payload.name || '';
    if (descEl) descEl.value = payload.description || '';
    const colorRadio = document.querySelector(`input[name="markerColor"][value="${payload.color || 'red'}"]`);
    if (colorRadio) colorRadio.checked = true;
    const iconRadio = document.querySelector(`input[name="markerIcon"][value="${payload.icon || '📍'}"]`);
    if (iconRadio) iconRadio.checked = true;
    // 若包含圖片，一併預覽與寫入表單
    try {
        if (Array.isArray(payload.images) && payload.images.length > 0) {
            displayMultipleImagePreviews(payload.images);
        }
    } catch (e) {
        console.warn('預填共享圖片失敗：', e);
    }
    // 若有指定縮放層級，則一併套用視角
    if (payload.zoom && typeof map !== 'undefined' && map && typeof map.setView === 'function') {
        try { map.setView([payload.lat, payload.lng], payload.zoom, { animate: true }); } catch (e) {}
    }
    // 若有指定子群組/群組顯示邏輯（以名稱），嘗試切換顯示
    try {
        if (payload.filter && payload.filter.type === 'subgroup' && payload.filter.groupName && payload.filter.subgroupName) {
            const grp = (Array.isArray(groups) ? groups.find(g => g.name === payload.filter.groupName) : null);
            const sub = (grp && Array.isArray(grp.subgroups)) ? grp.subgroups.find(sg => sg.name === payload.filter.subgroupName) : null;
            if (grp && sub && typeof selectGroup === 'function') selectGroup(grp.id, sub.id);
        } else if (payload.filter && payload.filter.type === 'group' && payload.filter.groupName) {
            const grp = (Array.isArray(groups) ? groups.find(g => g.name === payload.filter.groupName) : null);
            if (grp && typeof selectGroup === 'function') selectGroup(grp.id);
        }
    } catch (e) {
        // 忽略顯示邏輯套用失敗
    }
    showNotification('📍 已載入共享標註資料，請確認後保存', 'info');

    // 額外：在地圖上顯示臨時標記，讓使用者「能看見定位點」
    try {
        const tempIcon = createCustomMarkerIcon(payload.color || 'red', payload.icon || '📍');
        const temp = L.marker([payload.lat, payload.lng], { icon: tempIcon }).addTo(map);
        const title = payload.name ? `${payload.icon || '📍'} ${payload.name}` : '共享標註';
        temp.bindPopup(`<div style="text-align:center;">
            <div style="font-size:16px; margin-bottom:6px;">${title}</div>
            ${payload.description ? `<div style=\"font-size:12px; color:#555;\">${payload.description}</div>` : ''}
        </div>`).openPopup();
        // 15 秒後自動移除臨時標記
        setTimeout(() => { try { map.removeLayer(temp); } catch {} }, 15000);
    } catch (e) {}
}

// 引導：顯示「一鍵保存共享標註與路線」提示
function showSaveSharedMarkerPrompt(payload) {
    try {
        // 若已有提示，先移除
        const existing = document.getElementById('saveSharedMarkerPrompt');
        if (existing) existing.remove();
        const prompt = document.createElement('div');
        prompt.id = 'saveSharedMarkerPrompt';
        prompt.style.cssText = `
            position: fixed;
            left: 50%;
            bottom: 24px;
            transform: translateX(-50%);
            background: rgba(32, 32, 32, 0.92);
            color: #fff;
            padding: 10px 14px;
            border-radius: 10px;
            font-size: 14px;
            z-index: 20000;
            box-shadow: 0 6px 18px rgba(0,0,0,0.2);
            display: flex;
            gap: 10px;
            align-items: center;
        `;
        const label = document.createElement('span');
        label.textContent = '已載入共享標註與路線';
        const saveBtn = document.createElement('button');
        saveBtn.textContent = '一鍵保存';
        saveBtn.style.cssText = 'padding: 6px 10px; font-size: 13px; background:#4CAF50; color:#fff; border:none; border-radius:6px;';
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '取消';
        cancelBtn.style.cssText = 'padding: 6px 10px; font-size: 13px; background:#9E9E9E; color:#fff; border:none; border-radius:6px;';
        saveBtn.addEventListener('click', () => {
            try { saveSharedMarkerAndRoutes(payload); } catch (e) { console.error(e); }
            try { prompt.remove(); } catch (e) {}
        });
        cancelBtn.addEventListener('click', () => {
            try { prompt.remove(); } catch (e) {}
        });
        prompt.appendChild(label);
        prompt.appendChild(saveBtn);
        prompt.appendChild(cancelBtn);
        document.body.appendChild(prompt);
    } catch (e) {
        console.warn('顯示保存提示失敗：', e);
    }
}

// 程式化：將共享標註與其路線保存為正式資料
function saveSharedMarkerAndRoutes(payload) {
    try {
        // 1) 解析群組/子群組（以名稱）
        let group = null;
        let subgroup = null;
        if (payload.filter && payload.filter.type === 'subgroup') {
            group = Array.isArray(groups) ? groups.find(g => g.name === payload.filter.groupName) : null;
            if (!group) {
                group = new Group('group_' + Date.now().toString(36), payload.filter.groupName || '共享群組');
                groups.push(group);
            }
            subgroup = group.subgroups.find(sg => sg.name === payload.filter.subgroupName) || null;
            if (!subgroup) {
                subgroup = new Subgroup('subgroup_' + Date.now().toString(36), payload.filter.subgroupName || '共享子群組', group.id);
                group.addSubgroup(subgroup);
            }
        } else if (payload.filter && payload.filter.type === 'group') {
            group = Array.isArray(groups) ? groups.find(g => g.name === payload.filter.groupName) : null;
            if (!group) {
                group = new Group('group_' + Date.now().toString(36), payload.filter.groupName || '共享群組');
                groups.push(group);
            }
        } else {
            // 若無指定則使用現有選擇或默認群組
            if (currentGroup) {
                group = currentGroup;
            } else {
                group = groups.find(g => g.name === '共享群組') || null;
                if (!group) {
                    group = new Group('group_' + Date.now().toString(36), '共享群組');
                    groups.push(group);
                }
            }
        }

        // 2) 建立標註點
        const marker = new Marker(
            Date.now().toString(),
            payload.name || '共享標註',
            payload.description || '',
            payload.lat,
            payload.lng,
            group.id,
            subgroup ? subgroup.id : null,
            payload.color || 'red',
            payload.icon || '📍',
            (Array.isArray(payload.images) ? payload.images : (payload.images || null))
        );
        markers.push(marker);
        group.addMarker(marker);
        if (subgroup) subgroup.addMarker(marker);
        addMarkerToMap(marker);

        // 3) 匯入路線（僅支援 payload.routes 的 points + metadata）
        if (Array.isArray(payload.routes)) {
            payload.routes.forEach(r => {
                const coordinates = Array.isArray(r.points) ? r.points.map(p => ({ lat: p.lat, lng: p.lng, timestamp: Date.now() })) : [];
                const added = marker.addRoute({
                    name: r.name || '共享路線',
                    coordinates,
                    distance: r.distance || 0,
                    duration: r.duration || 0
                });
                if (r.color) added.color = r.color;
                if (r.targetMarkerName) added.targetMarkerName = r.targetMarkerName;
            });
        }

        // 4) 保存並更新 UI
        saveMarkersToStorage();
        updateMarkersList();
        updateGroupsList();
        try { updateMarkerPopup(marker); } catch (e) {}
        try { marker.leafletMarker && marker.leafletMarker.openPopup(); } catch (e) {}
        const imgCount = Array.isArray(payload.images) ? payload.images.length : (payload.images ? 1 : 0);
        showNotification(`✅ 已保存共享標註、${imgCount} 張圖片與路線（${Array.isArray(payload.routes) ? payload.routes.length : 0} 條）`, 'success');
        // 視角與縮放
        if (payload.zoom && typeof map !== 'undefined' && map && typeof map.setView === 'function') {
            try { map.setView([payload.lat, payload.lng], payload.zoom, { animate: true }); } catch (e) {}
        }
    } catch (error) {
        console.error('保存共享標註與路線失敗：', error);
        showNotification('❌ 保存共享標註與路線失敗', 'error');
    }
}

function handleSharedLinkOnInit() {
    try {
        const params = new URLSearchParams(window.location.search);
        if (params.has('shared_gz') || params.has('shared')) {
            let payload = null;
            try {
                if (params.has('shared_gz')) {
                    const rawGz = params.get('shared_gz');
                    const bytes = base64UrlToBytes(rawGz);
                    const jsonStrGz = (typeof pako !== 'undefined' && pako && typeof pako.inflate === 'function') ? pako.inflate(bytes, { to: 'string' }) : '';
                    payload = JSON.parse(jsonStrGz);
                } else {
                    const raw = params.get('shared');
                    const jsonStr = base64DecodeUnicode(raw);
                    payload = JSON.parse(jsonStr);
                }
            } catch (e) {
                console.error('解析共享連結內容失敗：', e);
                payload = null;
            }

            // 內部：判斷是否為最小標註payload（僅座標與名稱）
            const isMinimalMarkerPayload = (p) => {
                if (!p || p.type !== 'marker') return false;
                if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return false;
                const hasRoutes = Array.isArray(p.routes) && p.routes.length > 0;
                const hasImages = Array.isArray(p.images) ? p.images.length > 0 : !!p.images;
                const hasExtra = ('description' in p) || ('color' in p) || ('icon' in p) || ('filter' in p) || ('groupId' in p) || ('subgroupId' in p);
                return !hasRoutes && !hasImages && !hasExtra;
            };

            if (payload && payload.type === 'marker') {
                if (isMinimalMarkerPayload(payload)) {
                    try { saveSharedMarkerAndRoutes(payload); } catch (e) { console.error(e); }
                    // 套用縮放層級（如果有）
                    try { if (payload.zoom && typeof map !== 'undefined' && map && typeof map.setView === 'function') { map.setView([payload.lat, payload.lng], payload.zoom, { animate: true }); } } catch (e) {}
                    showNotification('✅ 已自動保存共享標註', 'success');
                    return;
                }
                prefillMarkerFormFromPayload(payload);
                // 若有路線資料，顯示一鍵保存提示以正式保存標註與路線
                try {
                    if (Array.isArray(payload.routes) && payload.routes.length > 0) {
                        showSaveSharedMarkerPrompt(payload);
                    }
                } catch (e) {}
                // 若要求開啟追蹤，嘗試啟用追蹤（無目標亦可啟動定位）
                try { if (payload.trackingEnabled && typeof startTracking === 'function') startTracking(); } catch (e) {}
                // 若包含路線提示，且本地已存在相同名稱/群組的標記，嘗試套用
                try {
                    if (payload.route && typeof payload.route.index === 'number') {
                        let candidate = null;
                        // 依群組名稱 + 標記名稱找到可能的目標標記
                        let groupId = null;
                        if (payload.filter && payload.filter.groupName && Array.isArray(groups)) {
                            const grp = groups.find(g => g.name === payload.filter.groupName);
                            if (grp) groupId = grp.id;
                        }
                        const sameName = Array.isArray(markers) ? markers.filter(m => m.name === payload.name) : [];
                        if (sameName.length === 1) {
                            candidate = sameName[0];
                        } else if (sameName.length > 1) {
                            const narrowed = groupId ? sameName.filter(m => m.groupId === groupId) : sameName;
                            if (narrowed.length === 1) candidate = narrowed[0];
                        }
                        if (candidate && typeof displayRoute === 'function') {
                            const action = payload.route.action || 'use';
                            if (action === 'use' && typeof useRoute === 'function') {
                                useRoute(candidate.id, payload.route.index);
                            } else if (action === 'display') {
                                displayRoute(candidate.id, payload.route.index);
                            } else if (action === 'hide' && typeof hideRoute === 'function') {
                                hideRoute(candidate.id, payload.route.index);
                            }
                        }
                    }
                } catch (e) {}
            } else if (payload && payload.type === 'location') {
                addTemporarySharedLocationMarker(payload.lat, payload.lng);
                // 若指定縮放層級則套用
                if (payload.zoom && typeof map !== 'undefined' && map && typeof map.setView === 'function') {
                    try { map.setView([payload.lat, payload.lng], payload.zoom, { animate: true }); } catch (e) {}
                }
                // 若要求開啟追蹤，嘗試啟用追蹤
                try { if (payload.trackingEnabled && typeof startTracking === 'function') startTracking(); } catch (e) {}
                showNotification('🔗 已載入共享位置', 'success');
            }
        } else if (params.has('lat') && params.has('lng')) {
            const lat = parseFloat(params.get('lat'));
            const lng = parseFloat(params.get('lng'));
            if (!isNaN(lat) && !isNaN(lng)) {
                addTemporarySharedLocationMarker(lat, lng);
            }
        }
    } catch (e) {
        console.error('解析共享連結失敗:', e);
    }
}

// 將分享函式暴露到全域，供內嵌 onclick 使用
window.shareMarkerById = shareMarkerById;
window.shareMarkerByIdUrl = shareMarkerByIdUrl;
window.shareMarkerByIdFile = shareMarkerByIdFile;
window.shareMarkerByIdPointUrl = shareMarkerByIdPointUrl;
window.shareCurrentLocation = shareCurrentLocation;

// 圖片處理相關函數
// 圖片壓縮函數
function compressImage(file, maxSizeKB = 25) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        img.onload = function() {
            // 計算壓縮後的尺寸
            let { width, height } = img;
            const maxDimension = 800; // 最大尺寸
            
            if (width > height && width > maxDimension) {
                height = (height * maxDimension) / width;
                width = maxDimension;
            } else if (height > maxDimension) {
                width = (width * maxDimension) / height;
                height = maxDimension;
            }
            
            canvas.width = width;
            canvas.height = height;
            
            // 繪製圖片到canvas
            ctx.drawImage(img, 0, 0, width, height);
            
            // 嘗試不同的質量設置來達到目標文件大小
            let quality = 0.8;
            let compressedDataUrl;
            
            const tryCompress = () => {
                compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                const sizeKB = Math.round((compressedDataUrl.length * 3) / 4 / 1024);
                
                if (sizeKB > maxSizeKB && quality > 0.1) {
                    quality -= 0.1;
                    tryCompress();
                } else {
                    resolve(compressedDataUrl);
                }
            };
            
            tryCompress();
        };
        
        // 如果是文件對象，轉換為DataURL
        if (file instanceof File) {
            const reader = new FileReader();
            reader.onload = (e) => {
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        } else {
            // 如果已經是DataURL
            img.src = file;
        }
    });
}

// 專用於網址分享的更激進壓縮：優先 WebP，必要時縮小尺寸
async function compressImageForShare(fileOrDataUrl, targetKB = 5, maxDimension = 480) {
    return new Promise((resolve) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.onload = function() {
            let width = img.width;
            let height = img.height;
            const scaleDown = (w, h, maxDim) => {
                if (w > h && w > maxDim) {
                    h = Math.round((h * maxDim) / w);
                    w = maxDim;
                } else if (h > maxDim) {
                    w = Math.round((w * maxDim) / h);
                    h = maxDim;
                }
                return { w, h };
            };
            const dim = scaleDown(width, height, maxDimension);
            width = dim.w; height = dim.h;
            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            let quality = 0.6;
            let attempt = 0;
            const tryCompress = () => {
                const preferWebp = true;
                let dataUrl = '';
                if (preferWebp) {
                    try { dataUrl = canvas.toDataURL('image/webp', quality); } catch {}
                }
                if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/webp')) {
                    dataUrl = canvas.toDataURL('image/jpeg', quality);
                }
                const sizeKB = Math.round((dataUrl.length * 3) / 4 / 1024);
                if (sizeKB > targetKB && (quality > 0.2 || attempt < 4)) {
                    if (quality > 0.2) quality = Math.max(0.2, quality - 0.1);
                    else {
                        // 進一步縮小尺寸
                        const newDim = scaleDown(width, height, Math.round(maxDimension * 0.8));
                        if (newDim.w < width || newDim.h < height) {
                            width = newDim.w; height = newDim.h;
                            canvas.width = width; canvas.height = height;
                            ctx.drawImage(img, 0, 0, width, height);
                            maxDimension = Math.round(maxDimension * 0.8);
                        }
                    }
                    attempt++;
                    tryCompress();
                } else {
                    resolve(dataUrl);
                }
            };
            tryCompress();
        };
        if (fileOrDataUrl instanceof File) {
            const reader = new FileReader();
            reader.onload = (e) => { img.src = e.target.result; };
            reader.readAsDataURL(fileOrDataUrl);
        } else {
            img.src = fileOrDataUrl;
        }
    });
}

function truncateString(str, maxLen = 250) {
    try {
        if (typeof str !== 'string') return '';
        if (str.length <= maxLen) return str;
        return str.slice(0, maxLen);
    } catch { return ''; }
}

function handleImageUpload(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;
    
    // 檢查圖片數量限制
    const form = document.getElementById('markerForm');
    const existingImages = JSON.parse(form.dataset.imageData || '[]');
    const totalImages = existingImages.length + files.length;
    
    if (totalImages > 6) {
        showNotification('最多只能上傳6張圖片', 'warning');
        return;
    }
    
    // 處理每個文件
    let processedCount = 0;
    const newImages = [];
    
    files.forEach(file => {
        // 檢查文件類型
        if (!file.type.startsWith('image/')) {
            showNotification('請選擇圖片文件', 'warning');
            return;
        }
        
        // 檢查文件大小（限制為10MB）
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (file.size > maxSize) {
            showNotification('圖片文件過大，請選擇小於10MB的圖片', 'warning');
            return;
        }
        
        // 使用壓縮功能處理圖片
        compressImage(file).then(compressedDataUrl => {
            newImages.push(compressedDataUrl);
            processedCount++;
            
            // 當所有圖片都處理完成時，更新預覽
            if (processedCount === files.length) {
                const allImages = [...existingImages, ...newImages];
                displayMultipleImagePreviews(allImages);
                showNotification(`已上傳 ${files.length} 張圖片並自動壓縮`, 'success');
            }
        }).catch(error => {
            console.error('圖片壓縮失敗:', error);
            showNotification('圖片處理失敗', 'error');
        });
    });
}

function displayMultipleImagePreviews(imagesArray) {
    const previewContainer = document.getElementById('imagePreviewContainer');
    const form = document.getElementById('markerForm');
    
    // 清空現有預覽
    previewContainer.innerHTML = '';
    
    // 存儲圖片數據到表單
    form.dataset.imageData = JSON.stringify(imagesArray);
    
    // 為每張圖片創建預覽元素
    imagesArray.forEach((imageData, index) => {
        const imagePreview = document.createElement('div');
        imagePreview.className = 'image-preview';
        imagePreview.dataset.index = index;
        
        const img = document.createElement('img');
        img.src = imageData;
        img.alt = `圖片 ${index + 1}`;
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-image-btn';
        removeBtn.innerHTML = '×';
        removeBtn.title = '刪除圖片';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removeImageAtIndex(index);
        };
        
        // 添加點擊預覽功能
        imagePreview.onclick = () => {
            openImageModal(imagesArray, index);
        };
        
        imagePreview.appendChild(img);
        imagePreview.appendChild(removeBtn);
        previewContainer.appendChild(imagePreview);
    });
}

function removeImageAtIndex(index) {
    const form = document.getElementById('markerForm');
    const imagesArray = JSON.parse(form.dataset.imageData || '[]');
    
    // 移除指定索引的圖片
    imagesArray.splice(index, 1);
    
    // 更新預覽
    displayMultipleImagePreviews(imagesArray);
    
    // 清空文件輸入
    document.getElementById('markerImages').value = '';
}

function removeAllMarkerImages() {
    const previewContainer = document.getElementById('imagePreviewContainer');
    const fileInput = document.getElementById('markerImages');
    const form = document.getElementById('markerForm');
    
    // 清除預覽
    previewContainer.innerHTML = '';
    
    // 清除文件輸入
    fileInput.value = '';
    
    // 清除表單數據
    delete form.dataset.imageData;
}

function resetImageUpload() {
    removeAllMarkerImages();
}

// 圖片模態框預覽功能
function openImageModal(imagesArray, startIndex = 0) {
    const modal = document.getElementById('imagePreviewModal');
    const modalImg = document.getElementById('modalPreviewImg');
    const imageCounter = document.getElementById('imageCounter');
    const prevBtn = document.getElementById('prevImageBtn');
    const nextBtn = document.getElementById('nextImageBtn');
    const thumbnailContainer = document.getElementById('imageThumbnailContainer');
    
    let currentIndex = startIndex;
    
    // 隱藏縮圖和計數器，但顯示導航按鈕
    if (imageCounter) imageCounter.style.display = 'none';
    if (thumbnailContainer) thumbnailContainer.style.display = 'none';
    
    // 只有多張圖片時才顯示導航按鈕
    if (imagesArray.length > 1) {
        if (prevBtn) prevBtn.style.display = 'block';
        if (nextBtn) nextBtn.style.display = 'block';
    } else {
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
    }
    
    function updateModalImage() {
        modalImg.src = imagesArray[currentIndex];
        
        // 更新按鈕狀態
        if (prevBtn) prevBtn.disabled = currentIndex === 0;
        if (nextBtn) nextBtn.disabled = currentIndex === imagesArray.length - 1;
    }
    
    function showPrevImage() {
        if (currentIndex > 0) {
            currentIndex--;
            updateModalImage();
        }
    }
    
    function showNextImage() {
        if (currentIndex < imagesArray.length - 1) {
            currentIndex++;
            updateModalImage();
        }
    }
    
    // 設置事件監聽器
    if (prevBtn) prevBtn.onclick = showPrevImage;
    if (nextBtn) nextBtn.onclick = showNextImage;
    
    // 鍵盤導航
    function handleKeyPress(e) {
        if (e.key === 'ArrowLeft') showPrevImage();
        if (e.key === 'ArrowRight') showNextImage();
        if (e.key === 'Escape') closeImageModal();
    }
    
    document.addEventListener('keydown', handleKeyPress);
    
    // 點擊背景關閉模態框
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeImageModal();
        }
    });
    
    // 關閉模態框時清理事件監聽器
    const originalCloseModal = closeImageModal;
    window.closeImageModal = function() {
        document.removeEventListener('keydown', handleKeyPress);
        originalCloseModal();
    };
    
    // 初始化並顯示模態框
    updateModalImage();
    modal.style.display = 'flex';
    
    // 如果處於全螢幕模式，確保modal在正確的容器中
    if (isFullscreen) {
        const fullscreenContainer = document.querySelector('.map-container.fullscreen');
        if (fullscreenContainer) {
            // 強制將modal移到全螢幕容器中
            fullscreenContainer.appendChild(modal);
            
            // 確保modal的樣式正確
            setTimeout(() => {
                modal.style.position = 'fixed';
                modal.style.zIndex = '18000'; /* 提高z-index確保圖片模態框正確顯示 */
                modal.style.left = '0';
                modal.style.top = '0';
                modal.style.width = '100vw';
                modal.style.height = '100vh';
            }, 10);
        }
    }
}

function closeImageModal() {
    const modal = document.getElementById('imagePreviewModal');
    
    // 如果在全屏模式下，將模態框移回原來的位置
    if (isFullscreen) {
        const fullscreenContainer = document.querySelector('.fullscreen');
        if (fullscreenContainer && fullscreenContainer.contains(modal)) {
            document.body.appendChild(modal);
            // 重置樣式
            modal.style.zIndex = '';
            modal.style.position = '';
            modal.style.top = '';
            modal.style.left = '';
            modal.style.width = '';
            modal.style.height = '';
        }
    }
    
    modal.style.display = 'none';
}

// 添加重置功能（用於測試）
window.resetSetup = function() {
    try { appStorageRemove('hasSeenSetup'); } catch (e) { try { localStorage.removeItem('hasSeenSetup'); } catch (_) {} }
    location.reload();
};

// 切換設定區域顯示/隱藏
window.toggleSection = function(sectionName) {
    const section = document.querySelector(`.${sectionName}-section`);
    const content = section.querySelector('.section-content');
    const icon = section.querySelector('.toggle-icon');
    
    if (section.classList.contains('collapsed')) {
        section.classList.remove('collapsed');
        content.style.display = 'block';
        icon.textContent = '▲';
    } else {
        section.classList.add('collapsed');
        content.style.display = 'none';
        icon.textContent = '▼';
    }
};





// 全螢幕功能
let isFullscreen = false;

function toggleFullscreen() {
    const mapContainer = document.querySelector('.map-container');
    const fullscreenIcon = document.getElementById('fullscreenIcon');
    
    console.log('toggleFullscreen called, current isFullscreen:', isFullscreen);
    console.log('mapContainer found:', !!mapContainer);
    console.log('fullscreenIcon found:', !!fullscreenIcon);
    
    if (!isFullscreen) {
        // 進入全螢幕模式
        console.log('Attempting to enter fullscreen');
        enterFullscreen(mapContainer);
    } else {
        // 退出全螢幕模式
        console.log('Attempting to exit fullscreen');
        exitFullscreen();
    }
}

function enterFullscreen(element) {
    const mapContainer = document.querySelector('.map-container');
    const fullscreenIcon = document.getElementById('fullscreenIcon');
    
    console.log('Entering fullscreen mode');
    
    // 添加全螢幕CSS類
    mapContainer.classList.add('fullscreen');
    
    // 更新按鈕圖標 - 進入全螢幕時顯示退出圖標
    fullscreenIcon.textContent = '⛶';
    
    // 檢測是否為行動裝置
    const isMobile = isMobileDevice();
    const isIOS = isIOSDevice();
    
    // iOS Safari 不支援對非video元素使用全螢幕API，直接使用CSS全螢幕
    if (isIOS) {
        console.log('iOS detected, using CSS fullscreen');
        handleCSSFullscreen();
        return;
    }
    
    // 對於其他行動裝置和桌面，嘗試使用原生全螢幕API
    let fullscreenPromise = null;
    
    if (element.requestFullscreen) {
        fullscreenPromise = element.requestFullscreen();
    } else if (element.webkitRequestFullscreen) {
        fullscreenPromise = element.webkitRequestFullscreen();
    } else if (element.msRequestFullscreen) {
        fullscreenPromise = element.msRequestFullscreen();
    }
    
    if (fullscreenPromise) {
        fullscreenPromise.catch((error) => {
            console.log('Native fullscreen failed, using CSS fullscreen:', error);
            handleCSSFullscreen();
        });
    } else {
        // 瀏覽器不支持原生全螢幕，使用CSS全螢幕
        console.log('Native fullscreen not supported, using CSS fullscreen');
        handleCSSFullscreen();
    }
    
    isFullscreen = true;
    
    // 如果modal已經打開，將其移到全螢幕容器中
    const modal = document.getElementById('markerModal');
    if (modal && modal.style.display === 'block') {
        mapContainer.appendChild(modal);
        
        // 確保modal的樣式正確
        setTimeout(() => {
            modal.style.position = 'fixed';
            modal.style.zIndex = '15000'; /* 提高z-index確保模態框正確顯示 */
            modal.style.left = '0';
            modal.style.top = '0';
            modal.style.width = '100vw';
            modal.style.height = '100vh';
        }, 10);
    }
    

    
    // 重新調整地圖大小
    setTimeout(() => {
        if (map) {
            map.invalidateSize();
        }
    }, 100);
}

function exitFullscreen() {
    const mapContainer = document.querySelector('.map-container');
    const fullscreenIcon = document.getElementById('fullscreenIcon');
    
    console.log('Exiting fullscreen mode');
    
    // 移除全螢幕CSS類
    mapContainer.classList.remove('fullscreen');
    
    // 清理CSS全螢幕樣式
    mapContainer.style.position = '';
    mapContainer.style.top = '';
    mapContainer.style.left = '';
    mapContainer.style.width = '';
    mapContainer.style.height = '';
    mapContainer.style.minHeight = '';
    mapContainer.style.zIndex = '';
    mapContainer.style.backgroundColor = '';
    
    // 恢復頁面滾動條
    document.body.style.overflow = '';
    
    // 更新按鈕圖標 - 退出全螢幕時顯示進入圖標
    fullscreenIcon.textContent = '⛶';
    
    // 嘗試退出瀏覽器原生全螢幕
    if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
    } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen().catch(() => {});
    } else if (document.msExitFullscreen) {
        document.msExitFullscreen().catch(() => {});
    }
    
    isFullscreen = false;
    
    // 將modal移回body（如果它在全螢幕容器中）
    const modal = document.getElementById('markerModal');
    if (modal && mapContainer.contains(modal)) {
        document.body.appendChild(modal);
        
        // 重置modal的樣式
        modal.style.position = '';
        modal.style.zIndex = '';
        modal.style.left = '';
        modal.style.top = '';
        modal.style.width = '';
        modal.style.height = '';
    }
    

    
    // 重新調整地圖大小
    setTimeout(() => {
        if (map) {
            map.invalidateSize();
        }
    }, 100);
}

function handleCSSFullscreen() {
    // 純CSS全螢幕實現，適用於不支持原生API的情況
    const mapContainer = document.querySelector('.map-container');
    const isIOS = isIOSDevice();
    
    mapContainer.style.position = 'fixed';
    mapContainer.style.top = '0';
    mapContainer.style.left = '0';
    mapContainer.style.width = '100vw';
    // 先設定標準視窗高度
    mapContainer.style.height = '100vh';
    // 若支援動態/安全視窗高度，優先使用以確保滿版覆蓋
    try {
        if (window.CSS && CSS.supports && CSS.supports('height', '100dvh')) {
            mapContainer.style.height = '100dvh';
        } else if (window.CSS && CSS.supports && CSS.supports('height', '100svh')) {
            mapContainer.style.height = '100svh';
        }
    } catch (_) {
        // 忽略 CSS.supports 例外，保留 100vh
    }
    mapContainer.style.zIndex = '9999';
    mapContainer.style.backgroundColor = '#000';
    
    // 行動裝置特殊處理
    if (isIOS) {
        // iOS Safari 特殊處理：使用 visualViewport 或 innerHeight 以確保滿版
        const applyDynamicHeight = () => {
            const viewportHeight = (window.visualViewport && window.visualViewport.height)
                ? Math.ceil(window.visualViewport.height)
                : Math.ceil(window.innerHeight);
            mapContainer.style.height = viewportHeight + 'px';
            mapContainer.style.minHeight = viewportHeight + 'px';
        };

        // 初始套用
        setTimeout(() => {
            window.scrollTo(0, 1);
            applyDynamicHeight();
            if (map) map.invalidateSize();
        }, 100);

        // 監聽方向變化與視窗視覺變更
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                applyDynamicHeight();
                if (map) {
                    map.invalidateSize();
                }
            }, 500);
        });

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => {
                applyDynamicHeight();
                if (map) map.invalidateSize();
            });
        }
    }
    
    // 隱藏頁面滾動條
    document.body.style.overflow = 'hidden';
    
    console.log('CSS fullscreen activated for mobile device');
}

// 按鈕點擊處理函數
function handleFullscreenClick() {
    console.log('Fullscreen button clicked');
    toggleFullscreen();
}

// 手機設備自動進入全螢幕模式
function autoEnterFullscreenOnMobile() {
    if (!isMobileDevice()) {
        return;
    }
    
    console.log('Mobile device detected, attempting auto fullscreen');
    
    // 檢查是否已經在全螢幕模式
    if (isFullscreen) {
        console.log('Already in fullscreen mode');
        return;
    }
    
    // 延遲執行以確保頁面完全載入
    setTimeout(() => {
        try {
            const mapContainer = document.querySelector('.map-container');
            if (mapContainer) {
                enterFullscreen(mapContainer);
                console.log('Auto fullscreen activated for mobile device');
                
                // 顯示通知告知用戶已自動進入全螢幕
                showNotification('已自動進入全螢幕模式', 'info');
            } else {
                console.warn('Map container not found for auto fullscreen');
            }
        } catch (error) {
            console.error('Auto fullscreen failed:', error);
        }
    }, 500); // 延遲500ms確保DOM完全載入
}

function handleLocationClick() {
    console.log('Location button clicked');
    centerMapToCurrentLocation();
}

// 更新自動居中按鈕的提示文字
function updateCenterButtonTooltip() {
    const centerBtn = document.getElementById('centerBtn');
    if (centerBtn) {
        const status = keepMapCentered ? '已開啟' : '已關閉';
        centerBtn.title = `自動居中功能 (目前${status}) - 點擊切換`;
    }
}

// 顯示手機端自動居中狀態提示
function showMobileCenterStatusToast() {
    // 檢查是否為手機裝置
    if (!isMobileDevice()) {
        return;
    }
    
    const status = keepMapCentered ? '已開啟' : '已關閉';
    const message = `自動居中功能${status}`;
    
    // 創建提示元素
    const toast = document.createElement('div');
    toast.className = 'mobile-status-toast';
    toast.textContent = message;
    
    // 添加樣式
    toast.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        font-size: 16px;
        font-weight: bold;
        z-index: 10000;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease;
    `;
    
    // 添加到頁面
    document.body.appendChild(toast);
    
    // 顯示動畫
    setTimeout(() => {
        toast.style.opacity = '1';
    }, 10);
    
    // 2秒後移除
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 2000);
}

function handleCenterClick() {
    console.log('Center button clicked');
    // 切換自動居中功能
    keepMapCentered = !keepMapCentered;
    
    // 更新按鈕狀態
    const centerBtn = document.getElementById('centerBtn');
    const centerIcon = document.getElementById('centerIcon');
    
    if (keepMapCentered) {
        centerBtn.classList.add('active');
        centerIcon.textContent = '🎯';
        showNotification('自動居中已開啟', 'success');
        
        // 如果有當前位置，立即居中
        if (currentPosition) {
            map.setView([currentPosition.lat, currentPosition.lng], map.getZoom());
        }
        
        // 如果正在追蹤，啟動居中定時器
        if (isTracking && centeringInterval > 0) {
            if (centeringTimer) {
                clearInterval(centeringTimer);
            }
            centeringTimer = setInterval(() => {
                if (currentPosition && isTracking && keepMapCentered) {
                    centerMapToCurrentPosition(true);
                }
            }, centeringInterval);
        }
    } else {
        centerBtn.classList.remove('active');
        centerIcon.textContent = '🎯';
        showNotification('自動居中已關閉', 'info');
        
        // 清除居中定時器
        if (centeringTimer) {
            clearInterval(centeringTimer);
            centeringTimer = null;
        }
    }
    
    // 更新按鈕提示文字
    updateCenterButtonTooltip();
    
    // 更新設定面板中的複選框
    document.getElementById('keepMapCentered').checked = keepMapCentered;
    
    // 只保存設定，不保存標註點資料
    saveSettingsOnly();
}

// 將函數暴露到全局作用域，讓HTML的onclick可以訪問
window.handleFullscreenClick = handleFullscreenClick;
window.handleLocationClick = handleLocationClick;
window.handleCenterClick = handleCenterClick;
window.toggleAddMarkerMode = toggleAddMarkerMode;
window.toggleTracking = toggleTracking;
window.toggleNotifications = toggleNotifications;
window.centerMapToCurrentLocation = centerMapToCurrentLocation;

// 行動裝置檢測函數
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function isIOSDevice() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

// 初始化控制按鈕
function initControlButtons() {
    // 拖曳功能
    initDragFunctionality();
    
    // 初始化自動居中按鈕狀態
    const centerBtn = document.getElementById('centerBtn');
    if (centerBtn && keepMapCentered) {
        centerBtn.classList.add('active');
    }
    
    // 初始化按鈕提示文字
    updateCenterButtonTooltip();
    
    // 為行動裝置添加特殊提示
    if (isMobileDevice()) {
        const fullscreenBtn = document.getElementById('fullscreenBtn');
        if (fullscreenBtn) {
            // 更新行動裝置的提示文字
            if (isIOSDevice()) {
                fullscreenBtn.title = '全螢幕顯示 (iOS使用CSS全螢幕)';
            } else {
                fullscreenBtn.title = '全螢幕顯示 (行動裝置)';
            }
        }
        
        console.log('Mobile device detected, fullscreen optimized for mobile');
    }
}

// 監聽全螢幕狀態變化
document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
document.addEventListener('msfullscreenchange', handleFullscreenChange);

function handleFullscreenChange() {
    const isCurrentlyFullscreen = !!(document.fullscreenElement || 
                                    document.webkitFullscreenElement || 
                                    document.msFullscreenElement);
    
    if (!isCurrentlyFullscreen && isFullscreen) {
        // 用戶通過ESC或其他方式退出了全螢幕
        exitFullscreen();
    }
}

// 定位點功能
function getCurrentLocation() {
    const locationBtn = document.getElementById('locationBtn');
    const locationIcon = document.getElementById('locationIcon');
    
    // 檢查是否支持地理位置
    if (!navigator.geolocation) {
        showNotification('您的瀏覽器不支持地理位置功能', 'error');
        return;
    }
    
    // 設置按鈕為載入狀態
    locationBtn.classList.add('locating');
    locationBtn.disabled = true;
    locationIcon.textContent = '🔄';
    
    // 獲取當前位置
    navigator.geolocation.getCurrentPosition(
        function(position) {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const accuracy = position.coords.accuracy;
            
            // 更新當前位置
            currentPosition = { 
                lat, 
                lng, 
                accuracy: accuracy,
                timestamp: Date.now()
            };
            
            // 更新當前位置標記（會自動處理居中）
            updateCurrentLocationMarker();
            
            // 強制居中到當前位置並設定合適的縮放級別
            centerMapToCurrentPosition(true, 16);
            
            // 恢復按鈕狀態
            locationBtn.classList.remove('locating');
            locationBtn.disabled = false;
            locationIcon.textContent = '📍';
            
            // 顯示成功通知，包含精度信息
            const accuracyText = accuracy ? `，精度: ±${Math.round(accuracy)}公尺` : '';
            showNotification(`🎯 已定位到您的位置${accuracyText}`, 'success');
            
            console.log('手動定位成功:', currentPosition);
        },
        function(error) {
            console.error('手動定位失敗:', {
                code: error.code,
                message: error.message,
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                isSecureContext: window.isSecureContext,
                protocol: window.location.protocol
            });
            
            // 處理錯誤
            let errorMessage = '無法獲取位置';
            let technicalInfo = '';
            
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    if (isMobileDevice()) {
                        errorMessage = '❌ 位置權限被拒絕。請在手機設定中允許此網站存取位置，或點擊地址欄的位置圖示重新授權。';
                    } else {
                        errorMessage = '❌ 位置權限被拒絕。請點擊瀏覽器地址欄的位置圖示重新授權。';
                    }
                    technicalInfo = '錯誤代碼: PERMISSION_DENIED (1)';
                    break;
                case error.POSITION_UNAVAILABLE:
                    errorMessage = '📍 位置信息不可用。請檢查GPS是否開啟，或確認網路連接正常。';
                    technicalInfo = '錯誤代碼: POSITION_UNAVAILABLE (2)';
                    break;
                case error.TIMEOUT:
                    errorMessage = '⏰ 定位超時（30秒）。請確認GPS訊號良好，或稍後再試。';
                    technicalInfo = '錯誤代碼: TIMEOUT (3)';
                    break;
                default:
                    errorMessage = '📍 定位失敗。請檢查網路連接或稍後重試。';
                    technicalInfo = `錯誤代碼: ${error.code}`;
                    break;
            }
            
            // 檢查是否為HTTPS環境
            if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
                errorMessage += '\n⚠️ 注意：定位功能需要HTTPS環境才能正常工作。';
                technicalInfo += ' | 非HTTPS環境';
            }
            
            // 恢復按鈕狀態
            locationBtn.classList.remove('locating');
            locationBtn.disabled = false;
            locationIcon.textContent = '📍';
            
            showNotification(errorMessage, 'error');
            
            // 在控制台顯示技術信息
            console.warn(`手動定位失敗詳情: ${technicalInfo} | ${error.message}`);
        },
        {
            enableHighAccuracy: true, // 始終使用高精度定位
            timeout: 30000, // 增加超時時間到30秒
            maximumAge: 0 // 不使用緩存，強制獲取新的位置
        }
    );
}

// 拖曳功能實現
async function initDragFunctionality() {
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const locationBtn = document.getElementById('locationBtn');
    const centerBtn = document.getElementById('centerBtn');
    const rotateBtn = document.getElementById('rotateBtn');
    
    // 載入保存的按鈕位置（IndexedDB 非同步）
    try { await loadButtonPositions(); } catch (_) { loadButtonPositions(); }
    
    // 為每個按鈕添加拖曳功能
    makeDraggable(fullscreenBtn);
    makeDraggable(locationBtn);
    makeDraggable(centerBtn);
    makeDraggable(rotateBtn);
    
    // 為手機添加額外的觸控事件處理
    addMobileTouchSupport(fullscreenBtn, 'handleFullscreenClick');
    addMobileTouchSupport(locationBtn, 'handleLocationClick');
    addMobileTouchSupport(centerBtn, 'handleCenterClick');
    addMobileTouchSupport(rotateBtn, 'toggleMapRotation');
    
    // 為其他重要按鈕添加手機觸控支援
    const addMarkerBtn = document.getElementById('addMarkerBtn');
    const trackingBtn = document.getElementById('trackingBtn');
    const notificationBtn = document.getElementById('notificationBtn');
    const centerMapBtn = document.getElementById('centerMapBtn');
    const floatingHelpBtn = document.getElementById('floatingHelpBtn');
    const shareLocationBtn = document.getElementById('shareLocationBtn');
    
    if (addMarkerBtn) addMobileTouchSupport(addMarkerBtn, 'toggleAddMarkerMode');
    if (trackingBtn) addMobileTouchSupport(trackingBtn, 'toggleTracking');
    if (notificationBtn) addMobileTouchSupport(notificationBtn, 'toggleNotifications');
    if (centerMapBtn) addMobileTouchSupport(centerMapBtn, 'centerMapToCurrentLocation');
    if (floatingHelpBtn) addMobileTouchSupport(floatingHelpBtn, 'showHelpModal');
    if (shareLocationBtn) addMobileTouchSupport(shareLocationBtn, 'shareCurrentLocation');

    // 額外保險：直接在旋轉按鈕上綁定觸控與點擊（避免部分瀏覽器事件相容性問題）
    if (rotateBtn) {
        rotateBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            if (!rotateBtn.hasDragged && typeof window.toggleMapRotation === 'function') {
                window.toggleMapRotation();
            }
        }, { passive: false });
        rotateBtn.addEventListener('click', (e) => {
            if (!rotateBtn.hasDragged && typeof window.toggleMapRotation === 'function') {
                window.toggleMapRotation();
            }
        });
    }
}

// 為手機添加觸控事件支持
function addMobileTouchSupport(element, functionName) {
    let touchStartTime = 0;
    let touchMoved = false;
    let touchStartX = 0;
    let touchStartY = 0;
    
    element.addEventListener('touchstart', function(e) {
        touchStartTime = Date.now();
        touchMoved = false;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        
        // 防止預設行為，確保觸控事件正確處理
        e.preventDefault();
    }, { passive: false });
    
    element.addEventListener('touchmove', function(e) {
        const touchX = e.touches[0].clientX;
        const touchY = e.touches[0].clientY;
        const moveDistance = Math.sqrt(
            Math.pow(touchX - touchStartX, 2) + Math.pow(touchY - touchStartY, 2)
        );
        
        // 如果移動距離超過10像素，視為移動
        if (moveDistance > 10) {
            touchMoved = true;
        }
    }, { passive: true });
    
    element.addEventListener('touchend', function(e) {
        const touchDuration = Date.now() - touchStartTime;
        
        // 防止預設行為
        e.preventDefault();
        
        // 如果是短時間觸控且沒有移動，且沒有被拖曳功能標記為已拖曳
        if (touchDuration < 500 && !touchMoved && !element.hasDragged) {
            console.log('Mobile touch click for:', element.id);
            
            // 立即調用對應的函數，不延遲（確保在用戶手勢事件中執行）
            if (functionName === 'handleFullscreenClick' && typeof window.handleFullscreenClick === 'function') {
                window.handleFullscreenClick();
            } else if (functionName === 'handleLocationClick' && typeof window.handleLocationClick === 'function') {
                window.handleLocationClick();
            } else if (functionName === 'handleCenterClick' && typeof window.handleCenterClick === 'function') {
                window.handleCenterClick();
                // 在手機端顯示額外的狀態提示
                showMobileCenterStatusToast();
            } else if (functionName === 'toggleAddMarkerMode' && typeof window.toggleAddMarkerMode === 'function') {
                window.toggleAddMarkerMode();
            } else if (functionName === 'toggleTracking' && typeof window.toggleTracking === 'function') {
                window.toggleTracking();
            } else if (functionName === 'toggleNotifications' && typeof window.toggleNotifications === 'function') {
                window.toggleNotifications();
            } else if (functionName === 'centerMapToCurrentLocation' && typeof window.centerMapToCurrentLocation === 'function') {
                window.centerMapToCurrentLocation();
            } else if (functionName === 'showHelpModal' && typeof window.showHelpModal === 'function') {
                window.showHelpModal();
            } else if (functionName === 'toggleMapRotation' && typeof window.toggleMapRotation === 'function') {
                window.toggleMapRotation();
            } else if (functionName === 'shareCurrentLocation' && typeof window.shareCurrentLocation === 'function') {
                // iOS/Safari 需在使用者手勢事件中直接呼叫分享
                window.shareCurrentLocation();
            }
        }
        
        // 重置拖曳標記
        setTimeout(() => {
            element.hasDragged = false;
        }, 50);
    }, { passive: false });
}

function makeDraggable(element) {
    let isDragging = false;
    let startX, startY, initialX, initialY;
    let currentX = 0, currentY = 0;
    let dragStartTime = 0;
    
    // 明確初始化hasDragged為false
    element.hasDragged = false;
    
    // 獲取初始位置
    const computedStyle = window.getComputedStyle(element);
    initialX = parseInt(computedStyle.left) || 0;
    initialY = parseInt(computedStyle.top) || 0;
    
    // 只綁定開始事件到元素本身
    element.addEventListener('mousedown', dragStart);
    element.addEventListener('touchstart', dragStart, { passive: false });
    
    function dragStart(e) {
        dragStartTime = Date.now();
        element.hasDragged = false;
        
        if (e.type === 'touchstart') {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            // 綁定觸摸事件
            document.addEventListener('touchmove', drag, { passive: false });
            document.addEventListener('touchend', dragEnd);
        } else {
            startX = e.clientX;
            startY = e.clientY;
            // 綁定滑鼠事件
            document.addEventListener('mousemove', drag);
            document.addEventListener('mouseup', dragEnd);
        }
        
        isDragging = false;
        
        // 設置初始偏移
        const rect = element.getBoundingClientRect();
        currentX = rect.left - initialX;
        currentY = rect.top - initialY;
        
        // 只在滑鼠事件時preventDefault，觸控事件延遲處理
        if (e.type !== 'touchstart') {
            e.preventDefault();
        }
    }
    
    function drag(e) {
        let clientX, clientY;
        if (e.type === 'touchmove') {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }
        
        // 計算移動距離
        const deltaX = clientX - startX;
        const deltaY = clientY - startY;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        // 如果移動距離超過5像素，開始拖曳
        if (!isDragging && distance > 5) {
            isDragging = true;
            element.hasDragged = true;
            element.classList.add('dragging');
            // 現在才阻止默認行為，確保真正開始拖曳
            e.preventDefault();
        }
        
        if (!isDragging) return;
        
        // 只在真正拖曳時阻止默認行為
        e.preventDefault();
        
        const newX = initialX + currentX + deltaX;
        const newY = initialY + currentY + deltaY;
        
        // 獲取視窗和元素尺寸
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const elementWidth = element.offsetWidth;
        const elementHeight = element.offsetHeight;
        
        // 限制在視窗範圍內
        const constrainedX = Math.max(0, Math.min(newX, windowWidth - elementWidth));
        const constrainedY = Math.max(0, Math.min(newY, windowHeight - elementHeight));
        
        // 應用新位置
        element.style.left = constrainedX + 'px';
        element.style.top = constrainedY + 'px';
        element.style.right = 'auto';
        element.style.bottom = 'auto';
    }
    
    function dragEnd(e) {
        // 移除事件監聽器
        document.removeEventListener('mousemove', drag);
        document.removeEventListener('mouseup', dragEnd);
        document.removeEventListener('touchmove', drag);
        document.removeEventListener('touchend', dragEnd);
        
        // 總是重置拖曳狀態
        isDragging = false;
        element.classList.remove('dragging');
        
        if (element.hasDragged) {
            // 更新初始位置
            const computedStyle = window.getComputedStyle(element);
            initialX = parseInt(computedStyle.left) || 0;
            initialY = parseInt(computedStyle.top) || 0;
            currentX = 0;
            currentY = 0;
            
            // 保存位置到localStorage
            saveButtonPosition(element.id, initialX, initialY);
        }
        
        // 短暫延遲後重置hasDragged，避免立即觸發點擊
        setTimeout(() => {
            element.hasDragged = false;
        }, 10);
    }
    
    // 阻止拖曳時觸發點擊事件
    element.addEventListener('click', function(e) {
        // 只有在真正發生拖曳時才阻止點擊
        if (element.hasDragged) {
            console.log('Preventing click due to drag for element:', element.id);
            e.preventDefault();
            e.stopPropagation();
            return false;
        } else {
            console.log('Allowing click for element:', element.id);
        }
    }, false);
}

async function saveButtonPosition(buttonId, x, y) {
    try {
        const existing = await appStorageGet('buttonPositions');
        const positions = existing && typeof existing === 'object' ? existing : {};
        positions[buttonId] = { x, y };
        await appStorageSet('buttonPositions', positions);
    } catch (e) {
        console.warn('保存按鈕位置失敗，使用快取回退:', e);
        try {
            const positions = JSON.parse(localStorage.getItem('buttonPositions') || '{}');
            positions[buttonId] = { x, y };
            localStorage.setItem('buttonPositions', JSON.stringify(positions));
        } catch (_) {}
    }
}

async function loadButtonPositions() {
    try {
        const positions = await appStorageGet('buttonPositions') || {};
        Object.keys(positions).forEach(buttonId => {
            const element = document.getElementById(buttonId);
            if (element) {
                const { x, y } = positions[buttonId];
                element.style.left = x + 'px';
                element.style.top = y + 'px';
                element.style.right = 'auto';
                element.style.bottom = 'auto';
            }
        });
    } catch (e) {
        console.warn('載入按鈕位置失敗，使用快取回退:', e);
        const positions = JSON.parse(localStorage.getItem('buttonPositions') || '{}');
        Object.keys(positions).forEach(buttonId => {
            const element = document.getElementById(buttonId);
            if (element) {
                const { x, y } = positions[buttonId];
                element.style.left = x + 'px';
                element.style.top = y + 'px';
                element.style.right = 'auto';
                element.style.bottom = 'auto';
            }
        });
    }
}

// 請求位置權限
function requestLocationPermission() {
    console.log('開始請求位置權限...');
    
    return new Promise(async (resolve, reject) => {
        // 檢查是否為Android應用程式
        if (window.isAndroidApp && window.isAndroidApp()) {
            console.log('檢測到Android應用程式環境，使用Android權限管理...');
            try {
                // 先請求Android權限
                const hasPermission = await window.AndroidPermissions.requestLocationPermission();
                if (!hasPermission) {
                    console.error('Android位置權限被拒絕');
                    showNotification('❌ 位置權限被拒絕，請在設定中允許位置權限', 'error');
                    reject(new Error('位置權限被拒絕'));
                    return;
                }
                
                // 使用Android地理位置API
                window.AndroidGeolocation.getCurrentPosition(
                    {
                        enableHighAccuracy: enableHighAccuracy,
                        timeout: locationTimeout,
                        maximumAge: 5000
                    }
                ).then(position => {
                    console.log('Android定位成功！', position);
                    currentPosition = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                        accuracy: position.coords.accuracy
                    };
                    updateLocationDisplay();
                    updateCurrentLocationMarker();
                    map.setView([currentPosition.lat, currentPosition.lng], 18);
                    
                    // 顯示定位精度信息
                    if (position.coords.accuracy) {
                        showNotification(`🎯 定位成功！精度: ±${Math.round(position.coords.accuracy)}公尺`, 'success');
                    } else {
                        showNotification('🎯 定位成功！', 'success');
                    }
                    
                    resolve(position);
                }).catch(error => {
                    console.error('Android定位失敗:', error);
                    handleLocationError(error, reject);
                });
                
                return;
            } catch (error) {
                console.error('Android權限請求失敗:', error);
                // 如果Android權限失敗，回退到標準API
            }
        }
        
        // 檢查是否為HTTPS或localhost
        const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname === '::1';
        if (location.protocol === 'file:') {
            console.warn('目前以本機檔案方式開啟，瀏覽器可能拒絕定位');
            showNotification('提示：請以「localhost」或 HTTPS 啟動本地伺服器以使用定位功能', 'warning');
        }
        if (!isSecure) {
            console.warn('警告：非安全連線可能影響定位功能');
            showNotification('提示：建議使用HTTPS以獲得更好的定位體驗', 'warning');
        }
        
        if ('geolocation' in navigator) {
        console.log('瀏覽器支援地理位置功能，正在請求位置...');
        navigator.geolocation.getCurrentPosition(
            function(position) {
                console.log('定位成功！', position);
                currentPosition = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy
                };
                updateLocationDisplay();
                updateCurrentLocationMarker();
                map.setView([currentPosition.lat, currentPosition.lng], 18);
                
                // 顯示定位精度信息
                if (position.coords.accuracy) {
                    showNotification(`🎯 定位成功！精度: ±${Math.round(position.coords.accuracy)}公尺`, 'success');
                } else {
                    showNotification('🎯 定位成功！', 'success');
                }
                
                resolve(position);
            },
            function(error) {
                console.warn('getCurrentPosition 失敗，嘗試 watchPosition 回退');
                try {
                    let watchId = null;
                    const stopWatch = () => {
                        if (watchId !== null) {
                            navigator.geolocation.clearWatch(watchId);
                            watchId = null;
                        }
                    };
                    let timeoutTimer = setTimeout(() => {
                        stopWatch();
                        handleLocationError(error, reject);
                    }, 15000);
                    watchId = navigator.geolocation.watchPosition(
                        function(pos) {
                            clearTimeout(timeoutTimer);
                            stopWatch();
                            console.log('watchPosition 成功', pos);
                            currentPosition = {
                                lat: pos.coords.latitude,
                                lng: pos.coords.longitude,
                                accuracy: pos.coords.accuracy
                            };
                            updateLocationDisplay();
                            updateCurrentLocationMarker();
                            map.setView([currentPosition.lat, currentPosition.lng], 18);
                            if (pos.coords.accuracy) {
                                showNotification(`🎯 定位成功！精度: ±${Math.round(pos.coords.accuracy)}公尺`, 'success');
                            } else {
                                showNotification('🎯 定位成功！', 'success');
                            }
                            resolve(pos);
                        },
                        function(err) {
                            clearTimeout(timeoutTimer);
                            stopWatch();
                            handleLocationError(err, reject);
                        },
                        {
                            enableHighAccuracy: true,
                            maximumAge: 0
                        }
                    );
                } catch (e) {
                    handleLocationError(error, reject);
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 30000
            }
        );
        } else {
            showNotification('您的瀏覽器不支援地理位置功能', 'error');
            reject(new Error('瀏覽器不支援地理位置功能'));
        }
    });
}

function handleLocationError(error, reject) {
    console.error('無法獲取位置:', error);
    console.log('錯誤詳情 - 代碼:', error.code, '訊息:', error.message);
    let errorMessage = '無法獲取您的位置';
    let detailedMessage = '';
    
    switch(error.code) {
        case error.PERMISSION_DENIED:
            errorMessage = '位置權限被拒絕';
            detailedMessage = '請點擊瀏覽器地址欄的鎖頭圖標，將位置權限設為"允許"，然後重新整理頁面';
            break;
        case error.POSITION_UNAVAILABLE:
            errorMessage = '位置信息不可用';
            detailedMessage = '請確認設備的位置服務已開啟，並檢查網路連線';
            break;
        case error.TIMEOUT:
            errorMessage = '定位請求超時';
            detailedMessage = '定位時間過長，請檢查網路連線或稍後再試';
            break;
        default:
            detailedMessage = '請檢查瀏覽器權限設定和設備位置服務';
    }
    
    showNotification(errorMessage + '。' + detailedMessage, 'warning');
    
    // 立即設定為預設位置（台北市中心）
    const defaultLat = 25.0330;
    const defaultLng = 121.5654;
    map.setView([defaultLat, defaultLng], 16);
    showNotification('已自動設定為台北市中心。您可以點擊地圖來添加標記。', 'info');
    
    reject(error);
}

function requestNotificationPermission() {
    if ('Notification' in window) {
        // 檢查當前權限狀態
        if (Notification.permission === 'granted') {
            showNotification('通知權限已啟用');
            // 同時請求背景通知權限
            if (typeof AndroidDevice !== 'undefined' && AndroidDevice.requestBackgroundNotificationPermission) {
                AndroidDevice.requestBackgroundNotificationPermission();
            }
            return Promise.resolve('granted');
        } else if (Notification.permission === 'denied') {
            showNotification('通知權限被拒絕，請在瀏覽器設定中手動啟用', 'warning');
            return Promise.resolve('denied');
        } else {
            // 請求權限
            return Notification.requestPermission().then(function(permission) {
                if (permission === 'granted') {
                    showNotification('通知權限已啟用');
                    // 註冊Service Worker推送通知
                    registerPushNotification();
                    // 請求背景通知權限
                    if (typeof AndroidDevice !== 'undefined' && AndroidDevice.requestBackgroundNotificationPermission) {
                        AndroidDevice.requestBackgroundNotificationPermission();
                    }
                } else {
                    showNotification('通知權限被拒絕，部分功能可能無法正常使用', 'warning');
                }
                return permission;
            });
        }
    } else {
        // 對於Android環境，直接使用AndroidDevice
        if (typeof AndroidDevice !== 'undefined' && AndroidDevice.requestBackgroundNotificationPermission) {
            AndroidDevice.requestBackgroundNotificationPermission();
        }
        showNotification('您的瀏覽器不支援通知功能', 'error');
        return Promise.resolve('unsupported');
    }
}

// 註冊推送通知
function registerPushNotification() {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        navigator.serviceWorker.ready.then(function(registration) {
            // 檢查是否已經訂閱
            return registration.pushManager.getSubscription();
        }).then(function(subscription) {
            if (!subscription) {
                // 如果沒有訂閱，創建新的訂閱
                console.log('Push notification ready for mobile devices');
            }
        }).catch(function(error) {
            console.log('Push notification setup failed:', error);
        });
    }
}

// 顯示初始設定彈窗
function showInitialSetup() {
    const modal = document.getElementById('initialSetupModal');
    const defaultGroupSelect = document.getElementById('defaultGroupSelect');
    
    // 填充現有組別到選擇器
    updateDefaultGroupSelect();
    
    // 確保modal在全螢幕模式下也能正確顯示
    modal.style.display = 'block';
    
    // 如果處於全螢幕模式，確保modal在正確的容器中
    if (isFullscreen) {
        const fullscreenContainer = document.querySelector('.map-container.fullscreen');
        if (fullscreenContainer) {
            // 強制將modal移到全螢幕容器中
            fullscreenContainer.appendChild(modal);
            
            // 確保modal的樣式正確
            setTimeout(() => {
                modal.style.position = 'fixed';
                modal.style.zIndex = '15000'; /* 提高z-index確保模態框正確顯示 */
                modal.style.left = '0';
                modal.style.top = '0';
                modal.style.width = '100vw';
                modal.style.height = '100vh';
            }, 10);
        }
    }
}

// 更新預設組別選擇器
function updateDefaultGroupSelect() {
    const select = document.getElementById('defaultGroupSelect');
    select.innerHTML = '<option value="">不選擇預設組別</option>';
    
    groups.forEach(group => {
        const option = document.createElement('option');
        option.value = group.id;
        option.textContent = group.name;
        select.appendChild(option);
    });
}

// 處理初始設定完成
function handleInitialSetup() {
    const defaultGroupId = document.getElementById('defaultGroupSelect').value;
    const alertDistanceValue = document.getElementById('setupAlertDistance').value;
    const alertIntervalValue = document.getElementById('setupAlertInterval').value;
    const enableLocation = document.getElementById('setupEnableLocation').checked;
    const enableNotifications = document.getElementById('setupEnableNotifications').checked;
    
    // 保存設定
    alertDistance = parseInt(alertDistanceValue);
    alertInterval = parseInt(alertIntervalValue);
    
    // 更新UI中的設定值
    const alertDistanceEl = getSettingsElement('alertDistance');
    const alertIntervalEl = getSettingsElement('alertInterval');
    const enableNotificationsEl = getSettingsElement('enableNotifications');
    
    if (alertDistanceEl) alertDistanceEl.value = alertDistance;
    if (alertIntervalEl) alertIntervalEl.value = alertInterval;
    if (enableNotificationsEl) enableNotificationsEl.checked = enableNotifications;
    
    // 設定預設組別
    if (defaultGroupId) {
        currentGroup = groups.find(g => g.id === defaultGroupId);
        updateGroupsList();
    }
    
    // 標記已經看過設定
    try { appStorageSet('hasSeenSetup', true); } catch (e) {}
    
    // 關閉彈窗
    document.getElementById('initialSetupModal').style.display = 'none';
    
    // 請求權限（位置權限已在initializeApp中調用）
    const permissionPromises = [];
    
    if (enableNotifications) {
        permissionPromises.push(requestNotificationPermission());
    }
    
    // 等待所有權限請求完成
    Promise.all(permissionPromises).then(() => {
        if (enableNotifications && Notification.permission === 'granted') {
            showNotification('🎉 所有權限設定完成！您現在可以接收位置提醒了', 'success');
        } else if (enableLocation) {
            showNotification('✅ 位置權限已設定，您可以開始使用地圖功能', 'success');
        }
    }).catch((error) => {
        console.log('Permission setup error:', error);
        showNotification('⚠️ 部分權限設定失敗，您可以稍後在設定中重新啟用', 'warning');
    });
    
    saveData();
}

// 跳過初始設定
function skipInitialSetup() {
    try { appStorageSet('hasSeenSetup', true); } catch (e) {}
    document.getElementById('initialSetupModal').style.display = 'none';
    requestLocationPermission();
    requestNotificationPermission();
}

// 顯示建立組別彈窗
function showCreateGroupModal() {
    document.getElementById('createGroupModal').style.display = 'block';
}

// 處理建立新組別
function handleCreateGroup(event) {
    event.preventDefault();
    
    const name = document.getElementById('newGroupName').value.trim();
    const description = document.getElementById('newGroupDescription').value.trim();
    
    if (!name) return;
    
    const newGroup = new Group(name, description);
    groups.push(newGroup);
    
    // 更新預設組別選擇器
    updateDefaultGroupSelect();
    
    // 清空表單
    document.getElementById('newGroupName').value = '';
    document.getElementById('newGroupDescription').value = '';
    
    // 關閉彈窗
    document.getElementById('createGroupModal').style.display = 'none';
    
    saveData();
}

// 更新當前位置標記
// 統一的地圖居中函數
function centerMapToCurrentPosition(forceCenter = false, zoomLevel = null) {
    if (!currentPosition) return;
    
    // 如果強制居中或者啟用了自動居中功能
    if (forceCenter || keepMapCentered) {
        const currentZoom = zoomLevel || map.getZoom();
        const disp = getMapDisplayCoord(currentPosition.lat, currentPosition.lng);
        map.setView([disp.lat, disp.lng], currentZoom);
    }
}

function updateCurrentLocationMarker() {
    if (!currentPosition) return;
    
    // 移除舊的位置標記
    if (currentLocationMarker) {
        map.removeLayer(currentLocationMarker);
    }
    
    // 創建新的位置標記
    const disp = getMapDisplayCoord(currentPosition.lat, currentPosition.lng);
    currentLocationMarker = L.marker([disp.lat, disp.lng], {
        icon: createCurrentLocationIcon(),
        zIndexOffset: 1000 // 確保當前位置標記在最上層
    }).addTo(map);
    
    // 添加彈出視窗
    currentLocationMarker.bindPopup(`
        <div class="current-location-popup">
            <strong>📍 您的當前位置</strong><br>
            緯度: ${disp.lat.toFixed(6)}<br>
            經度: ${disp.lng.toFixed(6)}<br>
            <small>點擊地圖其他位置可添加標註</small>
        </div>
    `);
    
    // 使用統一的居中函數
    centerMapToCurrentPosition();
}

// 組別管理功能
function addGroup() {
    const groupNameInput = document.getElementById('groupNameInput');
    const groupName = groupNameInput.value.trim();
    
    if (!groupName) {
        showNotification('請輸入組別名稱', 'warning');
        return;
    }
    
    const group = new Group(Date.now().toString(), groupName);
    groups.push(group);
    groupNameInput.value = '';
    
    updateGroupsList();
    saveData();
    showNotification(`組別 "${groupName}" 已建立`);
}

function deleteGroup(groupId) {
    if (confirm('確定要刪除此組別嗎？這將同時刪除所有相關的標註點。')) {
        // 刪除地圖上的標記
        const group = groups.find(g => g.id === groupId);
        if (group) {
            group.markers.forEach(marker => {
                if (marker.leafletMarker) {
                    map.removeLayer(marker.leafletMarker);
                }
            });
            
            // 刪除子群組的標記
            group.subgroups.forEach(subgroup => {
                subgroup.markers.forEach(marker => {
                    if (marker.leafletMarker) {
                        map.removeLayer(marker.leafletMarker);
                    }
                });
            });
        }
        
        groups = groups.filter(g => g.id !== groupId);
        markers = markers.filter(m => m.groupId !== groupId);
        
        updateGroupsList();
        updateMarkersList();
        saveData();
        showNotification('組別已刪除');
    }
}

function addSubgroup(groupId) {
    const subgroupName = prompt('請輸入群組名稱:');
    if (!subgroupName) return;
    
    const group = groups.find(g => g.id === groupId);
    if (group) {
        const subgroup = new Subgroup(Date.now().toString(), subgroupName, groupId);
        group.addSubgroup(subgroup);
        
        updateGroupsList();
        saveData();
        showNotification(`群組 "${subgroupName}" 已建立`);
    }
}

function deleteSubgroup(groupId, subgroupId) {
    if (confirm('確定要刪除此群組嗎？這將同時刪除所有相關的標註點。')) {
        const group = groups.find(g => g.id === groupId);
        if (group) {
            const subgroup = group.subgroups.find(sg => sg.id === subgroupId);
            if (subgroup) {
                // 刪除地圖上的標記
                subgroup.markers.forEach(marker => {
                    if (marker.leafletMarker) {
                        map.removeLayer(marker.leafletMarker);
                    }
                });
            }
            
            group.removeSubgroup(subgroupId);
            markers = markers.filter(m => m.subgroupId !== subgroupId);
        }
        
        updateGroupsList();
        updateMarkersList();
        saveData();
        showNotification('群組已刪除');
    }
}

function selectGroup(groupId, subgroupId = null) {
    // 找到對應的組別對象
    if (groupId === null) {
        currentGroup = null;
        currentSubgroup = null;
        clearFilter(); // 清除過濾條件，顯示所有標記
    } else {
        currentGroup = groups.find(g => g.id === groupId) || null;
        
        // 找到對應的子群組對象
        if (subgroupId && currentGroup) {
            currentSubgroup = currentGroup.subgroups.find(sg => sg.id === subgroupId) || null;
            setFilter('subgroup', subgroupId); // 設定子群組過濾
        } else {
            currentSubgroup = null;
            setFilter('group', groupId); // 設定群組過濾
        }
    }
    
    // 更新UI顯示
    document.querySelectorAll('.group-item').forEach(item => {
        item.classList.remove('active');
    });
    // 確保子群組也只保留唯一 active
    document.querySelectorAll('.subgroup-item').forEach(item => {
        item.classList.remove('active');
    });
    
    if (groupId === null) {
        // 顯示所有標註點時，激活第一個選項
        document.querySelector('.group-item')?.classList.add('active');
    } else if (subgroupId) {
        document.querySelector(`[data-subgroup-id="${subgroupId}"]`)?.classList.add('active');
    } else {
        document.querySelector(`[data-group-id="${groupId}"]`)?.classList.add('active');
    }
    
    updateMarkersList();
}

// 編輯組別名稱
function editGroupName(groupId) {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    
    const newName = prompt('請輸入新的組別名稱：', group.name);
    if (newName && newName.trim() && newName.trim() !== group.name) {
        group.name = newName.trim();
        updateGroupsList();
        updateMarkersList();
        saveData();
        showNotification('組別名稱已更新', 'success');
    }
}

// 編輯子群組名稱
function editSubgroupName(groupId, subgroupId) {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    
    const subgroup = group.subgroups.find(sg => sg.id === subgroupId);
    if (!subgroup) return;
    
    const newName = prompt('請輸入新的群組名稱：', subgroup.name);
    if (newName && newName.trim() && newName.trim() !== subgroup.name) {
        subgroup.name = newName.trim();
        updateGroupsList();
        updateMarkersList();
        saveData();
        showNotification('群組名稱已更新', 'success');
    }
}

// 標註功能
function toggleAddMarkerMode() {
    isAddingMarker = !isAddingMarker;
    const btn = document.getElementById('addMarkerBtn');
    
    if (isAddingMarker) {
        btn.classList.add('active');
        btn.innerHTML = '<span>+</span>';
        map.getContainer().style.cursor = 'crosshair';
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '<span>+</span>';
        map.getContainer().style.cursor = '';
    }
}

function showMarkerModal(lat, lng, existingMarker = null) {
    const modal = document.getElementById('markerModal');
    const form = document.getElementById('markerForm');
    const groupSelect = document.getElementById('markerGroup');
    const subgroupSelect = document.getElementById('markerSubgroup');
    
    // 清空並填充組別選項
    groupSelect.innerHTML = '<option value="">選擇組別</option>';
    groups.forEach(group => {
        const option = document.createElement('option');
        option.value = group.id;
        option.textContent = group.name;
        groupSelect.appendChild(option);
    });
    
    // 組別變更時更新子群組選項
    groupSelect.addEventListener('change', function() {
        updateSubgroupOptions(this.value);
    });
    
    if (existingMarker) {
        // 編輯現有標記
        document.getElementById('markerName').value = existingMarker.name;
        document.getElementById('markerDescription').value = existingMarker.description;
        groupSelect.value = existingMarker.groupId;
        updateSubgroupOptions(existingMarker.groupId);
        subgroupSelect.value = existingMarker.subgroupId || '';
        
        // 設定顏色和圖案
        const colorRadio = document.querySelector(`input[name="markerColor"][value="${existingMarker.color || 'red'}"]`);
        if (colorRadio) colorRadio.checked = true;
        
        const iconRadio = document.querySelector(`input[name="markerIcon"][value="${existingMarker.icon || '📍'}"]`);
        if (iconRadio) iconRadio.checked = true;
        
        // 處理圖片顯示
        if (existingMarker.imageData) {
            let imageData = existingMarker.imageData;
            
            // 如果是字符串，嘗試解析為數組
            if (typeof imageData === 'string') {
                try {
                    imageData = JSON.parse(imageData);
                } catch (e) {
                    // 如果解析失敗，轉換為數組格式
                    imageData = [imageData];
                }
            }
            
            // 確保是數組格式
            if (!Array.isArray(imageData)) {
                imageData = [imageData];
            }
            
            // 設置表單數據並顯示預覽
            form.dataset.imageData = JSON.stringify(imageData);
            displayMultipleImagePreviews(imageData);
        } else {
            resetImageUpload();
        }
        
        document.getElementById('deleteMarkerBtn').style.display = 'block';
        
        form.dataset.markerId = existingMarker.id;
    } else {
        // 新增標記
        form.reset();
        resetImageUpload();
        document.getElementById('deleteMarkerBtn').style.display = 'none';
        
        // 如果有選定的組別，自動設定為默認值
        if (currentGroup) {
            groupSelect.value = currentGroup.id;
            updateSubgroupOptions(currentGroup.id);
            
            // 如果有選定的子群組，也自動設定
            if (currentSubgroup) {
                subgroupSelect.value = currentSubgroup.id;
            }
        } else {
            updateSubgroupOptions('');
        }
        
        form.dataset.lat = lat;
        form.dataset.lng = lng;
        delete form.dataset.markerId;
    }
    
    // 確保modal在全螢幕模式下也能正確顯示
    modal.style.display = 'block';
    
    // 如果處於全螢幕模式，確保modal在正確的容器中並強制設定樣式
    if (isFullscreen) {
        const fullscreenContainer = document.querySelector('.map-container.fullscreen');
        if (fullscreenContainer) {
            // 強制將modal移到全螢幕容器中
            fullscreenContainer.appendChild(modal);
            
            // 延遲設定樣式確保正確顯示
            setTimeout(() => {
                modal.style.position = 'fixed';
                modal.style.zIndex = '15000'; /* 提高z-index確保模態框正確顯示 */
                modal.style.left = '0';
                modal.style.top = '0';
                modal.style.width = '100vw';
                modal.style.height = '100vh';
                modal.style.display = 'block';
            }, 10);
        }
    }
}

function updateSubgroupOptions(groupId) {
    const subgroupSelect = document.getElementById('markerSubgroup');
    subgroupSelect.innerHTML = '<option value="">選擇群組（可選）</option>';
    
    if (groupId) {
        const group = groups.find(g => g.id === groupId);
        if (group) {
            group.subgroups.forEach(subgroup => {
                const option = document.createElement('option');
                option.value = subgroup.id;
                option.textContent = subgroup.name;
                subgroupSelect.appendChild(option);
            });
        }
    }
}

function saveMarker(e) {
    e.preventDefault();
    
    const form = e.target;
    const name = document.getElementById('markerName').value.trim();
    const description = document.getElementById('markerDescription').value.trim();
    const groupId = document.getElementById('markerGroup').value;
    const subgroupId = document.getElementById('markerSubgroup').value || null;
    const color = document.querySelector('input[name="markerColor"]:checked').value;
    const icon = document.querySelector('input[name="markerIcon"]:checked').value;
    // 获取图片数据，支持多张图片
    let imageData = form.dataset.imageData || null;
    if (imageData) {
        try {
            // 尝试解析为数组
            imageData = JSON.parse(imageData);
        } catch (e) {
            // 如果解析失败，保持原始格式（兼容旧数据）
            console.log('Image data is not JSON format, keeping as string');
        }
    }
    
    if (!name) {
        showNotification('請填寫標記名稱', 'warning');
        return;
    }
    
    let group;
    if (!groupId) {
        // 如果沒有選擇組別，創建默認組別
        if (groups.length === 0) {
            const defaultGroup = new Group('default', '默認組別');
            groups.push(defaultGroup);
            updateGroupsList();
            showNotification('已自動創建默認組別', 'info');
        }
        group = groups[0];
        document.getElementById('markerGroup').value = group.id;
    } else {
        group = groups.find(g => g.id === groupId);
        if (!group) {
            showNotification('選擇的組別不存在', 'error');
            return;
        }
    }
    
    if (form.dataset.markerId) {
        // 編輯現有標記
        const markerId = form.dataset.markerId;
        const marker = markers.find(m => m.id === markerId);
        
        if (marker) {
            // 從舊的組別/群組中移除
            const oldGroup = groups.find(g => g.id === marker.groupId);
            if (oldGroup) {
                oldGroup.removeMarker(markerId);
                if (marker.subgroupId) {
                    const oldSubgroup = oldGroup.subgroups.find(sg => sg.id === marker.subgroupId);
                    if (oldSubgroup) {
                        oldSubgroup.removeMarker(markerId);
                    }
                }
            }
            
            // 更新標記資訊
            marker.name = name;
            marker.description = description;
            marker.groupId = groupId;
            marker.subgroupId = subgroupId;
            marker.color = color;
            marker.icon = icon;
            marker.imageData = imageData;
            
            // 添加到新的組別/群組
            group.addMarker(marker);
            if (subgroupId) {
                const subgroup = group.subgroups.find(sg => sg.id === subgroupId);
                if (subgroup) {
                    subgroup.addMarker(marker);
                }
            }
            
            // 更新地圖標記
            if (marker.leafletMarker) {
                // 移除舊標記
                map.removeLayer(marker.leafletMarker);
                
                // 重新添加標記到地圖
                addMarkerToMap(marker);
            }
        }
    } else {
        // 新增標記
        const lat = parseFloat(form.dataset.lat);
        const lng = parseFloat(form.dataset.lng);
        
        const marker = new Marker(
            Date.now().toString(),
            name,
            description,
            lat,
            lng,
            group.id,
            subgroupId,
            color,
            icon,
            imageData
        );
        
        markers.push(marker);
        group.addMarker(marker);
        
        if (subgroupId) {
            const subgroup = group.subgroups.find(sg => sg.id === subgroupId);
            if (subgroup) {
                subgroup.addMarker(marker);
            }
        }
        
        // 在地圖上添加標記
        addMarkerToMap(marker);
    }
    
    updateMarkersList();
    updateGroupsList();
    saveData();
    
    // 關閉浮動視窗 - 確保在全螢幕模式下也能正確關閉
    const modal = document.getElementById('markerModal');
    
    // 如果modal在全螢幕容器中，將其移回body
    const fullscreenContainer = document.querySelector('.map-container.fullscreen');
    if (fullscreenContainer && fullscreenContainer.contains(modal)) {
        document.body.appendChild(modal);
    }
    modal.style.display = 'none';
    
    // 關閉標註模式
    isAddingMarker = false;
    const btn = document.getElementById('addMarkerBtn');
    btn.classList.remove('active');
    btn.innerHTML = '<span>+</span>';
    map.getContainer().style.cursor = '';
    
    // 顯示提示並自動關閉
    const notification = document.createElement('div');
    notification.className = 'notification success';
    notification.textContent = '標記已保存';
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 2000); // 2秒後自動關閉
}

function addMarkerToMap(marker) {
    // 如果已經有 leaflet 標記，先移除
    if (marker.leafletMarker) {
        map.removeLayer(marker.leafletMarker);
        marker.leafletMarker = null;
    }
    
    // 創建自定義圖標
    const customIcon = createCustomMarkerIcon(marker.color || 'red', marker.icon || '📍');
    const disp = getMapDisplayCoord(marker.lat, marker.lng);
    const leafletMarker = L.marker([disp.lat, disp.lng], { icon: customIcon }).addTo(map);
    
    // 添加點擊事件，包含按壓效果和關閉浮動設定視窗
    leafletMarker.on('click', function(e) {
        // 添加按壓效果 - 觸覺反饋
        if ('vibrate' in navigator) {
            navigator.vibrate(50); // 短暫振動50毫秒
        }
        
        // 添加視覺按壓效果到標記圖標
        if (leafletMarker._icon) {
            const icon = leafletMarker._icon;
            
            // 添加按壓動畫類別
            icon.classList.add('marker-press-animation');
            
            // 移除動畫類別
            setTimeout(() => {
                icon.classList.remove('marker-press-animation');
            }, 300);
        }
        
        // 關閉浮動設定視窗
        hideFloatingSettings();
        
        // 阻止事件冒泡，避免觸發地圖點擊事件
        e.originalEvent.stopPropagation();
    });
    
    marker.leafletMarker = leafletMarker;
    
    // 使用統一的popup更新函數
    updateMarkerPopup(marker);

    // 綁定長按動作：顯示移動/刪除選單
    attachLongPressHandlers(marker);
}

// 綁定標註點圖示的長按事件（滑鼠/觸控）
function attachLongPressHandlers(marker) {
    const leafletMarker = marker.leafletMarker;
    if (!leafletMarker || !leafletMarker._icon) return;
    const iconEl = leafletMarker._icon;
    const LONG_PRESS_MS = 600;
    let timer = null;
    let startX = 0, startY = 0;
    let longPressTriggered = false;

    const start = (ev) => {
        const e = ev.touches ? ev.touches[0] : ev;
        startX = e.clientX;
        startY = e.clientY;
        longPressTriggered = false;
        iconEl.dataset.longPressTriggered = '0';
        timer = setTimeout(() => {
            longPressTriggered = true;
            iconEl.dataset.longPressTriggered = '1';
            // 觸覺反饋
            if ('vibrate' in navigator) {
                navigator.vibrate(30);
            }
            showMarkerActionMenu(marker, iconEl);
        }, LONG_PRESS_MS);
    };

    const move = (ev) => {
        if (!timer) return;
        const e = ev.touches ? ev.touches[0] : ev;
        const dx = Math.abs(e.clientX - startX);
        const dy = Math.abs(e.clientY - startY);
        // 若移動超過閾值，視為拖曳地圖，不觸發長按
        if (dx + dy > 10) {
            clearTimeout(timer);
            timer = null;
        }
    };

    const cancel = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        // 重置避免阻擋點擊
        setTimeout(() => { iconEl.dataset.longPressTriggered = '0'; }, 0);
    };

    // 阻擋長按後的點擊開啟彈窗（避免雙重行為）
    const clickBlocker = (e) => {
        if (iconEl.dataset.longPressTriggered === '1' || longPressTriggered) {
            e.preventDefault();
            e.stopPropagation();
            longPressTriggered = false;
            iconEl.dataset.longPressTriggered = '0';
        }
    };

    iconEl.addEventListener('mousedown', start);
    iconEl.addEventListener('touchstart', start, { passive: false });
    iconEl.addEventListener('mousemove', move);
    iconEl.addEventListener('touchmove', move, { passive: false });
    iconEl.addEventListener('mouseup', cancel);
    iconEl.addEventListener('mouseleave', cancel);
    iconEl.addEventListener('touchend', cancel);
    iconEl.addEventListener('click', clickBlocker, true);
    iconEl.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); }, true);
}

// 顯示標註點的操作選單（移動 / 刪除）
function showMarkerActionMenu(marker, iconEl) {
    const rect = iconEl.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'marker-action-menu';
    menu.style.cssText = `
        position: fixed;
        top: ${Math.max(8, rect.top - 6)}px;
        left: ${Math.min(window.innerWidth - 160, rect.left + rect.width + 8)}px;
        z-index: 10000;
        background: #fff;
        border: 1px solid #ddd;
        box-shadow: 0 8px 18px rgba(0,0,0,0.18);
        border-radius: 10px;
        padding: 8px;
        display: flex;
        gap: 8px;
    `;

    const moveBtn = document.createElement('button');
    moveBtn.textContent = '移動';
    moveBtn.style.cssText = `
        padding: 6px 10px;
        border: none;
        border-radius: 8px;
        background: #4CAF50;
        color: #fff;
        font-size: 12px;
        cursor: pointer;
    `;
    moveBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (menu.parentNode) menu.parentNode.removeChild(menu);
        startMarkerDrag(marker);
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '刪除';
    deleteBtn.style.cssText = `
        padding: 6px 10px;
        border: none;
        border-radius: 8px;
        background: #f44336;
        color: #fff;
        font-size: 12px;
        cursor: pointer;
    `;
    deleteBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (menu.parentNode) menu.parentNode.removeChild(menu);
        confirmDeleteMarker(marker.id);
    };

    menu.appendChild(moveBtn);
    menu.appendChild(deleteBtn);
    document.body.appendChild(menu);

    // 點擊外部關閉
    const onOutsidePointer = (ev) => {
        if (!menu.contains(ev.target) && ev.target !== iconEl) {
            if (menu.parentNode) menu.parentNode.removeChild(menu);
            window.removeEventListener('pointerdown', onOutsidePointer, true);
        }
    };
    setTimeout(() => window.addEventListener('pointerdown', onOutsidePointer, true), 150);
}

function startMarkerDrag(marker) {
    if (!marker.leafletMarker) return;
    const mk = marker.leafletMarker;
    try { mk.dragging.enable(); } catch (e) {}
    showNotification('🖐️ 拖動標註到新位置，放開後自動儲存', 'info');
    mk.once('dragend', () => {
        const pos = mk.getLatLng();
        const actual = getMapActualCoord(pos.lat, pos.lng);
        marker.lat = actual.lat;
        marker.lng = actual.lng;
        // 儲存與刷新
        saveData();
        updateMarkersList();
        updateGroupsList();
        updateMarkerPopup(marker);
        try { mk.dragging.disable(); } catch (e) {}
        showNotification('✅ 標註點已移動', 'success');
    });
}

function confirmDeleteMarker(markerId) {
    // 簡單確認提示（未使用瀏覽器 confirm 以維持一致 UI）
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 10001;
        background: rgba(0,0,0,0.15);
        display: flex; align-items: center; justify-content: center;
    `;
    const box = document.createElement('div');
    box.style.cssText = `
        background: #fff; border-radius: 12px; padding: 12px; min-width: 220px;
        box-shadow: 0 10px 24px rgba(0,0,0,0.2);
    `;
    box.innerHTML = `
        <div style="font-size:14px; margin-bottom:10px; color:#2d3748;">
            🗑️ 確定要刪除這個標註點嗎？
        </div>
        <div style="display:flex; gap:8px; justify-content:flex-end;">
            <button id="confirmDelYes" style="padding:6px 10px; border:none; border-radius:8px; background:#f44336; color:#fff; font-size:12px; cursor:pointer;">刪除</button>
            <button id="confirmDelNo" style="padding:6px 10px; border:none; border-radius:8px; background:#e2e8f0; color:#4a5568; font-size:12px; cursor:pointer;">取消</button>
        </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const cleanup = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
    box.querySelector('#confirmDelYes').onclick = (e) => { e.preventDefault(); e.stopPropagation(); cleanup(); deleteMarkerById(markerId); };
    box.querySelector('#confirmDelNo').onclick = (e) => { e.preventDefault(); e.stopPropagation(); cleanup(); };
}

function deleteMarkerById(markerId) {
    const marker = markers.find(m => m.id === markerId);
    if (!marker) return;

    // 從地圖移除並清理引用
    if (marker.leafletMarker) {
        map.removeLayer(marker.leafletMarker);
        marker.leafletMarker = null;
    }

    // 從組別/群組移除
    const group = groups.find(g => g.id === marker.groupId);
    if (group) {
        group.removeMarker(markerId);
        if (marker.subgroupId) {
            const subgroup = group.subgroups.find(sg => sg.id === marker.subgroupId);
            if (subgroup) {
                subgroup.removeMarker(markerId);
            }
        }
    }

    // 從全域陣列移除
    markers = markers.filter(m => m.id !== markerId);

    updateMarkersList();
    updateGroupsList();
    updateMapMarkers();
    saveData();
    showNotification('🗑️ 標註點已刪除', 'success');
}

function editMarker(markerId) {
    const marker = markers.find(m => m.id === markerId);
    if (marker) {
        closeGroupDetailsModal();
        showMarkerModal(marker.lat, marker.lng, marker);
    }
}

function setTrackingTarget(markerId) {
    const marker = markers.find(m => m.id === markerId);
    if (marker) {
        // 清除之前的追蹤目標提醒
        if (trackingTarget) {
            stopRepeatedAlert(trackingTarget.id);
            // 清除之前追蹤目標的群組按鈕效果
            clearGroupButtonHighlight();
            // 停止之前的路線記錄
            stopRouteRecording();
        }
        
        trackingTarget = marker;
        showNotification(`已設定 "${marker.name}" 為追蹤目標`);
        
        // 立即為相關群組按鈕添加追蹤圖標
        showGroupTrackingIcon(marker.groupId, marker.subgroupId);
        
        // 顯示路徑線和距離資訊
        if (currentPosition) {
            showRouteLine();
        }
        
        // 開始路線記錄
        if (currentPosition) {
            startRouteRecording(marker);
        }
        
        // 如果正在追蹤位置，開始距離檢查定時器
        if (isTracking && currentPosition) {
            startProximityCheck();
        }
        
        // 重新渲染所有標記的popup以更新按鈕狀態
        refreshAllMarkerPopups();
        
        // 更新標註點列表以顯示追蹤目標的醒目樣式
        updateMarkersList();
    }
}

// 設置追蹤目標但不記錄新路線（用於導航模式）
function setTrackingTargetForNavigation(markerId) {
    const marker = markers.find(m => m.id === markerId);
    if (marker) {
        // 清除之前的追蹤目標提醒
        if (trackingTarget) {
            stopRepeatedAlert(trackingTarget.id);
            // 清除之前追蹤目標的群組按鈕效果
            clearGroupButtonHighlight();
            // 停止之前的路線記錄
            stopRouteRecording();
        }
        
        trackingTarget = marker;
        showNotification(`已設定 "${marker.name}" 為導航目標`);
        
        // 立即為相關群組按鈕添加追蹤圖標
        showGroupTrackingIcon(marker.groupId, marker.subgroupId);
        
        // 顯示路徑線和距離資訊
        if (currentPosition) {
            showRouteLine();
        }
        
        // 注意：這裡不開始路線記錄，因為是導航模式
        
        // 如果正在追蹤位置，開始距離檢查定時器
        if (isTracking && currentPosition) {
            startProximityCheck();
        }
        
        // 重新渲染所有標記的popup以更新按鈕狀態
        refreshAllMarkerPopups();
        
        // 更新標註點列表以顯示追蹤目標的醒目樣式
        updateMarkersList();
    }
}

function clearTrackingTarget() {
    if (trackingTarget) {
        const targetName = trackingTarget.name;
        const targetId = trackingTarget.id;
        
        // 停止重複提醒
        stopRepeatedAlert(trackingTarget.id);
        
        // 立即清除所有群組按鈕效果
        clearGroupButtonHighlight();
        
        // 停止路線記錄並保存
        stopRouteRecording();
        
        // 隱藏所有顯示的路線記錄
        hideAllDisplayedRoutes(targetId);
        
        // 清除追蹤目標
        trackingTarget = null;
        
        // 清除路徑線和距離資訊
        clearRouteLine();
        
        // 顯示通知
        showNotification(`已取消追蹤 "${targetName}"`);
        
        // 重新渲染所有標記的popup以更新按鈕狀態
        refreshAllMarkerPopups();
        
        // 更新標註點列表以移除追蹤目標的醒目樣式
        updateMarkersList();
    }
}

function refreshAllMarkerPopups() {
    markers.forEach(marker => {
        if (marker.leafletMarker) {
            updateMarkerPopup(marker);
        }
    });
}

function updateMarkerPopup(marker) {
    const groupName = marker.groupId ? (groups.find(g => g.id === marker.groupId)?.name || '未知群組') : '無群組';
    const subgroupName = marker.subgroupId ? 
        (groups.find(g => g.id === marker.groupId)?.subgroups.find(sg => sg.id === marker.subgroupId)?.name || '未知子群組') : 
        '無子群組';
    
    // 計算距離顯示
    let distanceDisplay = '';
    if (currentPosition) {
        const distance = calculateDistance(
            currentPosition.lat, 
            currentPosition.lng, 
            marker.lat, 
            marker.lng
        );
        
        let distanceText = '';
        let distanceColor = '#666';
        
        if (distance < 1000) {
            distanceText = `${Math.round(distance)}公尺`;
        } else {
            distanceText = `${(distance / 1000).toFixed(1)}公里`;
        }
        
        // 根據距離設置顏色
        if (distance <= alertDistance) {
            distanceColor = '#ff4444'; // 紅色 - 接近目標
        } else if (distance <= alertDistance * 2) {
            distanceColor = '#ffaa00'; // 橙色 - 中等距離
        } else {
            distanceColor = '#4CAF50'; // 綠色 - 較遠距離
        }
        
        // 檢查是否為當前追蹤目標，如果是則添加閃爍效果
        const isTrackingTarget = trackingTarget && trackingTarget.id === marker.id;
        const blinkClass = isTrackingTarget ? ' tracking-distance-blink' : '';
        
        distanceDisplay = `<div class="distance-display${blinkClass}" style="font-size: 13px; color: ${distanceColor}; margin-bottom: 8px; font-weight: 500;">📍 距離: ${distanceText}</div>`;
    }
    
    // 檢查是否為當前追蹤目標
    const isCurrentTarget = trackingTarget && trackingTarget.id === marker.id;
    const trackingButton = isCurrentTarget 
        ? `<button onclick="clearTrackingTarget()" style="padding: 4px 8px; font-size: 12px; background-color: #ef4444; color: white;">取消追蹤</button>`
        : `<button onclick="setTrackingTarget('${marker.id}')" style="padding: 4px 8px; font-size: 12px;">追蹤</button>`;
    
    // 路線管理區域
    let routeManagementSection = '';
    if (marker.routeRecords && marker.routeRecords.length > 0) {
        const count = marker.routeRecords.length;
        let routeListHtml = '';
        if (count > 1) {
            // 兩條以上記錄：使用自製下拉清單以改善手機體驗
            const selectedIndex = (window.routeSelectIndex && typeof window.routeSelectIndex[marker.id] === 'number') ? window.routeSelectIndex[marker.id] : 0;
            const selectedRoute = marker.routeRecords[selectedIndex] || marker.routeRecords[0];
            const selectedDistance = (selectedRoute.distance / 1000).toFixed(2);
            const selectedDuration = formatDuration(selectedRoute.duration);
            const selectedStartName = selectedRoute.startMarkerName || '未知';
            const targetMarkerObjForSelected = selectedRoute.targetMarkerId ? markers.find(m => m.id === selectedRoute.targetMarkerId) : null;
            const selectedTargetIcon = targetMarkerObjForSelected && targetMarkerObjForSelected.icon ? targetMarkerObjForSelected.icon : '';
            const selectedTargetName = selectedRoute.targetMarkerName || (targetMarkerObjForSelected ? targetMarkerObjForSelected.name : '未知');
            const selectedLabel = `路線 ${selectedIndex + 1}｜${selectedDistance} km｜${selectedDuration}｜起點: ${selectedStartName}｜終點: ${selectedTargetIcon} ${selectedTargetName}`;
            routeListHtml = `
                <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px;">
                    <label style="font-size:11px; color:#333;">選擇路線：</label>
                    <div id="routeDropdown_${marker.id}" style="flex:1; position:relative; font-size:11px;">
                        <button type="button" id="routeDropdown_${marker.id}_label" onclick="toggleRouteDropdown('${marker.id}')" 
                                style="width:100%; padding:2px 6px; font-size:11px; text-align:left; border:1px solid #ccc; border-radius:2px; background:#fff; cursor:pointer;">
                            ${selectedLabel}
                        </button>
                        <div id="routeDropdownMenu_${marker.id}" style="display:${window.routeDropdownOpen && window.routeDropdownOpen[marker.id] ? 'block' : 'none'}; position:absolute; top:100%; left:0; right:0; background:#fff; border:1px solid #ddd; border-radius:2px; max-height:160px; overflow:auto; z-index:9999; box-shadow:0 2px 8px rgba(0,0,0,0.15);">
                            ${marker.routeRecords.map((route, idx) => {
                                const distance = (route.distance / 1000).toFixed(2);
                                const duration = formatDuration(route.duration);
                                const startName = route.startMarkerName || '未知';
                                const active = (idx === selectedIndex) ? 'background:#e3f2fd;' : '';
                                const targetObj = route.targetMarkerId ? markers.find(m => m.id === route.targetMarkerId) : null;
                                const targetIcon = targetObj && targetObj.icon ? targetObj.icon : '';
                                const targetName = route.targetMarkerName || (targetObj ? targetObj.name : '未知');
                                return `<div style="padding:4px 8px; cursor:pointer; border-bottom:1px solid #eee; ${active}" onclick="selectRouteIndex('${marker.id}', ${idx})">路線 ${idx + 1}｜${distance} km｜${duration}｜起點: ${startName}｜終點: ${targetIcon} ${targetName}</div>`;
                            }).join('')}
                        </div>
                    </div>
                </div>
                <div style="display:flex; gap:4px; flex-wrap:wrap;">
                    <button onclick="handleRouteAction('${marker.id}', 'display')" 
                            style="padding: 2px 6px; font-size: 10px; background-color: #2196F3; color: white; border: none; border-radius: 2px; cursor: pointer;">顯示</button>
                    <button onclick="handleRouteAction('${marker.id}', 'hide')" 
                            style="padding: 2px 6px; font-size: 10px; background-color: #757575; color: white; border: none; border-radius: 2px; cursor: pointer;">隱藏</button>
                    <button onclick="handleRouteAction('${marker.id}', 'use')" 
                            style="padding: 2px 6px; font-size: 10px; background-color: #FF9800; color: white; border: none; border-radius: 2px; cursor: pointer;">使用</button>
                    <button onclick="handleRouteAction('${marker.id}', 'delete'); updateMarkerPopup(markers.find(m => m.id === '${marker.id}'))" 
                            style="padding: 2px 6px; font-size: 10px; background-color: #f44336; color: white; border: none; border-radius: 2px; cursor: pointer;">刪除</button>
                    <button onclick="hideAllDisplayedRoutes('${marker.id}'); updateMarkerPopup(markers.find(m => m.id === '${marker.id}'))" 
                            style="padding: 2px 6px; font-size: 10px; background-color: #9E9E9E; color: white; border: none; border-radius: 2px; cursor: pointer;">全部隱藏</button>
                </div>
            `;
        } else {
            // 僅一條記錄：顯示單路線卡片
            const route = marker.routeRecords[0];
            const index = 0;
            const distance = (route.distance / 1000).toFixed(2);
            const duration = formatDuration(route.duration);
            const startName = route.startMarkerName || '未知';
            const routeId = `${marker.id}_${index}`;
            const isDisplayed = window.displayedRouteLines && window.displayedRouteLines[routeId];
            const targetObjSingle = route.targetMarkerId ? markers.find(m => m.id === route.targetMarkerId) : null;
            const targetIconSingle = targetObjSingle && targetObjSingle.icon ? targetObjSingle.icon : '';
            const targetNameSingle = route.targetMarkerName || (targetObjSingle ? targetObjSingle.name : '未知');
            routeListHtml = `
                <div style="border: 1px solid #ddd; border-radius: 4px; padding: 8px; margin: 4px 0; background-color: #f9f9f9; font-size: 11px;">
                    <div style="display: flex; align-items: center; margin-bottom: 4px;">
                        <div style="width: 12px; height: 12px; background-color: ${route.color}; border-radius: 50%; margin-right: 6px;"></div>
                        <strong>路線 ${index + 1}</strong>
                    </div>
                    <div style="color: #666; margin-bottom: 6px;">起點: ${startName}</div>
                    <div style="color: #666; margin-bottom: 6px;">終點: ${targetIconSingle} ${targetNameSingle}</div>
                    <div style="color: #666; margin-bottom: 6px;">${distance} km | ${duration}</div>
                    <div style="display: flex; gap: 3px; flex-wrap: wrap;">
                        ${isDisplayed ? 
                            `<button onclick="hideRoute('${marker.id}', ${index}); updateMarkerPopup(markers.find(m => m.id === '${marker.id}'))" 
                                     style="padding: 2px 6px; font-size: 10px; background-color: #757575; color: white; border: none; border-radius: 2px; cursor: pointer;">隱藏</button>` :
                            `<button onclick="displayRoute('${marker.id}', ${index}); updateMarkerPopup(markers.find(m => m.id === '${marker.id}'))" 
                                     style="padding: 2px 6px; font-size: 10px; background-color: #2196F3; color: white; border: none; border-radius: 2px; cursor: pointer;">顯示</button>`
                        }
                        <button onclick="useRoute('${marker.id}', ${index})" 
                                style="padding: 2px 6px; font-size: 10px; background-color: #FF9800; color: white; border: none; border-radius: 2px; cursor: pointer;">使用</button>
                        <button onclick="deleteRoute('${marker.id}', ${index}); updateMarkerPopup(markers.find(m => m.id === '${marker.id}'))" 
                                style="padding: 2px 6px; font-size: 10px; background-color: #f44336; color: white; border: none; border-radius: 2px; cursor: pointer;">刪除</button>
                        <button onclick="hideAllDisplayedRoutes('${marker.id}'); updateMarkerPopup(markers.find(m => m.id === '${marker.id}'))" 
                                style="padding: 2px 6px; font-size: 10px; background-color: #9E9E9E; color: white; border: none; border-radius: 2px; cursor: pointer;">全部隱藏</button>
                    </div>
                </div>
            `;
        }
        
        routeManagementSection = `
            <div style="margin: 8px 0; border-top: 1px solid #eee; padding-top: 8px;">
                <div style="font-size: 12px; font-weight: bold; margin-bottom: 6px; color: #333;">路線記錄 (${count})</div>
                ${routeListHtml}
                <div style="text-align: center; margin-top: 6px;">
                    <button onclick="startNewRouteRecording('${marker.id}')" 
                            style="padding: 4px 8px; font-size: 11px; background-color: #4CAF50; color: white; border: none; border-radius: 3px; cursor: pointer;">新增路線記錄</button>
                    <button onclick="showRouteManagement('${marker.id}')" 
                            style="padding: 4px 8px; font-size: 11px; background-color: #2196F3; color: white; border: none; border-radius: 3px; cursor: pointer; margin-left: 4px;">詳細管理</button>
                </div>
            </div>
        `;
    } else {
        routeManagementSection = `
            <div style="margin: 8px 0; border-top: 1px solid #eee; padding-top: 8px; text-align: center;">
                <button onclick="showDefaultRoute('${marker.id}')" 
                        style="padding: 4px 8px; font-size: 11px; background-color: #ff9800; color: white; border: none; border-radius: 3px; cursor: pointer;">顯示預設路線</button>
                <button onclick="startNewRouteRecording('${marker.id}')" 
                        style="padding: 4px 8px; font-size: 11px; background-color: #4CAF50; color: white; border: none; border-radius: 3px; cursor: pointer; margin-left: 4px;">新增路線記錄</button>
            </div>
        `;
    }
    
    // 多張圖片顯示
    let imageDisplay = '';
    if (marker.imageData) {
        // 移動設備調試：記錄圖片數據處理開始
        console.log('開始處理圖片數據:', {
            hasImageData: !!marker.imageData,
            dataType: typeof marker.imageData,
            isArray: Array.isArray(marker.imageData),
            dataLength: marker.imageData ? marker.imageData.length : 0,
            isMobile: window.DeviceMotionEvent !== undefined
        });
        
        try {
            // 嘗試解析為數組（新格式）
            let imagesArray;
            if (Array.isArray(marker.imageData)) {
                imagesArray = marker.imageData;
            } else if (typeof marker.imageData === 'string') {
                try {
                    // 嘗試解析JSON字符串
                    const parsed = JSON.parse(marker.imageData);
                    imagesArray = Array.isArray(parsed) ? parsed : [parsed];
                } catch (parseError) {
                    // 如果不是JSON，當作單張圖片處理
                    imagesArray = [marker.imageData];
                }
            } else {
                imagesArray = [marker.imageData];
            }
            
            // 過濾掉無效的圖片數據
            imagesArray = imagesArray.filter(img => img && typeof img === 'string' && img.trim() !== '');
            
            if (imagesArray.length > 0) {
                // 移動設備調試：記錄處理結果
                console.log('圖片數組處理成功:', {
                    imageCount: imagesArray.length,
                    firstImageType: typeof imagesArray[0],
                    firstImageLength: imagesArray[0] ? imagesArray[0].length : 0,
                    allImagesValid: imagesArray.every(img => img && typeof img === 'string')
                });
                
                if (imagesArray.length === 1) {
                    // 單張圖片顯示
                    const firstImage = imagesArray[0];
                    imageDisplay = `<div style="margin-bottom: 8px; text-align: center;">
                        <img src="${firstImage}" 
                             style="width: 68px; height: 68px; display: block; margin: 0 auto; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); cursor: pointer; object-fit: cover;" 
                             alt="標註點圖片"
                             onclick="openImageModal(${JSON.stringify(imagesArray).replace(/"/g, '&quot;')}, 0)">
                        <div style="font-size: 11px; color: #888; margin-top: 4px;">點擊圖片預覽</div>
                    </div>`;
                } else {
                    // 多張圖片顯示縮略圖
                    const thumbnailsHtml = imagesArray.slice(0, 3).map((img, index) => 
                        `<img src="${img}" 
                             style="width: 42px; height: 42px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); cursor: pointer; object-fit: cover; margin: 2px;" 
                             alt="圖片 ${index + 1}"
                             onclick="openImageModal(${JSON.stringify(imagesArray).replace(/"/g, '&quot;')}, ${index})">`
                    ).join('');
                    
                    const moreText = imagesArray.length > 3 ? `<div style="font-size: 10px; color: #666; margin-top: 2px;">+${imagesArray.length - 3} 更多</div>` : '';
                    
                    imageDisplay = `<div style="margin-bottom: 8px; text-align: center;">
                        <div style="display: flex; justify-content: center; flex-wrap: wrap; gap: 2px;">
                            ${thumbnailsHtml}
                        </div>
                        <div style="font-size: 11px; color: #888; margin-top: 4px;">點擊圖片預覽 (${imagesArray.length}張)</div>
                        ${moreText}
                    </div>`;
                }
            }
        } catch (e) {
            console.error('圖片數據處理錯誤:', e);
            console.error('原始圖片數據:', marker.imageData);
            console.error('數據類型:', typeof marker.imageData);
            console.error('數據長度:', marker.imageData ? marker.imageData.length : 'null');
            
            // 移動設備調試已移除，僅保留控制台日誌
            
            // 如果所有解析都失敗，嘗試當作單張圖片處理
            if (typeof marker.imageData === 'string' && marker.imageData.startsWith('data:image/')) {
                imageDisplay = `<div style="margin-bottom: 8px; text-align: center;">
                    <img src="${marker.imageData}" 
                         style="width: 68px; height: 68px; display: block; margin: 0 auto; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); cursor: pointer; object-fit: cover;" 
                         alt="標註點圖片"
                         onclick="openImageModal(['${marker.imageData}'], 0)">
                    <div style="font-size: 11px; color: #888; margin-top: 4px;">點擊圖片預覽 (1/1)</div>
                </div>`;
            }
        }
    }
    
    // 在更新前保存目前下拉清單的捲動位置（若存在）
    let savedDropdownScrollTop = 0;
    try {
        const existingMenuEl = document.getElementById(`routeDropdownMenu_${marker.id}`);
        if (existingMenuEl) {
            savedDropdownScrollTop = existingMenuEl.scrollTop || 0;
        } else if (window.routeDropdownScroll && typeof window.routeDropdownScroll[marker.id] === 'number') {
            savedDropdownScrollTop = window.routeDropdownScroll[marker.id] || 0;
        }
    } catch (e) {}
    const popupContent = `
        <div style="text-align: center; min-width: 200px; max-width: 300px;">
            <div style="font-size: 18px; margin-bottom: 8px;">${marker.icon} <strong>${marker.name}</strong></div>
            ${marker.description ? `<div style="font-size: 14px; color: #333; margin-bottom: 8px; text-align: left; padding: 0 10px;">${marker.description}</div>` : ''}
            ${imageDisplay}
            ${distanceDisplay}
            <div style="font-size: 12px; color: #666; margin-bottom: 8px;">群組: ${groupName}</div>
            <div style="font-size: 12px; color: #666; margin-bottom: 12px;">子群組: ${subgroupName}</div>
            <div style="display: flex; gap: 5px; justify-content: center; flex-wrap: wrap;">
                <button onclick="editMarker('${marker.id}')" style="padding: 4px 8px; font-size: 12px;">編輯</button>
                ${trackingButton}
                <button onclick="showOnlyThisMarker('${marker.id}')" style="padding: 4px 8px; font-size: 12px;">只顯示</button>
<button onclick="shareMarkerByIdPointUrl('${marker.id}')" style="padding: 4px 8px; font-size: 12px;">僅座標/名稱網址分享</button>
<button onclick="shareMarkerByIdFile('${marker.id}')" style="padding: 4px 8px; font-size: 12px;">完整檔案分享</button>
            </div>
            ${routeManagementSection}
        </div>
    `;
    
    // 如果還沒有綁定popup，先綁定
    if (!marker.leafletMarker.getPopup()) {
        marker.leafletMarker.bindPopup(popupContent);
    } else {
        marker.leafletMarker.setPopupContent(popupContent);
    }
    // 內容更新後，恢復自製下拉清單的捲動位置並綁定保存事件
    setTimeout(() => {
        try {
            const menuEl = document.getElementById(`routeDropdownMenu_${marker.id}`);
            if (menuEl) {
                if (!window.routeDropdownScroll) window.routeDropdownScroll = {};
                if (typeof savedDropdownScrollTop === 'number' && savedDropdownScrollTop > 0) {
                    menuEl.scrollTop = savedDropdownScrollTop;
                }
                menuEl.addEventListener('scroll', () => {
                    window.routeDropdownScroll[marker.id] = menuEl.scrollTop;
                }, { passive: true });
            }
        } catch (e) {}
    }, 0);
}

function deleteCurrentMarker() {
    const form = document.getElementById('markerForm');
    const markerId = form.dataset.markerId;
    
    if (markerId) {
        const marker = markers.find(m => m.id === markerId);
        
        if (marker) {
            // 從地圖移除並清理引用
            if (marker.leafletMarker) {
                map.removeLayer(marker.leafletMarker);
                marker.leafletMarker = null; // 清理引用
            }
            
            // 從組別/群組移除
            const group = groups.find(g => g.id === marker.groupId);
            if (group) {
                group.removeMarker(markerId);
                if (marker.subgroupId) {
                    const subgroup = group.subgroups.find(sg => sg.id === marker.subgroupId);
                    if (subgroup) {
                        subgroup.removeMarker(markerId);
                    }
                }
            }
            
            // 從全域陣列移除
            markers = markers.filter(m => m.id !== markerId);
        }
        
        updateMarkersList();
        updateGroupsList();
        updateMapMarkers(); // 這會重新渲染地圖上的標記
        saveData();
        
        // 關閉浮動視窗 - 確保在全螢幕模式下也能正確關閉
        const modal = document.getElementById('markerModal');
        
        // 如果modal在全螢幕容器中，將其移回body
        const fullscreenContainer = document.querySelector('.map-container.fullscreen');
        if (fullscreenContainer && fullscreenContainer.contains(modal)) {
            document.body.appendChild(modal);
        }
        modal.style.display = 'none';
        
        // 顯示提示並自動關閉
        const notification = document.createElement('div');
        notification.className = 'notification success';
        notification.textContent = '標記已刪除';
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 2000); // 2秒後自動關閉
    }
}

// 位置追蹤功能
function toggleTracking() {
    const btn = document.getElementById('trackingBtn');
    
    if (isTracking) {
        stopTracking();
        btn.classList.remove('active');
        btn.innerHTML = '<span>📍</span>開始追蹤';
    } else {
        startTracking();
        btn.classList.add('active');
        btn.innerHTML = '<span>⏹️</span>停止追蹤';
    }
    
    isTracking = !isTracking;
}

// 通知功能切換
function toggleNotifications() {
    const floatingEnableNotifications = document.getElementById('floatingEnableNotifications');
    
    // 獲取當前設定面板的狀態
    const currentState = floatingEnableNotifications ? floatingEnableNotifications.checked : markerNotificationsEnabled;
    
    // 切換狀態
    const newState = !currentState;
    
    // 同步更新所有相關狀態
    markerNotificationsEnabled = newState;
    if (floatingEnableNotifications) {
        floatingEnableNotifications.checked = newState;
    }
    
    // 更新按鈕狀態
    updateNotificationButtonState();
    
    if (newState) {
        // 請求通知權限
        requestNotificationPermission();
        
        showNotification('🔔 標註點通知已開啟', 'info');
        
        // 如果追蹤正在進行，重新啟動距離檢查
        if (isTracking && trackingTarget) {
            startProximityCheck();
        }
    } else {
        showNotification('🔕 標註點通知已關閉', 'info');
        
        // 停止所有提醒定時器
        alertTimers.forEach((timer, markerId) => {
            clearInterval(timer);
        });
        alertTimers.clear();
        markersInRange.clear();
        lastAlerts.clear();
        lastAlertTimes.clear();
    }
}

// 統一更新通知按鈕狀態的函數
function updateNotificationButtonState() {
    const notificationBtn = document.getElementById('notificationBtn');
    if (notificationBtn) {
        if (markerNotificationsEnabled) {
            notificationBtn.classList.add('active');
            notificationBtn.innerHTML = '<span>🔔</span>';
        } else {
            notificationBtn.classList.remove('active');
            notificationBtn.innerHTML = '<span>🔕</span>';
        }
    }
}

// 幫助說明內容彈窗（新增手繪路線功能說明）
function showHelpModal() {
    const modalId = 'helpModal';
    let modal = document.getElementById(modalId);
    if (!modal) {
        modal = document.createElement('div');
        modal.id = modalId;
        modal.className = 'help-modal';
        modal.innerHTML = `
            <div class="help-modal-content">
                <div class="help-modal-header">
                    <h2>功能說明</h2>
                    <button class="close-help-btn" onclick="document.getElementById('${modalId}').remove()">×</button>
                </div>
                <div class="help-modal-body">
                    <div class="help-section">
                        <h3>手繪路線</h3>
                        <div class="help-item">
                            <div class="help-icon">✍️</div>
                            <div class="help-text">
                                使用右上角「手繪路線」圖示開始，在地圖上拖曳即可繪製路線；放開即可完成一段。完成後可選擇起點與終點標註，並保存於路線記錄中。
                            </div>
                        </div>
                        <div class="help-item">
                            <div class="help-icon">↩️</div>
                            <div class="help-text">
                                操作提示：可使用「撤銷最後點」與「撤銷最後筆劃」來修正繪製內容。
                            </div>
                        </div>
                    </div>
                    <div class="help-section">
                        <h3>標註與通知</h3>
                        <div class="help-item">
                            <div class="help-icon">+</div>
                            <div class="help-text">點擊「+」進入標註模式，於地圖點選位置新增標記；再次按下可取消。</div>
                        </div>
                        <div class="help-item">
                            <div class="help-icon">🔔/🔕</div>
                            <div class="help-text">通知按鈕僅以圖示顯示開關，開啟後系統會在接近設定距離時提醒。</div>
                        </div>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(modal);
    }
}

function startTracking() {
    console.log('=== 開始位置追蹤 ===');
    
    if ('geolocation' in navigator) {
        // 更新狀態顯示
        updateLocationStatus('正在啟動追蹤...');
        
        watchId = navigator.geolocation.watchPosition(
            function(position) {
                const now = Date.now();
                lastLocationUpdate = now;
                
                // 計算速度（如果有前一個位置）
                let speed = null;
                if (currentPosition && position.coords.speed !== null) {
                    speed = position.coords.speed;
                } else if (currentPosition) {
                    const timeDiff = (now - currentPosition.timestamp) / 1000; // 秒
                    const distance = calculateDistance(
                        currentPosition.lat, currentPosition.lng,
                        position.coords.latitude, position.coords.longitude
                    );
                    if (timeDiff > 0) {
                        speed = distance / timeDiff; // 公尺/秒
                    }
                }
                
                // 處理自動轉向
                // 保存當前位置作為下次計算的參考
                lastPosition = currentPosition ? {
                    lat: currentPosition.lat,
                    lng: currentPosition.lng
                } : null;
                
                currentPosition = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    timestamp: now,
                    speed: speed
                };

                // 更新行進方向（bearing）並派發事件，供地圖旋轉使用
                try {
                    let newBearing = null;
                    // 優先使用原生 heading（度，0=北，順時針）
                    if (position.coords && position.coords.heading != null && isFinite(position.coords.heading)) {
                        newBearing = position.coords.heading;
                    } else if (lastPosition) {
                        // 以前後兩點計算 bearing，避免小幅抖動（距離門檻2m）
                        const moveDist = calculateDistance(
                            lastPosition.lat, lastPosition.lng,
                            currentPosition.lat, currentPosition.lng
                        );
                        if (moveDist >= 2) {
                            newBearing = calculateBearing(
                                lastPosition.lat, lastPosition.lng,
                                currentPosition.lat, currentPosition.lng
                            );
                        }
                    }

                    if (newBearing != null && isFinite(newBearing)) {
                        currentBearing = newBearing;
                        window.currentBearing = newBearing;
                        document.dispatchEvent(new Event('bearingUpdated'));
                    }
                } catch (e) {
                    console.warn('更新行進方向失敗:', e);
                }
                
                updateLocationDisplay();
                            updateCurrentLocationMarker();
                            
                            // 更新路線記錄（如果正在記錄）
                            updateRouteRecording(currentPosition);
                            
                            // 如果啟用保持地圖居中，強制居中到當前位置
                            if (keepMapCentered) {
                                centerMapToCurrentPosition(true);
                            }
                            
                            refreshAllMarkerPopups(); // 更新所有標記的提示窗距離顯示
                            
                            // 如果有追蹤目標，更新路徑線
                            if (trackingTarget) {
                                showRouteLine();
                            }
                            
                            updateLocationStatus('追蹤中');
                
                // 如果精度較差，顯示警告
                if (position.coords.accuracy > 50) {
                    console.warn(`定位精度較差: ${Math.round(position.coords.accuracy)}公尺`);
                }
            },
            function(error) {
                console.error('位置追蹤錯誤:', error);
                let errorMessage = '位置追蹤失敗';
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        errorMessage = '位置權限被拒絕';
                        updateLocationStatus('權限被拒絕');
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMessage = '位置信息不可用';
                        updateLocationStatus('位置不可用');
                        break;
                    case error.TIMEOUT:
                        errorMessage = '定位超時，請檢查GPS信號';
                        updateLocationStatus('定位超時');
                        break;
                }
                showNotification(errorMessage, 'error');
            },
            {
                enableHighAccuracy: enableHighAccuracy,
                timeout: locationTimeout,
                maximumAge: 0 // 強制獲取最新位置，不使用緩存
            }
        );
        
        // 啟動定位更新定時器，確保按照設定頻率強制更新
        if (locationUpdateTimer) {
            clearInterval(locationUpdateTimer);
        }
        
        locationUpdateTimer = setInterval(() => {
            // 強制重新獲取當前位置
            if (navigator.geolocation && isTracking) {
                navigator.geolocation.getCurrentPosition(
                    function(position) {
                        const now = Date.now();
                        
                        // 檢查是否真的是新的位置數據
                        if (!lastLocationUpdate || (now - lastLocationUpdate) >= (locationUpdateFrequency * 0.8)) {
                            lastLocationUpdate = now;
                            
                            // 計算速度（如果有前一個位置）
                            let speed = null;
                            if (currentPosition && position.coords.speed !== null) {
                                speed = position.coords.speed;
                            } else if (currentPosition) {
                                const timeDiff = (now - currentPosition.timestamp) / 1000; // 秒
                                const distance = calculateDistance(
                                    currentPosition.lat, currentPosition.lng,
                                    position.coords.latitude, position.coords.longitude
                                );
                                if (timeDiff > 0) {
                                    speed = distance / timeDiff; // 公尺/秒
                                }
                            }
                            
                            // 保存當前位置作為下次計算的參考
                            lastPosition = currentPosition ? {
                                lat: currentPosition.lat,
                                lng: currentPosition.lng
                            } : null;
                            
                            currentPosition = {
                                lat: position.coords.latitude,
                                lng: position.coords.longitude,
                                accuracy: position.coords.accuracy,
                                timestamp: now,
                                speed: speed
                            };

                            // 定時強制更新時同步更新行進方向並派發事件
                            try {
                                let newBearing = null;
                                if (position.coords && position.coords.heading != null && isFinite(position.coords.heading)) {
                                    newBearing = position.coords.heading;
                                } else if (lastPosition) {
                                    const moveDist = calculateDistance(
                                        lastPosition.lat, lastPosition.lng,
                                        currentPosition.lat, currentPosition.lng
                                    );
                                    if (moveDist >= 2) {
                                        newBearing = calculateBearing(
                                            lastPosition.lat, lastPosition.lng,
                                            currentPosition.lat, currentPosition.lng
                                        );
                                    }
                                }
                                if (newBearing != null && isFinite(newBearing)) {
                                    currentBearing = newBearing;
                                    window.currentBearing = newBearing;
                                    document.dispatchEvent(new Event('bearingUpdated'));
                                }
                            } catch (e) {
                                console.warn('定時更新行進方向失敗:', e);
                            }
                            
                            updateLocationDisplay();
                            updateCurrentLocationMarker();
                            
                            // 更新路線記錄（如果正在記錄）
                            updateRouteRecording(currentPosition);
                            
                            // 如果啟用保持地圖居中，強制居中到當前位置
                            if (keepMapCentered) {
                                centerMapToCurrentPosition(true);
                            }
                            
                            refreshAllMarkerPopups(); // 更新所有標記的提示窗距離顯示
                            
                            // 如果有追蹤目標，更新路徑線
                            if (trackingTarget) {
                                showRouteLine();
                            }
                            
                            updateLocationStatus('追蹤中 (強制更新)');
                        }
                    },
                    function(error) {
                        console.warn('定時器位置更新失敗:', error);
                    },
                    {
                        enableHighAccuracy: enableHighAccuracy,
                        timeout: Math.min(locationTimeout, Math.max(locationUpdateFrequency - 100, 1000)),
                        maximumAge: 0 // 強制獲取最新位置
                    }
                );
            }
        }, locationUpdateFrequency);
        
        // 如果有追蹤目標，開始距離檢查定時器
        if (trackingTarget) {
            startProximityCheck();
        }
        
        // 啟動定位居中定時器（只有在啟用居中功能時才啟動）
        if (keepMapCentered && centeringInterval > 0) {
            if (centeringTimer) {
                clearInterval(centeringTimer);
            }
            centeringTimer = setInterval(() => {
                if (currentPosition && isTracking && keepMapCentered) {
                    centerMapToCurrentPosition(true);
                }
            }, centeringInterval);
        }
        
        showNotification(`位置追蹤已啟動 (${enableHighAccuracy ? '高精度' : '標準'}模式，強制更新頻率: ${locationUpdateFrequency/1000}秒)`);
    } else {
        showNotification('您的瀏覽器不支援位置追蹤', 'error');
        updateLocationStatus('不支援定位');
    }
}

function stopTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        
        // 停止距離檢查定時器
        stopProximityCheck();
        
        // 清除定位更新定時器
        if (locationUpdateTimer) {
            clearInterval(locationUpdateTimer);
            locationUpdateTimer = null;
        }
        
        // 清除定位居中定時器
        if (centeringTimer) {
            clearInterval(centeringTimer);
            centeringTimer = null;
        }
        
        // 清除所有提醒定時器
        alertTimers.forEach((timer, markerId) => {
            clearInterval(timer);
        });
        alertTimers.clear();
        markersInRange.clear();
        lastAlerts.clear();
        lastAlertTimes.clear();
        
        // 不自動清除追蹤目標，讓用戶可以手動取消
        // trackingTarget 保持不變，用戶可以通過標註點的按鈕手動取消追蹤
        
        showNotification('位置追蹤已停止，所有提醒已取消。如需取消追蹤目標，請點擊標註點的取消追蹤按鈕。');
    }
}

function centerMapToCurrentLocation() {
    // 檢查是否從地圖上的定位按鈕調用，如果是則添加視覺反饋
    const locationBtn = document.getElementById('locationBtn');
    const locationIcon = document.getElementById('locationIcon');
    let isFromMapButton = false;
    
    // 檢查調用堆疊，判斷是否來自handleLocationClick
    const stack = new Error().stack;
    if (stack && stack.includes('handleLocationClick')) {
        isFromMapButton = true;
        // 設置按鈕為載入狀態
        if (locationBtn && locationIcon) {
            locationBtn.classList.add('locating');
            locationBtn.disabled = true;
            locationIcon.textContent = '🔄';
        }
    }
    
    if (currentPosition) {
        const disp = getMapDisplayCoord(currentPosition.lat, currentPosition.lng);
        map.setView([disp.lat, disp.lng], 18);
        updateCurrentLocationMarker();
        // 顯示當前位置標記的彈出視窗
        if (currentLocationMarker) {
            currentLocationMarker.openPopup();
        }
        
        // 恢復按鈕狀態
        if (isFromMapButton && locationBtn && locationIcon) {
            locationBtn.classList.remove('locating');
            locationBtn.disabled = false;
            locationIcon.textContent = '📍';
        }
        
        showNotification('已回到您的位置', 'success');
    } else {
        // 如果沒有位置資料，請求位置權限
        requestLocationPermission().then(() => {
            // 恢復按鈕狀態
            if (isFromMapButton && locationBtn && locationIcon) {
                locationBtn.classList.remove('locating');
                locationBtn.disabled = false;
                locationIcon.textContent = '📍';
            }
        }).catch(() => {
            // 恢復按鈕狀態
            if (isFromMapButton && locationBtn && locationIcon) {
                locationBtn.classList.remove('locating');
                locationBtn.disabled = false;
                locationIcon.textContent = '📍';
            }
        });
    }
}

// 處理當前位置顯示區域的點擊事件
function handleCurrentLocationClick(event) {
    console.log('🎯 handleCurrentLocationClick 函數被調用');
    
    // 觸覺反饋
    if (navigator.vibrate) {
        navigator.vibrate(50);
        console.log('📳 震動反饋已觸發');
    } else {
        console.log('⚠️ 瀏覽器不支援震動API');
    }
    
    // 視覺按壓效果 - 支援多個元素
    const targetElement = event ? event.target : null;
    const elementsToAnimate = [];
    
    // 添加主要的currentLocation元素
    const currentLocationDiv = document.getElementById('currentLocation');
    if (currentLocationDiv) {
        elementsToAnimate.push(currentLocationDiv);
    }
    
    // 添加浮動視窗中的元素
    const floatingCurrentLocation = document.getElementById('floatingCurrentLocation');
    if (floatingCurrentLocation) {
        elementsToAnimate.push(floatingCurrentLocation);
    }
    
    // 如果有特定的目標元素，優先處理它
    if (targetElement && (targetElement.id === 'currentLocation' || targetElement.id === 'floatingCurrentLocation')) {
        // 只對點擊的元素添加按壓效果
        targetElement.style.transform = 'scale(0.95)';
        targetElement.style.transition = 'transform 0.1s ease';
        
        setTimeout(() => {
            targetElement.style.transform = 'scale(1)';
        }, 100);
        
        console.log(`🎨 對 ${targetElement.id} 元素應用按壓效果`);
    } else {
        // 如果沒有特定目標，對所有相關元素添加效果
        elementsToAnimate.forEach(element => {
            element.style.transform = 'scale(0.95)';
            element.style.transition = 'transform 0.1s ease';
            
            setTimeout(() => {
                element.style.transform = 'scale(1)';
            }, 100);
        });
        
        console.log('🎨 對所有定位元素應用按壓效果');
    }
    
    // 檢查是否有追蹤目標
    if (trackingTarget) {
        // 定位到追蹤標示點
        focusMarkerFromFloatingWindow(trackingTarget);
    } else {
        // 沒有追蹤目標時，定位到當前位置
        centerMapToCurrentLocation();
    }
}

// 從浮動視窗定位到標示點的函數
function focusMarkerFromFloatingWindow(marker) {
    // 觸覺反饋
    if (navigator.vibrate) {
        navigator.vibrate(50);
    }
    
    // 平滑移動地圖到標示點位置
    map.flyTo([marker.lat, marker.lng], 18, {
        animate: true,
        duration: 0.5
    });
    
    // 找到對應的標示點
    const targetMarker = markers.find(m => m.id === marker.id);
    if (targetMarker && targetMarker.leafletMarker) {
        // 300ms 延遲後開啟彈出視窗
        setTimeout(() => {
            targetMarker.leafletMarker.openPopup();
        }, 300);
        
        // 添加閃爍效果
        const markerElement = targetMarker.leafletMarker.getElement();
        if (markerElement) {
            markerElement.classList.add('marker-focus-blink');
            setTimeout(() => {
                markerElement.classList.remove('marker-focus-blink');
            }, 1000);
        }
    }
    
    // 顯示成功通知
    setTimeout(() => {
        showNotification(`已定位到 ${marker.name}`, 'success');
    }, 500);
}

// 距離計算
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371e3; // 地球半徑（公尺）
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lng2-lng1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // 距離（公尺）
}

// 計算兩點間的方向角度（以北為0度，順時針）
function calculateBearing(lat1, lng1, lat2, lng2) {
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δλ = (lng2-lng1) * Math.PI/180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

    const θ = Math.atan2(y, x);
    
    // 轉換為0-360度
    return (θ * 180/Math.PI + 360) % 360;
}

// ===== 裝置方向（指南針）整合 =====
let compassBearing = null; // 由裝置方向取得的方位（0-360）
let lastBearingUpdateTs = 0; // 最近一次更新 bearing 的時間戳

function initCompassOrientation() {
    // iOS 13+ 需要權限
    const requestIOSPermission = async () => {
        try {
            if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                const res = await DeviceOrientationEvent.requestPermission();
                console.log('DeviceOrientation permission:', res);
            }
        } catch (e) {
            console.warn('DeviceOrientation 權限請求失敗:', e);
        }
    };

    // 嘗試請求（在部分瀏覽器需由使用者手勢觸發，這裡容忍失敗）
    requestIOSPermission();

    const handleOrientation = (event) => {
        let deg = null;
        // iOS Safari 提供 webkitCompassHeading（0=北，順時針）
        if (typeof event.webkitCompassHeading === 'number' && isFinite(event.webkitCompassHeading)) {
            deg = event.webkitCompassHeading;
        } else if (event.absolute && typeof event.alpha === 'number' && isFinite(event.alpha)) {
            // 絕對方位，alpha 通常為相對北的角度（0-360）
            deg = event.alpha;
        } else if (typeof event.alpha === 'number' && isFinite(event.alpha)) {
            // 非絕對模式，仍可作為近似值
            deg = event.alpha;
        }

        if (deg != null) {
            // 正規化到 0-360
            deg = ((deg % 360) + 360) % 360;
            compassBearing = deg;
            window.compassBearing = deg;
            maybeUseCompassBearing();
        }
    };

    // 監聽裝置方向（不同瀏覽器提供不同事件）
    window.addEventListener('deviceorientationabsolute', handleOrientation);
    window.addEventListener('deviceorientation', handleOrientation);
}

function maybeUseCompassBearing() {
    // 在停走或無法由 GPS 得到 heading 時，使用指南針方位維持地圖朝向
    if (compassBearing == null) return;
    const now = Date.now();

    // 當速度低於 0.5 m/s，或兩次位置距離小於 1.5m，視為停走
    let isStationary = false;
    if (currentPosition && typeof currentPosition.speed === 'number') {
        isStationary = currentPosition.speed < 0.5;
    }
    if (!isStationary && lastPosition && currentPosition) {
        const dist = calculateDistance(lastPosition.lat, lastPosition.lng, currentPosition.lat, currentPosition.lng);
        isStationary = dist < 1.5;
    }

    // 若停走，或沒有可靠的 GPS heading，使用指南針
    const hasGpsHeading = (typeof currentBearing === 'number' && isFinite(currentBearing));
    if (isStationary || !hasGpsHeading) {
        currentBearing = compassBearing;
        window.currentBearing = compassBearing;
        lastBearingUpdateTs = now;
        document.dispatchEvent(new Event('bearingUpdated'));
    }
}

// 路徑顯示功能
function showRouteLine() {
    if (!currentPosition || !trackingTarget) {
        return;
    }
    
    // 清除現有路徑線
    clearRouteLine();
    
    // 創建路徑線
    const dispStart = getMapDisplayCoord(currentPosition.lat, currentPosition.lng);
    const dispEnd = getMapDisplayCoord(trackingTarget.lat, trackingTarget.lng);
    const routeCoords = [
        [dispStart.lat, dispStart.lng],
        [dispEnd.lat, dispEnd.lng]
    ];
    
    routeLine = L.polyline(routeCoords, {
        color: '#ff4444',
        weight: 4,
        opacity: 0.8,
        dashArray: '10, 5'
    }).addTo(map);
    
    // 計算距離
    routeDistance = calculateDistance(
        currentPosition.lat, currentPosition.lng,
        trackingTarget.lat, trackingTarget.lng
    );
    
    // 更新路徑資訊顯示
    updateRouteInfo();
}

function clearRouteLine() {
    if (routeLine) {
        map.removeLayer(routeLine);
        routeLine = null;
    }
    clearRouteInfo();
}

function updateRouteInfo() {
    if (!trackingTarget || !currentPosition) {
        return;
    }
    
    // 移除現有的路徑資訊控制項
    clearRouteInfo();
    
    // 格式化距離顯示
    let distanceText = '';
    if (routeDistance < 1000) {
        distanceText = `${Math.round(routeDistance)}公尺`;
    } else {
        distanceText = `${(routeDistance / 1000).toFixed(1)}公里`;
    }
    
    // 計算方向
    const bearing = calculateBearing(
        currentPosition.lat, currentPosition.lng,
        trackingTarget.lat, trackingTarget.lng
    );
    
    // 方向文字
    const directions = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
    const directionIndex = Math.round(bearing / 45) % 8;
    const directionText = directions[directionIndex];
    
    // 創建路徑資訊控制項
    routeInfoControl = L.control({position: 'topleft'});
    routeInfoControl.onAdd = function(map) {
        const div = L.DomUtil.create('div', 'route-info-control');
        div.innerHTML = `
            <div style="background: rgba(255,255,255,0.95); padding: 8px; border-radius: 6px; box-shadow: 0 2px 10px rgba(0,0,0,0.2); font-size: 11px; min-width: 150px;">
                <div style="font-weight: bold; color: #333; margin-bottom: 4px;">
                    🎯 追蹤目標: ${trackingTarget.name}
                </div>
                <div style="color: #666; margin-bottom: 2px;">
                    📍 距離: <span style="color: #ff4444; font-weight: bold;">${distanceText}</span>
                </div>
                <div style="color: #666;">
                    🧭 方向: <span style="color: #2196F3; font-weight: bold;">${directionText} (${Math.round(bearing)}°)</span>
                </div>
            </div>
        `;
        
        // 添加點擊事件監聽器
        const infoDiv = div.querySelector('div');
        infoDiv.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            // 觸覺反饋
            if (navigator.vibrate) {
                navigator.vibrate(50);
            }
            
            // 視覺按壓效果
            div.classList.add('tracking-info-press-animation');
            setTimeout(() => {
                div.classList.remove('tracking-info-press-animation');
            }, 300);
            
            // 定位到追蹤目標
            locateToTrackingTarget();
        });
        
        // 防止地圖事件冒泡
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        
        return div;
    };
    routeInfoControl.addTo(map);
}

function clearRouteInfo() {
    if (routeInfoControl) {
        map.removeControl(routeInfoControl);
        routeInfoControl = null;
    }
}

// 定位到追蹤目標
function locateToTrackingTarget() {
    if (!trackingTarget) {
        console.log('沒有設定追蹤目標');
        return;
    }
    
    // 平滑移動地圖到追蹤目標位置
    map.flyTo([trackingTarget.lat, trackingTarget.lng], 18, {
        animate: true,
        duration: 0.8
    });
    
    // 找到對應的標示點
    const targetMarker = markers.find(m => m.id === trackingTarget.id);
    if (targetMarker && targetMarker.leafletMarker) {
        // 500ms 延遲後開啟彈出視窗
        setTimeout(() => {
            targetMarker.leafletMarker.openPopup();
        }, 500);
        
        // 添加閃爍效果
        const markerElement = targetMarker.leafletMarker.getElement();
        if (markerElement) {
            markerElement.classList.add('marker-focus-blink');
            setTimeout(() => {
                markerElement.classList.remove('marker-focus-blink');
            }, 2000);
        }
    }
    
    // 顯示通知
    showNotification(`📍 已定位到追蹤目標: ${trackingTarget.name}`, 'success');
}

// 距離檢查定時器
let proximityCheckTimer = null;

// 開始距離檢查定時器
function startProximityCheck() {
    // 清除現有定時器
    if (proximityCheckTimer) {
        clearInterval(proximityCheckTimer);
    }
    
    // 設定定時器，使用用戶設定的提醒間隔時間檢查距離
    proximityCheckTimer = setInterval(() => {
        checkProximityAlerts();
    }, alertInterval * 1000); // 使用設定的提醒間隔時間
    
    // 立即執行一次檢查
    checkProximityAlerts();
}

// 停止距離檢查定時器
function stopProximityCheck() {
    if (proximityCheckTimer) {
        clearInterval(proximityCheckTimer);
        proximityCheckTimer = null;
    }
}

// 接近提醒檢查（僅用於判斷進入/離開範圍）
function checkProximityAlerts() {
    // 統一使用設定面板的開關作為主要控制
    const floatingEnableNotifications = document.getElementById('floatingEnableNotifications');
    const notificationsEnabled = floatingEnableNotifications ? floatingEnableNotifications.checked : markerNotificationsEnabled;
    
    if (!currentPosition || !notificationsEnabled || !trackingTarget) {
        return;
    }
    
    // 只檢查追蹤目標
    const distance = calculateDistance(
        currentPosition.lat,
        currentPosition.lng,
        trackingTarget.lat,
        trackingTarget.lng
    );
    
    // 向Service Worker發送位置檢查信息，支援背景通知
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'BACKGROUND_LOCATION_CHECK',
            trackingTarget: trackingTarget,
            currentPosition: currentPosition,
            distance: distance,
            alertDistance: alertDistance,
            timestamp: Date.now()
        });
    }
    
    if (distance <= alertDistance) {
        // 如果追蹤目標進入範圍
        if (!markersInRange.has(trackingTarget.id)) {
            markersInRange.add(trackingTarget.id);
            
            // 立即顯示第一次通知
            showLocationAlert(trackingTarget, distance);
            lastAlertTimes.set(trackingTarget.id, Date.now());
            
            // 設定定時器進行重複通知
            startRepeatedAlert(trackingTarget.id, trackingTarget);
            console.log(`標註點 "${trackingTarget.name}" 進入範圍 (${Math.round(distance)}m)，開始定時通知`);
            
            // 向Service Worker發送進入範圍通知
            if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({
                    type: 'LOCATION_ALERT',
                    title: '📍 位置提醒',
                    body: `您已接近標記點 "${trackingTarget.name}"，距離約 ${Math.round(distance)} 公尺`,
                    data: {
                        markerId: trackingTarget.id,
                        markerName: trackingTarget.name,
                        distance: Math.round(distance),
                        tag: `location-alert-${trackingTarget.id}`
                    }
                });
            }
        }
        // 如果已經在範圍內，不做任何操作，讓定時器處理後續通知
    } else {
        // 如果追蹤目標離開範圍
        if (markersInRange.has(trackingTarget.id)) {
            markersInRange.delete(trackingTarget.id);
            stopRepeatedAlert(trackingTarget.id);
            console.log(`標註點 "${trackingTarget.name}" 離開範圍 (${Math.round(distance)}m)，停止通知`);
        }
    }
}

// 開始重複通知
function startRepeatedAlert(markerId, marker) {
    // 清除可能存在的舊定時器
    stopRepeatedAlert(markerId);
    
    // 設定新的定時器，直接按照設定的間隔時間進行通知
    const timer = setInterval(() => {
        const floatingEnableNotifications = document.getElementById('floatingEnableNotifications');
        if (!currentPosition || !floatingEnableNotifications || !floatingEnableNotifications.checked) {
            stopRepeatedAlert(markerId);
            return;
        }
        
        // 重新計算距離，確保仍在範圍內
        const distance = calculateDistance(
            currentPosition.lat, currentPosition.lng,
            marker.lat, marker.lng
        );
        
        if (distance <= alertDistance) {
            // 在範圍內，按照設定間隔發送通知（不再檢查上次通知時間）
            showLocationAlert(marker, distance);
            lastAlertTimes.set(markerId, Date.now());
            console.log(`按間隔通知 ${marker.name}，距離 ${Math.round(distance)} 公尺`);
        } else {
            // 如果已經離開範圍，停止定時器
            console.log(`${marker.name} 已離開範圍，停止通知`);
            stopRepeatedAlert(markerId);
        }
    }, alertInterval * 1000); // 直接使用設定的間隔時間
    
    alertTimers.set(markerId, timer);
}

// 停止重複通知
function stopRepeatedAlert(markerId) {
    const timer = alertTimers.get(markerId);
    if (timer) {
        clearInterval(timer);
        alertTimers.delete(markerId);
    }
    markersInRange.delete(markerId);
    lastAlerts.delete(markerId);
    lastAlertTimes.delete(markerId);
}

function showLocationAlert(marker, distance) {
    // 獲取群組和子群組信息
    let groupInfo = '';
    const group = groups.find(g => g.id === marker.groupId);
    if (group) {
        groupInfo = `[${group.name}`;
        if (marker.subgroupId) {
            const subgroup = group.subgroups.find(sg => sg.id === marker.subgroupId);
            if (subgroup) {
                groupInfo += ` > ${subgroup.name}`;
            }
        }
        groupInfo += '] ';
    }
    
    const message = `${groupInfo}您已接近標記點 "${marker.name}"，距離約 ${Math.round(distance)} 公尺`;
    
    // 高亮顯示相關的群組按鈕
    highlightGroupButton(marker.groupId, marker.subgroupId);
    
    // 震動功能
    async function triggerVibration() {
        try {
            // 優先使用 Capacitor Haptics
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics) {
                console.log('Using Capacitor Haptics for vibration');
                // 複雜震動序列
                await window.Capacitor.Plugins.Haptics.vibrate({ duration: 500 });
                setTimeout(async () => {
                    await window.Capacitor.Plugins.Haptics.vibrate({ duration: 300 });
                }, 700);
                setTimeout(async () => {
                    await window.Capacitor.Plugins.Haptics.vibrate({ duration: 300 });
                }, 1200);
            } else if (window.AndroidDevice && typeof window.AndroidDevice.vibrate === 'function') {
                console.log('Using AndroidDevice vibration');
                window.AndroidDevice.vibrate([500, 200, 300, 200, 300]);
            } else if ('vibrate' in navigator) {
                console.log('Using browser vibration');
                navigator.vibrate([500, 200, 300, 200, 300]);
            } else {
                console.log('No vibration method available');
            }
        } catch (error) {
            console.error('Vibration failed:', error);
            // 降級到瀏覽器震動
            if ('vibrate' in navigator) {
                navigator.vibrate([500, 200, 300, 200, 300]);
            }
        }
    }
    
    // 播放通知音效
    async function playNotificationSound() {
        try {
            if (window.notificationSound && typeof window.notificationSound.playNotificationSound === 'function') {
                await window.notificationSound.playNotificationSound();
                console.log('通知音效播放成功');
            } else {
                console.log('通知音效功能不可用');
            }
        } catch (error) {
            console.warn('播放通知音效失敗:', error);
        }
    }

    // 執行震動和音效，然後顯示自定義通知
    Promise.all([
        triggerVibration(),
        playNotificationSound()
    ]).then(() => {
        // 震動和音效完成後顯示通知
        setTimeout(() => {
            showAutoCloseNotification(message, 'info');
            
            // 將地圖定位到通知的標示點
            if (marker && marker.lat && marker.lng) {
                map.setView([marker.lat, marker.lng], 16); // 設定地圖中心和縮放級別
                
                // 確保標示點在地圖上並顯示其資料
                const markerOnMap = markers.find(m => m.id === marker.id);
                if (markerOnMap && markerOnMap.leafletMarker) {
                    // 更新標示點的彈出視窗內容
                    updateMarkerPopup(markerOnMap);
                    // 打開標示點的彈出視窗
                    markerOnMap.leafletMarker.openPopup();
                }
            }
        }, 100); // 短暫延遲確保震動完成
    }).catch(() => {
        // 如果震動或音效失敗，仍然顯示通知
        setTimeout(() => {
            showAutoCloseNotification(message, 'info');
            
            // 將地圖定位到通知的標示點
            if (marker && marker.lat && marker.lng) {
                map.setView([marker.lat, marker.lng], 16); // 設定地圖中心和縮放級別
                
                // 確保標示點在地圖上並顯示其資料
                const markerOnMap = markers.find(m => m.id === marker.id);
                if (markerOnMap && markerOnMap.leafletMarker) {
                    // 更新標示點的彈出視窗內容
                    updateMarkerPopup(markerOnMap);
                    // 打開標示點的彈出視窗
                    markerOnMap.leafletMarker.openPopup();
                }
            }
        }, 100);
    });
}

// 更新定位狀態顯示
function updateLocationStatus(status) {
    // 只有當追蹤按鈕存在時才更新狀態顯示
    const trackingBtn = document.getElementById('trackingBtn');
    if (!trackingBtn) {
        return; // 如果追蹤按鈕不存在，則不顯示追蹤狀態
    }
    
    const statusDiv = document.getElementById('locationStatus');
    if (statusDiv) {
        statusDiv.textContent = status;
    }
}

// 更新速度顯示
function updateSpeedDisplay(speed) {
    const speedDiv = document.getElementById('locationSpeed');
    if (speedDiv && speed !== null && speed !== undefined) {
        const speedKmh = (speed * 3.6).toFixed(1); // 轉換為 km/h
        speedDiv.textContent = `${speedKmh} km/h`;
    } else if (speedDiv) {
        speedDiv.textContent = '-- km/h';
    }
}

// UI更新函數
function updateLocationDisplay() {
    const locationDiv = document.getElementById('currentLocation');
    const accuracyDiv = document.getElementById('locationAccuracy');
    
    if (currentPosition) {
        let timeText = '';
        
        if (currentPosition.timestamp) {
            const updateTime = new Date(currentPosition.timestamp);
            timeText = `<br><span style="color: #888; font-size: 12px;">更新: ${updateTime.toLocaleTimeString()}</span>`;
        }
        
        locationDiv.innerHTML = `
            緯度: ${currentPosition.lat.toFixed(6)}<br>
            經度: ${currentPosition.lng.toFixed(6)}${timeText}
        `;
        
        // 更新精度顯示
        if (currentPosition.accuracy && accuracyDiv) {
            const accuracy = Math.round(currentPosition.accuracy);
            let accuracyClass = 'accuracy-good';
            let accuracyIcon = '🎯';
            
            if (accuracy > 100) {
                accuracyClass = 'accuracy-poor';
                accuracyIcon = '📍';
            } else if (accuracy > 50) {
                accuracyClass = 'accuracy-medium';
                accuracyIcon = '🎯';
            } else {
                accuracyClass = 'accuracy-good';
                accuracyIcon = '🎯';
            }
            
            accuracyDiv.innerHTML = `${accuracyIcon} 精度: ±${accuracy}公尺`;
            accuracyDiv.className = `accuracy-display ${accuracyClass}`;
        } else if (accuracyDiv) {
            accuracyDiv.innerHTML = '📍 精度: --';
            accuracyDiv.className = 'accuracy-display';
        }
    } else {
        locationDiv.textContent = '位置未知';
        if (accuracyDiv) {
            accuracyDiv.innerHTML = '📍 精度: --';
            accuracyDiv.className = 'accuracy-display';
        }
    }
    

}



function updateGroupsList() {
    const groupsList = document.getElementById('groupsList');
    groupsList.innerHTML = '';
    
    // 添加"顯示所有標註點"選項
    const allMarkersDiv = document.createElement('div');
    allMarkersDiv.className = 'group-item';
    if (!currentGroup) {
        allMarkersDiv.classList.add('active');
    }
    
    allMarkersDiv.innerHTML = `
        <div class="group-name" onclick="selectGroup(null)">📍 顯示所有標註點</div>
    `;
    
    groupsList.appendChild(allMarkersDiv);
    
    groups.forEach(group => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'group-item';
        groupDiv.dataset.groupId = group.id;
        
        groupDiv.innerHTML = `
            <div class="group-name" onclick="selectGroup('${group.id}')" oncontextmenu="event.preventDefault(); showGroupDetailsModal('${group.id}');" title="左鍵選擇組別，右鍵查看詳情">${group.name}</div>
            <div class="group-actions">
                <button onclick="editGroupName('${group.id}')">編輯</button>
                <button onclick="addSubgroup('${group.id}')">新增群組</button>
                <button onclick="deleteGroup('${group.id}')">刪除</button>
                <button onclick="showGroupDetailsModal('${group.id}')" title="查看組別詳情">詳情</button>
            </div>
        `;

        // 若目前選擇的是此群組，標記 active
        if (currentGroup && !currentSubgroup && currentGroup.id === group.id) {
            groupDiv.classList.add('active');
        }
        // 讓整個群組項目也能被點擊選取（避免覆寫子群組點擊）
        groupDiv.addEventListener('click', (e) => {
            // 避免點擊操作按鈕或子群組時觸發群組選取
            const isActionBtn = e.target.closest('.group-actions button');
            const isSubgroup = e.target.closest('.subgroup-item');
            if (isActionBtn || isSubgroup) return;
            // 僅在點擊群組名稱或群組卡片空白處時選取
            const isGroupName = e.target.closest('.group-name');
            if (!isGroupName && e.target !== groupDiv) return;
            selectGroup(group.id);
        });
        
        // 添加子群組
        group.subgroups.forEach(subgroup => {
            const subgroupDiv = document.createElement('div');
            subgroupDiv.className = 'subgroup-item';
            subgroupDiv.dataset.subgroupId = subgroup.id;
            
            subgroupDiv.innerHTML = `
                <div class="subgroup-name" onclick="selectGroup('${group.id}', '${subgroup.id}')" oncontextmenu="event.preventDefault(); showGroupDetailsModal('${group.id}', '${subgroup.id}');" title="左鍵選擇群組，右鍵查看詳情">${subgroup.name}</div>
                <div class="subgroup-actions">
                    <button onclick="editSubgroupName('${group.id}', '${subgroup.id}')">編輯</button>
                    <button onclick="deleteSubgroup('${group.id}', '${subgroup.id}')">刪除</button>
                    <button onclick="showGroupDetailsModal('${group.id}', '${subgroup.id}')" title="查看群組詳情">詳情</button>
                </div>
            `;

            // 若目前選擇的是此子群組，標記 active
            if (currentGroup && currentSubgroup && currentGroup.id === group.id && currentSubgroup.id === subgroup.id) {
                subgroupDiv.classList.add('active');
            }
            // 讓整個子群組項目也能被點擊選取，並阻止冒泡
            subgroupDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                const isActionBtn = e.target.closest('.subgroup-actions button');
                if (isActionBtn) return;
                selectGroup(group.id, subgroup.id);
            });
            
            groupDiv.appendChild(subgroupDiv);
        });
        
        groupsList.appendChild(groupDiv);
    });
    
    // 為新生成的組別按鈕添加隨機顏色動畫
    addRandomColorAnimationToGroupButtons();
}

function updateMarkersList() {
    const markersList = document.getElementById('markersList');
    markersList.innerHTML = '';
    
    // 與全域過濾狀態一致，確保即時顯示
    let displayMarkers = getFilteredMarkers();
    
    displayMarkers.forEach(marker => {
        const markerDiv = document.createElement('div');
        markerDiv.className = 'marker-item';
        
        // 檢查是否為當前追蹤目標，如果是則添加特殊樣式
        if (trackingTarget && trackingTarget.id === marker.id) {
            markerDiv.classList.add('tracking-target');
        }
        
        // 獲取群組和子群組信息
        let groupInfo = '';
        if (marker.groupId) {
            const group = groups.find(g => g.id === marker.groupId);
            if (group) {
                groupInfo = `<div class="marker-group-info">組別: ${group.name}`;
                
                if (marker.subgroupId) {
                    const subgroup = group.subgroups?.find(sg => sg.id === marker.subgroupId);
                    if (subgroup) {
                        groupInfo += ` > ${subgroup.name}`;
                    }
                }
                groupInfo += '</div>';
            }
        } else {
            groupInfo = '<div class="marker-group-info">組別: 未分組</div>';
        }
        
        markerDiv.innerHTML = `
            <div class="marker-name" onclick="focusMarker('${marker.id}')">${marker.name}</div>
            <div class="marker-description">${marker.description}</div>
            ${groupInfo}
        `;
        
        markersList.appendChild(markerDiv);
    });
}

function updateMapMarkers() {
    // 清除所有標記
    markers.forEach(marker => {
        if (marker.leafletMarker) {
            map.removeLayer(marker.leafletMarker);
            marker.leafletMarker = null; // 清理引用
        }
    });
    
    // 根據過濾條件重新添加標記
    const filteredMarkers = getFilteredMarkers();
    filteredMarkers.forEach(marker => {
        addMarkerToMap(marker);
    });
}

// 根據當前過濾條件獲取要顯示的標記
function getFilteredMarkers() {
    if (!currentFilter) {
        // 沒有過濾條件時，使用原有的邏輯
        if (currentGroup && currentSubgroup) {
            // 顯示選中子群組的標記
            return markers.filter(m => m.groupId === currentGroup.id && m.subgroupId === currentSubgroup.id);
        } else if (currentGroup) {
            // 顯示選中群組的所有標記（包括子群組的標記）
            return markers.filter(m => m.groupId === currentGroup.id);
        } else {
            // 顯示所有標記
            return markers;
        }
    }
    
    switch (currentFilter.type) {
        case 'marker':
            return markers.filter(marker => marker.id === currentFilter.id);
        case 'group':
            return markers.filter(marker => marker.groupId === currentFilter.id);
        case 'subgroup':
            return markers.filter(marker => marker.subgroupId === currentFilter.id);
        default:
            return markers;
    }
}

// 設定過濾條件
function setFilter(type, id) {
    currentFilter = { type, id };
    updateMapMarkers();
    updateMarkersList(); // 更新標記列表以反映過濾狀態
}

// 清除過濾條件
function clearFilter() {
    currentFilter = null;
    updateMapMarkers();
    updateMarkersList();
}

// 只顯示指定標記
function showOnlyThisMarker(markerId) {
    setFilter('marker', markerId);
}

function focusMarker(markerId) {
    const marker = markers.find(m => m.id === markerId);
    if (marker && marker.leafletMarker) {
        // 添加按壓效果 - 觸覺反饋
        if ('vibrate' in navigator) {
            navigator.vibrate(50); // 短暫振動50毫秒
        }
        
        // 添加視覺按壓效果
        const markerElement = document.querySelector(`[onclick="focusMarker('${markerId}')"]`);
        if (markerElement) {
            markerElement.style.transform = 'scale(0.95)';
            markerElement.style.transition = 'transform 0.1s ease';
            
            // 恢復原始大小
            setTimeout(() => {
                markerElement.style.transform = 'scale(1)';
                setTimeout(() => {
                    markerElement.style.transition = '';
                }, 100);
            }, 100);
        }
        
        closeGroupDetailsModal();
        // 關閉浮動設定視窗（如果開啟的話）
        hideFloatingSettings();
        
        // 添加地圖定位動畫效果
        map.setView([marker.lat, marker.lng], 18, {
            animate: true,
            duration: 0.5
        });
        
        // 延遲打開popup以配合動畫
        setTimeout(() => {
            marker.leafletMarker.openPopup();
            
            // 添加標記閃爍效果
            if (marker.leafletMarker._icon) {
                const icon = marker.leafletMarker._icon;
                icon.style.animation = 'marker-focus-blink 1s ease-in-out';
                
                // 清除動畫
                setTimeout(() => {
                    icon.style.animation = '';
                }, 1000);
            }
        }, 300);
        
        // 顯示定位成功通知
        showNotification(`已定位到 "${marker.name}"`, 'success', 2000);
    }
}

// 通知系統
function showNotification(message, type = 'success', duration = 1000) {
    // 移除現有的通知（避免重疊）
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(notification => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    });
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    
    // 添加圖示
    const icon = document.createElement('span');
    icon.className = 'notification-icon';
    switch(type) {
        case 'success':
            icon.textContent = '✅';
            break;
        case 'error':
            icon.textContent = '❌';
            break;
        case 'warning':
            icon.textContent = '⚠️';
            break;
        case 'info':
            icon.textContent = 'ℹ️';
            break;
        default:
            icon.textContent = '📢';
    }
    
    const messageElement = document.createElement('span');
    messageElement.className = 'notification-message';
    messageElement.textContent = message;
    
    notification.appendChild(icon);
    notification.appendChild(messageElement);
    
    // 確保在全螢幕模式下也能正確顯示
    const fullscreenContainer = document.querySelector('.map-container.fullscreen');
    if (fullscreenContainer) {
        fullscreenContainer.appendChild(notification);
    } else {
        document.body.appendChild(notification);
    }
    
    // 添加點擊關閉功能
    notification.addEventListener('click', () => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    });
    
    // 自動移除
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }
    }, duration);
}

// 位置提醒專用通知函數（3秒自動關閉，支持重複提醒）
let lastLocationNotificationTime = 0;
let lastLocationNotificationMessage = '';

function showAutoCloseNotification(message, type = 'info') {
    const currentTime = Date.now();
    const timeDiff = currentTime - lastLocationNotificationTime;
    
    // 如果是相同訊息且在5秒內，則不重複顯示
    if (message === lastLocationNotificationMessage && timeDiff < 5000) {
        console.log('重複通知被阻止:', message);
        return;
    }
    
    // 更新最後通知時間和訊息
    lastLocationNotificationTime = currentTime;
    lastLocationNotificationMessage = message;
    
    // 使用現有的showNotification函數，設置1秒自動關閉
    showNotification(message, type, 1000);
}

// 群組按鈕提示管理
let groupAlertTimers = new Map(); // 記錄群組提示的定時器

// 顯示群組追蹤圖標（開啟追蹤時立即顯示）
function showGroupTrackingIcon(groupId, subgroupId = null) {
    // 清除之前的追蹤圖標
    clearGroupButtonHighlight();
    
    if (subgroupId) {
        // 為子群組按鈕添加追蹤圖標
        const subgroupElement = document.querySelector(`[data-subgroup-id="${subgroupId}"]`);
        if (subgroupElement) {
            subgroupElement.classList.add('tracking-active');
        }
    } else {
        // 為群組按鈕添加追蹤圖標
        const groupElement = document.querySelector(`[data-group-id="${groupId}"]`);
        if (groupElement) {
            groupElement.classList.add('tracking-active');
        }
    }
}

// 高亮群組按鈕（靠近時添加脈衝動畫）
function highlightGroupButton(groupId, subgroupId = null) {
    // 清除之前的脈衝動畫
    clearSpecificGroupHighlight(groupId, subgroupId);
    
    if (!groupId) return;
    
    if (subgroupId) {
        // 為子群組按鈕添加脈衝動畫
        const subgroupElement = document.querySelector(`[data-subgroup-id="${subgroupId}"]`);
        if (subgroupElement) {
            subgroupElement.classList.add('tracking-alert');
            
            // 滾動到該元素
            subgroupElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // 10秒後自動清除脈衝動畫（但保留圖標）
            const timerId = setTimeout(() => {
                clearSpecificGroupHighlight(null, subgroupId);
            }, 10000);
            
            groupAlertTimers.set(groupId + (subgroupId || ''), timerId);
        }
    } else {
        // 為群組按鈕添加脈衝動畫
        const groupElement = document.querySelector(`[data-group-id="${groupId}"]`);
        if (groupElement) {
            groupElement.classList.add('tracking-alert');
            
            // 滾動到該元素
            groupElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // 10秒後自動清除脈衝動畫（但保留圖標）
            const timerId = setTimeout(() => {
                clearSpecificGroupHighlight(groupId, null);
            }, 10000);
            
            groupAlertTimers.set(groupId + (subgroupId || ''), timerId);
        }
    }
}

// 清除群組按鈕高亮（清除所有追蹤效果）
function clearGroupButtonHighlight() {
    // 清除所有追蹤圖標
    const activeElements = document.querySelectorAll('.tracking-active');
    activeElements.forEach(element => {
        element.classList.remove('tracking-active');
    });
    
    // 清除所有脈衝動畫
    const alertElements = document.querySelectorAll('.tracking-alert');
    alertElements.forEach(element => {
        element.classList.remove('tracking-alert');
    });
    
    // 清除所有定時器
    groupAlertTimers.forEach(timerId => {
        clearTimeout(timerId);
    });
    groupAlertTimers.clear();
}

// 手動清除特定群組的脈衝動畫（保留圖標）
function clearSpecificGroupHighlight(groupId, subgroupId = null) {
    const key = groupId + (subgroupId || '');
    
    // 清除定時器
    if (groupAlertTimers.has(key)) {
        clearTimeout(groupAlertTimers.get(key));
        groupAlertTimers.delete(key);
    }
    
    // 只清除脈衝動畫，保留追蹤圖標
    if (subgroupId) {
        const subgroupElement = document.querySelector(`[data-subgroup-id="${subgroupId}"]`);
        if (subgroupElement) {
            subgroupElement.classList.remove('tracking-alert');
        }
    } else if (groupId) {
        const groupElement = document.querySelector(`[data-group-id="${groupId}"]`);
        if (groupElement) {
            groupElement.classList.remove('tracking-alert');
        }
    }
}

// 暴露函數到全域
window.highlightGroupButton = highlightGroupButton;
window.clearGroupButtonHighlight = clearGroupButtonHighlight;
window.showGroupTrackingIcon = showGroupTrackingIcon;
window.clearSpecificGroupHighlight = clearSpecificGroupHighlight;









// IndexedDB 簡易備援儲存（避免 iOS 背景被滑掉後清空 localStorage）
const IDB_DB_NAME = 'MapAppDB';
const IDB_STORE_NAME = 'kv';
const IDB_VERSION = 1;

function openIdb() {
    return new Promise((resolve, reject) => {
        try {
            const request = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
            request.onerror = () => reject(request.error);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
                    db.createObjectStore(IDB_STORE_NAME, { keyPath: 'key' });
                }
            };
            request.onsuccess = () => resolve(request.result);
        } catch (e) {
            reject(e);
        }
    });
}

async function idbSet(key, value) {
    const db = await openIdb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        const req = store.put({ key, value, timestamp: Date.now() });
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
            console.warn('IndexedDB 交易錯誤:', tx.error);
        };
    });
}

async function idbGet(key) {
    const db = await openIdb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readonly');
        const store = tx.objectStore(IDB_STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
            console.warn('IndexedDB 交易錯誤:', tx.error);
        };
    });
}

async function idbDelete(key) {
    const db = await openIdb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        const req = store.delete(key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
    });
}

// 統一儲存層：優先 IndexedDB，localStorage 作為快取
async function appStorageSet(key, value) {
    try {
        // localStorage 快取（字串或 JSON）
        const lsVal = (typeof value === 'string') ? value : JSON.stringify(value);
        try { localStorage.setItem(key, lsVal); } catch (e) {}
        // IndexedDB 主存
        await idbSet(key, value);
    } catch (error) {
        console.warn(`appStorageSet(${key}) 失敗:`, error);
        try { localStorage.setItem(key, (typeof value === 'string') ? value : JSON.stringify(value)); } catch (e) {}
    }
}

async function appStorageGet(key) {
    try {
        const record = await idbGet(key);
        if (record && typeof record.value !== 'undefined') {
            return record.value;
        }
    } catch (error) {
        console.warn(`appStorageGet(${key}) 讀取 IndexedDB 失敗，改用快取:`, error);
    }
    // fallback: localStorage
    try {
        const lsVal = localStorage.getItem(key);
        if (lsVal === null || lsVal === undefined) return null;
        if (lsVal.startsWith('{') || lsVal.startsWith('[')) {
            try { return JSON.parse(lsVal); } catch (_) { return lsVal; }
        }
        return lsVal;
    } catch (e) {
        return null;
    }
}

async function appStorageRemove(key) {
    try { await idbDelete(key); } catch (e) { console.warn(`刪除 IndexedDB ${key} 失敗`, e); }
    try { localStorage.removeItem(key); } catch (e) {}
}

// 將現有 localStorage 關鍵資料遷移到 IndexedDB
async function migrateLocalStorageToIndexedDB() {
    const keys = [
        'mapAnnotationData',
        'userSettings',
        'hasSeenSetup',
        'buttonPositions',
        'floatingSettingsButtonPosition',
        'pathColorSelection',
        'notificationSoundEnabled',
        'notificationSoundVolume'
    ];
    for (const key of keys) {
        try {
            const existing = await idbGet(key);
            if (existing) continue; // 已存在，不覆蓋
            const lsVal = localStorage.getItem(key);
            if (lsVal !== null && lsVal !== undefined) {
                let value = lsVal;
                if (lsVal.startsWith('{') || lsVal.startsWith('[')) {
                    try { value = JSON.parse(lsVal); } catch (_) {}
                } else if (key === 'notificationSoundVolume') {
                    // 數值轉型
                    const num = parseFloat(lsVal);
                    if (!isNaN(num)) value = num;
                } else if (key === 'notificationSoundEnabled') {
                    value = (lsVal === 'true');
                } else if (key === 'hasSeenSetup') {
                    value = (lsVal === 'true');
                }
                await idbSet(key, value);
                console.log(`已將 ${key} 從 localStorage 遷移至 IndexedDB`);
            }
        } catch (e) {
            console.warn(`遷移鍵 ${key} 失敗:`, e);
        }
    }
}

// 資料持久化
async function saveData() {
    try {
        // 創建不包含 leafletMarker 的標記副本
        const markersToSave = markers.map(marker => ({
            id: marker.id,
            name: marker.name,
            description: marker.description,
            lat: marker.lat,
            lng: marker.lng,
            groupId: marker.groupId,
            subgroupId: marker.subgroupId,
            color: marker.color,
            icon: marker.icon,
            imageData: marker.imageData,
            routeRecords: marker.routeRecords || []
            // 不包含 leafletMarker 屬性
        }));
        
        // 創建不包含 markers 屬性的群組副本
        const groupsToSave = groups.map(group => ({
            id: group.id,
            name: group.name,
            subgroups: group.subgroups.map(subgroup => ({
                id: subgroup.id,
                name: subgroup.name,
                groupId: subgroup.groupId
                // 不包含 markers 屬性
            }))
            // 不包含 markers 屬性
        }));
        
        const data = {
            groups: groupsToSave,
            markers: markersToSave,
            alertDistance: alertDistance,
            alertInterval: alertInterval,
            currentGroup: currentGroup ? { id: currentGroup.id, name: currentGroup.name } : null,
            currentSubgroup: currentSubgroup ? { id: currentSubgroup.id, name: currentSubgroup.name, groupId: currentSubgroup.groupId } : null,
            // 即時定位設定
            enableHighAccuracy: enableHighAccuracy,
            autoStartTracking: autoStartTracking,
            locationUpdateFrequency: locationUpdateFrequency,
            locationTimeout: locationTimeout,
            // 通知設定
            markerNotificationsEnabled: markerNotificationsEnabled
        };
        
        await appStorageSet('mapAnnotationData', data);
        console.log('資料儲存成功');
        
        // 顯示儲存成功通知
        const markerCount = markers.length;
        const groupCount = groups.length;
        const timestamp = new Date().toLocaleString('zh-TW');
        showNotification(
            `✅ 資料儲存成功！\n時間：${timestamp}\n包含：${markerCount} 個標註點，${groupCount} 個群組`, 
            'success', 
            5000
        );
    } catch (error) {
        console.error('儲存資料失敗:', error);
        showNotification(
            `❌ 儲存資料失敗\n錯誤：${error.message}\n請檢查瀏覽器儲存空間`, 
            'error', 
            6000
        );
    }
}

async function loadData() {
    let data = await appStorageGet('mapAnnotationData');
    if (!data) {
        // 舊版本回退：嘗試從 localStorage 字串解析
        try {
            const savedDataStr = localStorage.getItem('mapAnnotationData');
            if (savedDataStr) data = JSON.parse(savedDataStr);
        } catch (e) {}
    }
    
    if (data) {
        try {
            // 重建組別
            groups = data.groups.map(groupData => {
                const group = new Group(groupData.id, groupData.name);
                group.subgroups = groupData.subgroups.map(subgroupData => 
                    new Subgroup(subgroupData.id, subgroupData.name, subgroupData.groupId)
                );
                return group;
            });
            
            // 重建標記
            markers = data.markers.map(markerData => {
                const marker = new Marker(
                    markerData.id,
                    markerData.name,
                    markerData.description,
                    markerData.lat,
                    markerData.lng,
                    markerData.groupId,
                    markerData.subgroupId,
                    markerData.color || 'red',
                    markerData.icon || '📍',
                    markerData.imageData || null
                );
                
                // 恢復路線記錄
                if (markerData.routeRecords && Array.isArray(markerData.routeRecords)) {
                    marker.routeRecords = markerData.routeRecords;
                }
                
                return marker;
            });
            
            // 重建關聯關係
            markers.forEach(marker => {
                const group = groups.find(g => g.id === marker.groupId);
                if (group) {
                    group.addMarker(marker);
                    if (marker.subgroupId) {
                        const subgroup = group.subgroups.find(sg => sg.id === marker.subgroupId);
                        if (subgroup) {
                            subgroup.addMarker(marker);
                        }
                    }
                }
            });
            
            // 恢復設定
            alertDistance = data.alertDistance || 100;
            alertInterval = data.alertInterval || 30;
            
            // 恢復當前群組和子群組的引用
            if (data.currentGroup) {
                currentGroup = groups.find(g => g.id === data.currentGroup.id) || null;
            } else {
                currentGroup = null;
            }
            
            if (data.currentSubgroup && currentGroup) {
                currentSubgroup = currentGroup.subgroups.find(sg => sg.id === data.currentSubgroup.id) || null;
            } else {
                currentSubgroup = null;
            }
            
            // 恢復即時定位設定
            enableHighAccuracy = data.enableHighAccuracy !== undefined ? data.enableHighAccuracy : true;
            autoStartTracking = data.autoStartTracking !== undefined ? data.autoStartTracking : false;
            locationUpdateFrequency = data.locationUpdateFrequency || 3000;
            locationTimeout = data.locationTimeout || 20000;
            
            // 恢復通知設定
            markerNotificationsEnabled = data.markerNotificationsEnabled !== undefined ? data.markerNotificationsEnabled : false;
            
            const alertDistanceEl = getSettingsElement('alertDistance');
            const alertIntervalEl = getSettingsElement('alertInterval');
            if (alertDistanceEl) alertDistanceEl.value = alertDistance;
            if (alertIntervalEl) alertIntervalEl.value = alertInterval;
            
            // 同步通知設定到UI
            const floatingEnableNotifications = document.getElementById('floatingEnableNotifications');
            if (floatingEnableNotifications) {
                floatingEnableNotifications.checked = markerNotificationsEnabled;
            }
            
            // 同步地圖按鈕狀態
            updateNotificationButtonState();
            
            // 更新UI
            updateGroupsList();
            updateMarkersList();
            
            // 在地圖上顯示標記
            markers.forEach(marker => {
                addMarkerToMap(marker);
            });
            
        } catch (error) {
            console.error('載入資料失敗:', error);
            showNotification('載入儲存的資料失敗', 'error');
        }
    }
}

// 封裝：立即保存標註與路線資料到 localStorage
function saveMarkersToStorage() {
    try {
        // 使用既有的 saveData，確保 routeRecords 一併持久化
        saveData();
    } catch (error) {
        console.error('保存標註與路線資料失敗:', error);
        try {
            showNotification('❌ 保存路線資料失敗', 'error');
        } catch (e) {}
    }
}

// 全域函數（供HTML調用）
window.editMarker = editMarker;
window.selectGroup = selectGroup;
window.addSubgroup = addSubgroup;
window.deleteGroup = deleteGroup;
window.deleteSubgroup = deleteSubgroup;
window.focusMarker = focusMarker;
window.setTrackingTarget = setTrackingTarget;
window.clearTrackingTarget = clearTrackingTarget;
window.showOnlyThisMarker = showOnlyThisMarker;
window.editGroupName = editGroupName;
window.editSubgroupName = editSubgroupName;

async function saveCurrentSettings() {
    try {
        // 獲取當前設定值，加入安全檢查
        const enableNotificationsEl = getSettingsElement('enableNotifications');
        const alertDistanceEl = getSettingsElement('alertDistance');
        const alertIntervalEl = getSettingsElement('alertInterval');
        const enableNotificationSoundEl = getSettingsElement('enableNotificationSound');
        const notificationVolumeEl = getSettingsElement('notificationVolume');
        
        if (!enableNotificationsEl || !alertDistanceEl || !alertIntervalEl) {
            throw new Error('設定介面元素未找到');
        }
        
        const enableNotifications = enableNotificationsEl.checked;
        const currentAlertDistance = parseInt(alertDistanceEl.value);
        const currentAlertInterval = parseInt(alertIntervalEl.value);
        const enableNotificationSound = enableNotificationSoundEl ? enableNotificationSoundEl.checked : true;
        const notificationVolume = notificationVolumeEl ? parseFloat(notificationVolumeEl.value) : 0.5;
        
        // 驗證數值
        if (isNaN(currentAlertDistance) || currentAlertDistance < 1) {
            throw new Error('提醒距離必須是有效的正數');
        }
        
        if (isNaN(currentAlertInterval) || currentAlertInterval < 1) {
            throw new Error('提醒間隔必須是有效的正數');
        }
        
        // 準備標註點資料（不包含markers屬性的簡化版本）
        const markersToSave = markers.map(marker => ({
            id: marker.id,
            name: marker.name,
            description: marker.description,
            lat: marker.lat,
            lng: marker.lng,
            groupId: marker.groupId,
            subgroupId: marker.subgroupId,
            color: marker.color,
            icon: marker.icon
        }));
        
        // 準備群組資料（不包含markers屬性）
        const groupsToSave = groups.map(group => ({
            id: group.id,
            name: group.name,
            subgroups: group.subgroups.map(subgroup => ({
                id: subgroup.id,
                name: subgroup.name,
                groupId: subgroup.groupId
            }))
        }));
        
        // 建立完整設定物件
        const settings = {
            // 位置提醒設定
            enableNotifications: enableNotifications,
            alertDistance: currentAlertDistance,
            alertInterval: currentAlertInterval,
            
            // 音效設定
            enableNotificationSound: enableNotificationSound,
            notificationVolume: notificationVolume,
            
            // 地圖設定
            keepMapCentered: keepMapCentered,
            
            // 標註點和群組資料
            markers: markersToSave,
            groups: groupsToSave,
            // 僅保存必要欄位以避免循環引用（Leaflet 物件）
            currentGroup: currentGroup ? { id: currentGroup.id, name: currentGroup.name } : null,
            currentSubgroup: currentSubgroup ? { id: currentSubgroup.id, name: currentSubgroup.name, groupId: currentSubgroup.groupId } : null,
            
            // 儲存時間戳
            savedAt: new Date().toISOString()
        };
        
        // 保存到 IndexedDB（localStorage 作為快取由 appStorageSet 處理）
        await appStorageSet('userSettings', settings);
        
        // 更新全域變數
        alertDistance = currentAlertDistance;
        alertInterval = currentAlertInterval;
        
        const savedDate = new Date(settings.savedAt).toLocaleString('zh-TW');
        const markerCount = markersToSave.length;
        const groupCount = groupsToSave.length;
        showNotification(`設定已儲存 (${savedDate})\n包含 ${markerCount} 個標註點，${groupCount} 個群組`, 'success');
        
        console.log('Settings saved:', settings);
        return true;
    } catch (error) {
        console.error('Error saving settings:', error);
        showNotification('儲存設定時發生錯誤', 'error');
        return false;
    }
}

// 只保存設定，不保存標註點資料
async function saveSettingsOnly() {
    try {
        // 從儲存層讀取現有設定
        const existingSettings = (await appStorageGet('userSettings')) || {};
        
        // 只更新地圖相關設定，保留其他資料
        const updatedSettings = {
            ...existingSettings,
            keepMapCentered: keepMapCentered,
            savedAt: new Date().toISOString()
        };
        
        // 保存到儲存層
        await appStorageSet('userSettings', updatedSettings);
        
        console.log('Settings only saved:', { keepMapCentered });
        return true;
    } catch (error) {
        console.error('Error saving settings only:', error);
        return false;
    }
}

async function loadSavedSettings() {
    try {
        const savedSettings = await appStorageGet('userSettings');
        if (!savedSettings) {
            showNotification('沒有找到已儲存的設定', 'info');
            return false;
        }
        
        const settings = (typeof savedSettings === 'string') ? JSON.parse(savedSettings) : savedSettings;
        
        // 應用位置提醒設定到UI
        if (settings.enableNotifications !== undefined) {
            const enableNotificationsEl = getSettingsElement('enableNotifications');
            if (enableNotificationsEl) {
                enableNotificationsEl.checked = settings.enableNotifications;
            }
        }
        if (settings.alertDistance !== undefined) {
            const alertDistanceEl = getSettingsElement('alertDistance');
            if (alertDistanceEl) {
                alertDistanceEl.value = settings.alertDistance;
            }
            alertDistance = settings.alertDistance;
        }
        if (settings.alertInterval !== undefined) {
            const alertIntervalEl = getSettingsElement('alertInterval');
            if (alertIntervalEl) {
                alertIntervalEl.value = settings.alertInterval;
            }
            alertInterval = settings.alertInterval;
        }
        
        // 應用音效設定到UI
        if (settings.enableNotificationSound !== undefined) {
            const enableNotificationSoundEl = getSettingsElement('enableNotificationSound');
            if (enableNotificationSoundEl) {
                enableNotificationSoundEl.checked = settings.enableNotificationSound;
            }
            // 更新音效系統設定
            if (window.notificationSound) {
                window.notificationSound.setEnabled(settings.enableNotificationSound);
            }
        }
        if (settings.notificationVolume !== undefined) {
            const notificationVolumeEl = getSettingsElement('notificationVolume');
            if (notificationVolumeEl) {
                notificationVolumeEl.value = settings.notificationVolume;
                // 更新音量顯示
                const volumeValueEl = document.querySelector('.volume-value');
                if (volumeValueEl) {
                    volumeValueEl.textContent = Math.round(settings.notificationVolume * 1) + '%';
                }
            }
            // 更新音效系統音量
            if (window.notificationSound) {
                window.notificationSound.setVolume(settings.notificationVolume);
            }
        }
        
        // 應用地圖設定到UI
        if (settings.keepMapCentered !== undefined) {
            const keepMapCenteredEl = getSettingsElement('keepMapCentered');
            if (keepMapCenteredEl) {
                keepMapCenteredEl.checked = settings.keepMapCentered;
            }
            keepMapCentered = settings.keepMapCentered;
        }

        
        // 載入標註點和群組資料（如果存在）
        if (settings.markers && settings.groups) {
            // 清除現有資料
            markers = [];
            groups = [];
            
            // 重建群組結構
            groups = settings.groups.map(groupData => {
                const group = new Group(groupData.id, groupData.name);
                groupData.subgroups.forEach(subgroupData => {
                    const subgroup = new Subgroup(subgroupData.id, subgroupData.name, subgroupData.groupId);
                    group.addSubgroup(subgroup);
                });
                return group;
            });
            
            // 重建標註點
            markers = settings.markers.map(markerData => 
                new Marker(
                    markerData.id,
                    markerData.name,
                    markerData.description,
                    markerData.lat,
                    markerData.lng,
                    markerData.groupId,
                    markerData.subgroupId,
                    markerData.color || 'red',
                    markerData.icon || '📍',
                    markerData.imageData || null
                )
            );
            
            // 將標註點加入對應的群組和子群組
            markers.forEach(marker => {
                const group = groups.find(g => g.id === marker.groupId);
                if (group) {
                    group.addMarker(marker);
                    if (marker.subgroupId) {
                        const subgroup = group.subgroups.find(sg => sg.id === marker.subgroupId);
                        if (subgroup) {
                            subgroup.addMarker(marker);
                        }
                    }
                }
            });
            
            // 恢復當前選擇的群組和子群組
            currentGroup = settings.currentGroup;
            currentSubgroup = settings.currentSubgroup;
            
            // 更新UI
            updateGroupsList();
            updateMarkersList();
            
            // 清除地圖上的現有標記並重新顯示
            updateMapMarkers();
        }
        
        const savedDate = new Date(settings.savedAt).toLocaleString('zh-TW');
        const markerCount = settings.markers ? settings.markers.length : 0;
        const groupCount = settings.groups ? settings.groups.length : 0;
        
        if (markerCount > 0 || groupCount > 0) {
            showNotification(`已載入設定 (儲存於: ${savedDate})\n包含 ${markerCount} 個標註點，${groupCount} 個群組`, 'success');
        } else {
            showNotification(`已載入設定 (儲存於: ${savedDate})`, 'success');
        }
        
        console.log('Settings loaded:', settings);
        return true;
    } catch (error) {
        console.error('Error loading settings:', error);
        showNotification('載入設定時發生錯誤', 'error');
        return false;
    }
}

function resetToDefaultSettings() {
    try {
        // 確認是否要清除所有資料
        const confirmReset = confirm('重置設定將會清除所有標註點和群組資料，確定要繼續嗎？');
        if (!confirmReset) {
            return;
        }
        
        // 重置位置提醒設定為預設值
        const enableNotificationsEl = getSettingsElement('enableNotifications');
        if (enableNotificationsEl) {
            enableNotificationsEl.checked = false;
        }
        markerNotificationsEnabled = false;
        const alertDistanceEl = getSettingsElement('alertDistance');
        if (alertDistanceEl) {
            alertDistanceEl.value = 100;
        }
        const alertIntervalEl = getSettingsElement('alertInterval');
        if (alertIntervalEl) {
            alertIntervalEl.value = 30;
        }
        
        // 更新全域變數
        alertDistance = 100;
        alertInterval = 30;
        
        // 清除地圖上的標記
        markers.forEach(marker => {
            if (marker.leafletMarker) {
                map.removeLayer(marker.leafletMarker);
            }
        });
        
        // 清除標註點和群組資料
        markers = [];
        groups = [];
        currentGroup = null;
        currentSubgroup = null;
        
        // 停止所有提醒
        lastAlerts.clear();
        lastAlertTimes.clear();
        alertTimers.forEach(timer => clearInterval(timer));
        alertTimers.clear();
        markersInRange.clear();
        
        // 停止追蹤
        trackingTarget = null;
        if (isTracking) {
            stopTracking();
        }
        
        // 清除過濾器
        currentFilter = null;
        
        // 更新UI
        updateGroupsList();
        updateMarkersList();
        updateMapMarkers();
        
        // 清除儲存的資料（IndexedDB 主存 + localStorage 快取）
        try { appStorageRemove('mapAnnotationData'); } catch (e) { try { localStorage.removeItem('mapAnnotationData'); } catch (_) {} }
        
        showNotification('已重置為預設設定，所有標註點和群組已清除', 'success');
        console.log('Settings and data reset to defaults');
    } catch (error) {
        console.error('Error resetting settings:', error);
        showNotification('重置設定時發生錯誤', 'error');
    }
}

// 匯出標註點資料
async function exportMarkerData() {
    try {
        // 調試：記錄匯出前的路線狀態
        console.log('匯出前的路線狀態:', {
            displayedRouteLines: window.displayedRouteLines,
            routeCount: window.displayedRouteLines ? Object.keys(window.displayedRouteLines).length : 0
        });
        // 準備匯出資料，包含標註點、群組和設定
        const markersToExport = await Promise.all(markers.map(async marker => {
            let compressedImageData = null;
            
            // 如果有圖片資料，進行壓縮處理
            if (marker.imageData) {
                if (Array.isArray(marker.imageData)) {
                    // 處理多張圖片
                    compressedImageData = await Promise.all(
                        marker.imageData.map(async imageData => {
                            if (typeof imageData === 'string' && imageData.startsWith('data:image/')) {
                                return await compressImage(imageData, 50);
                            }
                            return imageData;
                        })
                    );
                } else if (typeof marker.imageData === 'string' && marker.imageData.startsWith('data:image/')) {
                    // 處理單張圖片
                    compressedImageData = await compressImage(marker.imageData, 50);
                }
            }
            
            return {
                id: marker.id,
                name: marker.name,
                description: marker.description,
                lat: marker.lat,
                lng: marker.lng,
                groupId: marker.groupId,
                subgroupId: marker.subgroupId,
                color: marker.color || 'red',
                icon: marker.icon || '📍',
                imageData: compressedImageData,
                routeRecords: marker.routeRecords || []
            };
        }));
        
        const groupsToExport = groups.map(group => ({
            id: group.id,
            name: group.name,
            subgroups: group.subgroups.map(subgroup => ({
                id: subgroup.id,
                name: subgroup.name,
                groupId: subgroup.groupId
            }))
        }));
        
        const exportData = {
            version: '1.0',
            exportDate: new Date().toISOString(),
            markers: markersToExport,
            groups: groupsToExport,
            settings: {
                alertDistance: alertDistance,
                alertInterval: alertInterval,
                enableNotifications: (() => {
                    const enableNotificationsEl = getSettingsElement('enableNotifications');
                    return enableNotificationsEl ? enableNotificationsEl.checked : false;
                })()
            },
            // 僅保存必要資訊，避免循環引用（如 Leaflet 物件）
            currentGroup: currentGroup ? { id: currentGroup.id, name: currentGroup.name } : null,
            currentSubgroup: currentSubgroup ? { id: currentSubgroup.id, name: currentSubgroup.name, groupId: currentSubgroup.groupId } : null
        };
        
        // 建立下載連結（加入安全序列化回退，避免循環引用）
        let dataStr;
        try {
            dataStr = JSON.stringify(exportData, null, 2);
        } catch (jsonErr) {
            console.warn('JSON.stringify 發生循環引用，改用安全序列化：', jsonErr);
            const seen = new WeakSet();
            const replacer = (key, value) => {
                if (typeof value === 'object' && value !== null) {
                    if (seen.has(value)) return undefined;
                    // 過濾可能的 Leaflet 物件以避免循環
                    if (value._map || value._leaflet_id || value._layers || value._path) return undefined;
                    if (typeof value.addTo === 'function' || typeof value.on === 'function') return undefined;
                    seen.add(value);
                }
                return value;
            };
            dataStr = JSON.stringify(exportData, replacer, 2);
        }
        // 若可用，使用 gzip 壓縮以縮小檔案大小
        const canGzip = typeof window !== 'undefined' && window.pako && typeof window.pako.gzip === 'function';
        
        // 建立下載檔案名稱
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
        let url;
        let filename;
        if (canGzip) {
            try {
                const gzipped = window.pako.gzip(dataStr);
                const gzipBlob = new Blob([gzipped], { type: 'application/gzip' });
                url = URL.createObjectURL(gzipBlob);
                filename = `地圖標註資料_${dateStr}_${timeStr}.json.gz`;
            } catch (gzipErr) {
                console.warn('gzip 壓縮失敗，改用未壓縮 JSON：', gzipErr);
                const dataBlob = new Blob([dataStr], { type: 'application/json' });
                url = URL.createObjectURL(dataBlob);
                filename = `地圖標註資料_${dateStr}_${timeStr}.json`;
            }
        } else {
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            url = URL.createObjectURL(dataBlob);
            filename = `地圖標註資料_${dateStr}_${timeStr}.json`;
        }
        
        // 觸發下載
        const downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = filename;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        
        // 清理URL物件
        URL.revokeObjectURL(url);
        
        const markerCount = markersToExport.length;
        const groupCount = groupsToExport.length;
        
        // 計算路線記錄統計
        let totalRoutes = 0;
        let markersWithRoutes = 0;
        markersToExport.forEach(marker => {
            if (marker.routeRecords && marker.routeRecords.length > 0) {
                totalRoutes += marker.routeRecords.length;
                markersWithRoutes++;
            }
        });
        
        const timestamp = new Date().toLocaleString('zh-TW');
        const routeInfo = totalRoutes > 0 ? `\n路線記錄：${totalRoutes} 條 (${markersWithRoutes} 個標註點)` : '';
        
        showNotification(
            `📤 資料匯出成功！\n檔案：${filename}\n時間：${timestamp}\n包含：${markerCount} 個標註點，${groupCount} 個群組${routeInfo}`, 
            'success', 
            6000
        );
        
        console.log('Data exported successfully:', exportData);
        
        // 調試：記錄匯出後的路線狀態
        console.log('匯出後的路線狀態:', {
            displayedRouteLines: window.displayedRouteLines,
            routeCount: window.displayedRouteLines ? Object.keys(window.displayedRouteLines).length : 0
        });
    } catch (error) {
        console.error('Error exporting data:', error);
        showNotification(
            `❌ 匯出資料失敗\n錯誤：${error.message}\n請檢查檔案權限和儲存空間`, 
            'error', 
            6000
        );
    }
}

// 匯入標註點資料
function importMarkerData(file) {
    try {
        const reader = new FileReader();
        const isGzip = file && file.name && file.name.toLowerCase().endsWith('.gz');
        reader.onload = function(e) {
            try {
                let contentStr;
                if (isGzip) {
                    // 嘗試解壓縮 gzip 檔案
                    const arrayBuffer = e.target.result;
                    try {
                        if (window.pako && typeof window.pako.ungzip === 'function') {
                            contentStr = window.pako.ungzip(new Uint8Array(arrayBuffer), { to: 'string' });
                        } else {
                            throw new Error('缺少解壓縮庫 pako，無法解析 .gz 檔案');
                        }
                    } catch (decompressErr) {
                        console.error('Gzip 解壓失敗：', decompressErr);
                        showNotification(
                            `❌ 解壓縮失敗\n無法解析壓縮檔\n錯誤：${decompressErr.message}`,
                            'error',
                            6000
                        );
                        return;
                    }
                } else {
                    contentStr = e.target.result;
                }
                const importData = JSON.parse(contentStr);
                
                // 驗證資料格式
                if (!importData.markers || !importData.groups) {
                    throw new Error('無效的資料格式');
                }
                
                // 檢查是否有現有資料
                const hasExistingData = markers.length > 0 || groups.length > 0;
                
                if (!hasExistingData) {
                    // 沒有現有資料，直接匯入
                    performDirectImport(importData);
                } else {
                    // 有現有資料，進行比對並顯示選項
                    showImportOptionsModal(importData);
                }
                
            } catch (parseError) {
                console.error('Error parsing imported data:', parseError);
                showNotification(
                    `❌ 檔案格式錯誤\n無法解析 JSON 格式\n錯誤：${parseError.message}`, 
                    'error', 
                    6000
                );
            }
        };
        
        if (isGzip) {
            reader.readAsArrayBuffer(file);
        } else {
            reader.readAsText(file);
        }
        
        // 清空檔案輸入，允許重複選擇同一檔案
        // 注意：只有浮動設定視窗有匯入功能
        const floatingImportInput = document.getElementById('floatingImportFileInput');
        if (floatingImportInput) {
            floatingImportInput.value = '';
        }
        
    } catch (error) {
        console.error('Error importing data:', error);
        showNotification(
            `❌ 匯入資料失敗\n錯誤：${error.message}\n請檢查檔案內容和格式`, 
            'error', 
            6000
        );
    }
}

// 直接匯入（無現有資料時）
function performDirectImport(importData) {
    // 重建群組
    groups = importData.groups.map(groupData => {
        const group = new Group(groupData.id, groupData.name);
        groupData.subgroups.forEach(subgroupData => {
            const subgroup = new Subgroup(subgroupData.id, subgroupData.name, subgroupData.groupId);
            group.addSubgroup(subgroup);
        });
        return group;
    });
    
    // 重建標註點
    markers = importData.markers.map(markerData => {
        const marker = new Marker(
            markerData.id,
            markerData.name,
            markerData.description,
            markerData.lat,
            markerData.lng,
            markerData.groupId,
            markerData.subgroupId,
            markerData.color || 'red',
            markerData.icon || '📍',
            markerData.imageData || null
        );
        
        // 恢復路線記錄
        if (markerData.routeRecords && Array.isArray(markerData.routeRecords)) {
            marker.routeRecords = markerData.routeRecords;
        }
        
        return marker;
    });
    
    // 將標註點加入對應的群組和子群組
    markers.forEach(marker => {
        const group = groups.find(g => g.id === marker.groupId);
        if (group) {
            group.addMarker(marker);
            if (marker.subgroupId) {
                const subgroup = group.subgroups.find(sg => sg.id === marker.subgroupId);
                if (subgroup) {
                    subgroup.addMarker(marker);
                }
            }
        }
    });
    
    // 恢復設定
    if (importData.settings) {
        alertDistance = importData.settings.alertDistance || 100;
        alertInterval = importData.settings.alertInterval || 30;
        
        document.getElementById('alertDistance').value = alertDistance;
        document.getElementById('alertInterval').value = alertInterval;
        if (importData.settings.enableNotifications !== undefined) {
            const enableNotificationsEl = getSettingsElement('enableNotifications');
            if (enableNotificationsEl) {
                enableNotificationsEl.checked = importData.settings.enableNotifications;
            }
        }
    }
    
    // 以 ID 還原目前選取的群組/子群組，避免將整個物件（含 Leaflet 參考）寫回
    if (importData.currentGroup) {
        currentGroup = groups.find(g => g.id === importData.currentGroup.id) || null;
    } else {
        currentGroup = null;
    }
    if (importData.currentSubgroup && currentGroup) {
        currentSubgroup = currentGroup.subgroups.find(sg => sg.id === importData.currentSubgroup.id) || null;
    } else {
        currentSubgroup = null;
    }
    
    updateGroupsList();
    updateMarkersList();
    updateMapMarkers();
    saveData();
    
    const markerCount = importData.markers.length;
    const groupCount = importData.groups.length;
    const importDate = importData.exportDate ? 
        new Date(importData.exportDate).toLocaleString('zh-TW') : '未知';
    
    // 計算路線記錄統計
    let totalRoutes = 0;
    let markersWithRoutes = 0;
    importData.markers.forEach(markerData => {
        if (markerData.routeRecords && markerData.routeRecords.length > 0) {
            totalRoutes += markerData.routeRecords.length;
            markersWithRoutes++;
        }
    });
    
    const routeInfo = totalRoutes > 0 ? `\n路線記錄：${totalRoutes} 條 (${markersWithRoutes} 個標註點)` : '';
    
    showNotification(
        `📥 資料匯入成功！\n` +
        `包含 ${markerCount} 個標註點，${groupCount} 個群組${routeInfo}\n` +
        `(匯出時間: ${importDate})`, 
        'success'
    );
}

// 清除所有資料的輔助函數
function clearAllData() {
    // 清除地圖上的標記
    markers.forEach(marker => {
        if (marker.leafletMarker) {
            map.removeLayer(marker.leafletMarker);
        }
    });
    
    // 清空陣列
    markers = [];
    groups = [];
    currentGroup = null;
    currentSubgroup = null;
    
    // 清除提醒相關的資料
    lastAlerts.clear();
    lastAlertTimes.clear();
    alertTimers.forEach(timer => clearInterval(timer));
    alertTimers.clear();
    markersInRange.clear();
    
    // 停止追蹤
    if (trackingTarget) {
        stopTracking();
    }
    
    // 清除過濾器
    clearFilter();
}

function initSettingsButtons() {
    // 儲存設定按鈕
    const saveBtn = document.getElementById('saveSettingsBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveCurrentSettings);
    }
    
    // 載入設定按鈕
    const loadBtn = document.getElementById('loadSettingsBtn');
    if (loadBtn) {
        loadBtn.addEventListener('click', loadSavedSettings);
    }
    
    // 重置設定按鈕
    const resetBtn = document.getElementById('resetSettingsBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', function() {
            if (confirm('確定要重置所有設定為預設值嗎？')) {
                resetToDefaultSettings();
            }
        });
    }
    
    // 注意：主設定面板的匯入匯出按鈕不存在於 HTML 中
    // 只有浮動設定視窗有這些功能
    
    // 監聽設定變更以即時更新全域變數
    const alertDistanceInput = getSettingsElement('alertDistance');
    const alertIntervalInput = getSettingsElement('alertInterval');
    
    if (alertDistanceInput) {
        alertDistanceInput.addEventListener('change', function() {
            alertDistance = parseInt(this.value);
            console.log('Alert distance updated:', alertDistance);
        });
    }
    
    if (alertIntervalInput) {
        alertIntervalInput.addEventListener('change', function() {
            alertInterval = parseInt(this.value);
            console.log('Alert interval updated:', alertInterval);
            
            // 如果正在追蹤，重新啟動距離檢查定時器以使用新間隔
            if (trackingTarget && proximityCheckTimer) {
                startProximityCheck();
            }
        });
    }
}

// 在應用初始化時載入已儲存的設定
async function loadSettingsOnInit() {
    try {
        const settings = await appStorageGet('userSettings');
        if (settings) {
            // 若從 localStorage 取得字串，嘗試解析
            const parsed = (typeof settings === 'string') ? JSON.parse(settings) : settings;
            
            // 應用設定到UI
            const enableNotificationsEl = getSettingsElement('enableNotifications');
            if (enableNotificationsEl) {
                enableNotificationsEl.checked = parsed.enableNotifications;
            }
            const alertDistanceEl = document.getElementById('alertDistance');
            const alertIntervalEl = document.getElementById('alertInterval');
            
            if (alertDistanceEl) {
                alertDistanceEl.value = parsed.alertDistance;
            }
            if (alertIntervalEl) {
                alertIntervalEl.value = parsed.alertInterval;
            }
            
            // 更新全域變數
            alertDistance = parsed.alertDistance;
            alertInterval = parsed.alertInterval;
            
            console.log('Settings loaded on init:', parsed);
        }
    } catch (error) {
        console.error('Error loading settings on init:', error);
    }
}

// 隨機顏色功能
function applyRandomColorToAddBtn() {
    const colors = ['red', 'blue', 'purple', 'orange', 'pink'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const addBtn = document.getElementById('addGroupBtn');
    
    // 移除所有顏色類別
    colors.forEach(color => {
        addBtn.classList.remove(`color-${color}`);
    });
    
    // 添加隨機顏色類別
    addBtn.classList.add(`color-${randomColor}`);
}

// 為組別內的按鈕添加隨機顏色動畫
function addRandomColorAnimationToGroupButtons() {
    const groupButtons = document.querySelectorAll('.group-actions button');
    groupButtons.forEach((button, index) => {
        // 為每個按鈕添加延遲動畫
        button.style.animationDelay = `${index * 0.1}s`;
        
        // 添加點擊時的隨機顏色變化
        button.addEventListener('click', function() {
            const colors = ['#667eea', '#f093fb', '#4facfe', '#43e97b', '#fa709a'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];
            
            // 創建臨時的顏色變化效果
            this.style.background = randomColor;
            setTimeout(() => {
                this.style.background = '';
            }, 300);
        });
    });
}

// 顯示匯入選項模態框
function showImportOptionsModal(importData) {
    const modal = document.getElementById('importOptionsModal');
    const comparisonInfo = document.getElementById('comparisonInfo');
    const duplicateDetails = document.getElementById('duplicateDetails');
    
    // 比對資料
    const comparison = compareImportData(importData);
    
    // 顯示比對資訊
    comparisonInfo.innerHTML = `
        <div class="comparison-summary">
            <h4>資料比對結果</h4>
            <div class="comparison-stats">
                <div class="stat-item">
                    <span class="stat-label">匯入檔案：</span>
                    <span class="stat-value">${importData.markers.length} 個標註點，${importData.groups.length} 個群組</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">目前資料：</span>
                    <span class="stat-value">${markers.length} 個標註點，${groups.length} 個群組</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">重複標註點：</span>
                    <span class="stat-value">${comparison.duplicateMarkers.length} 個</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">新增標註點：</span>
                    <span class="stat-value">${comparison.newMarkers.length} 個</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">匯入路線記錄：</span>
                    <span class="stat-value">${comparison.importRouteCount} 條</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">現有路線記錄：</span>
                    <span class="stat-value">${comparison.existingRouteCount} 條</span>
                </div>
            </div>
        </div>
    `;
    
    // 顯示重複詳情
    if (comparison.duplicateMarkers.length > 0) {
        duplicateDetails.innerHTML = `
            <h4>重複的標註點</h4>
            <div class="duplicate-list">
                ${comparison.duplicateMarkers.map(dup => `
                    <div class="duplicate-item">
                        <div class="duplicate-name">${dup.import.name}</div>
                        <div class="duplicate-location">位置: ${dup.import.lat.toFixed(6)}, ${dup.import.lng.toFixed(6)}</div>
                        <div class="duplicate-comparison">
                            <span class="existing">現有: ${dup.existing.description || '無描述'}</span>
                            <span class="importing">匯入: ${dup.import.description || '無描述'}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    } else {
        duplicateDetails.innerHTML = '<p>沒有發現重複的標註點</p>';
    }
    
    // 儲存匯入資料供後續使用
    modal.importData = importData;
    modal.comparison = comparison;
    
    // 設置預設選項為"合併匯入"
    const defaultOption = document.getElementById('importMerge');
    if (defaultOption) {
        defaultOption.checked = true;
        // 初始化視覺反饋
        document.querySelectorAll('.import-option').forEach(option => {
            option.classList.remove('selected');
        });
        defaultOption.closest('.import-option').classList.add('selected');
    }
    
    modal.style.display = 'block';
}

// 比對匯入資料與現有資料
function compareImportData(importData) {
    const duplicateMarkers = [];
    const newMarkers = [];
    const LOCATION_THRESHOLD = 0.0001; // 約10公尺的誤差範圍
    
    // 計算路線記錄統計
    let importRouteCount = 0;
    let existingRouteCount = 0;
    
    // 計算匯入資料中的路線記錄總數
    importData.markers.forEach(marker => {
        if (marker.routeRecords && Array.isArray(marker.routeRecords)) {
            importRouteCount += marker.routeRecords.length;
        }
    });
    
    // 計算現有資料中的路線記錄總數
    markers.forEach(marker => {
        if (marker.routeRecords && Array.isArray(marker.routeRecords)) {
            existingRouteCount += marker.routeRecords.length;
        }
    });
    
    importData.markers.forEach(importMarker => {
        const existingMarker = markers.find(existing => {
            const latDiff = Math.abs(existing.lat - importMarker.lat);
            const lngDiff = Math.abs(existing.lng - importMarker.lng);
            return latDiff < LOCATION_THRESHOLD && lngDiff < LOCATION_THRESHOLD;
        });
        
        if (existingMarker) {
            duplicateMarkers.push({
                existing: existingMarker,
                import: importMarker
            });
        } else {
            newMarkers.push(importMarker);
        }
    });
    
    return {
        duplicateMarkers,
        newMarkers,
        totalImport: importData.markers.length,
        totalExisting: markers.length,
        importRouteCount,
        existingRouteCount
    };
}

// 處理匯入選項
function handleImportOption(option) {
    const modal = document.getElementById('importOptionsModal');
    const importData = modal.importData;
    const comparison = modal.comparison;
    
    switch (option) {
        case 'merge':
            // 只增加新的標註點
            performMergeImport(importData, comparison);
            const mergeTimestamp = new Date().toLocaleString('zh-TW');
            
            // 計算新增標註點的路線記錄統計
            let newRoutes = 0;
            let newMarkersWithRoutes = 0;
            comparison.newMarkers.forEach(markerData => {
                if (markerData.routeRecords && markerData.routeRecords.length > 0) {
                    newRoutes += markerData.routeRecords.length;
                    newMarkersWithRoutes++;
                }
            });
            
            const newRouteInfo = newRoutes > 0 ? `\n新增路線記錄：${newRoutes} 條 (${newMarkersWithRoutes} 個標註點)` : '';
            
            showNotification(
                `📥 資料合併匯入成功！\n時間：${mergeTimestamp}\n新增：${comparison.newMarkers.length} 個標註點${newRouteInfo}\n原有資料保持不變`, 
                'success', 
                6000
            );
            break;
            
        case 'update':
            // 更新重複的，增加新的
            performUpdateImport(importData, comparison);
            
            // 計算路線記錄統計
            let updatedRoutes = 0;
            let updatedMarkersWithRoutes = 0;
            let updateNewRoutes = 0;
            let updateNewMarkersWithRoutes = 0;
            
            comparison.duplicateMarkers.forEach(markerData => {
                if (markerData.routeRecords && markerData.routeRecords.length > 0) {
                    updatedRoutes += markerData.routeRecords.length;
                    updatedMarkersWithRoutes++;
                }
            });
            
            comparison.newMarkers.forEach(markerData => {
                if (markerData.routeRecords && markerData.routeRecords.length > 0) {
                    updateNewRoutes += markerData.routeRecords.length;
                    updateNewMarkersWithRoutes++;
                }
            });
            
            const routeUpdateInfo = updatedRoutes > 0 ? `\n更新路線記錄：${updatedRoutes} 條 (${updatedMarkersWithRoutes} 個標註點)` : '';
            const routeNewInfo = updateNewRoutes > 0 ? `\n新增路線記錄：${updateNewRoutes} 條 (${updateNewMarkersWithRoutes} 個標註點)` : '';
            
            showNotification(
                `📥 資料更新匯入成功！\n已更新 ${comparison.duplicateMarkers.length} 個重複標註點，新增 ${comparison.newMarkers.length} 個新標註點${routeUpdateInfo}${routeNewInfo}`, 
                'success',
                6000
            );
            break;
    }
    
    modal.style.display = 'none';
}

// 生成唯一ID
function generateId() {
    return Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
}

// 合併匯入（只增加新的）
function performMergeImport(importData, comparison) {
    // 建立群組映射表，用於追蹤匯入群組與現有群組的對應關係
    const groupMapping = new Map(); // importGroupId -> existingGroupId
    const subgroupMapping = new Map(); // importSubgroupId -> existingSubgroupId
    
    // 處理群組
    importData.groups.forEach(importGroup => {
        let targetGroup = groups.find(g => g.name === importGroup.name);
        
        if (!targetGroup) {
            // 如果群組名稱不存在，創建新群組
            targetGroup = new Group(generateId(), importGroup.name);
            groups.push(targetGroup);
        }
        
        // 記錄群組映射
        groupMapping.set(importGroup.id, targetGroup.id);
        
        // 處理子群組
        importGroup.subgroups.forEach(importSubgroup => {
            let targetSubgroup = targetGroup.subgroups.find(sg => sg.name === importSubgroup.name);
            
            if (!targetSubgroup) {
                // 如果子群組名稱不存在，創建新子群組
                targetSubgroup = new Subgroup(generateId(), importSubgroup.name, targetGroup.id);
                targetGroup.addSubgroup(targetSubgroup);
            }
            
            // 記錄子群組映射
            subgroupMapping.set(importSubgroup.id, targetSubgroup.id);
        });
    });
    
    // 只添加新的標註點
    comparison.newMarkers.forEach(markerData => {
        let targetGroupId = groupMapping.get(markerData.groupId);
        let targetSubgroupId = markerData.subgroupId ? subgroupMapping.get(markerData.subgroupId) : null;
        
        // 如果群組映射失敗，創建一個預設群組
        if (!targetGroupId) {
            console.warn(`群組映射失敗，為標記 "${markerData.name}" 創建預設群組`);
            let defaultGroup = groups.find(g => g.name === '匯入的標註點');
            if (!defaultGroup) {
                defaultGroup = new Group(generateId(), '匯入的標註點');
                groups.push(defaultGroup);
            }
            targetGroupId = defaultGroup.id;
            targetSubgroupId = null; // 重置子群組
        }
        
        const targetGroup = groups.find(g => g.id === targetGroupId);
        
        if (targetGroup) {
            const newMarker = new Marker(
                generateId(),
                markerData.name,
                markerData.description,
                markerData.lat,
                markerData.lng,
                targetGroupId,
                targetSubgroupId,
                markerData.color || 'red',
                markerData.icon || '📍',
                markerData.imageData || null
            );
            
            // 恢復路線記錄
            if (markerData.routeRecords && Array.isArray(markerData.routeRecords)) {
                newMarker.routeRecords = markerData.routeRecords;
                console.log(`為標記 "${markerData.name}" 恢復了 ${markerData.routeRecords.length} 條路線記錄`);
            }
            
            markers.push(newMarker);
            targetGroup.addMarker(newMarker);
            
            // 如果有子群組，也要加入子群組
            if (targetSubgroupId) {
                const targetSubgroup = targetGroup.subgroups.find(sg => sg.id === targetSubgroupId);
                if (targetSubgroup) {
                    targetSubgroup.addMarker(newMarker);
                }
            }
        } else {
            console.error(`無法找到目標群組，跳過標記 "${markerData.name}"`);
        }
    });
    
    updateGroupsList();
    updateMarkersList();
    updateMapMarkers();
    saveData();
}

// 更新匯入（更新重複的，增加新的）
function performUpdateImport(importData, comparison) {
    // 建立群組和子群組映射表
    const groupMapping = new Map(); // 原始群組ID -> 新群組ID
    const subgroupMapping = new Map(); // 原始子群組ID -> 新子群組ID
    
    // 處理新群組
    importData.groups.forEach(importGroup => {
        let existingGroup = groups.find(g => g.name === importGroup.name);
        if (!existingGroup) {
            // 創建新群組
            existingGroup = new Group(generateId(), importGroup.name);
            groups.push(existingGroup);
        }
        groupMapping.set(importGroup.id, existingGroup.id);
        
        // 處理子群組
        importGroup.subgroups.forEach(subgroupData => {
            let existingSubgroup = existingGroup.subgroups.find(sg => sg.name === subgroupData.name);
            if (!existingSubgroup) {
                // 創建新子群組
                existingSubgroup = new Subgroup(generateId(), subgroupData.name, existingGroup.id);
                existingGroup.addSubgroup(existingSubgroup);
            }
            subgroupMapping.set(subgroupData.id, existingSubgroup.id);
        });
    });
    
    // 添加新的標註點
    comparison.newMarkers.forEach(markerData => {
        let targetGroupId = groupMapping.get(markerData.groupId);
        let targetSubgroupId = markerData.subgroupId ? subgroupMapping.get(markerData.subgroupId) : null;
        
        // 如果群組映射失敗，創建一個預設群組
        if (!targetGroupId) {
            console.warn(`群組映射失敗，為標記 "${markerData.name}" 創建預設群組`);
            let defaultGroup = groups.find(g => g.name === '匯入的標註點');
            if (!defaultGroup) {
                defaultGroup = new Group(generateId(), '匯入的標註點');
                groups.push(defaultGroup);
            }
            targetGroupId = defaultGroup.id;
            targetSubgroupId = null; // 重置子群組
        }
        
        const targetGroup = groups.find(g => g.id === targetGroupId);
        
        if (targetGroup) {
            const newMarker = new Marker(
                generateId(),
                markerData.name,
                markerData.description,
                markerData.lat,
                markerData.lng,
                targetGroupId,
                targetSubgroupId,
                markerData.color || 'red',
                markerData.icon || '📍',
                markerData.imageData || null
            );
            
            // 恢復路線記錄
            if (markerData.routeRecords && Array.isArray(markerData.routeRecords)) {
                newMarker.routeRecords = markerData.routeRecords;
                console.log(`為標記 "${markerData.name}" 恢復了 ${markerData.routeRecords.length} 條路線記錄`);
            }
            
            markers.push(newMarker);
            targetGroup.addMarker(newMarker);
            
            // 如果有子群組，也要加入子群組
            if (targetSubgroupId) {
                const targetSubgroup = targetGroup.subgroups.find(sg => sg.id === targetSubgroupId);
                if (targetSubgroup) {
                    targetSubgroup.addMarker(newMarker);
                }
            }
        } else {
            console.error(`無法找到目標群組，跳過標記 "${markerData.name}"`);
        }
    });
    
    // 更新重複的標註點
    comparison.duplicateMarkers.forEach(dup => {
        const existingMarker = dup.existing;
        const importMarker = dup.import;
        
        // 更新標註點資訊
        existingMarker.name = importMarker.name;
        existingMarker.description = importMarker.description;
        existingMarker.color = importMarker.color || existingMarker.color;
        existingMarker.icon = importMarker.icon || existingMarker.icon;
        if (importMarker.imageData) {
            existingMarker.imageData = importMarker.imageData;
        }
        
        // 合併路線記錄
        if (importMarker.routeRecords && Array.isArray(importMarker.routeRecords)) {
            if (!existingMarker.routeRecords) {
                existingMarker.routeRecords = [];
            }
            
            // 合併路線記錄，避免重複
            importMarker.routeRecords.forEach(importRoute => {
                // 檢查是否已存在相同的路線記錄（基於創建時間和距離）
                const isDuplicate = existingMarker.routeRecords.some(existingRoute => {
                    return existingRoute.createdAt === importRoute.createdAt && 
                           Math.abs(existingRoute.distance - importRoute.distance) < 10; // 10公尺誤差
                });
                
                if (!isDuplicate) {
                    existingMarker.routeRecords.push(importRoute);
                }
            });
            
            // 限制路線記錄數量，保留最新的10條
            if (existingMarker.routeRecords.length > 10) {
                existingMarker.routeRecords.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                existingMarker.routeRecords = existingMarker.routeRecords.slice(0, 10);
            }
        }
    });
    
    updateGroupsList();
    updateMarkersList();
    updateMapMarkers();
    saveData();
}

// 關閉匯入選項模態框
function closeImportOptionsModal() {
    document.getElementById('importOptionsModal').style.display = 'none';
}

// 顯示組別詳情模態框
function showGroupDetailsModal(groupId, subgroupId = null) {
    const modal = document.getElementById('groupDetailsModal');
    const title = document.getElementById('groupDetailsTitle');
    const stats = document.getElementById('groupDetailsStats');
    const markersList = document.getElementById('groupDetailsMarkersList');
    
    let targetGroup, targetSubgroup, targetMarkers, titleText;
    
    if (subgroupId) {
        // 顯示子群組詳情
        targetGroup = groups.find(g => g.id === groupId);
        targetSubgroup = targetGroup?.subgroups.find(sg => sg.id === subgroupId);
        targetMarkers = markers.filter(m => m.groupId === groupId && m.subgroupId === subgroupId);
        titleText = `${targetGroup?.name} - ${targetSubgroup?.name}`;
    } else {
        // 顯示群組詳情
        targetGroup = groups.find(g => g.id === groupId);
        targetMarkers = markers.filter(m => m.groupId === groupId);
        titleText = targetGroup?.name;
    }
    
    if (!targetGroup) return;
    
    // 設定標題
    title.textContent = titleText;
    
    // 設定統計資訊
    stats.innerHTML = `
        <div class="stats-item">
            <span class="stats-label">標註點數量：</span>
            <span class="stats-value">${targetMarkers.length}</span>
        </div>
        <div class="stats-item">
            <span class="stats-label">群組：</span>
            <span class="stats-value">${targetGroup.name}</span>
        </div>
        ${subgroupId ? `
        <div class="stats-item">
            <span class="stats-label">子群組：</span>
            <span class="stats-value">${targetSubgroup.name}</span>
        </div>
        ` : ''}
    `;
    
    // 設定標註點列表
    if (targetMarkers.length > 0) {
        markersList.innerHTML = targetMarkers.map(marker => {
            const markerGroup = groups.find(g => g.id === marker.groupId);
            const markerSubgroup = markerGroup?.subgroups.find(sg => sg.id === marker.subgroupId);
            
            // 檢查是否為當前追蹤目標，決定是否顯示位置圖標
            const isTrackingTarget = trackingTarget && trackingTarget.id === marker.id;
            const markerNameDisplay = isTrackingTarget ? `📍 ${marker.name}` : marker.name;
            
            return `
            <div class="group-details-marker-item">
                <div class="marker-info">
                    <div class="marker-name">${markerNameDisplay}</div>
                    <div class="marker-description">${marker.description || '無描述'}</div>
                    <div class="marker-group-info">
                        群組: ${markerGroup?.name || '未分組'}${markerSubgroup ? ` - ${markerSubgroup.name}` : ''}
                    </div>
                    <div class="marker-location">位置: ${marker.lat.toFixed(6)}, ${marker.lng.toFixed(6)}</div>
                </div>
                <div class="marker-actions">
                    <button onclick="focusMarker('${marker.id}')" class="btn-focus">定位</button>
                    <button onclick="editMarker('${marker.id}')" class="btn-edit">編輯</button>
                </div>
            </div>
        `;
        }).join('');
    } else {
        markersList.innerHTML = '<p class="no-markers">此群組目前沒有標註點</p>';
    }
    
    // 儲存當前群組資訊供按鈕使用
    modal.currentGroupId = groupId;
    modal.currentSubgroupId = subgroupId;
    
    modal.style.display = 'block';
}

// 關閉組別詳情模態框
function closeGroupDetailsModal() {
    document.getElementById('groupDetailsModal').style.display = 'none';
}

// 顯示所有標註點
function showAllMarkersInGroup() {
    const modal = document.getElementById('groupDetailsModal');
    const groupId = modal.currentGroupId;
    const subgroupId = modal.currentSubgroupId;
    
    if (subgroupId) {
        setFilter('subgroup', subgroupId);
    } else {
        setFilter('group', groupId);
    }
    
    closeGroupDetailsModal();
    showNotification('已顯示該群組的所有標註點', 'success');
}

// 隱藏所有標註點
function hideAllMarkersInGroup() {
    clearFilter();
    closeGroupDetailsModal();
    showNotification('已隱藏所有標註點', 'success');
}

// 居中顯示群組標註點
function centerToGroupMarkers() {
    const modal = document.getElementById('groupDetailsModal');
    const groupId = modal.currentGroupId;
    const subgroupId = modal.currentSubgroupId;
    
    let targetMarkers;
    if (subgroupId) {
        targetMarkers = markers.filter(m => m.groupId === groupId && m.subgroupId === subgroupId);
    } else {
        targetMarkers = markers.filter(m => m.groupId === groupId);
    }
    
    if (targetMarkers.length === 0) {
        showNotification('該群組沒有標註點可以居中顯示', 'warning');
        return;
    }
    
    if (targetMarkers.length === 1) {
        // 只有一個標註點，直接居中
        const marker = targetMarkers[0];
        map.setView([marker.lat, marker.lng], 16);
    } else {
        // 多個標註點，計算邊界並適配視圖
        const bounds = L.latLngBounds(targetMarkers.map(m => [m.lat, m.lng]));
        map.fitBounds(bounds, { padding: [20, 20] });
    }
    
    closeGroupDetailsModal();
    showNotification('已居中顯示群組標註點', 'success');
}

// 顯示全部詳情模態框
function showAllDetailsModal() {
    // 關閉浮動設定視窗
    hideFloatingSettings();
    
    const modal = document.getElementById('allDetailsModal');
    const totalGroupsCount = document.getElementById('totalGroupsCount');
    const totalMarkersCount = document.getElementById('totalMarkersCount');
    const allDetailsContent = document.getElementById('allDetailsContent');
    
    // 更新統計資訊
    totalGroupsCount.textContent = `${groups.length} 個組別`;
    totalMarkersCount.textContent = `${markers.length} 個標註點`;
    
    // 生成所有組別群組內容
    let contentHTML = '';
    
    if (groups.length === 0) {
        contentHTML = '<div style="text-align: center; color: #718096; padding: 40px;">尚未建立任何組別</div>';
    } else {
        groups.forEach(group => {
            const groupMarkers = markers.filter(m => m.groupId === group.id);
            const subgroups = group.subgroups || [];
            
            contentHTML += `
                <div class="all-details-group">
                    <div class="all-details-group-header">
                        <div class="all-details-group-name">${group.name}</div>
                        <div class="all-details-group-count">${groupMarkers.length} 個標註點</div>
                    </div>
            `;
            
            if (subgroups.length > 0) {
                contentHTML += '<div class="all-details-subgroups">';
                subgroups.forEach(subgroup => {
                    const subgroupMarkers = markers.filter(m => m.groupId === group.id && m.subgroupId === subgroup.id);
                    contentHTML += `
                        <div class="all-details-subgroup">
                            <div class="all-details-subgroup-name">${subgroup.name}</div>
                            <div class="all-details-subgroup-count">${subgroupMarkers.length} 個標註點</div>
                        </div>
                    `;
                });
                contentHTML += '</div>';
            } else {
                // 如果沒有子群組，顯示直接屬於組別的標註點
                const directMarkers = markers.filter(m => m.groupId === group.id && !m.subgroupId);
                if (directMarkers.length > 0) {
                    contentHTML += `
                        <div class="all-details-subgroups">
                            <div class="all-details-subgroup">
                                <div class="all-details-subgroup-name">直接標註點</div>
                                <div class="all-details-subgroup-count">${directMarkers.length} 個標註點</div>
                            </div>
                        </div>
                    `;
                }
            }
            
            contentHTML += '</div>';
        });
    }
    
    allDetailsContent.innerHTML = contentHTML;
    modal.style.display = 'block';
}

// 關閉全部詳情模態框
function closeAllDetailsModal() {
    document.getElementById('allDetailsModal').style.display = 'none';
}

// 將函數暴露到全域範圍
window.handleImportOption = handleImportOption;
window.closeImportOptionsModal = closeImportOptionsModal;
window.showGroupDetailsModal = showGroupDetailsModal;
window.closeGroupDetailsModal = closeGroupDetailsModal;
window.showAllMarkersInGroup = showAllMarkersInGroup;
window.hideAllMarkersInGroup = hideAllMarkersInGroup;
window.centerToGroupMarkers = centerToGroupMarkers;
window.showAllDetailsModal = showAllDetailsModal;
window.closeAllDetailsModal = closeAllDetailsModal;

// 浮動設定按鈕功能
function initFloatingSettings() {
    const floatingBtn = document.getElementById('floatingSettingsBtn');
    const floatingModal = document.getElementById('floatingSettingsModal');
    const closeBtn = document.getElementById('closeFloatingSettings');
    
    if (!floatingBtn || !floatingModal || !closeBtn) {
        console.warn('浮動設定元素未找到');
        return;
    }
    
    // 使浮動按鈕可拖拽（拖拽處理器會處理點擊事件）
    makeFloatingButtonDraggable(floatingBtn);
    
    // 點擊關閉按鈕
    closeBtn.addEventListener('click', function() {
        hideFloatingSettings();
    });
    
    // 點擊背景關閉視窗
    floatingModal.addEventListener('click', function(e) {
        if (e.target === floatingModal) {
            hideFloatingSettings();
        }
    });
    
    // 初始化浮動設定的事件監聽器
    initFloatingSettingsEventListeners();
    
    // 載入按鈕位置
    loadFloatingButtonPosition();
}

function makeFloatingButtonDraggable(element) {
    let isDragging = false;
    let startX, startY, initialX, initialY;
    let dragThreshold = 10; // 拖拽閾值
    let hasMoved = false;
    let startTime = 0;
    
    function handleStart(e) {
        isDragging = true;
        hasMoved = false;
        startTime = Date.now();
        
        const clientX = e.type === 'mousedown' ? e.clientX : e.touches[0].clientX;
        const clientY = e.type === 'mousedown' ? e.clientY : e.touches[0].clientY;
        
        startX = clientX;
        startY = clientY;
        
        const rect = element.getBoundingClientRect();
        initialX = rect.left;
        initialY = rect.top;
        
        element.style.transition = 'none';
        
        // 為觸控事件提供視覺反饋
        if (e.type === 'touchstart') {
            element.style.transform = 'scale(0.95)';
        }
    }
    
    function handleMove(e) {
        if (!isDragging) return;
        
        const clientX = e.type === 'mousemove' ? e.clientX : e.touches[0].clientX;
        const clientY = e.type === 'mousemove' ? e.clientY : e.touches[0].clientY;
        
        const deltaX = clientX - startX;
        const deltaY = clientY - startY;
        
        // 檢查是否超過拖拽閾值
        if (!hasMoved && (Math.abs(deltaX) > dragThreshold || Math.abs(deltaY) > dragThreshold)) {
            hasMoved = true;
        }
        
        if (hasMoved) {
            const newX = initialX + deltaX;
            const newY = initialY + deltaY;
            
            // 限制在視窗範圍內
            const maxX = window.innerWidth - element.offsetWidth;
            const maxY = window.innerHeight - element.offsetHeight;
            
            const constrainedX = Math.max(0, Math.min(newX, maxX));
            const constrainedY = Math.max(0, Math.min(newY, maxY));
            
            element.style.left = constrainedX + 'px';
            element.style.top = constrainedY + 'px';
            element.style.right = 'auto';
            element.style.bottom = 'auto';
            
            e.preventDefault();
        }
    }
    
    function handleEnd(e) {
        if (isDragging) {
            isDragging = false;
            element.style.transition = '';
            element.style.transform = ''; // 恢復視覺狀態
            
            const endTime = Date.now();
            const touchDuration = endTime - startTime;
            
            // 如果有移動，保存位置並阻止點擊
            if (hasMoved) {
                console.log('Button was dragged, saving position');
                const rect = element.getBoundingClientRect();
                saveFloatingButtonPosition(rect.left, rect.top);
                e.preventDefault();
                e.stopPropagation();
            } else if (touchDuration < 500) {
                // 如果沒有移動且觸控時間短，這是一個有效的點擊
                console.log('Valid click detected, duration:', touchDuration);
                e.preventDefault();
                e.stopPropagation();
                // 延遲執行以確保事件完全處理
                setTimeout(() => {
                    console.log('Opening settings after valid click');
                    showFloatingSettings();
                }, 50);
            } else {
                // 觸控時間過長，視為長按，阻止點擊
                console.log('Touch duration too long, preventing click:', touchDuration);
                e.preventDefault();
                e.stopPropagation();
            }
        }
    }
    
    // 滑鼠事件
    element.addEventListener('mousedown', handleStart);
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    
    // 觸控事件
    element.addEventListener('touchstart', handleStart, { passive: false });
    document.addEventListener('touchmove', handleMove, { passive: false });
    element.addEventListener('touchend', handleEnd, { passive: false });
}

function showFloatingSettings() {
    console.log('showFloatingSettings called');
    const modal = document.getElementById('floatingSettingsModal');
    console.log('Modal element found:', !!modal);
    if (modal) {
        console.log('Current modal display style:', modal.style.display);
        console.log('Current modal computed style:', window.getComputedStyle(modal).display);
        
        // 強制設定樣式
        modal.style.display = 'flex';
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.zIndex = '20000'; /* 提高z-index確保在最上層 */
        modal.style.background = 'rgba(0, 0, 0, 0.5)';
        
        // 如果處於全螢幕模式，確保modal在正確的容器中
        if (isFullscreen) {
            const fullscreenContainer = document.querySelector('.map-container.fullscreen');
            if (fullscreenContainer) {
                // 強制將modal移到全螢幕容器中
                fullscreenContainer.appendChild(modal);
                
                // 確保modal的樣式正確
                setTimeout(() => {
                    modal.style.position = 'fixed';
                    modal.style.zIndex = '20000'; /* 提高z-index確保在最上層 */
                    modal.style.left = '0';
                    modal.style.top = '0';
                    modal.style.width = '100vw';
                    modal.style.height = '100vh';
                    modal.style.display = 'flex'; /* 確保顯示 */
                    modal.style.alignItems = 'center';
                    modal.style.justifyContent = 'center';
                }, 10);
            }
        }
        
        console.log('Setting modal display to flex');
        console.log('Modal display after setting:', modal.style.display);
        
        setTimeout(() => {
            console.log('Adding show class to modal');
            modal.classList.add('show');
            console.log('Modal classes:', modal.className);
            console.log('Modal visibility:', window.getComputedStyle(modal).visibility);
            console.log('Modal opacity:', window.getComputedStyle(modal).opacity);
        }, 10);
        
        // 同步設定值
        syncFloatingSettingsValues();
    } else {
        console.error('floatingSettingsModal element not found!');
    }
}

function hideFloatingSettings() {
    const modal = document.getElementById('floatingSettingsModal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            modal.style.display = 'none';
            
            // 如果modal被移到全螢幕容器中，將其移回原來的位置
            if (isFullscreen) {
                const fullscreenContainer = document.querySelector('.map-container.fullscreen');
                if (fullscreenContainer && fullscreenContainer.contains(modal)) {
                    document.body.appendChild(modal);
                }
            }
        }, 300);
    }
}

function syncFloatingSettingsValues() {
    // 從全域變數同步設定值到浮動設定視窗
    const floatingEnableNotifications = document.getElementById('floatingEnableNotifications');
    if (floatingEnableNotifications) {
        floatingEnableNotifications.checked = markerNotificationsEnabled;
    }
    
    const floatingAlertDistance = document.getElementById('floatingAlertDistance');
    if (floatingAlertDistance) {
        floatingAlertDistance.value = alertDistance;
    }
    
    const floatingAlertInterval = document.getElementById('floatingAlertInterval');
    if (floatingAlertInterval) {
        floatingAlertInterval.value = alertInterval;
    }
    
    const floatingEnableHighAccuracy = document.getElementById('floatingEnableHighAccuracy');
    if (floatingEnableHighAccuracy) {
        floatingEnableHighAccuracy.checked = enableHighAccuracy;
    }
    
    const floatingAutoStartTracking = document.getElementById('floatingAutoStartTracking');
    if (floatingAutoStartTracking) {
        floatingAutoStartTracking.checked = autoStartTracking;
    }
    
    const floatingKeepMapCentered = document.getElementById('floatingKeepMapCentered');
    if (floatingKeepMapCentered) {
        floatingKeepMapCentered.checked = keepMapCentered;
    }
    
    const floatingLocationUpdateFrequency = document.getElementById('floatingLocationUpdateFrequency');
    if (floatingLocationUpdateFrequency) {
        floatingLocationUpdateFrequency.value = locationUpdateFrequency;
    }
    
    const floatingLocationTimeout = document.getElementById('floatingLocationTimeout');
    if (floatingLocationTimeout) {
        floatingLocationTimeout.value = locationTimeout / 1000; // 轉換為秒
    }
    
    // 同步位置顯示
    const currentLocation = document.getElementById('currentLocation');
    const floatingCurrentLocation = document.getElementById('floatingCurrentLocation');
    if (currentLocation && floatingCurrentLocation) {
        floatingCurrentLocation.textContent = currentLocation.textContent;
    }
    
    const locationAccuracy = document.getElementById('locationAccuracy');
    const floatingLocationAccuracy = document.getElementById('floatingLocationAccuracy');
    if (locationAccuracy && floatingLocationAccuracy) {
        floatingLocationAccuracy.textContent = locationAccuracy.textContent;
    }
    
    // 只有當追蹤按鈕存在時才同步狀態顯示
    const trackingBtn = document.getElementById('trackingBtn');
    if (trackingBtn) {
        const locationStatus = document.getElementById('locationStatus');
        const floatingLocationStatus = document.getElementById('floatingLocationStatus');
        if (locationStatus && floatingLocationStatus) {
            floatingLocationStatus.textContent = locationStatus.textContent;
        }
    }
}

function initFloatingSettingsEventListeners() {
    // 浮動設定變更事件監聽器
    const floatingEnableNotifications = document.getElementById('floatingEnableNotifications');
    if (floatingEnableNotifications) {
        floatingEnableNotifications.addEventListener('change', function() {
            // 更新全域變數
            markerNotificationsEnabled = this.checked;
            
            // 更新地圖上的追蹤按鈕狀態
            updateNotificationButtonState();
            
            // 請求通知權限（如果啟用）
            if (this.checked) {
                requestNotificationPermission();
            }
            
            // 重新啟動接近檢查（如果正在追蹤）
            if (isTracking) {
                stopProximityCheck();
                if (markerNotificationsEnabled) {
                    startProximityCheck();
                }
            }
            
            // 顯示狀態通知
            showNotification(
                markerNotificationsEnabled ? '已啟用標註點通知' : '已停用標註點通知', 
                'info'
            );
            
            // 保存狀態
            saveData();
        });
    }
    
    const floatingAlertDistance = document.getElementById('floatingAlertDistance');
    if (floatingAlertDistance) {
        floatingAlertDistance.addEventListener('change', function() {
            alertDistance = parseInt(this.value) || 100;
            // 重新啟動接近檢查以使用新距離
            if (isTracking) {
                stopProximityCheck();
                startProximityCheck();
            }
        });
    }
    
    const floatingAlertInterval = document.getElementById('floatingAlertInterval');
    if (floatingAlertInterval) {
        floatingAlertInterval.addEventListener('change', function() {
            alertInterval = parseInt(this.value) || 30;
            // 清除現有的重複提醒並重新設定
            alertTimers.forEach((timer, markerId) => {
                clearInterval(timer);
                alertTimers.delete(markerId);
            });
        });
    }
    
    const floatingEnableHighAccuracy = document.getElementById('floatingEnableHighAccuracy');
    if (floatingEnableHighAccuracy) {
        floatingEnableHighAccuracy.addEventListener('change', function() {
            enableHighAccuracy = this.checked;
        });
    }
    
    const floatingAutoStartTracking = document.getElementById('floatingAutoStartTracking');
    if (floatingAutoStartTracking) {
        floatingAutoStartTracking.addEventListener('change', function() {
            autoStartTracking = this.checked;
        });
    }
    
    const floatingKeepMapCentered = document.getElementById('floatingKeepMapCentered');
    if (floatingKeepMapCentered) {
        floatingKeepMapCentered.addEventListener('change', async function() {
            keepMapCentered = this.checked;
            
            // 同步更新主設定面板中的核取方塊
            const mainKeepMapCentered = document.getElementById('keepMapCentered');
            if (mainKeepMapCentered) {
                mainKeepMapCentered.checked = this.checked;
            }
            
            // 更新中央按鈕的UI狀態
            updateCenterButtonTooltip();
            
            // 儲存設定
            await saveSettingsOnly();
            
            // 顯示通知
            showNotification(keepMapCentered ? '已啟用地圖居中功能' : '已停用地圖居中功能', 'info');
        });
    }
    
    const floatingLocationUpdateFrequency = document.getElementById('floatingLocationUpdateFrequency');
    if (floatingLocationUpdateFrequency) {
        floatingLocationUpdateFrequency.addEventListener('change', function() {
            locationUpdateFrequency = parseInt(this.value) || 3000;
            
            // 如果正在追蹤，重新啟動定時器以應用新的更新頻率
            if (isTracking && locationUpdateTimer) {
                clearInterval(locationUpdateTimer);
                
                locationUpdateTimer = setInterval(() => {
                    // 強制重新獲取當前位置
                    if (navigator.geolocation && isTracking) {
                        navigator.geolocation.getCurrentPosition(
                            function(position) {
                                const now = Date.now();
                                
                                // 檢查是否真的是新的位置數據
                                if (!lastLocationUpdate || (now - lastLocationUpdate) >= (locationUpdateFrequency * 0.8)) {
                                    lastLocationUpdate = now;
                                    
                                    // 計算速度（如果有前一個位置）
                                    let speed = null;
                                    if (currentPosition && position.coords.speed !== null) {
                                        speed = position.coords.speed;
                                    } else if (currentPosition) {
                                        const timeDiff = (now - currentPosition.timestamp) / 1000; // 秒
                                        const distance = calculateDistance(
                                            currentPosition.lat, currentPosition.lng,
                                            position.coords.latitude, position.coords.longitude
                                        );
                                        if (timeDiff > 0) {
                                            speed = distance / timeDiff; // 公尺/秒
                                        }
                                    }
                                    
                                    // 保存當前位置作為下次計算的參考
                                    lastPosition = currentPosition ? {
                                        lat: currentPosition.lat,
                                        lng: currentPosition.lng
                                    } : null;
                                    
                                    currentPosition = {
                                        lat: position.coords.latitude,
                                        lng: position.coords.longitude,
                                        accuracy: position.coords.accuracy,
                                        timestamp: now,
                                        speed: speed
                                    };
                                    
                                    updateLocationDisplay();
                                    updateCurrentLocationMarker();
                                    
                                    // 更新路線記錄（如果正在記錄）
                                    updateRouteRecording(currentPosition);
                                    
                                    refreshAllMarkerPopups(); // 更新所有標記的提示窗距離顯示
                                    updateLocationStatus('追蹤中 (強制更新)');
                                }
                            },
                            function(error) {
                                console.warn('定時器位置更新失敗:', error);
                            },
                            {
                                enableHighAccuracy: enableHighAccuracy,
                                timeout: Math.min(locationTimeout, Math.max(locationUpdateFrequency - 100, 1000)),
                                maximumAge: 0 // 強制獲取最新位置
                            }
                        );
                    }
                }, locationUpdateFrequency);
                
                showNotification(`更新頻率已變更為 ${locationUpdateFrequency/1000} 秒`);
            }
        });
    }
    
    const floatingLocationTimeout = document.getElementById('floatingLocationTimeout');
    if (floatingLocationTimeout) {
        floatingLocationTimeout.addEventListener('change', function() {
            locationTimeout = parseInt(this.value) * 1000 || 20000; // 轉換為毫秒
            
            // 如果正在追蹤，重新啟動定時器以應用新的超時設定
            if (isTracking && locationUpdateTimer) {
                clearInterval(locationUpdateTimer);
                
                locationUpdateTimer = setInterval(() => {
                    // 強制重新獲取當前位置
                    if (navigator.geolocation && isTracking) {
                        navigator.geolocation.getCurrentPosition(
                            function(position) {
                                const now = Date.now();
                                
                                // 檢查是否真的是新的位置數據
                                if (!lastLocationUpdate || (now - lastLocationUpdate) >= (locationUpdateFrequency * 0.8)) {
                                    lastLocationUpdate = now;
                                    
                                    // 計算速度（如果有前一個位置）
                                    let speed = null;
                                    if (currentPosition && position.coords.speed !== null) {
                                        speed = position.coords.speed;
                                    } else if (currentPosition) {
                                        const timeDiff = (now - currentPosition.timestamp) / 1000; // 秒
                                        const distance = calculateDistance(
                                            currentPosition.lat, currentPosition.lng,
                                            position.coords.latitude, position.coords.longitude
                                        );
                                        if (timeDiff > 0) {
                                            speed = distance / timeDiff; // 公尺/秒
                                        }
                                    }
                                    
                                    // 保存當前位置作為下次計算的參考
                                    lastPosition = currentPosition ? {
                                        lat: currentPosition.lat,
                                        lng: currentPosition.lng
                                    } : null;
                                    
                                    currentPosition = {
                                        lat: position.coords.latitude,
                                        lng: position.coords.longitude,
                                        accuracy: position.coords.accuracy,
                                        timestamp: now,
                                        speed: speed
                                    };
                                    
                                    updateLocationDisplay();
                                    updateCurrentLocationMarker();
                                    
                                    // 更新路線記錄（如果正在記錄）
                                    updateRouteRecording(currentPosition);
                                    
                                    refreshAllMarkerPopups(); // 更新所有標記的提示窗距離顯示
                                    updateLocationStatus('追蹤中 (強制更新)');
                                }
                            },
                            function(error) {
                                console.warn('定時器位置更新失敗:', error);
                            },
                            {
                                enableHighAccuracy: enableHighAccuracy,
                                timeout: Math.min(locationTimeout, Math.max(locationUpdateFrequency - 100, 1000)),
                                maximumAge: 0 // 強制獲取最新位置
                            }
                        );
                    }
                }, locationUpdateFrequency);
                
                showNotification(`超時時間已變更為 ${locationTimeout/1000} 秒`);
            }
        });
    }
    
    // 按鈕事件監聽器
    const floatingSaveBtn = document.getElementById('floatingSaveSettingsBtn');
    if (floatingSaveBtn) {
        floatingSaveBtn.addEventListener('click', async function() {
            await saveCurrentSettings();
        });
    }
    
    const floatingLoadBtn = document.getElementById('floatingLoadSettingsBtn');
    if (floatingLoadBtn) {
        floatingLoadBtn.addEventListener('click', async function() {
            await loadSavedSettings();
        });
    }
    
    const floatingResetBtn = document.getElementById('floatingResetSettingsBtn');
    if (floatingResetBtn) {
        floatingResetBtn.addEventListener('click', function() {
            resetToDefaultSettings();
        });
    }
    
    const floatingExportBtn = document.getElementById('floatingExportDataBtn');
    if (floatingExportBtn) {
        floatingExportBtn.addEventListener('click', async function() {
            await exportMarkerData();
        });
    }
    
    const floatingImportBtn = document.getElementById('floatingImportDataBtn');
    if (floatingImportBtn) {
        floatingImportBtn.addEventListener('click', function() {
            const fileInput = document.getElementById('floatingImportFileInput');
            if (fileInput) {
                fileInput.click();
            }
        });
    }
    
    // 檔案輸入事件監聽器
    const floatingFileInput = document.getElementById('floatingImportFileInput');
    if (floatingFileInput) {
        floatingFileInput.addEventListener('change', function() {
            if (this.files.length > 0) {
                importMarkerData(this.files[0]);
            }
        });
    }
    
    // 搜尋功能事件監聽器
    const searchInput = document.getElementById('markerSearchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    const searchResults = document.getElementById('searchResults');
    
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const query = this.value.trim();
            if (query.length > 0) {
                performMarkerSearch(query);
                clearSearchBtn.style.display = 'flex';
            } else {
                hideSearchResults();
                clearSearchBtn.style.display = 'none';
            }
        });
        
        searchInput.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                clearSearch();
            }
        });
    }
    
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', function() {
            clearSearch();
        });
    }
}

async function saveFloatingButtonPosition(x, y) {
    try { await appStorageSet('floatingSettingsButtonPosition', { x, y }); }
    catch (e) { try { localStorage.setItem('floatingSettingsButtonPosition', JSON.stringify({ x, y })); } catch (_) {} }
}

async function loadFloatingButtonPosition() {
    try {
        const saved = await appStorageGet('floatingSettingsButtonPosition');
        if (saved && typeof saved === 'object') {
            const { x, y } = saved;
            const btn = document.getElementById('floatingSettingsBtn');
            if (btn) {
                btn.style.left = x + 'px';
                btn.style.top = y + 'px';
                btn.style.right = 'auto';
                btn.style.bottom = 'auto';
            }
        }
    } catch (error) {
        console.error('載入浮動按鈕位置失敗，改用快取:', error);
        const savedStr = localStorage.getItem('floatingSettingsButtonPosition');
        if (savedStr) {
            try {
                const { x, y } = JSON.parse(savedStr);
                const btn = document.getElementById('floatingSettingsBtn');
                if (btn) {
                    btn.style.left = x + 'px';
                    btn.style.top = y + 'px';
                    btn.style.right = 'auto';
                    btn.style.bottom = 'auto';
                }
            } catch (_) {}
        }
    }
}

// 將函數暴露到全域
window.initFloatingSettings = initFloatingSettings;
window.showFloatingSettings = showFloatingSettings;
window.hideFloatingSettings = hideFloatingSettings;

// 背景服務相關功能
let backgroundServiceEnabled = false;
let backgroundLocationTracking = false;

// 初始化背景服務
function initBackgroundService() {
    // 檢查是否在 Android 環境中
    if (typeof AndroidBackgroundService !== 'undefined') {
        console.log('Android 背景服務接口可用');
        
        // 設置位置更新回調
        window.onLocationUpdate = function(latitude, longitude) {
            console.log('收到背景位置更新:', latitude, longitude);
            
            // 更新當前位置
            currentPosition = { lat: latitude, lng: longitude };
            
            // 更新地圖標記
            updateCurrentLocationMarker();
            
            // 檢查距離提醒
            if (markerNotificationsEnabled) {
                checkProximityAlerts();
            }
            
            // 如果有追蹤目標，發送給 Service Worker
            if (trackingTarget && navigator.serviceWorker && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({
                    type: 'BACKGROUND_LOCATION_CHECK',
                    trackingTarget: trackingTarget,
                    currentPosition: currentPosition
                });
            }
        };
        
        backgroundServiceEnabled = true;
    } else {
        console.log('Android 背景服務接口不可用，使用標準定位');
    }
}

// 啟動背景位置追蹤
function startBackgroundLocationTracking() {
    if (backgroundServiceEnabled && typeof AndroidBackgroundService !== 'undefined') {
        try {
            AndroidBackgroundService.startBackgroundService();
            backgroundLocationTracking = true;
            console.log('背景位置追蹤已啟動');
            
            // 更新 UI 狀態
            updateLocationStatus('背景追蹤中...');
            
            return true;
        } catch (error) {
            console.error('啟動背景服務失敗:', error);
            return false;
        }
    }
    return false;
}

// 停止背景位置追蹤
function stopBackgroundLocationTracking() {
    if (backgroundServiceEnabled && typeof AndroidBackgroundService !== 'undefined') {
        try {
            AndroidBackgroundService.stopBackgroundService();
            backgroundLocationTracking = false;
            console.log('背景位置追蹤已停止');
            
            // 更新 UI 狀態
            updateLocationStatus('已停止');
            
            return true;
        } catch (error) {
            console.error('停止背景服務失敗:', error);
            return false;
        }
    }
    return false;
}

// 增強版的開始追蹤函數
function startTrackingWithBackground() {
    // 首先嘗試啟動背景服務
    const backgroundStarted = startBackgroundLocationTracking();
    
    if (!backgroundStarted) {
        // 如果背景服務啟動失敗，使用標準追蹤
        startTracking();
    } else {
        // 背景服務啟動成功，設置相關狀態
        isTracking = true;
        
        // 更新按鈕狀態
        const trackingBtn = document.getElementById('trackingBtn');
        if (trackingBtn) {
            trackingBtn.textContent = '停止追蹤';
            trackingBtn.classList.add('active');
        }
        
        // 開始距離檢查
        if (markerNotificationsEnabled) {
            startProximityCheck();
        }
        
        console.log('背景追蹤模式已啟動');
    }
}

// 增強版的停止追蹤函數
function stopTrackingWithBackground() {
    // 停止背景服務
    stopBackgroundLocationTracking();
    
    // 停止標準追蹤
    stopTracking();
}

// 修改原有的 toggleTracking 函數
const originalToggleTracking = window.toggleTracking;
window.toggleTracking = function() {
    if (isTracking) {
        stopTrackingWithBackground();
    } else {
        startTrackingWithBackground();
    }
};

// 處理應用進入背景時的邏輯
function handleAppBackground() {
    if (isTracking && backgroundServiceEnabled) {
        console.log('應用進入背景，維持背景追蹤');
        // 背景服務會繼續運行，不需要額外操作
    }
    // 進入背景時保存資料（避免系統回收導致遺失）
    try { if (typeof saveData === 'function') saveData(); } catch (e) {
        console.warn('背景保存資料失敗:', e);
    }
}

// 處理應用回到前台時的邏輯
function handleAppForeground() {
    if (backgroundLocationTracking) {
        console.log('應用回到前台，同步背景追蹤狀態');
        // 同步背景服務的狀態到前台 UI
        isTracking = true;
        
        const trackingBtn = document.getElementById('trackingBtn');
        if (trackingBtn) {
            trackingBtn.textContent = '停止追蹤';
            trackingBtn.classList.add('active');
        }
    }
}

// 監聽頁面可見性變化
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        handleAppBackground();
    } else {
        handleAppForeground();
    }
});

// 監聽頁面卸載事件（應用被關閉）
window.addEventListener('beforeunload', function() {
    if (backgroundLocationTracking) {
        // 應用被關閉時停止背景服務
        stopBackgroundLocationTracking();
    }
});

// iOS 修正：頁面隱藏或被系統終止時立即保存資料
window.addEventListener('pagehide', function() {
    try { if (typeof saveData === 'function') saveData(); } catch (e) {
        console.warn('pagehide 儲存資料失敗:', e);
    }
});

// 處理來自 Service Worker 的消息
if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'FOCUS_MARKER') {
            // 聚焦到指定標記
            focusMarker(event.data.markerId);
        } else if (event.data && event.data.type === 'BACKGROUND_LOCATION_CHECK') {
            // 處理背景位置檢查請求
            if (currentPosition && trackingTarget) {
                // 發送當前位置和追蹤目標給 Service Worker
                navigator.serviceWorker.controller.postMessage({
                    type: 'BACKGROUND_LOCATION_CHECK',
                    trackingTarget: trackingTarget,
                    currentPosition: currentPosition
                });
            }
        }
    });
}

// 初始化 - 在所有函數定義之後
document.addEventListener('DOMContentLoaded', async function() {
    console.log('DOMContentLoaded event fired');
    
    // 檢查移動設備兼容性
    checkMobileCompatibility();
    
    // 初始化路線監控（調試用）
    setupRouteLineMonitoring();
    
    initEventListeners();
    await initializeApp();
    
    // 初始化背景服務
    initBackgroundService();
    
    // 初始化拖曳功能
    console.log('Initializing drag functionality...');
    try {
        await initDragFunctionality();
        console.log('Drag functionality initialized');
    } catch (error) {
        console.error('Error initializing drag functionality:', error);
    }
    
    // 初始化浮動設定功能
    console.log('Initializing floating settings...');
    try {
        initFloatingSettings();
        console.log('Floating settings initialized');
    } catch (error) {
        console.error('Error initializing floating settings:', error);
    }
    

    
    // 延遲執行其他初始化函數
    setTimeout(async () => {
        // 載入設定
        try {
            console.log('Calling loadSettingsOnInit...');
            if (typeof loadSettingsOnInit === 'function') {
                await loadSettingsOnInit();
            } else {
                console.warn('loadSettingsOnInit function not found');
            }
        } catch (error) {
            console.error('Error loading settings:', error);
        }
        
        // 請求定位權限
        try {
            console.log('Calling requestLocationPermission...');
            if (typeof requestLocationPermission === 'function') {
                requestLocationPermission();
            } else {
                console.warn('requestLocationPermission function not found');
            }
        } catch (error) {
            console.error('Error requesting location permission:', error);
        }
        
        // 手機設備自動進入全螢幕模式
        if (isMobileDevice()) {
            try {
                console.log('Mobile device detected, attempting auto fullscreen...');
                autoEnterFullscreenOnMobile();
            } catch (error) {
                console.error('Error entering fullscreen on mobile:', error);
            }
        }
        
    }, 100);
});

// 搜尋功能實現
function performMarkerSearch(query) {
    const searchResults = document.getElementById('searchResults');
    if (!searchResults) return;
    
    // 模糊搜尋所有標註點
    const results = fuzzySearchMarkers(query);
    
    if (results.length === 0) {
        searchResults.innerHTML = '<div class="search-no-results">沒有找到符合的標註點</div>';
        searchResults.style.display = 'block';
        return;
    }
    
    // 顯示搜尋結果
    const resultsHTML = results.map(result => {
        const marker = result.marker;
        const group = groups.find(g => g.id === marker.groupId);
        const subgroup = group ? group.subgroups.find(sg => sg.id === marker.subgroupId) : null;
        
        let groupInfo = '';
        if (group) {
            groupInfo = group.name;
            if (subgroup) {
                groupInfo += ` > ${subgroup.name}`;
            }
        } else {
            groupInfo = '未分組';
        }
        
        return `
            <div class="search-result-item" onclick="selectSearchResult('${marker.id}')">
                <div class="search-result-name">${highlightSearchText(marker.name, query)}</div>
                <div class="search-result-description">${highlightSearchText(marker.description || '', query)}</div>
                <div class="search-result-location">${marker.lat.toFixed(6)}, ${marker.lng.toFixed(6)}</div>
                <div class="search-result-group">${groupInfo}</div>
            </div>
        `;
    }).join('');
    
    searchResults.innerHTML = resultsHTML;
    searchResults.style.display = 'block';
}

function fuzzySearchMarkers(query) {
    const queryLower = query.toLowerCase();
    const results = [];
    
    markers.forEach(marker => {
        let score = 0;
        let matches = [];
        
        // 檢查名稱匹配
        if (marker.name && marker.name.toLowerCase().includes(queryLower)) {
            score += 10;
            matches.push('name');
        }
        
        // 檢查描述匹配
        if (marker.description && marker.description.toLowerCase().includes(queryLower)) {
            score += 5;
            matches.push('description');
        }
        
        // 檢查組別名稱匹配
        const group = groups.find(g => g.id === marker.groupId);
        if (group && group.name.toLowerCase().includes(queryLower)) {
            score += 3;
            matches.push('group');
        }
        
        // 檢查子組別名稱匹配
        if (group) {
            const subgroup = group.subgroups.find(sg => sg.id === marker.subgroupId);
            if (subgroup && subgroup.name.toLowerCase().includes(queryLower)) {
                score += 3;
                matches.push('subgroup');
            }
        }
        
        // 模糊匹配（字符相似度）
        if (score === 0) {
            const nameScore = calculateFuzzyScore(marker.name || '', queryLower);
            const descScore = calculateFuzzyScore(marker.description || '', queryLower);
            
            if (nameScore > 0.3 || descScore > 0.3) {
                score += Math.max(nameScore, descScore) * 2;
                matches.push('fuzzy');
            }
        }
        
        if (score > 0) {
            results.push({
                marker: marker,
                score: score,
                matches: matches
            });
        }
    });
    
    // 按分數排序
    return results.sort((a, b) => b.score - a.score);
}

function calculateFuzzyScore(text, query) {
    if (!text || !query) return 0;
    
    const textLower = text.toLowerCase();
    const queryLower = query.toLowerCase();
    
    // 簡單的字符匹配算法
    let matches = 0;
    let queryIndex = 0;
    
    for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
        if (textLower[i] === queryLower[queryIndex]) {
            matches++;
            queryIndex++;
        }
    }
    
    return matches / queryLower.length;
}

function highlightSearchText(text, query) {
    if (!text || !query) return text;
    
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<span class="search-result-highlight">$1</span>');
}

function selectSearchResult(markerId) {
    const marker = markers.find(m => m.id === markerId);
    if (!marker) return;
    
    // 關閉搜尋結果
    hideSearchResults();
    clearSearch();
    
    // 關閉設定視窗
    hideFloatingSettings();
    
    // 設定追蹤目標並聚焦到標註點
    setTrackingTarget(markerId);
    
    // 顯示通知
    showNotification(`🎯 開始追蹤: ${marker.name}`, 'success');
}

function clearSearch() {
    const searchInput = document.getElementById('markerSearchInput');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    
    if (searchInput) {
        searchInput.value = '';
    }
    
    if (clearSearchBtn) {
        clearSearchBtn.style.display = 'none';
    }
    
    hideSearchResults();
}

function hideSearchResults() {
    const searchResults = document.getElementById('searchResults');
    if (searchResults) {
        searchResults.style.display = 'none';
        searchResults.innerHTML = '';
    }
}

// 將搜尋功能暴露到全域
window.performMarkerSearch = performMarkerSearch;
window.selectSearchResult = selectSearchResult;
window.clearSearch = clearSearch;

// ===== 浮動幫助按鈕功能 =====

// 幫助按鈕拖拽功能
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

function initHelpButton() {
    const helpBtn = document.getElementById('floatingHelpBtn');
    const helpModal = document.getElementById('helpModal');
    const closeBtn = document.getElementById('closeHelpModal');
    
    if (!helpBtn || !helpModal || !closeBtn) {
        console.warn('幫助按鈕或視窗元素未找到');
        return;
    }
    
    // 點擊顯示幫助視窗
    helpBtn.addEventListener('click', function(e) {
        if (!isDragging) {
            showHelpModal();
        }
    });
    
    // 關閉按鈕事件
    closeBtn.addEventListener('click', hideHelpModal);
    
    // 點擊背景關閉視窗
    helpModal.addEventListener('click', function(e) {
        if (e.target === helpModal) {
            hideHelpModal();
        }
    });
    
    // ESC鍵關閉視窗
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && !helpModal.classList.contains('hidden')) {
            hideHelpModal();
        }
    });
    
    // 拖拽功能 - 滑鼠事件
    helpBtn.addEventListener('mousedown', startDrag);
    
    // 拖拽功能 - 觸控事件
    helpBtn.addEventListener('touchstart', startDragTouch, { passive: false });

    // 載入幫助按鈕位置（IndexedDB 優先）
    try { loadFloatingHelpButtonPosition(); } catch (_) {}
}

function startDrag(e) {
    isDragging = true;
    const helpBtn = document.getElementById('floatingHelpBtn');
    const rect = helpBtn.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    helpBtn.style.cursor = 'grabbing';
    
    // 動態添加事件監聽器
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', endDrag);
    
    e.preventDefault();
    e.stopPropagation();
}

function drag(e) {
    if (!isDragging) return;
    
    const helpBtn = document.getElementById('floatingHelpBtn');
    const newX = e.clientX - dragOffset.x;
    const newY = e.clientY - dragOffset.y;
    
    // 限制在視窗範圍內
    const maxX = window.innerWidth - helpBtn.offsetWidth;
    const maxY = window.innerHeight - helpBtn.offsetHeight;
    
    const constrainedX = Math.max(0, Math.min(newX, maxX));
    const constrainedY = Math.max(0, Math.min(newY, maxY));
    
    helpBtn.style.left = constrainedX + 'px';
    helpBtn.style.top = constrainedY + 'px';
    helpBtn.style.right = 'auto';
    
    e.preventDefault();
}

function endDrag() {
    if (isDragging) {
        const helpBtn = document.getElementById('floatingHelpBtn');
        helpBtn.style.cursor = 'pointer';
        
        // 移除事件監聽器
        document.removeEventListener('mousemove', drag);
        document.removeEventListener('mouseup', endDrag);
        
        // 保存位置
        try {
            const cs = window.getComputedStyle(helpBtn);
            const x = parseInt(cs.left) || 0;
            const y = parseInt(cs.top) || 0;
            saveFloatingHelpButtonPosition(x, y);
        } catch (_) {}

        // 延遲重置拖拽狀態，避免立即觸發點擊事件
        setTimeout(() => {
            isDragging = false;
        }, 100);
    }
}

function startDragTouch(e) {
    if (e.touches.length === 1) {
        const touch = e.touches[0];
        isDragging = true;
        const helpBtn = document.getElementById('floatingHelpBtn');
        const rect = helpBtn.getBoundingClientRect();
        dragOffset.x = touch.clientX - rect.left;
        dragOffset.y = touch.clientY - rect.top;
        
        // 動態添加事件監聽器
        document.addEventListener('touchmove', dragTouch, { passive: false });
        document.addEventListener('touchend', endDragTouch);
        
        e.preventDefault();
        e.stopPropagation();
    }
}

function dragTouch(e) {
    if (!isDragging || e.touches.length !== 1) return;
    
    const touch = e.touches[0];
    const helpBtn = document.getElementById('floatingHelpBtn');
    const newX = touch.clientX - dragOffset.x;
    const newY = touch.clientY - dragOffset.y;
    
    // 限制在視窗範圍內
    const maxX = window.innerWidth - helpBtn.offsetWidth;
    const maxY = window.innerHeight - helpBtn.offsetHeight;
    
    const constrainedX = Math.max(0, Math.min(newX, maxX));
    const constrainedY = Math.max(0, Math.min(newY, maxY));
    
    helpBtn.style.left = constrainedX + 'px';
    helpBtn.style.top = constrainedY + 'px';
    helpBtn.style.right = 'auto';
    
    e.preventDefault();
}

function endDragTouch() {
    if (isDragging) {
        // 移除事件監聽器
        document.removeEventListener('touchmove', dragTouch);
        document.removeEventListener('touchend', endDragTouch);
        
        // 保存位置
        try {
            const helpBtn = document.getElementById('floatingHelpBtn');
            const cs = window.getComputedStyle(helpBtn);
            const x = parseInt(cs.left) || 0;
            const y = parseInt(cs.top) || 0;
            saveFloatingHelpButtonPosition(x, y);
        } catch (_) {}

        // 延遲重置拖拽狀態，避免立即觸發點擊事件
        setTimeout(() => {
            isDragging = false;
        }, 100);
    }
}

function showHelpModal() {
    const helpModal = document.getElementById('helpModal');
    if (helpModal) {
        helpModal.classList.remove('hidden');
        helpModal.style.display = 'flex';
        document.body.style.overflow = 'hidden'; // 防止背景滾動
    }
}

function hideHelpModal() {
    const helpModal = document.getElementById('helpModal');
    if (helpModal) {
        helpModal.classList.add('hidden');
        helpModal.style.display = 'none';
        document.body.style.overflow = ''; // 恢復背景滾動
    }
}

// 初始化幫助按鈕
document.addEventListener('DOMContentLoaded', function() {
    initHelpButton();
});

// 幫助按鈕位置儲存（IndexedDB 優先）
async function saveFloatingHelpButtonPosition(x, y) {
    try { await appStorageSet('floatingHelpButtonPosition', { x, y }); } catch (e) {}
    try { localStorage.setItem('floatingHelpButtonPosition', JSON.stringify({ x, y })); } catch (_) {}
}

async function loadFloatingHelpButtonPosition() {
    try {
        const saved = await appStorageGet('floatingHelpButtonPosition');
        if (saved && typeof saved === 'object') {
            const { x, y } = saved;
            const btn = document.getElementById('floatingHelpBtn');
            if (btn) {
                btn.style.left = x + 'px';
                btn.style.top = y + 'px';
                btn.style.right = 'auto';
                btn.style.bottom = 'auto';
            }
        }
    } catch (error) {
        const savedStr = localStorage.getItem('floatingHelpButtonPosition');
        if (savedStr) {
            try {
                const { x, y } = JSON.parse(savedStr);
                const btn = document.getElementById('floatingHelpBtn');
                if (btn) {
                    btn.style.left = x + 'px';
                    btn.style.top = y + 'px';
                    btn.style.right = 'auto';
                    btn.style.bottom = 'auto';
                }
            } catch (_) {}
        }
    }
}

// 路徑顏色持久化：儲存/讀取/初始化
function getSavedPathColor() {
    try {
        return localStorage.getItem('pathColorSelection') || 'random';
    } catch (e) {
        return 'random';
    }
}

async function saveSelectedPathColor(value) {
    try {
        await appStorageSet('pathColorSelection', value);
    } catch (e) { /* IndexedDB 失敗時忽略，改用 localStorage*/ }
    try { localStorage.setItem('pathColorSelection', value); } catch (_) {}
}

function initPathColorPersistence() {
    const radios = document.querySelectorAll('input[name="pathColor"]');
    if (!radios || !radios.length) return;

    const saved = getSavedPathColor();
    let matched = false;
    radios.forEach(radio => {
        if (radio.value === saved) {
            radio.checked = true;
            matched = true;
        }
        radio.addEventListener('change', () => {
            if (radio.checked) {
                saveSelectedPathColor(radio.value);
            }
        });
    });

    if (!matched) {
        const randomRadio = Array.from(radios).find(r => r.value === 'random');
        if (randomRadio) randomRadio.checked = true;
    }
}

// 在 DOM 載入完成後初始化路徑顏色持久化
document.addEventListener('DOMContentLoaded', initPathColorPersistence);

// ==================== 路線記錄功能 ====================

// 開始路線記錄
function startRouteRecording(targetMarker, selectedStartMarker) {
    if (isRecordingRoute) {
        stopRouteRecording();
    }
    
    if (!currentPosition || !targetMarker) {
        console.warn('無法開始路線記錄：缺少當前位置或目標標記');
        return;
    }
    
    isRecordingRoute = true;
    routeRecordingStartTime = Date.now();
    
    // 使用者選擇的起始標示點（不自動回退到目標標示點）
    const startMarker = selectedStartMarker || null;
    if (!startMarker) {
        showNotification('⚠️ 請先選擇起始標示點再開始記錄', 'warning');
        return;
    }

    // 初始化路線數據
    currentRouteData = {
        targetMarkerId: targetMarker.id,
        targetMarkerName: targetMarker.name,
        startMarkerId: startMarker.id,
        startMarkerName: startMarker.name,
        coordinates: [{
            lat: currentPosition.lat,
            lng: currentPosition.lng,
            timestamp: Date.now()
        }],
        distance: 0,
        startTime: routeRecordingStartTime
    };
    
    // 創建藍色實體線顯示當前記錄的路線
    const disp = getMapDisplayCoord(currentPosition.lat, currentPosition.lng);
    const routePolyline = L.polyline([[disp.lat, disp.lng]], {
        color: '#007AFF', // 藍色
        weight: 4,
        opacity: 0.8,
        smoothFactor: 1
    }).addTo(map);
    
    // 存儲當前記錄路線的引用
    currentRouteData.polyline = routePolyline;
    
    console.log(`開始記錄到 "${targetMarker.name}" 的路線`);
    showNotification(`🔵 開始記錄路線到 "${targetMarker.name}"`, 'info');
}

// 停止路線記錄並保存
function stopRouteRecording() {
    if (!isRecordingRoute || !currentRouteData) {
        return;
    }
    
    isRecordingRoute = false;
    
    // 計算總時間
    const totalDuration = Date.now() - routeRecordingStartTime;
    
    // 移除當前記錄路線的顯示
    if (currentRouteData.polyline) {
        map.removeLayer(currentRouteData.polyline);
    }
    
    // 如果路線有足夠的點數，僅保存到「起始標示點」
    if (currentRouteData.coordinates.length >= 2) {
        const targetMarker = markers.find(m => m.id === currentRouteData.targetMarkerId);
        const startMarker = currentRouteData.startMarkerId ? markers.find(m => m.id === currentRouteData.startMarkerId) : null;
        if (!startMarker) {
            showNotification('⚠️ 未選擇起始標示點，路線不會被保存', 'warning');
        } else {
            // 創建路線記錄
            const routeRecord = {
                name: `路線 ${new Date().toLocaleString()}`,
                coordinates: currentRouteData.coordinates,
                distance: currentRouteData.distance,
                duration: totalDuration,
                color: ((getSavedPathColor && (getSavedPathColor() || 'random') !== 'random') ? getSavedPathColor() : generateRandomColor()),
                createdAt: Date.now(),
                // 標註起點與終點資訊，方便顯示與後續導航
                startMarkerId: startMarker.id,
                startMarkerName: startMarker.name,
                targetMarkerId: targetMarker ? targetMarker.id : null,
                targetMarkerName: targetMarker ? targetMarker.name : null
            };
            
            // 確保標記有 routeRecords 陣列
            if (!startMarker.routeRecords) {
                startMarker.routeRecords = [];
            }
            
            // 檢查是否超過最大記錄數量
            if (startMarker.routeRecords.length >= 10) {
                // 移除最舊的記錄
                startMarker.routeRecords.shift();
            }
            
            // 添加新記錄
            startMarker.routeRecords.push(routeRecord);
            
            console.log(`路線記錄已保存到 "${startMarker.name}"（終點：${routeRecord.targetMarkerName || '未知'}）`);
            showNotification(`✅ 路線已保存到 "${startMarker.name}"`, 'success');
            
            // 保存數據到本地存儲
            saveMarkersToStorage();
        }
    }
    
    // 清理
    currentRouteData = null;
    routeRecordingStartTime = null;
}

// 獲取路徑顏色（自選或隨機）
function generateRandomColor() {
    // 檢查是否有選擇的顏色
    const selectedColorRadio = document.querySelector('input[name="pathColor"]:checked');
    
    if (selectedColorRadio && selectedColorRadio.value !== 'random') {
        return selectedColorRadio.value;
    } else {
        // 隨機顏色
        const colors = [
            '#FF1744', '#00C853', '#2962FF', '#7B1FA2', '#FF6D00',
            '#00B8D4', '#D500F9', '#C51162', '#AA00FF', '#00E5FF',
            '#1DE9B6', '#76FF03', '#FFC400', '#FF3D00', '#64DD17'
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }
}

// 更新路線記錄（在位置更新時調用）
function updateRouteRecording(newPosition) {
    if (!isRecordingRoute || !currentRouteData || !newPosition) {
        return;
    }
    
    const lastCoordinate = currentRouteData.coordinates[currentRouteData.coordinates.length - 1];
    
    // 計算與上一個點的距離
    const distance = calculateDistance(
        lastCoordinate.lat, lastCoordinate.lng,
        newPosition.lat, newPosition.lng
    );
    
    // 只有當移動距離超過5公尺時才記錄新點（避免記錄過多細微移動）
    if (distance > 5) {
        // 添加新座標點
        currentRouteData.coordinates.push({
            lat: newPosition.lat,
            lng: newPosition.lng,
            timestamp: Date.now()
        });
        
        // 更新總距離
        currentRouteData.distance += distance;
        
        // 更新藍色路線顯示
        if (currentRouteData.polyline) {
            const latLngs = currentRouteData.coordinates.map(coord => {
                const disp = getMapDisplayCoord(coord.lat, coord.lng);
                return [disp.lat, disp.lng];
            });
            currentRouteData.polyline.setLatLngs(latLngs);
        }
    }
}

// 顯示標記的路線記錄
function displayMarkerRoutes(marker, routeIds = null) {
    if (!marker || !marker.hasRoutes()) {
        return;
    }
    
    const routes = routeIds ? 
        routeIds.map(id => marker.getRoute(id)).filter(r => r) : 
        marker.getRoutes();
    
    routes.forEach(route => {
        if (route.coordinates.length >= 2) {
            const latLngs = route.coordinates.map(coord => {
                const disp = getMapDisplayCoord(coord.lat, coord.lng);
                return [disp.lat, disp.lng];
            });
            const polyline = L.polyline(latLngs, {
                color: route.color,
                weight: 3,
                opacity: 0.7,
                smoothFactor: 1
            }).addTo(map);
            
            // 添加路線信息彈出框
            const startCoord = (route.coordinates && route.coordinates.length > 0) ? route.coordinates[0] : null;
            const startText = startCoord ? `${startCoord.lat.toFixed(5)}, ${startCoord.lng.toFixed(5)}` : '未知';
            const routeInfo = `
                <div style="font-size: 12px;">
                    <strong>${route.name}</strong><br>
                    起點: ${startText}<br>
                    終點: ${marker.icon || ''} ${marker.name}<br>
                    距離: ${(route.distance / 1000).toFixed(2)} km<br>
                    時間: ${formatDuration(route.duration)}<br>
                    建立: ${new Date(route.createdAt).toLocaleString()}
                </div>
            `;
            polyline.bindPopup(routeInfo);
            
            // 存儲顯示的路線引用
            displayedRoutes.set(route.id, polyline);
        }
    });
}

// 隱藏標記的路線記錄
function hideMarkerRoutes(marker, routeIds = null) {
    if (!marker) {
        return;
    }
    
    const routes = routeIds ? 
        routeIds.map(id => marker.getRoute(id)).filter(r => r) : 
        marker.getRoutes();
    
    routes.forEach(route => {
        const polyline = displayedRoutes.get(route.id);
        if (polyline) {
            map.removeLayer(polyline);
            displayedRoutes.delete(route.id);
        }
    });
}

// 格式化時間長度
function formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
        return `${hours}時${minutes % 60}分`;
    } else if (minutes > 0) {
        return `${minutes}分${seconds % 60}秒`;
    } else {
        return `${seconds}秒`;
    }
}

// 將幫助功能暴露到全域
window.showHelpModal = showHelpModal;
window.hideHelpModal = hideHelpModal;

// 路線管理功能
function showRouteManagement(markerId) {
    const marker = markers.find(m => m.id === markerId);
    if (!marker || !marker.routeRecords || marker.routeRecords.length === 0) {
        alert('此標記沒有記錄的路線');
        return;
    }
    
    // 創建路線管理模態框
    const modal = document.createElement('div');
    modal.id = 'routeManagementModal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
    `;
    
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background: white;
        border-radius: 8px;
        padding: 20px;
        max-width: 500px;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    `;
    
    let routeListHtml = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
            <h3 style="margin: 0; color: #333;">
                ${marker.icon} ${marker.name} - 路線管理
            </h3>
            <button onclick="closeRouteManagement()" 
                    style="padding: 4px 8px; background-color: #757575; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                ✕
            </button>
        </div>
        <div style="margin-bottom: 15px; text-align: center;">
            <button onclick="startNewRouteRecording('${markerId}')" 
                    style="padding: 8px 16px; background-color: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;">
                新增路線記錄
            </button>
        </div>
        <div style="border-top: 1px solid #eee; padding-top: 15px;">`;
    
    marker.routeRecords.forEach((route, index) => {
        const distance = (route.distance / 1000).toFixed(2);
        const duration = formatDuration(route.duration);
        const createdAt = new Date(route.createdAt).toLocaleString();
        const startCoord = (route.coordinates && route.coordinates.length > 0) ? route.coordinates[0] : null;
        const startText = startCoord ? `${startCoord.lat.toFixed(5)}, ${startCoord.lng.toFixed(5)}` : '未知';
        
        routeListHtml += `
            <div style="border: 1px solid #ddd; border-radius: 6px; padding: 12px; margin-bottom: 10px; background-color: #f9f9f9;">
                <div style="display: flex; align-items: center; margin-bottom: 8px;">
                    <div style="width: 20px; height: 20px; background-color: ${route.color}; border-radius: 50%; margin-right: 10px;"></div>
                    <strong style="color: #333;">路線 ${index + 1}</strong>
                </div>
                <div style="font-size: 12px; color: #666; margin-bottom: 8px;">
                    起點: ${startText}<br>
                    終點: ${marker.icon || ''} ${marker.name}<br>
                    距離: ${distance} km | 時間: ${duration}<br>
                    建立時間: ${createdAt}
                </div>
                <div style="display: flex; gap: 5px; flex-wrap: wrap;">
                    <button onclick="displayRoute('${markerId}', ${index})" 
                            style="padding: 4px 8px; font-size: 11px; background-color: #2196F3; color: white; border: none; border-radius: 3px; cursor: pointer;">
                        顯示
                    </button>
                    <button onclick="hideRoute('${markerId}', ${index})" 
                            style="padding: 4px 8px; font-size: 11px; background-color: #757575; color: white; border: none; border-radius: 3px; cursor: pointer;">
                        隱藏
                    </button>
                    <button onclick="useRoute('${markerId}', ${index})" 
                            style="padding: 4px 8px; font-size: 11px; background-color: #FF9800; color: white; border: none; border-radius: 3px; cursor: pointer;">
                        使用
                    </button>
                    <button onclick="deleteRoute('${markerId}', ${index})" 
                            style="padding: 4px 8px; font-size: 11px; background-color: #f44336; color: white; border: none; border-radius: 3px; cursor: pointer;">
                        刪除
                    </button>
                </div>
            </div>
        `;
    });
    
    routeListHtml += `
        </div>
        <div style="text-align: center; margin-top: 15px; border-top: 1px solid #eee; padding-top: 15px;">
            <button onclick="closeRouteManagement()" 
                    style="padding: 8px 16px; background-color: #757575; color: white; border: none; border-radius: 4px; cursor: pointer;">
                關閉
            </button>
        </div>
    `;
    
    modalContent.innerHTML = routeListHtml;
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
}

// 顯示預設路線（紅色虛線）
function showDefaultRoute(markerId) {
    const marker = markers.find(m => m.id === markerId);
    if (!marker || !currentPosition) {
        alert('無法顯示預設路線：找不到標記或當前位置');
        return;
    }
    
    // 移除之前的預設路線
    if (window.defaultRouteLine) {
        map.removeLayer(window.defaultRouteLine);
    }
    
    // 創建紅色虛線路線
    const dispCur = getMapDisplayCoord(currentPosition.lat, currentPosition.lng);
    const dispMarker = getMapDisplayCoord(marker.lat, marker.lng);
    const latLngs = [
        [dispCur.lat, dispCur.lng],
        [dispMarker.lat, dispMarker.lng]
    ];
    
    window.defaultRouteLine = L.polyline(latLngs, {
        color: '#ff0000',
        weight: 3,
        opacity: 0.7,
        dashArray: '10, 10'
    }).addTo(map);
    
    // 添加路線信息
    const distance = calculateDistance(currentPosition.lat, currentPosition.lng, marker.lat, marker.lng);
    const routeInfo = `
        <div style="font-size: 12px;">
            <strong>預設路線</strong><br>
            目標: ${marker.name}<br>
            直線距離: ${distance < 1000 ? Math.round(distance) + '公尺' : (distance / 1000).toFixed(2) + '公里'}
        </div>
    `;
    window.defaultRouteLine.bindPopup(routeInfo);
    
    // 3秒後自動隱藏
    setTimeout(() => {
        if (window.defaultRouteLine) {
            map.removeLayer(window.defaultRouteLine);
            window.defaultRouteLine = null;
        }
    }, 3000);
}

// 關閉路線管理模態框
function closeRouteManagement() {
    const modal = document.getElementById('routeManagementModal');
    if (modal) {
        modal.remove();
    }
}

// 開始新的路線記錄（改為先選擇起始標示點）
function startNewRouteRecording(markerId) {
    const marker = markers.find(m => m.id === markerId);
    if (!marker) {
        alert('找不到指定的標記');
        return;
    }
    
    // 檢查是否已達到最大路線數量
    if (marker.routeRecords && marker.routeRecords.length >= 10) {
        alert('此標記已達到最大路線記錄數量（10條）');
        return;
    }
    
    // 隱藏所有現有的路線記錄
    if (marker.routeRecords && marker.routeRecords.length > 0) {
        marker.routeRecords.forEach((route, index) => {
            hideRoute(markerId, index);
        });
    }
    
    // 開啟起點選擇器
    showStartMarkerSelector(markerId);
}

// 顯示起點選擇模態視窗
function showStartMarkerSelector(targetMarkerId) {
    if (!currentPosition) {
        alert('尚未取得目前位置，無法選擇起點');
        return;
    }
    const targetMarker = markers.find(m => m.id === targetMarkerId);
    if (!targetMarker) {
        alert('找不到目標標示點');
        return;
    }
    // 計算距離並取得 200m 內候選
    const candidates = markers.map(m => {
        const dist = calculateDistance(currentPosition.lat, currentPosition.lng, m.lat, m.lng);
        return { marker: m, dist };
    }).sort((a,b) => a.dist - b.dist);
    const nearby = candidates.filter(c => c.dist <= 200);
    
    // 建立模態容器
    const modal = document.createElement('div');
    modal.id = 'startMarkerSelectorModal';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.right = '0';
    modal.style.bottom = '0';
    modal.style.background = 'rgba(0,0,0,0.4)';
    modal.style.zIndex = '99999';
    modal.innerHTML = `
        <div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); background:#fff; width:320px; max-width:90vw; border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,0.2);">
            <div style="padding:10px 12px; border-bottom:1px solid #eee; font-size:14px; font-weight:600;">選擇起始標示點</div>
            <div style="padding:10px 12px; font-size:12px; color:#555;">
                目標：${targetMarker.icon || ''} ${targetMarker.name}<br>
                目前位置：${currentPosition.lat.toFixed(5)}, ${currentPosition.lng.toFixed(5)}
            </div>
            <div style="padding:8px 12px;">
                <input id="startMarkerSearchInput" type="text" placeholder="搜尋標示點名稱" style="width:100%; padding:6px 8px; font-size:12px; border:1px solid #ccc; border-radius:4px;" />
            </div>
            <div id="nearbyStartList" style="padding:0 12px 8px; max-height:200px; overflow:auto;">
                ${nearby.length > 0 ? nearby.map(c => `
                    <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f0f0f0;">
                        <div style="font-size:12px;">
                            ${c.marker.icon || ''} ${c.marker.name}
                            <div style="font-size:11px; color:#777;">距離：約 ${Math.round(c.dist)} m</div>
                        </div>
                        <button onclick="beginRouteRecordingWithStart('${targetMarkerId}', '${c.marker.id}')" style="padding:4px 8px; font-size:12px;">選擇</button>
                    </div>
                `).join('') : `
                    <div style="font-size:12px; color:#777; padding:6px 0;">附近（200m 內）沒有標示點，可從全部標示點選擇。</div>
                `}
            </div>
            <div style="padding:6px 12px; border-top:1px solid #eee; background:#fafafa; font-size:12px;">全部標示點</div>
            <div id="allStartList" style="padding:0 12px 12px; max-height:160px; overflow:auto;">
                ${candidates.map(c => `
                    <div style="display:flex; align-items:center; justify-content:space-between; padding:6px 0; border-bottom:1px solid #f0f0f0;">
                        <div style="font-size:12px;">
                            ${c.marker.icon || ''} ${c.marker.name}
                            <div style="font-size:11px; color:#777;">距離：約 ${Math.round(c.dist)} m</div>
                        </div>
                        <button onclick="beginRouteRecordingWithStart('${targetMarkerId}', '${c.marker.id}')" style="padding:4px 8px; font-size:12px;">選擇</button>
                    </div>
                `).join('')}
            </div>
            <div style="display:flex; gap:8px; justify-content:flex-end; padding:10px 12px; border-top:1px solid #eee;">
                <button onclick="(function(){const m=document.getElementById('startMarkerSelectorModal'); if(m) m.remove();})()" style="padding:6px 10px; font-size:12px;">取消</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // 搜尋過濾
    const searchInput = modal.querySelector('#startMarkerSearchInput');
    searchInput.addEventListener('input', () => {
        const q = searchInput.value.trim();
        const filter = (containerId) => {
            const container = modal.querySelector(containerId);
            if (!container) return;
            Array.from(container.children).forEach(row => {
                const text = row.innerText || '';
                row.style.display = (q === '' || text.includes(q)) ? '' : 'none';
            });
        };
        filter('#nearbyStartList');
        filter('#allStartList');
    });
}

// 以選定起點開始記錄路線
function beginRouteRecordingWithStart(targetMarkerId, startMarkerId) {
    const targetMarker = markers.find(m => m.id === targetMarkerId);
    const startMarker = markers.find(m => m.id === startMarkerId);
    if (!targetMarker || !startMarker) {
        alert('找不到目標或起始標示點');
        return;
    }
    // 設為追蹤目標（終點）
    setTrackingTarget(targetMarkerId);
    // 關閉路線管理與選擇器
    closeRouteManagement();
    const modal = document.getElementById('startMarkerSelectorModal');
    if (modal) modal.remove();
    // 開始記錄
    startRouteRecording(targetMarker, startMarker);
    alert(`開始記錄：起點「${startMarker.name}」 → 終點「${targetMarker.name}」`);
}

// 顯示指定路線
function displayRoute(markerId, routeIndex) {
    const marker = markers.find(m => m.id === markerId);
    if (!marker || !marker.routeRecords || !marker.routeRecords[routeIndex]) {
        alert('找不到指定的路線');
        return;
    }
    
    const route = marker.routeRecords[routeIndex];
    const routeId = `${markerId}_${routeIndex}`;
    
    // 移除之前顯示的此路線
    if (window.displayedRouteLines && window.displayedRouteLines[routeId]) {
        map.removeLayer(window.displayedRouteLines[routeId]);
    }
    
    if (!window.displayedRouteLines) {
        window.displayedRouteLines = {};
    }
    
    // 創建路線
    const latLngs = route.coordinates.map(coord => [coord.lat, coord.lng]);
    const polyline = L.polyline(latLngs, {
        color: route.color,
        weight: 4,
        opacity: 0.8,
        smoothFactor: 1
    }).addTo(map);
    
    // 添加路線信息
    const distance = (route.distance / 1000).toFixed(2);
    const duration = formatDuration(route.duration);
    const targetMarkerObj = route.targetMarkerId ? markers.find(m => m.id === route.targetMarkerId) : null;
    const targetIcon = targetMarkerObj && targetMarkerObj.icon ? targetMarkerObj.icon : '';
    const targetName = route.targetMarkerName || (targetMarkerObj ? targetMarkerObj.name : '未知終點');
    const routeInfo = `
        <div style="font-size: 12px;">
            <strong>路線 ${routeIndex + 1}</strong><br>
            終點: ${targetIcon} ${targetName}<br>
            距離: ${distance} km<br>
            時間: ${duration}<br>
            建立: ${new Date(route.createdAt).toLocaleString()}
        </div>
    `;
    polyline.bindPopup(routeInfo);
    
    window.displayedRouteLines[routeId] = polyline;
}

// 隱藏指定路線
function hideRoute(markerId, routeIndex) {
    const routeId = `${markerId}_${routeIndex}`;
    
    if (window.displayedRouteLines && window.displayedRouteLines[routeId]) {
        map.removeLayer(window.displayedRouteLines[routeId]);
        delete window.displayedRouteLines[routeId];
    }
}

// 隱藏指定標記的所有顯示路線
function hideAllDisplayedRoutes(markerId) {
    if (!window.displayedRouteLines) {
        return;
    }
    
    // 找到所有屬於該標記的路線並隱藏
    const routeKeysToRemove = [];
    for (const routeId in window.displayedRouteLines) {
        if (routeId.startsWith(`${markerId}_`)) {
            map.removeLayer(window.displayedRouteLines[routeId]);
            routeKeysToRemove.push(routeId);
        }
    }
    
    // 從記錄中刪除
    routeKeysToRemove.forEach(routeId => {
        delete window.displayedRouteLines[routeId];
    });
}

// 使用指定路線進行導航
function useRoute(markerId, routeIndex) {
    const marker = markers.find(m => m.id === markerId);
    if (!marker || !marker.routeRecords || !marker.routeRecords[routeIndex]) {
        alert('找不到指定的路線');
        return;
    }
    
    const route = marker.routeRecords[routeIndex];
    
    // 顯示路線
    displayRoute(markerId, routeIndex);
    
    // 設置追蹤目標為此路線的終點（不記錄新路線）
    if (route.targetMarkerId) {
        setTrackingTargetForNavigation(route.targetMarkerId);
    } else {
        setTrackingTargetForNavigation(markerId);
    }
    
    // 關閉模態框
    closeRouteManagement();
    
    alert(`開始使用路線 ${routeIndex + 1} 進行導航`);
}

// 刪除指定路線
function deleteRoute(markerId, routeIndex) {
    const marker = markers.find(m => m.id === markerId);
    if (!marker || !marker.routeRecords || !marker.routeRecords[routeIndex]) {
        alert('找不到指定的路線');
        return;
    }
    
    if (confirm(`確定要刪除路線 ${routeIndex + 1} 嗎？此操作無法復原。`)) {
        // 先隱藏路線
        hideRoute(markerId, routeIndex);
        
        // 從記錄中刪除
        marker.routeRecords.splice(routeIndex, 1);
        
        // 保存到本地存儲
        saveMarkersToStorage();
        
        // 關閉浮動視窗
        closeRouteManagement();
        
        // 重新打開路線管理界面以更新顯示
        setTimeout(() => {
            if (marker.routeRecords.length > 0) {
                showRouteManagement(markerId);
            } else {
                alert('所有路線已刪除');
            }
        }, 100);
    }
}

// 下拉選單路線操作輔助：顯示/隱藏/使用/刪除
function handleRouteAction(markerId, action) {
    const routeIndex = getSelectedRouteIndex(markerId);
    if (Number.isNaN(routeIndex)) return;
    switch (action) {
        case 'display':
            displayRoute(markerId, routeIndex);
            break;
        case 'hide':
            hideRoute(markerId, routeIndex);
            break;
        case 'use':
            useRoute(markerId, routeIndex);
            break;
        case 'delete':
            deleteRoute(markerId, routeIndex);
            break;
        default:
            console.warn('未知的操作:', action);
    }
    // 操作後，於手機模式收合選擇框
    collapseRouteSelect(markerId);
    const marker = markers.find(m => m.id === markerId);
    if (marker) {
        updateMarkerPopup(marker);
    }
}

// ==== 手機模式：路線下拉選擇框展開/收合輔助 ====
function isMobileDevice() {
    try {
        return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
               (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    } catch (e) {
        return false;
    }
}

function expandRouteSelect(markerId) {
    const select = document.getElementById(`routeSelect_${markerId}`);
    if (!select) return;
    if (!isMobileDevice()) return;
    // 展開為清單，避免手機原生選單自動收合
    const optionCount = Math.max(2, Math.min(select.options.length, 6));
    select.size = optionCount;
    select.style.height = 'auto';
    select.style.maxHeight = '128px';
    select.style.overflowY = 'auto';
}

function collapseRouteSelect(markerId) {
    const select = document.getElementById(`routeSelect_${markerId}`);
    if (!select) return;
    select.size = 1;
    // 失焦以收合鍵盤/原生 UI
    try { select.blur(); } catch (e) {}
}

// ==== 自製路線選擇清單輔助 ====
function getSelectedRouteIndex(markerId) {
    const selectEl = document.getElementById(`routeSelect_${markerId}`);
    if (selectEl) {
        const v = parseInt(selectEl.value, 10);
        if (!Number.isNaN(v)) return v;
    }
    if (!window.routeSelectIndex) window.routeSelectIndex = {};
    const v2 = window.routeSelectIndex[markerId];
    return (typeof v2 === 'number' && !Number.isNaN(v2)) ? v2 : 0;
}

function toggleRouteDropdown(markerId) {
    const menu = document.getElementById(`routeDropdownMenu_${markerId}`);
    if (!menu) return;
    const show = menu.style.display === 'none' || menu.style.display === '';
    menu.style.display = show ? 'block' : 'none';
    if (!window.routeDropdownOpen) window.routeDropdownOpen = {};
    window.routeDropdownOpen[markerId] = show;
    // 展開時恢復既有捲動位置
    if (show) {
        if (!window.routeDropdownScroll) window.routeDropdownScroll = {};
        const saved = window.routeDropdownScroll[markerId] || 0;
        try { menu.scrollTop = saved; } catch (e) {}
    }
}

function selectRouteIndex(markerId, idx) {
    if (!window.routeSelectIndex) window.routeSelectIndex = {};
    window.routeSelectIndex[markerId] = idx;
    const labelEl = document.getElementById(`routeDropdown_${markerId}_label`);
    const marker = markers.find(m => m.id === markerId);
    if (labelEl && marker && marker.routeRecords && marker.routeRecords[idx]) {
        const r = marker.routeRecords[idx];
        const distance = (r.distance / 1000).toFixed(2);
        const duration = formatDuration(r.duration);
        labelEl.textContent = `路線 ${idx + 1}｜${distance} km｜${duration}`;
    }
    const menu = document.getElementById(`routeDropdownMenu_${markerId}`);
    if (menu) {
        // 高亮目前選擇並在點選後收合
        Array.from(menu.children).forEach((item, i) => {
            item.style.background = (i === idx) ? '#e3f2fd' : '';
        });
        menu.style.display = 'none';
    }
    if (!window.routeDropdownOpen) window.routeDropdownOpen = {};
    window.routeDropdownOpen[markerId] = false;
}

// 點擊外部區域時收合清單
document.addEventListener('click', function(e) {
    const menus = document.querySelectorAll('[id^="routeDropdownMenu_"]');
    menus.forEach(menu => {
        if (menu.style.display === 'block') {
            const parent = menu.parentElement;
            if (parent && !parent.contains(e.target)) {
                menu.style.display = 'none';
                const idMatch = menu.id.match(/^routeDropdownMenu_(.+)$/);
                if (idMatch) {
                    const markerId = idMatch[1];
                    if (!window.routeDropdownOpen) window.routeDropdownOpen = {};
                    window.routeDropdownOpen[markerId] = false;
                }
            }
        }
    });
});

// ==================== 螢幕恆亮功能 ====================

// 初始化螢幕恆亮功能
async function initWakeLock() {
    // 檢查瀏覽器是否支援 Screen Wake Lock API
    if ('wakeLock' in navigator) {
        try {
            // 自動啟用螢幕恆亮
            await requestWakeLock();
            console.log('螢幕恆亮功能已初始化');
        } catch (error) {
            console.warn('無法啟用螢幕恆亮:', error);
            showNotification('⚠️ 螢幕恆亮功能不可用', 'warning');
        }
    } else {
        console.warn('此瀏覽器不支援螢幕恆亮功能');
        showNotification('⚠️ 此瀏覽器不支援螢幕恆亮功能', 'warning');
    }
    
    // 監聽頁面可見性變化
    document.addEventListener('visibilitychange', handleVisibilityChange);
}

// 請求螢幕恆亮
async function requestWakeLock() {
    if ('wakeLock' in navigator && !wakeLock) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            isWakeLockEnabled = true;
            
            wakeLock.addEventListener('release', () => {
                console.log('螢幕恆亮已釋放');
                isWakeLockEnabled = false;
                wakeLock = null;
            });
            
            console.log('螢幕恆亮已啟用');
            showNotification('🔆 螢幕恆亮已啟用', 'success');
            
        } catch (error) {
            console.error('無法啟用螢幕恆亮:', error);
            throw error;
        }
    }
}

// 釋放螢幕恆亮
async function releaseWakeLock() {
    if (wakeLock) {
        try {
            await wakeLock.release();
            wakeLock = null;
            isWakeLockEnabled = false;
            console.log('螢幕恆亮已手動釋放');
            showNotification('🌙 螢幕恆亮已關閉', 'info');
        } catch (error) {
            console.error('釋放螢幕恆亮時發生錯誤:', error);
        }
    }
}

// 處理頁面可見性變化
async function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && !wakeLock && isWakeLockEnabled) {
        // 頁面重新可見時，重新啟用螢幕恆亮
        try {
            await requestWakeLock();
        } catch (error) {
            console.warn('重新啟用螢幕恆亮失敗:', error);
        }
    }
}

// 切換螢幕恆亮狀態
async function toggleWakeLock() {
    if (wakeLock) {
        await releaseWakeLock();
    } else {
        try {
            await requestWakeLock();
        } catch (error) {
            showNotification('❌ 無法啟用螢幕恆亮', 'error');
        }
    }
}