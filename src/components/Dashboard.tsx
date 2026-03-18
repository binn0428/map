import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom";
import {
  MapContainer, TileLayer, Circle, Marker,
  useMap, useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import {
  Crosshair, ChevronLeft, ChevronRight,
  LogOut, Settings, Share2, Trash2, X,
} from "lucide-react";
import { supabase } from "../utils/supabaseClient";
import { connectMqtt, publishMqtt, disconnectMqtt } from "../utils/mqttClient";

// 修正 Leaflet marker icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ── 自訂圖示：使用者 GPS 位置（藍色脈衝圓點） ──
const gpsIcon = L.divIcon({
  className: "",
  html: `<div style="
    width:18px; height:18px;
    background:#3b82f6;
    border:3px solid white;
    border-radius:50%;
    box-shadow:0 0 0 4px rgba(59,130,246,0.35);
    animation: pulse-blue 1.8s infinite;
  "></div>
  <style>
    @keyframes pulse-blue {
      0%,100%{box-shadow:0 0 0 4px rgba(59,130,246,0.35)}
      50%{box-shadow:0 0 0 8px rgba(59,130,246,0.08)}
    }
  </style>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

// ── 自訂圖示：待確認地點（橘色圓頭 pin） ──
const pendingIcon = L.divIcon({
  className: "",
  html: `<div style="
    width:28px; height:36px;
    position:relative;
    display:flex; flex-direction:column; align-items:center;
  ">
    <div style="
      width:24px; height:24px;
      background:#f97316;
      border:3px solid white;
      border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      box-shadow:0 2px 6px rgba(0,0,0,0.4);
    "></div>
  </div>`,
  iconSize: [28, 36],
  iconAnchor: [14, 34],
});

// ── 自訂圖示：已儲存地點（綠色 pin） ──
const savedIcon = L.divIcon({
  className: "",
  html: `<div style="
    width:28px; height:36px;
    position:relative;
    display:flex; flex-direction:column; align-items:center;
  ">
    <div style="
      width:24px; height:24px;
      background:#22c55e;
      border:3px solid white;
      border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      box-shadow:0 2px 6px rgba(0,0,0,0.4);
    "></div>
  </div>`,
  iconSize: [28, 36],
  iconAnchor: [14, 34],
});

/* ─── 型別 ─── */
interface DeviceCredential {
  id: string;
  device_name: string;
  mqtt_user?: string;
  mqtt_pass?: string;
  share_from?: string | null;
  share_count?: number; // 對應資料庫的 count 欄位
}
interface SavedLocation {
  id: string;
  label: string;
  position: [number, number];
}

/* ─── 地圖子元件 ─── */
function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => { if (target) map.flyTo(target, 18, { duration: 1.0 }); }, [target, map]);
  return null;
}
function MapClickHandler({ onMapClick }: { onMapClick: (p: [number, number]) => void }) {
  useMapEvents({ click: (e) => onMapClick([e.latlng.lat, e.latlng.lng]) });
  return null;
}

/* ─── Portal Modal（渲染到 body，避免 Leaflet stacking context 問題） ─── */
function PortalModal({ children }: { children: React.ReactNode }) {
  return ReactDOM.createPortal(children, document.body);
}

const MAX_SHARES = 5;
const DEFAULT_CENTER: [number, number] = [22.6273, 120.3014];
const BROKER = "wss://8141bbadc4214f9d9f30e7822bd41522.s1.eu.hivemq.cloud:8884/mqtt";

export default function Dashboard({ email, onLogout }: { email: string; onLogout: () => void }) {
  const [devices, setDevices]               = useState<DeviceCredential[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<DeviceCredential | null>(null);
  const [loading, setLoading]               = useState(true);
  const [mqttStatus, setMqttStatus]         = useState("Disconnected");
  const [showCredentials, setShowCredentials]   = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting]           = useState(false);

  const [isStreetView, setIsStreetView]       = useState(false);
  const [userPosition, setUserPosition]       = useState<[number, number] | null>(null);
  const [flyTarget, setFlyTarget]             = useState<[number, number] | null>(null);
  const [gpsLoading, setGpsLoading]           = useState(false);
  const [gpsError, setGpsError]               = useState<string | null>(null);
  const [pendingLocation, setPendingLocation] = useState<[number, number] | null>(null);
  const [savedLocations, setSavedLocations]   = useState<SavedLocation[]>([]);
  const [activeLocIdx, setActiveLocIdx]       = useState(0);

  const isOwnDevice    = selectedDevice && !selectedDevice.share_from;
  // share_count = 已分享給幾人；剩餘 = MAX - share_count
  const shareRemaining = isOwnDevice
    ? MAX_SHARES - (parseInt(String(selectedDevice!.share_count ?? 0), 10))
    : null;

  /* ── 取得設備（明確 select count 欄位，避免保留字問題）── */
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("device_credentials")
          .select("id, device_name, mqtt_user, mqtt_pass, share_from, count")
          .eq("user_id", email);
        if (error) throw error;
        // 把資料庫的 count 對應到介面的 share_count
        const mapped = (data || []).map((d: any) => ({
          ...d,
          share_count: d.count ?? 0,
        }));
        setDevices(mapped);
        if (mapped.length) setSelectedDevice(mapped[0]);
      } catch (err) { console.error("fetchDevices:", err); }
      finally { setLoading(false); }
    })();
  }, [email]);

  /* ── MQTT ── */
  const deviceId = selectedDevice?.id;
  const mqttUser = selectedDevice?.mqtt_user;
  const mqttPass = selectedDevice?.mqtt_pass;

  useEffect(() => {
    if (!mqttUser || !mqttPass) return;
    let isActive = true;
    setMqttStatus("Connecting...");
    const client = connectMqtt(BROKER, {
      username: mqttUser, password: mqttPass,
      clientId: `web_${Math.random().toString(36).slice(2, 9)}`,
      reconnectPeriod: 3000, keepalive: 30,
    });
    client.on("connect",   () => { if (isActive) setMqttStatus("Connected"); });
    client.on("error",     () => { if (isActive) setMqttStatus("Error"); });
    client.on("close",     () => { if (isActive) setMqttStatus("Disconnected"); });
    client.on("reconnect", () => { if (isActive) setMqttStatus("Connecting..."); });
    return () => { isActive = false; disconnectMqtt(); };
  }, [deviceId, mqttUser, mqttPass]);

  /* ── 登出 ── */
  const handleLogout = async () => {
    try {
      await supabase.from("registered_emails").update({ mac: null }).eq("email", email);
      await supabase.auth.signOut();
      onLogout();
    } catch (err) { console.error(err); }
  };

  /* ── 重置 ── */
  const handleReset = async () => {
    setResetting(true);
    try {
      const { error } = await supabase.from("device_credentials").delete().eq("user_id", email);
      if (error) throw error;
      setDevices([]); setSelectedDevice(null); setShowResetConfirm(false);
      alert("重置完成");
    } catch { alert("重置失敗"); }
    finally { setResetting(false); }
  };

  /* ── 控制 ── */
  const handleControl = (action: string) => {
    if (!selectedDevice?.mqtt_user || !selectedDevice?.device_name) { alert("請先選擇設備"); return; }
    const pin = action === "open" ? "D4" : action === "stop" ? "D18" : "D19";
    publishMqtt(
      `device/${selectedDevice.mqtt_user}/${selectedDevice.device_name}/command`,
      JSON.stringify({ action, pin, ts: Math.floor(Date.now() / 1000) })
    );
  };

  /* ── GPS ── */
  const handleLocate = () => {
    if (!navigator.geolocation) { setGpsError("不支援 GPS"); return; }
    setGpsLoading(true); setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setUserPosition(c); setFlyTarget(c); setGpsError(null); setGpsLoading(false);
      },
      (err) => {
        setGpsLoading(false);
        setGpsError(err.code === err.PERMISSION_DENIED ? "定位被拒，請在瀏覽器設定允許" : "無法取得位置");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  /* ── 地點導航 ── */
  const nav = (dir: 1 | -1) => {
    if (!savedLocations.length) return;
    const i = (activeLocIdx + dir + savedLocations.length) % savedLocations.length;
    setActiveLocIdx(i); setFlyTarget(savedLocations[i].position);
  };

  const handleAddLocation = () => {
    if (!pendingLocation) return;
    const upd = [...savedLocations, {
      id: Date.now().toString(),
      label: `地點 ${savedLocations.length + 1}`,
      position: pendingLocation,
    }];
    setSavedLocations(upd); setActiveLocIdx(upd.length - 1); setPendingLocation(null);
  };

  /* ── 刪除設備 ── */
  const handleDeleteDevice = async (dev: DeviceCredential) => {
    if (!confirm(`刪除「${dev.device_name}」？`)) return;
    await supabase.from("device_credentials").delete().eq("id", dev.id);
    const upd = devices.filter((d) => d.id !== dev.id);
    setDevices(upd);
    if (selectedDevice?.id === dev.id) setSelectedDevice(upd[0] ?? null);
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-7 h-7 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const statusColor = mqttStatus === "Connected" ? "bg-green-500"
    : mqttStatus === "Connecting..." ? "bg-yellow-500 animate-pulse" : "bg-red-500";

  /* ══════════════════════════════ RENDER ══ */
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans select-none">

      {/* ══ HEADER ══ */}
      <div className="px-3 pt-3 pb-1">
        <div className="flex items-center justify-between mb-0.5">
          <h1 className="text-lg font-bold tracking-tight">Smart Lock</h1>
          <div className="flex items-center gap-2">
            {shareRemaining !== null ? (
              <span className={`text-xs px-2 py-0.5 rounded-full border ${
                shareRemaining > 0 ? "border-slate-600 text-slate-400" : "border-red-500/60 text-red-400"
              }`}>
                分享剩餘 {shareRemaining}/{MAX_SHARES}
              </span>
            ) : selectedDevice ? (
              <span className="text-xs text-yellow-600 bg-yellow-500/10 border border-yellow-600/30 px-2 py-0.5 rounded-full">
                共享・不可分享
              </span>
            ) : null}
            <button onClick={handleLogout} className="text-slate-500 hover:text-white p-1">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-2">
          <span className="text-slate-500 text-xs">控制面板</span>
          <div className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
          <span className="text-slate-500 text-xs">{mqttStatus}</span>
        </div>

        {/* 設備選擇列 */}
        <div className="flex items-center gap-1.5 mb-2">
          <div className="relative flex-1 min-w-0">
            <select
              value={selectedDevice?.id ?? ""}
              onChange={(e) => setSelectedDevice(devices.find((d) => d.id === e.target.value) ?? null)}
              className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 appearance-none focus:outline-none focus:border-blue-500 pr-6"
            >
              {devices.length === 0 && <option value="">無設備</option>}
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.share_from ? `⬦ ${d.device_name}` : `● ${d.device_name}`}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">▾</div>
          </div>
          {isOwnDevice && (
            <>
              <button onClick={() => alert(`分享：${selectedDevice!.device_name}`)}
                className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-blue-400 active:bg-blue-500/20">
                <Share2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => selectedDevice && handleDeleteDevice(selectedDevice)}
                className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-red-400 active:bg-red-500/20">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <button onClick={() => setShowResetConfirm(true)}
            className="px-2.5 py-2 rounded-lg bg-red-500 text-white text-xs font-semibold active:bg-red-600">
            重置
          </button>
          <button onClick={() => setShowCredentials(true)}
            className="p-2 rounded-lg bg-blue-500 text-white active:bg-blue-600">
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ══ 手動控制 ══ */}
      <div className="mx-3 mb-2">
        <div className="grid grid-cols-3 gap-2">
          {[
            { action:"open", label:"開", cls:"border-blue-500 text-blue-400 active:bg-blue-500/20" },
            { action:"stop", label:"停", cls:"border-red-500  text-red-400  active:bg-red-500/20"  },
            { action:"down", label:"關", cls:"border-slate-600 text-slate-300 active:bg-slate-800" },
          ].map(({ action, label, cls }) => (
            <button key={action} onClick={() => handleControl(action)}
              className={`py-2.5 rounded-xl border ${cls} font-bold text-base bg-slate-900`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ══ 地圖 ══ */}
      <div className="bg-slate-900 mx-3 rounded-xl overflow-hidden border border-slate-800 mb-2">

        {/* 工具列 */}
        <div className="px-2.5 py-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300">地點地圖</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setIsStreetView((v) => !v)}
              className={`px-2 py-0.5 rounded-full border text-xs font-medium ${
                isStreetView ? "bg-blue-600 border-blue-500 text-white" : "bg-slate-800 border-slate-700 text-slate-300"
              }`}>
              {isStreetView ? "街道" : "衛星"}
            </button>
            <button onClick={() => nav(-1)} disabled={!savedLocations.length}
              className="bg-slate-800 rounded-full border border-slate-700 w-6 h-6 flex items-center justify-center disabled:opacity-30">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => nav(1)} disabled={!savedLocations.length}
              className="bg-slate-800 rounded-full border border-slate-700 w-6 h-6 flex items-center justify-center disabled:opacity-30">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button onClick={handleLocate} disabled={gpsLoading}
              className={`rounded-full border w-6 h-6 flex items-center justify-center ${
                gpsLoading   ? "bg-yellow-500/20 border-yellow-500 text-yellow-400" :
                userPosition ? "bg-green-500/20  border-green-500  text-green-400"  :
                               "bg-slate-800 border-slate-700"
              }`}>
              {gpsLoading
                ? <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                : <Crosshair className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* 狀態 + 取消 */}
        <div className="px-2.5 pb-1 flex items-center justify-between gap-2 min-h-[20px]">
          <p className="text-xs text-slate-400 truncate">
            {gpsError && !userPosition
              ? <span className="text-red-400">{gpsError}</span>
              : pendingLocation
              ? `📍 ${pendingLocation[0].toFixed(4)}, ${pendingLocation[1].toFixed(4)}`
              : userPosition
              ? `✅ ${userPosition[0].toFixed(4)}, ${userPosition[1].toFixed(4)}`
              : "點地圖選位置，或按 ⊕ GPS"}
          </p>
          {pendingLocation && (
            <button onClick={() => setPendingLocation(null)}
              className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 text-xs flex-shrink-0">
              <X className="w-3 h-3" />取消
            </button>
          )}
        </div>

        {/* 地圖本體 */}
        <div className="h-52 w-full">
          <MapContainer
            center={userPosition || DEFAULT_CENTER}
            zoom={17} maxZoom={22}
            zoomControl={false}
            style={{ height: "100%", width: "100%" }}
          >
            {isStreetView ? (
              <TileLayer key="street"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="&copy; OSM"
                maxZoom={22} maxNativeZoom={19} keepBuffer={4} updateWhenIdle={false} />
            ) : (
              <TileLayer key="satellite"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                attribution="&copy; Esri"
                maxZoom={22} maxNativeZoom={20} keepBuffer={4} updateWhenIdle={false} />
            )}
            <FlyTo target={flyTarget} />
            <MapClickHandler onMapClick={setPendingLocation} />

            {/* 使用者 GPS 位置：藍色脈衝圓點 */}
            {userPosition && (
              <>
                <Circle center={userPosition} radius={15}
                  pathOptions={{ fillColor:"#3b82f6", fillOpacity:0.15, color:"#3b82f6", weight:1.5 }} />
                <Marker position={userPosition} icon={gpsIcon} />
              </>
            )}

            {/* 待確認地點：橘色 pin */}
            {pendingLocation && <Marker position={pendingLocation} icon={pendingIcon} />}

            {/* 已儲存地點：綠色 pin */}
            {savedLocations.map((loc) => (
              <Marker key={loc.id} position={loc.position} icon={savedIcon} />
            ))}
          </MapContainer>
        </div>

        <div className="px-2.5 py-1.5 border-t border-slate-800">
          <p className="text-xs text-slate-400">
            {savedLocations.length > 0
              ? `${savedLocations[activeLocIdx]?.label}（${activeLocIdx + 1}/${savedLocations.length}）`
              : "尚未儲存地點"}
          </p>
        </div>
      </div>

      {/* ══ 位置設定 ══ */}
      <div className="bg-slate-900 mx-3 rounded-xl px-3 py-2 border border-slate-800 mb-4">
        <h2 className="text-xs font-bold text-slate-400 mb-1.5">位置設定</h2>
        <button onClick={handleAddLocation} disabled={!pendingLocation}
          className="w-full py-2.5 rounded-xl border border-purple-600 bg-purple-900/20 text-white font-bold text-sm active:bg-purple-900/40 disabled:opacity-40 disabled:cursor-not-allowed">
          {pendingLocation ? "✚ 新增地點" : "新增地點（請先點選地圖）"}
        </button>
        {savedLocations.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {savedLocations.map((loc, idx) => (
              <div key={loc.id}
                className={`flex items-center justify-between px-2 py-1.5 rounded-lg border text-xs ${
                  idx === activeLocIdx ? "border-purple-500 bg-purple-500/10" : "border-slate-700 bg-slate-800"
                }`}>
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${idx === activeLocIdx ? "bg-purple-400" : "bg-slate-500"}`} />
                  <span className="text-slate-300 truncate">{loc.label}</span>
                  <span className="text-slate-500">{loc.position[0].toFixed(3)},{loc.position[1].toFixed(3)}</span>
                </div>
                <div className="flex gap-3 ml-2 flex-shrink-0">
                  <button onClick={() => { setActiveLocIdx(idx); setFlyTarget(loc.position); }}
                    className="text-blue-400">前往</button>
                  <button onClick={() => {
                    const upd = savedLocations.filter((_, i) => i !== idx);
                    setSavedLocations(upd);
                    setActiveLocIdx(Math.min(activeLocIdx, Math.max(0, upd.length - 1)));
                  }} className="text-red-400">刪除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ══ 設備帳密 Sheet（Portal → 不受 Leaflet stacking context 影響）══ */}
      {showCredentials && (
        <PortalModal>
          <div className="fixed inset-0 bg-black/70 flex items-end justify-center"
            style={{ zIndex: 99999 }}
            onClick={() => setShowCredentials(false)}>
            <div className="bg-slate-900 border-t border-slate-700 rounded-t-2xl p-5 w-full max-w-lg"
              onClick={(e) => e.stopPropagation()}>
              <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mb-3" />
              <h3 className="text-sm font-bold mb-3">設備帳密</h3>
              {selectedDevice ? (
                <div className="space-y-2.5">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">帳號</label>
                    <div className="bg-slate-800 p-2.5 rounded-lg font-mono text-sm border border-slate-700 break-all">
                      {selectedDevice.mqtt_user || "未設定"}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">密碼</label>
                    <div className="bg-slate-800 p-2.5 rounded-lg font-mono text-sm border border-slate-700 break-all">
                      {selectedDevice.mqtt_pass || "未設定"}
                    </div>
                  </div>
                </div>
              ) : <p className="text-slate-400 text-sm">請先選擇設備</p>}
              <button onClick={() => setShowCredentials(false)}
                className="w-full bg-blue-600 text-white font-bold py-2.5 rounded-xl mt-4 text-sm active:bg-blue-700">
                關閉
              </button>
            </div>
          </div>
        </PortalModal>
      )}

      {/* ══ 重置確認 Sheet（Portal）══ */}
      {showResetConfirm && (
        <PortalModal>
          <div className="fixed inset-0 bg-black/70 flex items-end justify-center"
            style={{ zIndex: 99999 }}
            onClick={() => setShowResetConfirm(false)}>
            <div className="bg-slate-900 border-t border-red-500/40 rounded-t-2xl p-5 w-full max-w-lg"
              onClick={(e) => e.stopPropagation()}>
              <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mb-3" />
              <h3 className="text-sm font-bold mb-1 text-red-400">確認重置</h3>
              <p className="text-slate-300 text-xs mb-0.5">此操作將清除帳號下所有設備資料。</p>
              <p className="text-slate-500 text-xs mb-4">⚠ 登入資格不受影響，重置後仍可登入。</p>
              <div className="flex gap-2">
                <button onClick={() => setShowResetConfirm(false)} disabled={resetting}
                  className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm font-medium active:bg-slate-800">
                  取消
                </button>
                <button onClick={handleReset} disabled={resetting}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-bold active:bg-red-700 flex items-center justify-center gap-2">
                  {resetting
                    ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : "確認重置"}
                </button>
              </div>
            </div>
          </div>
        </PortalModal>
      )}
    </div>
  );
}
