import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import { formatUptime } from "../utils/format";

interface Health { status: string; uptime: number }
interface MqttSettings { mqttUrl: string; mqttUsername: string; mqttPasswordSet: boolean }
interface SensorNode {
  id: string; name: string; mqttTopic: string;
  x: number; y: number; rotation: number; scale: number;
  lastSeen: string | null; status: "online" | "offline" | "unknown";
}

// ─── small helpers ───────────────────────────────────────────
function StatusDot({ status }: { status: SensorNode["status"] }) {
  const cls =
    status === "online"  ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" :
    status === "offline" ? "bg-red-500" : "bg-zinc-600";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${cls}`} />;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/[0.07] bg-[#161922] p-6 ${className}`}>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs text-zinc-400 mb-1.5">{children}</label>;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-white/10 bg-[#0f1117] px-3 py-2.5 text-sm text-zinc-100
        placeholder-zinc-600 outline-none transition
        focus:border-teal-500/60 focus:ring-2 focus:ring-teal-500/20 ${props.className ?? ""}`}
    />
  );
}

function Btn({
  children, onClick, disabled, variant = "primary", className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}) {
  const base = "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";
  const styles = {
    primary:   "bg-teal-600 text-white hover:bg-teal-500",
    secondary: "bg-white/[0.06] text-zinc-200 hover:bg-white/10 border border-white/10",
    ghost:     "text-zinc-400 hover:text-zinc-200",
  };
  return (
    <button className={`${base} ${styles[variant]} ${className}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

// ─── MQTT settings section ───────────────────────────────────
function MqttSection() {
  const [settings, setSettings] = useState<MqttSettings | null>(null);
  const [mqttUrl, setMqttUrl] = useState("");
  const [mqttUser, setMqttUser] = useState("");
  const [mqttPass, setMqttPass] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings()
      .then((s) => { setSettings(s); setMqttUrl(s.mqttUrl); setMqttUser(s.mqttUsername); })
      .catch(() => setError("Could not load settings"));
  }, []);

  const save = useCallback(async () => {
    setSaving(true); setError(null); setSaved(false);
    try {
      const next = await api.updateSettings({ mqttUrl, mqttUsername: mqttUser, mqttPassword: mqttPass || undefined });
      setSettings(next);
      setMqttPass("");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Failed to save — check the console.");
    } finally {
      setSaving(false);
    }
  }, [mqttUrl, mqttUser, mqttPass]);

  return (
    <Card>
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 rounded-lg bg-teal-500/10 text-teal-400">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.14 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"/>
          </svg>
        </div>
        <div>
          <h2 className="font-semibold text-zinc-100">MQTT Broker</h2>
          <p className="text-xs text-zinc-500">Connection used by the add-on to receive sensor data</p>
        </div>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">{error}</p>}

      <div className="space-y-4">
        <div>
          <Label>Broker URL</Label>
          <Input value={mqttUrl} onChange={(e) => setMqttUrl(e.target.value)}
            placeholder="mqtt://192.168.1.100:1883" />
          <p className="mt-1 text-[11px] text-zinc-600">Format: <code className="text-zinc-500">mqtt://host:port</code> &nbsp;·&nbsp; Use <code className="text-zinc-500">mqtts://</code> for TLS</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Username <span className="text-zinc-600">(optional)</span></Label>
            <Input value={mqttUser} onChange={(e) => setMqttUser(e.target.value)} placeholder="Leave blank if no auth" />
          </div>
          <div>
            <Label>
              Password{" "}
              {settings?.mqttPasswordSet
                ? <span className="text-teal-500 ml-1">● set</span>
                : <span className="text-zinc-600">(optional)</span>}
            </Label>
            <Input type="password" value={mqttPass} onChange={(e) => setMqttPass(e.target.value)} placeholder={settings?.mqttPasswordSet ? "Enter new password to change" : "Leave blank if no auth"} />
          </div>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <Btn onClick={save} disabled={saving}>
            {saving ? "Saving…" : saved ? "✓ Saved" : "Save"}
          </Btn>
          <p className="text-[11px] text-zinc-600">
            Changes take effect on the <strong className="text-zinc-400">next restart</strong> of the add-on.
          </p>
        </div>
      </div>
    </Card>
  );
}

// ─── Sensor nodes section ────────────────────────────────────
function NodesSection() {
  const [nodes, setNodes] = useState<SensorNode[]>([]);
  const [provisioning, setProvisioning] = useState<Set<string>>(new Set());
  const [provisionMsg, setProvisionMsg] = useState<Record<string, string>>({});

  useEffect(() => {
    api.getNodes().then(setNodes).catch(() => {});
    const iv = setInterval(() => api.getNodes().then(setNodes).catch(() => {}), 5000);
    return () => clearInterval(iv);
  }, []);

  const provision = useCallback(async (id: string) => {
    setProvisioning((p) => new Set(p).add(id));
    try {
      await api.provisionNode(id);
      setProvisionMsg((m) => ({ ...m, [id]: "✓ Config packet sent — device will restart." }));
      setTimeout(() => setProvisionMsg((m) => { const n = { ...m }; delete n[id]; return n; }), 5000);
    } catch {
      setProvisionMsg((m) => ({ ...m, [id]: "✗ Failed (node must be online)" }));
      setTimeout(() => setProvisionMsg((m) => { const n = { ...m }; delete n[id]; return n; }), 5000);
    } finally {
      setProvisioning((p) => { const n = new Set(p); n.delete(id); return n; });
    }
  }, []);

  return (
    <Card>
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 rounded-lg bg-violet-500/10 text-violet-400">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2h-2"/>
          </svg>
        </div>
        <div>
          <h2 className="font-semibold text-zinc-100">Sensor Nodes</h2>
          <p className="text-xs text-zinc-500">Live status and remote reprovisioning</p>
        </div>
      </div>

      {nodes.length === 0 ? (
        <p className="text-sm text-zinc-500">No nodes added yet. Go to <strong className="text-zinc-300">Floor Plan</strong> to add one.</p>
      ) : (
        <div className="space-y-3">
          {nodes.map((n) => (
            <div key={n.id} className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <div className="flex items-center gap-3">
                <StatusDot status={n.status} />
                <div>
                  <p className="text-sm font-medium text-zinc-100">{n.name}</p>
                  <p className="text-[11px] text-zinc-500 font-mono">{n.mqttTopic}</p>
                  {n.lastSeen && (
                    <p className="text-[10px] text-zinc-600">
                      Last seen {new Date(n.lastSeen).toLocaleTimeString()}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Btn variant="secondary"
                  disabled={provisioning.has(n.id) || n.status !== "online"}
                  onClick={() => provision(n.id)}
                  className="text-xs"
                >
                  {provisioning.has(n.id) ? "Sending…" : "Reprovision"}
                </Btn>
                {provisionMsg[n.id] && (
                  <p className="text-[11px] text-teal-400">{provisionMsg[n.id]}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Flash guide section ─────────────────────────────────────
function FlashGuide() {
  const steps = [
    {
      n: "1",
      title: "Install PlatformIO",
      body: <>Open VS Code, search Extensions (<kbd className="kbd">Ctrl+Shift+X</kbd>) for <strong>PlatformIO IDE</strong> and install it. Restart VS Code when prompted.</>,
    },
    {
      n: "2",
      title: "Open the firmware folder",
      body: <>In VS Code: <strong>File → Open Folder</strong> → navigate to <code className="code">firmware/</code> inside your Zegy repo. PlatformIO will detect <code className="code">platformio.ini</code> automatically.</>,
    },
    {
      n: "3",
      title: "Connect the ESP32 via USB",
      body: <>Plug in the ESP32 with a data-capable USB cable. Check that your OS detected it — a COM port (Windows) or <code className="code">/dev/ttyUSB0</code> (Linux/macOS) should appear.</>,
    },
    {
      n: "4",
      title: "Upload",
      body: <>Click the <strong>→ Upload</strong> button in the PlatformIO toolbar at the bottom of VS Code, or press <kbd className="kbd">Ctrl+Alt+U</kbd>. The firmware compiles then flashes in about 10–30 s.</>,
    },
    {
      n: "5",
      title: "First-boot setup",
      body: <>After flashing, the ESP32 creates a WiFi AP called <strong>Zegy-Setup</strong>. Connect your phone or laptop to it, then open <code className="code">http://192.168.4.1</code> in a browser to enter your WiFi &amp; MQTT credentials.</>,
    },
    {
      n: "6",
      title: "Verify it is online",
      body: <>Come back to this page — the node should appear with a green dot within a few seconds of entering your credentials. If it stays offline, double-check your MQTT broker URL above.</>,
    },
  ];

  return (
    <Card>
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
          </svg>
        </div>
        <div>
          <h2 className="font-semibold text-zinc-100">How to flash a new sensor</h2>
          <p className="text-xs text-zinc-500">One-time setup per device — takes about 5 minutes</p>
        </div>
      </div>

      <div className="space-y-4">
        {steps.map((s) => (
          <div key={s.n} className="flex gap-4">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center text-xs font-bold text-zinc-400">
              {s.n}
            </div>
            <div className="pt-0.5">
              <p className="text-sm font-medium text-zinc-200 mb-0.5">{s.title}</p>
              <p className="text-xs text-zinc-400 leading-relaxed">{s.body}</p>
            </div>
          </div>
        ))}
      </div>

      <hr className="border-white/[0.06] my-5" />
      <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 px-4 py-3 text-xs text-amber-300/80 space-y-1">
        <p className="font-semibold text-amber-300">Factory reset a node</p>
        <p>Hold the <strong>BOOT</strong> button (GPIO0) on the ESP32 for <strong>5 seconds</strong> while powered on. All saved credentials are erased and the device re-enters setup mode.</p>
      </div>
    </Card>
  );
}

// ─── System status section ───────────────────────────────────
function SystemSection() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    api.getHealth().then(setHealth).catch(() => {});
  }, []);

  return (
    <Card>
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 rounded-lg bg-zinc-800 text-zinc-400">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>
          </svg>
        </div>
        <div>
          <h2 className="font-semibold text-zinc-100">System</h2>
          <p className="text-xs text-zinc-500">Add-on health</p>
        </div>
      </div>

      {health ? (
        <div className="flex flex-wrap gap-6 text-sm">
          <div>
            <p className="text-xs text-zinc-500 mb-0.5">Status</p>
            <p className="flex items-center gap-2 font-medium text-zinc-100">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
              {health.status}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 mb-0.5">Uptime</p>
            <p className="font-medium text-zinc-100">{formatUptime(health.uptime)}</p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-zinc-500">Loading…</p>
      )}
    </Card>
  );
}

// ─── Page ────────────────────────────────────────────────────
export default function Settings() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="text-sm text-zinc-500 mt-1">Configure your MQTT broker and manage sensor hardware.</p>
      </div>

      <MqttSection />
      <NodesSection />
      <FlashGuide />
      <SystemSection />

      <style>{`
        .kbd { display:inline-block; padding:1px 5px; border-radius:5px; background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.12); font-size:10px; font-family:monospace; color:#d4d4d8; }
        .code { font-family:monospace; font-size:12px; color:#a1a1aa; background:rgba(255,255,255,.05); border-radius:4px; padding:1px 5px; }
      `}</style>
    </div>
  );
}
