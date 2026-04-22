import { useState, useEffect, useRef, useCallback } from "react";
import { useCameras } from "../hooks/useCameras";
import { useHandDetection } from "../hooks/useHandDetection";
import { api, CAMERA_GESTURE_DEFS } from "../api/client";
import { consumeMjpegStream } from "../utils/mjpeg";
import type {
  CameraConfig,
  CameraGroup,
  CameraGestureBinding,
  CameraGestureType,
  CameraCalibration,
  DiscoveredCamera,
} from "../api/client";

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`card bg-surface-raised p-5 ${className}`}>{children}</div>;
}

function Btn({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    variant === "primary"
      ? "btn-primary"
      : variant === "secondary"
        ? "btn-secondary"
        : variant === "danger"
          ? "bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded-xl font-medium transition-colors"
          : "btn-ghost";
  const sz = size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  return (
    <button className={`${base} ${sz} ${className}`} {...props}>
      {children}
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-gray-400 mb-1.5">{children}</label>;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input w-full ${props.className ?? ""}`} />;
}

function Select({
  value,
  onChange,
  children,
  className = "",
}: {
  value: string;
  onChange: (val: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`input w-full appearance-none ${className}`}
    >
      {children}
    </select>
  );
}

function GestureIcon({ gesture, size = 24 }: { gesture: CameraGestureType; size?: number }) {
  const def = CAMERA_GESTURE_DEFS[gesture];
  if (!def) return null;
  const style: React.CSSProperties = { fontSize: size * 0.85, lineHeight: 1, display: "inline-block" };
  return <span style={style} role="img">{def.emoji}</span>;
}

function AddCameraModal({
  open,
  groups,
  onClose,
  onSave,
}: {
  open: boolean;
  groups: CameraGroup[];
  onClose: () => void;
  onSave: (data: { name: string; url: string; snapshotUrl: string; username: string; password: string; groupId: string | null }) => void;
}) {
  const [tab, setTab] = useState<"manual" | "discover" | "ha">("discover");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [snapshotUrl, setSnapshotUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [groupId, setGroupId] = useState("");
  const [scanning, setScanning] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredCamera[]>([]);
  const [scanDone, setScanDone] = useState(false);
  const [scanSubnets, setScanSubnets] = useState<string[]>([]);
  const [selectedDiscovered, setSelectedDiscovered] = useState<string | null>(null);
  const [haCameras, setHaCameras] = useState<{ entityId: string; name: string; state: string }[]>([]);
  const [haCamerasLoading, setHaCamerasLoading] = useState(false);
  const [haCamerasError, setHaCamerasError] = useState<string | null>(null);
  const [selectedHaEntityId, setSelectedHaEntityId] = useState<string | null>(null);

  if (!open) return null;

  const handleUrlChange = (raw: string) => {
    const rtspEmbed = raw.match(/^(rtsp:\/\/)([^:@\s]+):([^@\s]*)@(.+)$/i);
    if (rtspEmbed) {
      setUrl(`rtsp://${rtspEmbed[4]}`);
      if (!username) setUsername(rtspEmbed[2]);
      if (!password) setPassword(rtspEmbed[3]);
      return;
    }
    const httpEmbed = raw.match(/^(https?:\/\/)([^:@\s]+):([^@\s]*)@(.+)$/i);
    if (httpEmbed) {
      setUrl(`${httpEmbed[1]}${httpEmbed[4]}`);
      if (!username) setUsername(httpEmbed[2]);
      if (!password) setPassword(httpEmbed[3]);
      return;
    }
    setUrl(raw);
  };

  const urlProtocol = (() => {
    if (/^ha:\/\//i.test(url)) return "HA";
    if (/^rtsp:\/\//i.test(url)) return "RTSP";
    if (/^https:\/\//i.test(url)) return "HTTPS";
    if (/^http:\/\//i.test(url)) return "HTTP";
    return null;
  })();

  const handleSave = () => {
    if (!name.trim() || !url.trim()) return;
    onSave({ name: name.trim(), url: url.trim(), snapshotUrl: snapshotUrl.trim(), username, password, groupId: groupId || null });
    resetForm();
  };

  const resetForm = () => {
    setName(""); setUrl(""); setSnapshotUrl(""); setUsername(""); setPassword(""); setGroupId("");
    setDiscovered([]); setScanDone(false); setSelectedDiscovered(null);
    setHaCameras([]); setHaCamerasError(null); setSelectedHaEntityId(null);
  };

  const handleClose = () => { resetForm(); onClose(); };

  const runScan = async () => {
    setScanning(true);
    setScanDone(false);
    setDiscovered([]);
    try {
      const res = await api.discoverCameras();
      setDiscovered(res.found);
      setScanSubnets(res.subnets);
    } catch {
      // ignore
    } finally {
      setScanning(false);
      setScanDone(true);
    }
  };

  const selectDiscovered = (cam: DiscoveredCamera) => {
    setSelectedDiscovered(cam.ip + ":" + cam.port);
    setName(cam.name);
    setUrl(cam.streamUrl);
    setSnapshotUrl(cam.snapshotUrl);
    setTab("manual");
  };

  const loadHaCameras = async () => {
    setHaCamerasLoading(true);
    setHaCamerasError(null);
    try {
      const cams = await api.getHaCameras();
      setHaCameras(cams);
    } catch {
      setHaCamerasError("Could not reach Home Assistant. Check your HA connection in Settings.");
    } finally {
      setHaCamerasLoading(false);
    }
  };

  const selectHaCamera = (cam: { entityId: string; name: string }) => {
    setSelectedHaEntityId(cam.entityId);
    setName(cam.name);
    setUrl(`ha://${cam.entityId}`);
    setSnapshotUrl("");
    setUsername("");
    setPassword("");
    setTab("manual");
  };

  const canSave = name.trim() && url.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative w-full max-w-lg bg-surface-raised rounded-2xl shadow-2xl overflow-hidden">

        <div className="flex border-b border-white/[0.06]">
          <button
            onClick={() => setTab("discover")}
            className={`flex-1 px-4 py-3.5 text-sm font-medium transition-colors ${tab === "discover" ? "text-zegy-400 border-b-2 border-zegy-500" : "text-gray-500 hover:text-gray-300"}`}
          >
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              Auto Discover
            </span>
          </button>
          <button
            onClick={() => { setTab("ha"); if (haCameras.length === 0 && !haCamerasLoading) loadHaCameras(); }}
            className={`flex-1 px-4 py-3.5 text-sm font-medium transition-colors ${tab === "ha" ? "text-zegy-400 border-b-2 border-zegy-500" : "text-gray-500 hover:text-gray-300"}`}
          >
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
              </svg>
              From HA
            </span>
          </button>
          <button
            onClick={() => setTab("manual")}
            className={`flex-1 px-4 py-3.5 text-sm font-medium transition-colors ${tab === "manual" ? "text-zegy-400 border-b-2 border-zegy-500" : "text-gray-500 hover:text-gray-300"}`}
          >
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
              Manual Entry
            </span>
          </button>
        </div>

        <div className="p-6">
          {tab === "discover" && (
            <div>
              {!scanDone && !scanning && (
                <div className="text-center py-6">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-zegy-600/15 mb-4">
                    <svg className="h-7 w-7 text-zegy-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                  </div>
                  <p className="text-sm text-gray-300 font-medium mb-1">Scan your local network</p>
                  <p className="text-xs text-gray-500 mb-5">Automatically finds IP cameras on your LAN. Scans ports 80 and 8080 across your /24 subnet.</p>
                  <Btn onClick={runScan}>
                    <span className="flex items-center gap-2">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                      </svg>
                      Scan Network
                    </span>
                  </Btn>
                </div>
              )}

              {scanning && (
                <div className="text-center py-8">
                  <div className="relative inline-flex justify-center items-center w-14 h-14 mb-4">
                    <div className="absolute inset-0 border-2 border-zegy-500/30 rounded-full" />
                    <div className="absolute inset-0 border-2 border-zegy-500 border-t-transparent rounded-full animate-spin" />
                    <svg className="h-6 w-6 text-zegy-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                  </div>
                  <p className="text-sm text-gray-300 font-medium">Scanning network...</p>
                  <p className="text-xs text-gray-500 mt-1">Checking ports 80 and 8080 on all local hosts. This takes ~15 seconds.</p>
                </div>
              )}

              {scanDone && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <span className="text-sm font-medium text-gray-200">
                        {discovered.length === 0 ? "No cameras found" : `${discovered.length} camera${discovered.length !== 1 ? "s" : ""} found`}
                      </span>
                      {scanSubnets.length > 0 && (
                        <p className="text-xs text-gray-600 mt-0.5">Scanned: {scanSubnets.map(s => s + ".0/24").join(", ")}</p>
                      )}
                    </div>
                    <button onClick={runScan} className="text-xs text-zegy-400 hover:text-zegy-300 flex items-center gap-1">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                      </svg>
                      Rescan
                    </button>
                  </div>

                  {discovered.length === 0 ? (
                    <div className="bg-surface-overlay rounded-xl p-5 text-center">
                      <p className="text-xs text-gray-500">No cameras detected automatically. Try adding manually or check that your cameras are on the same network.</p>
                      <button onClick={() => setTab("manual")} className="mt-3 text-xs text-zegy-400 hover:text-zegy-300">
                        Add camera manually →
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {discovered.map((cam) => {
                        const key = cam.ip + ":" + cam.port;
                        const isSelected = selectedDiscovered === key;
                        return (
                          <button
                            key={key}
                            onClick={() => selectDiscovered(cam)}
                            className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${isSelected ? "bg-zegy-600/20 ring-1 ring-zegy-500/40" : "bg-surface-overlay hover:bg-white/[0.05]"}`}
                          >
                            <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${cam.confidence === "confirmed" ? "bg-green-600/20" : "bg-yellow-600/20"}`}>
                              <svg className={`h-4 w-4 ${cam.confidence === "confirmed" ? "text-green-400" : "text-yellow-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                              </svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-200 truncate">{cam.name}</span>
                                {cam.requiresAuth && (
                                  <span className="badge bg-yellow-600/20 text-yellow-400 text-[10px]">Auth</span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 truncate mt-0.5">{cam.streamUrl}</p>
                            </div>
                            <div className="shrink-0 text-right">
                              <span className={`badge text-[10px] ${cam.confidence === "confirmed" ? "bg-green-600/20 text-green-400" : "bg-yellow-600/20 text-yellow-400"}`}>
                                {cam.confidence}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "ha" && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-gray-400">Cameras registered in Home Assistant</p>
                <button onClick={loadHaCameras} disabled={haCamerasLoading} className="text-xs text-zegy-400 hover:text-zegy-300 flex items-center gap-1 disabled:opacity-50">
                  <svg className={`h-3.5 w-3.5 ${haCamerasLoading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                  Refresh
                </button>
              </div>

              {haCamerasLoading && (
                <div className="text-center py-8">
                  <div className="h-5 w-5 border-2 border-zegy-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-xs text-gray-500">Loading cameras from Home Assistant...</p>
                </div>
              )}

              {haCamerasError && (
                <div className="bg-red-900/20 border border-red-700/30 rounded-xl p-4 text-center">
                  <p className="text-xs text-red-400">{haCamerasError}</p>
                </div>
              )}

              {!haCamerasLoading && !haCamerasError && haCameras.length === 0 && (
                <div className="bg-surface-overlay rounded-xl p-5 text-center">
                  <p className="text-xs text-gray-500">No camera entities found in Home Assistant.</p>
                </div>
              )}

              {!haCamerasLoading && haCameras.length > 0 && (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {haCameras.map((cam) => {
                    const isSelected = selectedHaEntityId === cam.entityId;
                    const isLive = cam.state === "idle" || cam.state === "streaming";
                    return (
                      <button
                        key={cam.entityId}
                        onClick={() => selectHaCamera(cam)}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${isSelected ? "bg-zegy-600/20 ring-1 ring-zegy-500/40" : "bg-surface-overlay hover:bg-white/[0.05]"}`}
                      >
                        <div className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-zegy-600/15">
                          <svg className="h-4 w-4 text-zegy-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-200 truncate">{cam.name}</p>
                          <p className="text-xs text-gray-500 truncate">{cam.entityId}</p>
                        </div>
                        <span className={`badge text-[10px] shrink-0 ${isLive ? "bg-green-600/20 text-green-400" : "bg-gray-700 text-gray-400"}`}>
                          {cam.state}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === "manual" && (
            <div className="space-y-3">
              {selectedDiscovered && (
                <div className="flex items-center gap-2 bg-green-600/10 border border-green-600/20 rounded-xl px-3 py-2.5 mb-1">
                  <svg className="h-4 w-4 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  <span className="text-xs text-green-300">Pre-filled from discovered camera. Review and confirm details.</span>
                </div>
              )}
              {selectedHaEntityId && (
                <div className="flex items-center gap-2 bg-zegy-600/10 border border-zegy-500/20 rounded-xl px-3 py-2.5 mb-1">
                  <svg className="h-4 w-4 text-zegy-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                  </svg>
                  <span className="text-xs text-zegy-300">From Home Assistant. Streamed via HA — no credentials needed.</span>
                </div>
              )}
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Living Room Camera" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>Stream URL</Label>
                  {urlProtocol && (
                    <span className={`badge text-[10px] ${
                      urlProtocol === "HA" ? "bg-zegy-600/20 text-zegy-300" :
                      urlProtocol === "RTSP" ? "bg-purple-600/20 text-purple-300" : "bg-blue-600/20 text-blue-300"
                    }`}>{urlProtocol}</span>
                  )}
                </div>
                <Input
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  placeholder="rtsp://192.168.1.100:554/stream  or  http://ip/video"
                />
                {urlProtocol === "RTSP" && (
                  <p className="text-[11px] text-gray-500 mt-1">Paste full URL with credentials (rtsp://user:pass@host/path) — they will auto-split below.</p>
                )}
              </div>
              <div>
                <Label>Snapshot URL (optional)</Label>
                <Input value={snapshotUrl} onChange={(e) => setSnapshotUrl(e.target.value)} placeholder="http://192.168.1.100/snapshot.jpg" />
              </div>
              {!selectedHaEntityId && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Username</Label>
                    <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" autoComplete="off" />
                  </div>
                  <div>
                    <Label>Password</Label>
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                  </div>
                </div>
              )}
              {groups.length > 0 && (
                <div>
                  <Label>Group</Label>
                  <Select value={groupId} onChange={setGroupId}>
                    <option value="">No group</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 pb-6">
          <Btn variant="ghost" onClick={handleClose}>Cancel</Btn>
          {tab === "discover" && !scanDone && !scanning && (
            <Btn variant="secondary" onClick={() => setTab("manual")}>Enter manually</Btn>
          )}
          {tab === "manual" && (
            <Btn onClick={handleSave} disabled={!canSave}>Add Camera</Btn>
          )}
        </div>
      </div>
    </div>
  );
}

function GestureBindingEditor({
  gestures,
  onChange,
}: {
  gestures: CameraGestureBinding[];
  onChange: (gestures: CameraGestureBinding[]) => void;
}) {
  const [showGesturePicker, setShowGesturePicker] = useState(false);

  const addBinding = (gesture: CameraGestureType) => {
    const binding: CameraGestureBinding = {
      id: `cgb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      gesture,
      name: CAMERA_GESTURE_DEFS[gesture].label,
      holdTime: 800,
      cooldown: 3000,
      actions: [],
      enabled: true,
    };
    onChange([...gestures, binding]);
    setShowGesturePicker(false);
  };

  const updateBinding = (id: string, updates: Partial<CameraGestureBinding>) => {
    onChange(gestures.map((g) => (g.id === id ? { ...g, ...updates } : g)));
  };

  const removeBinding = (id: string) => {
    onChange(gestures.filter((g) => g.id !== id));
  };

  const updateAction = (bindingId: string, actionIdx: number, field: string, value: string | number) => {
    onChange(
      gestures.map((g) => {
        if (g.id !== bindingId) return g;
        const actions = [...g.actions];
        actions[actionIdx] = { ...actions[actionIdx], [field]: value };
        return { ...g, actions };
      }),
    );
  };

  const addAction = (bindingId: string) => {
    onChange(
      gestures.map((g) => {
        if (g.id !== bindingId) return g;
        return {
          ...g,
          actions: [
            ...g.actions,
            {
              id: `as-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              type: "ha_service" as const,
              entityId: "",
              service: "",
              topic: "",
              payload: "",
              url: "",
              method: "POST",
              body: "",
              delay: 0,
            },
          ],
        };
      }),
    );
  };

  const removeAction = (bindingId: string, actionIdx: number) => {
    onChange(
      gestures.map((g) => {
        if (g.id !== bindingId) return g;
        const actions = g.actions.filter((_, i) => i !== actionIdx);
        return { ...g, actions };
      }),
    );
  };

  return (
    <div className="space-y-3">
      {gestures.length === 0 && (
        <p className="text-xs text-gray-600 text-center py-2">No bindings yet. Add a gesture below to control devices with your hand.</p>
      )}
      {gestures.filter((b) => !!CAMERA_GESTURE_DEFS[b.gesture]).map((binding) => (
        <div key={binding.id} className="bg-surface-overlay rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <GestureIcon gesture={binding.gesture} size={20} />
              <input
                value={binding.name}
                onChange={(e) => updateBinding(binding.id, { name: e.target.value })}
                className="bg-transparent text-sm font-medium text-gray-200 outline-none border-b border-transparent focus:border-zegy-500 transition-colors"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateBinding(binding.id, { enabled: !binding.enabled })}
                className={`h-5 w-9 rounded-full transition-colors ${binding.enabled ? "bg-zegy-600" : "bg-gray-700"}`}
              >
                <span className={`block h-3.5 w-3.5 rounded-full bg-white transition-transform ${binding.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
              <button onClick={() => removeBinding(binding.id)} className="text-gray-600 hover:text-red-400 transition-colors">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <Label>Hold (ms)</Label>
              <Input
                type="number"
                value={binding.holdTime}
                onChange={(e) => updateBinding(binding.id, { holdTime: Math.max(200, parseInt(e.target.value) || 200) })}
              />
            </div>
            <div>
              <Label>Cooldown (ms)</Label>
              <Input
                type="number"
                value={binding.cooldown}
                onChange={(e) => updateBinding(binding.id, { cooldown: Math.max(500, parseInt(e.target.value) || 500) })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Actions</span>
              <button onClick={() => addAction(binding.id)} className="text-xs text-zegy-400 hover:text-zegy-300">
                + Add action
              </button>
            </div>
            {binding.actions.map((action, ai) => {
              const actionAny = action as unknown as Record<string, unknown>;
              const atype = (actionAny.type as string) ?? "ha_service";
              return (
              <div key={action.id} className="flex flex-col gap-1.5 rounded-lg bg-surface p-2">
                <div className="flex gap-2 items-center">
                  <select
                    value={atype}
                    onChange={(e) => updateAction(binding.id, ai, "type", e.target.value)}
                    className="input text-xs flex-1 py-1"
                  >
                    <option value="ha_service">HA Service</option>
                    <option value="mqtt_publish">MQTT Publish</option>
                    <option value="webhook">Webhook</option>
                  </select>
                  <button onClick={() => removeAction(binding.id, ai)} className="text-gray-600 hover:text-red-400">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {atype === "ha_service" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="light.living_room" value={(actionAny.entityId as string) ?? ""} onChange={(e) => updateAction(binding.id, ai, "entityId", e.target.value)} />
                    <Input placeholder="turn_on" value={(actionAny.service as string) ?? ""} onChange={(e) => updateAction(binding.id, ai, "service", e.target.value)} />
                  </div>
                )}
                {atype === "mqtt_publish" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="zegy/my/topic" value={(actionAny.topic as string) ?? ""} onChange={(e) => updateAction(binding.id, ai, "topic", e.target.value)} />
                    <Input placeholder='{"state":"on"}' value={(actionAny.payload as string) ?? ""} onChange={(e) => updateAction(binding.id, ai, "payload", e.target.value)} />
                  </div>
                )}
                {atype === "webhook" && (
                  <div className="flex flex-col gap-1.5">
                    <div className="grid grid-cols-3 gap-2">
                      <select value={(actionAny.method as string) ?? "POST"} onChange={(e) => updateAction(binding.id, ai, "method", e.target.value)} className="input text-xs py-1">
                        <option value="POST">POST</option>
                        <option value="GET">GET</option>
                        <option value="PUT">PUT</option>
                      </select>
                      <div className="col-span-2"><Input placeholder="https://example.com/hook" value={(actionAny.url as string) ?? ""} onChange={(e) => updateAction(binding.id, ai, "url", e.target.value)} /></div>
                    </div>
                    <Input placeholder="Body (optional)" value={(actionAny.body as string) ?? ""} onChange={(e) => updateAction(binding.id, ai, "body", e.target.value)} />
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <Input type="number" min={0} step={100} value={action.delay} onChange={(e) => updateAction(binding.id, ai, "delay", parseInt(e.target.value) || 0)} />
                  <span className="text-[10px] text-zinc-500 whitespace-nowrap">ms delay</span>
                </div>
              </div>
            );})}
          </div>
        </div>
      ))}

      <div className="mt-4">
        {showGesturePicker ? (
          <div>
            <p className="text-xs text-gray-500 mb-2">Choose a gesture to add:</p>
            <div className="grid grid-cols-5 gap-2">
              {(Object.keys(CAMERA_GESTURE_DEFS) as CameraGestureType[]).map((g) => {
                const def = CAMERA_GESTURE_DEFS[g];
                const already = gestures.some((b) => b.gesture === g);
                return (
                  <button
                    key={g}
                    onClick={() => addBinding(g)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl p-3 border transition-all ${
                      already
                        ? "border-zegy-500/40 bg-zegy-600/10 opacity-60"
                        : "border-white/[0.06] bg-surface-overlay hover:border-zegy-500/40 hover:bg-zegy-600/10"
                    }`}
                    title={def.description}
                  >
                    <span style={{ fontSize: 26 }}>{def.emoji}</span>
                    <span className="text-[11px] font-medium text-gray-300 leading-tight text-center">{def.label}</span>
                    {already && <span className="text-[9px] text-zegy-400">Added</span>}
                  </button>
                );
              })}
            </div>
            <button onClick={() => setShowGesturePicker(false)} className="mt-2 text-xs text-gray-600 hover:text-gray-400">
              Cancel
            </button>
          </div>
        ) : (
          <Btn variant="ghost" size="sm" onClick={() => setShowGesturePicker(true)}>
            <span className="flex items-center gap-1.5">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add Gesture Binding
            </span>
          </Btn>
        )}
      </div>
    </div>
  );
}

function CalibrationModal({
  open,
  camera,
  onClose,
  onComplete,
}: {
  open: boolean;
  camera: CameraConfig | null;
  onClose: () => void;
  onComplete: (palmFeatures: number[][], fistFeatures: number[][]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const [step, setStep] = useState<"idle" | "palm" | "fist" | "done">("idle");
  const [samples, setSamples] = useState<{ palm: number[][]; fist: number[][] }>({ palm: [], fist: [] });
  const [countdown, setCountdown] = useState(0);
  const { ready, captureFeatures } = useHandDetection(null, open);
  const sampleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const streamUrl = camera ? api.getCameraStreamUrl(camera.id) : "";

  useEffect(() => {
    if (!open || !camera) return;
    const ac = new AbortController();

    (async () => {
      try {
        const res = await fetch(streamUrl, { signal: ac.signal });
        if (!res.ok || !res.body) return;
        await consumeMjpegStream(res.body, (bmp) => {
          const canvas = canvasRef.current;
          if (!canvas) { bmp.close(); return; }
          if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
            canvas.width = bmp.width;
            canvas.height = bmp.height;
          }
          const ctx = canvas.getContext("2d");
          if (ctx) ctx.drawImage(bmp, 0, 0);
          bmp.close();
        }, ac.signal);
      } catch { /* AbortError or network error */ }
    })();

    return () => {
      ac.abort();
      if (sampleIntervalRef.current) clearInterval(sampleIntervalRef.current);
      cancelAnimationFrame(rafRef.current);
    };
  }, [open, camera, streamUrl]);

  const startCapture = useCallback(
    (gesture: "palm" | "fist") => {
      if (!ready) return;
      setStep(gesture);
      setCountdown(3);

      let count = 3;
      const timer = setInterval(() => {
        count--;
        setCountdown(count);
        if (count <= 0) {
          clearInterval(timer);
          let captured = 0;
          sampleIntervalRef.current = setInterval(() => {
            const canvas = canvasRef.current;
            if (!canvas || canvas.width === 0) return;
            const features = captureFeatures(canvas, performance.now());
            if (features) {
              setSamples((prev) => ({ ...prev, [gesture]: [...prev[gesture], features] }));
              captured++;
            }
            if (captured >= 10) {
              if (sampleIntervalRef.current) clearInterval(sampleIntervalRef.current);
              setStep(gesture === "palm" ? "idle" : "done");
            }
          }, 200);
        }
      }, 1000);
    },
    [ready, captureFeatures],
  );

  const handleFinish = () => {
    onComplete(samples.palm, samples.fist);
    setSamples({ palm: [], fist: [] });
    setStep("idle");
  };

  if (!open || !camera) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-surface-raised rounded-2xl p-6 shadow-2xl">
        <h3 className="section-title mb-4">Calibrate — {camera.name}</h3>

        <div className="relative aspect-video bg-black rounded-xl overflow-hidden mb-4">
          <canvas ref={canvasRef} className="w-full h-full object-contain" />
          {countdown > 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-6xl font-bold text-white drop-shadow-lg">{countdown}</span>
            </div>
          )}
          {step !== "idle" && step !== "done" && countdown === 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded-xl text-sm">
              {step === "palm" ? "Show your open palm ✋" : "Make a fist ✊"} — capturing...
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs ${samples.palm.length >= 10 ? "bg-green-600/20 text-green-400" : "bg-gray-800 text-gray-500"}`}>
            ✋ Palm: {samples.palm.length}/10
          </div>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs ${samples.fist.length >= 10 ? "bg-green-600/20 text-green-400" : "bg-gray-800 text-gray-500"}`}>
            ✊ Fist: {samples.fist.length}/10
          </div>
        </div>

        {!ready && <p className="text-xs text-yellow-500 mb-3">Loading hand detection model...</p>}

        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          {samples.palm.length < 10 && (
            <Btn variant="secondary" onClick={() => startCapture("palm")} disabled={!ready || step !== "idle"}>
              Capture Palm
            </Btn>
          )}
          {samples.palm.length >= 10 && samples.fist.length < 10 && (
            <Btn variant="secondary" onClick={() => startCapture("fist")} disabled={!ready || step !== "idle"}>
              Capture Fist
            </Btn>
          )}
          {step === "done" && (
            <Btn onClick={handleFinish}>Save Calibration</Btn>
          )}
        </div>
      </div>
    </div>
  );
}

function LivePreview({
  camera,
  onGestureDetected,
}: {
  camera: CameraConfig;
  onGestureDetected: (gesture: CameraGestureType) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const lastGestureRef = useRef<{ gesture: CameraGestureType; since: number } | null>(null);
  const cooldownUntilRef = useRef(0);
  const [streamState, setStreamState] = useState<"loading" | "live" | "error">("loading");
  const [currentDetection, setCurrentDetection] = useState<{ gesture: CameraGestureType | null; confidence: number }>({ gesture: null, confidence: 0 });
  const { ready, loadError, detectFromVideo } = useHandDetection(camera.calibration, camera.enabled);

  const streamUrl = api.getCameraStreamUrl(camera.id);

  useEffect(() => {
    const ac = new AbortController();
    setStreamState("loading");
    setCurrentDetection({ gesture: null, confidence: 0 });
    let gotFrame = false;

    (async () => {
      try {
        const res = await fetch(streamUrl, { signal: ac.signal });
        if (!res.ok || !res.body) { setStreamState("error"); return; }
        await consumeMjpegStream(res.body, (bmp) => {
          if (!gotFrame) { gotFrame = true; setStreamState("live"); }
          const canvas = canvasRef.current;
          if (!canvas) { bmp.close(); return; }
          if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
            canvas.width = bmp.width;
            canvas.height = bmp.height;
            const ov = overlayRef.current;
            if (ov) { ov.width = bmp.width; ov.height = bmp.height; }
          }
          const ctx = canvas.getContext("2d");
          if (ctx) ctx.drawImage(bmp, 0, 0);
          bmp.close();
        }, ac.signal);
        if (!gotFrame) setStreamState("error");
      } catch (e: unknown) {
        if ((e as { name?: string }).name !== "AbortError") setStreamState("error");
      }
    })();

    return () => { ac.abort(); setStreamState("loading"); };
  }, [streamUrl]);

  useEffect(() => {
    if (!ready || streamState !== "live" || !canvasRef.current || !overlayRef.current) return;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const octx = overlay.getContext("2d");
    if (!octx) return;

    const activeBindings = camera.gestures.filter((g) => g.enabled);
    const holdTimes = Object.fromEntries(activeBindings.map((g) => [g.gesture, g.holdTime]));
    const cooldowns = Object.fromEntries(activeBindings.map((g) => [g.gesture, g.cooldown]));

    let lastDetect = 0;
    const DETECT_INTERVAL = 100;

    const loop = () => {
      const now = performance.now();
      if (canvas.width > 0 && now - lastDetect >= DETECT_INTERVAL) {
        lastDetect = now;
        const w = canvas.width, h = canvas.height;
        if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
        try {
          const result = detectFromVideo(canvas, now);
          octx.clearRect(0, 0, w, h);
          if (result.landmarks) {
            octx.fillStyle = "#14b8a6";
            for (const lm of result.landmarks) {
              octx.beginPath();
              octx.arc(lm.x * w, lm.y * h, 3, 0, Math.PI * 2);
              octx.fill();
            }
          }
          setCurrentDetection({ gesture: result.gesture, confidence: result.confidence });
          if (result.gesture && result.confidence > 0.55 && now > cooldownUntilRef.current) {
            if (lastGestureRef.current?.gesture === result.gesture) {
              const held = now - lastGestureRef.current.since;
              if (held >= (holdTimes[result.gesture] ?? 800)) {
                onGestureDetected(result.gesture);
                cooldownUntilRef.current = now + (cooldowns[result.gesture] ?? 3000);
                lastGestureRef.current = null;
              }
            } else {
              lastGestureRef.current = { gesture: result.gesture, since: now };
            }
          } else if (!result.gesture) {
            lastGestureRef.current = null;
          }
        } catch { /* skip frame on detection error */ }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [ready, streamState, camera.gestures, detectFromVideo, onGestureDetected]);

  return (
    <div className="relative aspect-video bg-black rounded-xl overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain" />
      <canvas ref={overlayRef} className="absolute inset-0 w-full h-full object-contain pointer-events-none" />

      {loadError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4">
          <p className="text-red-400 text-sm text-center">{loadError}</p>
        </div>
      )}

      {!loadError && streamState === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 gap-2">
          <div className="h-5 w-5 border-2 border-zegy-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-500 text-xs">Connecting to camera...</p>
        </div>
      )}

      {!loadError && streamState === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-5 gap-3 text-center">
          <p className="text-red-400 text-sm">Stream unavailable</p>
          <p className="text-xs text-gray-500 max-w-xs">
            Camera may be offline, the URL is wrong, or credentials failed. Supports HTTP MJPEG and RTSP.
          </p>
        </div>
      )}

      {!loadError && streamState === "live" && !ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 gap-2">
          <div className="h-5 w-5 border-2 border-zegy-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-xs">Loading gesture model...</p>
        </div>
      )}

      {currentDetection.gesture && (
        <div className="absolute top-3 right-3 flex items-center gap-2 bg-black/70 text-white px-3 py-1.5 rounded-lg text-sm">
          <GestureIcon gesture={currentDetection.gesture} size={16} />
          <span>{CAMERA_GESTURE_DEFS[currentDetection.gesture]?.label ?? currentDetection.gesture}</span>
          <span className="text-gray-400">{Math.round(currentDetection.confidence * 100)}%</span>
        </div>
      )}
    </div>
  );
}

function CameraDetail({
  camera,
  groups,
  onUpdate,
  onDelete,
  onCalibrate,
}: {
  camera: CameraConfig;
  groups: CameraGroup[];
  onUpdate: (id: string, data: Partial<CameraConfig>) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
  onCalibrate: (camera: CameraConfig) => void;
}) {
  const [saving, setSaving] = useState(false);

  const handleGestureDetected = useCallback(
    async (gesture: CameraGestureType) => {
      try {
        await api.triggerCameraGesture(camera.id, gesture);
      } catch {
        // ignore
      }
    },
    [camera.id],
  );

  const handleGesturesChange = async (gestures: CameraGestureBinding[]) => {
    setSaving(true);
    try {
      await onUpdate(camera.id, { gestures });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">{camera.name}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{camera.url}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${camera.calibration ? "bg-green-600/20 text-green-400" : "bg-yellow-600/20 text-yellow-400"}`}>
            {camera.calibration ? "Calibrated" : "Not calibrated"}
          </span>
          <button
            onClick={() => onUpdate(camera.id, { enabled: !camera.enabled })}
            className={`h-6 w-11 rounded-full transition-colors ${camera.enabled ? "bg-zegy-600" : "bg-gray-700"}`}
          >
            <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${camera.enabled ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
      </div>

      {camera.enabled && (
        <LivePreview camera={camera} onGestureDetected={handleGestureDetected} />
      )}

      {!camera.enabled && (
        <div className="aspect-video bg-surface-overlay rounded-xl flex items-center justify-center">
          <p className="text-gray-600 text-sm">Camera disabled</p>
        </div>
      )}

      <Card>
        <div className="flex items-center justify-between mb-3">
          <span className="section-title text-sm">Gesture Bindings</span>
          {saving && <span className="text-xs text-gray-500">Saving...</span>}
        </div>
        <GestureBindingEditor gestures={camera.gestures} onChange={handleGesturesChange} />
      </Card>

      <div className="flex gap-2">
        <Btn variant="secondary" size="sm" onClick={() => onCalibrate(camera)}>
          {camera.calibration ? "Recalibrate" : "Calibrate"}
        </Btn>
        <Btn variant="danger" size="sm" onClick={() => onDelete(camera.id)}>
          Delete Camera
        </Btn>
      </div>
    </div>
  );
}

export default function CameraGestures() {
  const {
    cameras,
    groups,
    loading,
    refresh,
    createCamera,
    updateCamera,
    removeCamera,
    calibrate,
    createGroup,
    updateGroup,
    removeGroup,
  } = useCameras();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [calibratingCamera, setCalibratingCamera] = useState<CameraConfig | null>(null);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  const selectedCamera = cameras.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && cameras.length > 0) {
      setSelectedId(cameras[0].id);
    }
  }, [cameras, selectedId]);

  const handleAddCamera = async (data: { name: string; url: string; snapshotUrl: string; username: string; password: string; groupId: string | null }) => {
    const cam = await createCamera(data);
    setSelectedId(cam.id);
    setAddModalOpen(false);
  };

  const handleCalibrationComplete = async (palmFeatures: number[][], fistFeatures: number[][]) => {
    if (!calibratingCamera) return;
    await calibrate(calibratingCamera.id, palmFeatures, fistFeatures);
    setCalibratingCamera(null);
    refresh();
  };

  const handleAddGroup = async () => {
    if (!newGroupName.trim()) return;
    await createGroup({ name: newGroupName.trim() });
    setNewGroupName("");
    setGroupModalOpen(false);
  };

  const editingGroup = groups.find((g) => g.id === editingGroupId) ?? null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="h-8 w-8 border-2 border-zegy-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Camera Gestures</h1>
          <p className="page-subtitle">Control your home with hand gestures via IP cameras</p>
        </div>
        <div className="flex gap-2">
          <Btn variant="secondary" onClick={() => setGroupModalOpen(true)}>New Group</Btn>
          <Btn onClick={() => setAddModalOpen(true)}>Add Camera</Btn>
        </div>
      </div>

      {cameras.length === 0 ? (
        <Card className="text-center py-12">
          <div className="text-gray-500 mb-2">
            <svg className="h-12 w-12 mx-auto mb-3 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <p className="text-sm">No cameras configured</p>
            <p className="text-xs text-gray-600 mt-1">Add an IP camera to get started with hand gesture controls</p>
          </div>
          <Btn className="mt-4" onClick={() => setAddModalOpen(true)}>Add Your First Camera</Btn>
        </Card>
      ) : (
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 md:col-span-3 space-y-4">
            <Card className="p-3">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider px-2">Cameras</span>
              <div className="mt-2 space-y-1">
                {cameras.map((cam) => (
                  <button
                    key={cam.id}
                    onClick={() => setSelectedId(cam.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-left transition-all ${
                      selectedId === cam.id
                        ? "bg-zegy-600/15 text-zegy-400"
                        : "text-gray-400 hover:bg-white/[0.04] hover:text-gray-300"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${cam.enabled ? "bg-green-500" : "bg-gray-600"}`} />
                    <span className="truncate flex-1">{cam.name}</span>
                    {cam.calibration && (
                      <svg className="h-3.5 w-3.5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </Card>

            {groups.length > 0 && (
              <Card className="p-3">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider px-2">Groups</span>
                <div className="mt-2 space-y-1">
                  {groups.map((group) => (
                    <button
                      key={group.id}
                      onClick={() => setEditingGroupId(editingGroupId === group.id ? null : group.id)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-left transition-all ${
                        editingGroupId === group.id
                          ? "bg-zegy-600/15 text-zegy-400"
                          : "text-gray-400 hover:bg-white/[0.04] hover:text-gray-300"
                      }`}
                    >
                      <span className="truncate flex-1">{group.name}</span>
                      <span className="text-xs text-gray-600">
                        {cameras.filter((c) => c.groupId === group.id).length}
                      </span>
                    </button>
                  ))}
                </div>
              </Card>
            )}
          </div>

          <div className="col-span-12 md:col-span-9">
            {editingGroupId && editingGroup ? (
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-100">{editingGroup.name}</h2>
                  <div className="flex gap-2">
                    <Btn variant="ghost" size="sm" onClick={() => setEditingGroupId(null)}>Close</Btn>
                    <Btn variant="danger" size="sm" onClick={() => { removeGroup(editingGroup.id); setEditingGroupId(null); }}>Delete Group</Btn>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mb-4">
                  Gestures defined here apply to all cameras in this group ({cameras.filter((c) => c.groupId === editingGroup.id).length} cameras).
                </p>
                <GestureBindingEditor
                  gestures={editingGroup.gestures}
                  onChange={(gestures) => updateGroup(editingGroup.id, { gestures })}
                />
              </Card>
            ) : selectedCamera ? (
              <CameraDetail
                camera={selectedCamera}
                groups={groups}
                onUpdate={updateCamera}
                onDelete={async (id) => {
                  await removeCamera(id);
                  setSelectedId(cameras.find((c) => c.id !== id)?.id ?? null);
                }}
                onCalibrate={setCalibratingCamera}
              />
            ) : (
              <Card className="text-center py-12">
                <p className="text-gray-500 text-sm">Select a camera from the sidebar</p>
              </Card>
            )}
          </div>
        </div>
      )}

      <AddCameraModal
        open={addModalOpen}
        groups={groups}
        onClose={() => setAddModalOpen(false)}
        onSave={handleAddCamera}
      />

      <CalibrationModal
        open={!!calibratingCamera}
        camera={calibratingCamera}
        onClose={() => setCalibratingCamera(null)}
        onComplete={handleCalibrationComplete}
      />

      {groupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setGroupModalOpen(false)} />
          <div className="relative w-full max-w-sm bg-surface-raised rounded-2xl p-6 shadow-2xl">
            <h3 className="section-title mb-4">New Camera Group</h3>
            <Label>Group Name</Label>
            <Input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="e.g. Downstairs Cameras"
              onKeyDown={(e) => { if (e.key === "Enter") handleAddGroup(); }}
            />
            <div className="mt-5 flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setGroupModalOpen(false)}>Cancel</Btn>
              <Btn onClick={handleAddGroup} disabled={!newGroupName.trim()}>Create Group</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
