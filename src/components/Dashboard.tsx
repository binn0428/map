import React, { useEffect, useState } from "react";
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

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface DeviceCredential {
  id: string;
  device_name: string;
  mqtt_user?: string;
  mqtt_pass?: string;
  share_from?: string | null;
  count?: number;
}
interface SavedLocation {
  id: string;
  label: string;
  position: [number, number];
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => { if (target) map.flyTo(target, 18, { duration: 1.2 }); }, [target, map]);
  return null;
}
function MapClickHandler({ onMapClick }: { onMapClick: (pos: [number, number]) => void }) {
  useMapEvents({ click: (e) => onMapClick([e.latlng.lat, e.latlng.lng]) });
  return null;
}

const MAX_SHARES = 5;
const DEFAULT_CENTER: [number, number] = [22.6273, 120.3014];

export default function Dashboard({ email, onLogout }: { email: string; onLogout: () => void }) {
  const [devices, setDevices]               = useState<DeviceCredential[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<DeviceCredential | null>(null);
  const [loading, setLoading]               = useState(true);
  const [mqttStatus, setMqttStatus]         = useState("Disconnected");
  const [showCredentials, setShowCredentials]   = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting]           = useState(false);

  const [isStreetView, setIsStreetView]     = useState(false);
  const [userPosition, setUserPosition]     = useState<[number, number] | null>(null);
  const [flyTarget, setFlyTarget]           = useState<[number, number] | null>(null);
  const [gpsLoading, setGpsLoading]         = useState(false);
  const [gpsError, setGpsError]             = useState<string | null>(null);
  const [pendingLocation, setPendingLocation] = useState<[number, number] | null>(null);
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
  const [activeLocIdx, setActiveLocIdx]     = useState(0);

  const isOwnDevice    = selectedDevice && !selectedDevice.share_from;
  const shareRemaining = isOwnDevice ? MAX_SHARES - (selectedDevice!.count ?? 0) : null;

  /* ── 取得設備 ── */
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase
          .from("device_credentials").select("*").eq("user_id", email);
        if (error) throw error;
        setDevices(data || []);
        if (data?.length) setSelectedDevice(data[0]);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    })();
  }, [email]);

  /* ── MQTT ── */
  useEffect(() => {
    if (!selectedDevice?.mqtt_user || !selectedDevice?.mqtt_pass) return;
    setMqttStatus("Connecting...");
    const client = connectMqtt(
      "wss://8141bbadc4214f9d9f30e7822bd41522.s1.eu.hivemq.cloud:8884/mqtt",
      { username: selectedDevice.mqtt_user, password: selectedDevice.mqtt_pass,
        clientId: `web_${Math.random().toString(36).slice(2, 9)}` }
    );
    client.on("connect", () => setMqttStatus("Connected"));
    client.on("error",   () => setMqttStatus("Error"));
    client.on("close",   () => setMqttStatus("Disconnected"));
    return () => { disconnectMqtt(); };
  }, [selectedDevice]);

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
        setGpsError(err.code === err.PERMISSION_DENIED ? "定位權限被拒，請至瀏覽器設定允許" : "無法取得位置");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  /* ── 地點操作 ── */
  const handlePrevLoc = () => {
    if (!savedLocations.length) return;
    const i = (activeLocIdx - 1 + savedLocations.length) % savedLocations.length;
    setActiveLocIdx(i); setFlyTarget(savedLocations[i].position);
  };
  const handleNextLoc = () => {
    if (!savedLocations.length) return;
    const i = (activeLocIdx + 1) % savedLocations.length;
    setActiveLocIdx(i); setFlyTarget(savedLocations[i].position);
  };
  const handleAddLocation = () => {
    if (!pendingLocation) return;
    const upd = [...savedLocations, { id: Date.now().toString(), label: `地點 ${savedLocations.length + 1}`, position: pendingLocation }];
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">

      {/* ══ HEADER ══ */}
      <div className="px-3 pt-3 pb-2">

        {/* 標題列 */}
        <div className="flex items-center justify-between mb-0.5">
          <h1 className="text-lg font-bold tracking-tight leading-none">Smart Lock</h1>
          <div className="flex items-center gap-2">
            {shareRemaining !== null ? (
              <span className={`text-xs px-2 py-0.5 rounded-full border ${
                shareRemaining > 0 ? "border-slate-600 text-slate-400" : "border-red-500/60 text-red-400"
              }`}>分享剩餘 {shareRemaining}/{MAX_SHARES}</span>
            ) : selectedDevice ? (
              <span className="text-xs text-yellow-600 bg-yellow-500/10 border border-yellow-600/30 px-2 py-0.5 rounded-full">
                共享・不可再分享
              </span>
            ) : null}
            <button onClick={handleLogout} className="text-slate-500 hover:text-white p-1">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 副標 + 連線狀態 */}
        <div className="flex items-center gap-3 mb-2">
          <p className="text-slate-400 text-xs">控制面板</p>
          <div className="flex items-center gap-1">
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColor}`} />
            <span className="text-slate-500 text-xs">{mqttStatus}</span>
          </div>
        </div>

        {/* ── 設備選擇列（下拉 + 分享/刪除按鈕）── */}
        <div className="flex items-center gap-1.5 mb-2">
          {/* 下拉選單 */}
          <div className="relative flex-1 min-w-0">
            <select
              value={selectedDevice?.id ?? ""}
              onChange={(e) => setSelectedDevice(devices.find((d) => d.id === e.target.value) ?? null)}
              className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2 appearance-none focus:outline-none focus:border-blue-500 pr-7 truncate"
            >
              {devices.length === 0 && <option value="">無設備</option>}
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.share_from ? `⬦ ${d.device_name}` : `● ${d.device_name}`}
                </option>
              ))}
            </select>
            {/* 自訂下拉箭頭 */}
            <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">▾</div>
          </div>

          {/* 自己設備才顯示：分享 & 刪除 */}
          {isOwnDevice && (
            <>
              <button
                onClick={() => alert(`即將分享：${selectedDevice!.device_name}`)}
                className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-blue-400 hover:bg-blue-500/20 transition-colors flex-shrink-0"
                title="分享設備"
              >
                <Share2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => selectedDevice && handleDeleteDevice(selectedDevice)}
                className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-red-400 hover:bg-red-500/20 transition-colors flex-shrink-0"
                title="刪除設備"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          {/* 重置 */}
          <button
            onClick={() => setShowResetConfirm(true)}
            className="px-3 py-2 rounded-lg bg-red-500/90 hover:bg-red-600 text-white text-xs font-semibold transition-colors flex-shrink-0"
          >
            重置
          </button>

          {/* 設備帳密 */}
          <button
            onClick={() => setShowCredentials(true)}
            className="p-2 rounded-lg bg-blue-500/90 hover:bg-blue-600 text-white transition-colors flex-shrink-0"
            title="設備帳密"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ══ 地圖 ══ */}
      <div className="bg-slate-900 mx-3 rounded-xl overflow-hidden border border-slate-800 mb-2">

        {/* 地圖工具列 */}
        <div className="px-2.5 py-1.5 flex items-center justify-between">
          <h2 className="text-xs font-bold text-slate-300">地點地圖</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsStreetView((v) => !v)}
              className={`px-2 py-1 rounded-full border text-xs font-medium transition-colors ${
                isStreetView
                  ? "bg-blue-600 border-blue-500 text-white"
                  : "bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300"
              }`}
            >
              {isStreetView ? "街道" : "衛星"}
            </button>
            <button onClick={handlePrevLoc} disabled={!savedLocations.length}
              className="bg-slate-800 hover:bg-slate-700 rounded-full border border-slate-700 w-6 h-6 flex items-center justify-center disabled:opacity-30">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button onClick={handleNextLoc} disabled={!savedLocations.length}
              className="bg-slate-800 hover:bg-slate-700 rounded-full border border-slate-700 w-6 h-6 flex items-center justify-center disabled:opacity-30">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button onClick={handleLocate} disabled={gpsLoading}
              className={`rounded-full border w-6 h-6 flex items-center justify-center transition-colors ${
                gpsLoading   ? "bg-yellow-500/20 border-yellow-500 text-yellow-400" :
                userPosition ? "bg-green-500/20 border-green-500 text-green-400" :
                               "bg-slate-800 hover:bg-slate-700 border-slate-700"
              }`}>
              {gpsLoading
                ? <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                : <Crosshair className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* 狀態 + 取消按鈕（單行） */}
        <div className="px-2.5 pb-1 flex items-center justify-between gap-2">
          <p className="text-xs text-slate-400 leading-tight truncate">
            {gpsError && !userPosition
              ? <span className="text-red-400">{gpsError}</span>
              : pendingLocation
              ? `📍 ${pendingLocation[0].toFixed(4)}, ${pendingLocation[1].toFixed(4)}`
              : userPosition
              ? `✅ ${userPosition[0].toFixed(4)}, ${userPosition[1].toFixed(4)}`
              : "點地圖選位置，或按 ⊕ GPS"}
          </p>
          {/* 取消：清除 pendingLocation */}
          {pendingLocation && (
            <button
              onClick={() => setPendingLocation(null)}
              className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs flex-shrink-0 transition-colors"
            >
              <X className="w-3 h-3" /> 取消
            </button>
          )}
        </div>

        {/* 地圖本體 */}
        <div className="h-48 w-full">
          <MapContainer
            center={userPosition || DEFAULT_CENTER}
            zoom={17} maxZoom={22}
            style={{ height: "100%", width: "100%" }}
            zoomControl
          >
            {isStreetView ? (
              <TileLayer key="street"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="&copy; OSM"
                maxZoom={22} maxNativeZoom={19} />
            ) : (
              <TileLayer key="satellite"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                attribution="&copy; Esri"
                maxZoom={22} maxNativeZoom={20} />
            )}
            <FlyTo target={flyTarget} />
            <MapClickHandler onMapClick={setPendingLocation} />
            {userPosition && (
              <>
                <Circle center={userPosition} radius={15}
                  pathOptions={{ fillColor: "#3b82f6", fillOpacity: 0.3, color: "#3b82f6", weight: 2 }} />
                <Marker position={userPosition} />
              </>
            )}
            {pendingLocation && <Marker position={pendingLocation} />}
            {savedLocations.map((loc) => <Marker key={loc.id} position={loc.position} />)}
          </MapContainer>
        </div>

        {/* 地圖底部狀態列 */}
        <div className="px-2.5 py-1.5 border-t border-slate-800 flex items-center justify-between">
          <p className="text-xs text-slate-400">
            {savedLocations.length > 0
              ? `${savedLocations[activeLocIdx]?.label}（${activeLocIdx + 1}/${savedLocations.length}）`
              : "尚未儲存地點"}
          </p>
        </div>
      </div>

      {/* ══ 手動控制 ══ */}
      <div className="bg-slate-900 mx-3 rounded-xl px-3 py-2 border border-slate-800 mb-2">
        <h2 className="text-xs font-bold text-slate-400 mb-1.5">手動控制</h2>
        <div className="grid grid-cols-3 gap-2">
          {[
            { action:"open", label:"開", border:"border-blue-500",  text:"text-blue-400",  hover:"hover:bg-blue-500/10"  },
            { action:"stop", label:"停", border:"border-red-500",   text:"text-red-400",   hover:"hover:bg-red-500/10"   },
            { action:"down", label:"關", border:"border-slate-600", text:"text-slate-300", hover:"hover:bg-slate-800"    },
          ].map(({ action, label, border, text, hover }) => (
            <button key={action} onClick={() => handleControl(action)}
              className={`py-2.5 rounded-xl border ${border} ${text} ${hover} font-bold text-base transition-colors`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ══ 位置設定 ══ */}
      <div className="bg-slate-900 mx-3 rounded-xl px-3 py-2 border border-slate-800 mb-4">
        <h2 className="text-xs font-bold text-slate-400 mb-1.5">位置設定</h2>
        <button
          onClick={handleAddLocation}
          disabled={!pendingLocation}
          className="w-full py-2.5 rounded-xl border border-purple-600 bg-purple-900/20 text-white font-bold text-sm hover:bg-purple-900/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pendingLocation ? "✚ 新增地點" : "新增地點（請先點選地圖）"}
        </button>

        {savedLocations.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {savedLocations.map((loc, idx) => (
              <div key={loc.id}
                className={`flex items-center justify-between px-2 py-1.5 rounded-lg border text-xs ${
                  idx === activeLocIdx ? "border-purple-500 bg-purple-500/10" : "border-slate-700 bg-slate-800"
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${idx === activeLocIdx ? "bg-purple-400" : "bg-slate-500"}`} />
                  <span className="text-slate-300 truncate">{loc.label}</span>
                  <span className="text-slate-500 flex-shrink-0">
                    {loc.position[0].toFixed(3)},{loc.position[1].toFixed(3)}
                  </span>
                </div>
                <div className="flex gap-2 ml-2 flex-shrink-0">
                  <button onClick={() => { setActiveLocIdx(idx); setFlyTarget(loc.position); }}
                    className="text-blue-400 hover:text-blue-300">前往</button>
                  <button onClick={() => {
                    const upd = savedLocations.filter((_, i) => i !== idx);
                    setSavedLocations(upd);
                    setActiveLocIdx(Math.min(activeLocIdx, Math.max(0, upd.length - 1)));
                  }} className="text-red-400 hover:text-red-300">刪除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ══ 設備帳密 Modal（底部 Sheet）══ */}
      {showCredentials && (
        <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50">
          <div className="bg-slate-900 border-t border-slate-700 rounded-t-2xl p-5 w-full max-w-lg shadow-2xl">
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
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl mt-4 text-sm transition-colors">
              關閉
            </button>
          </div>
        </div>
      )}

      {/* ══ 重置確認 Modal（底部 Sheet）══ */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50">
          <div className="bg-slate-900 border-t border-red-500/40 rounded-t-2xl p-5 w-full max-w-lg shadow-2xl">
            <div className="w-10 h-1 bg-slate-700 rounded-full mx-auto mb-3" />
            <h3 className="text-sm font-bold mb-1 text-red-400">確認重置</h3>
            <p className="text-slate-300 text-xs mb-1">此操作將清除帳號下所有設備資料。</p>
            <p className="text-slate-500 text-xs mb-4">⚠ 登入資格不受影響，重置後仍可登入。</p>
            <div className="flex gap-2">
              <button onClick={() => setShowResetConfirm(false)} disabled={resetting}
                className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-300 text-sm font-medium hover:bg-slate-800 transition-colors">
                取消
              </button>
              <button onClick={handleReset} disabled={resetting}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2">
                {resetting
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : "確認重置"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
