import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import { subscribe } from "../api/ws";

type GestureType =
  | "swipe_left"
  | "swipe_right"
  | "swipe_up"
  | "swipe_down"
  | "approach"
  | "retreat"
  | "wave"
  | "push"
  | "pull";

interface GestureAction {
  id: string;
  entityId: string;
  service: string;
  data?: Record<string, unknown>;
  delay: number;
}

interface GestureBinding {
  id: string;
  name: string;
  gesture: GestureType;
  enabled: boolean;
  sensitivity: number;
  cooldown: number;
  zoneId: string | null;
  actions: GestureAction[];
}

interface Zone { id: string; name: string }
interface Device { id: string; name: string; sensors: { entityId: string }[] }

interface LiveEvent {
  bindingId: string;
  gesture: string;
  targetId: number;
  confidence: number;
  time: number;
}

const GESTURE_TYPES: { value: GestureType; label: string; icon: string }[] = [
  { value: "swipe_left", label: "Swipe Left", icon: "←" },
  { value: "swipe_right", label: "Swipe Right", icon: "→" },
  { value: "swipe_up", label: "Swipe Up", icon: "↑" },
  { value: "swipe_down", label: "Swipe Down", icon: "↓" },
  { value: "approach", label: "Approach", icon: "⬆" },
  { value: "retreat", label: "Retreat", icon: "⬇" },
  { value: "wave", label: "Wave", icon: "👋" },
  { value: "push", label: "Push", icon: "⏩" },
  { value: "pull", label: "Pull", icon: "⏪" },
];

const SERVICES: Record<string, string[]> = {
  light: ["turn_on", "turn_off", "toggle"],
  switch: ["turn_on", "turn_off", "toggle"],
  fan: ["turn_on", "turn_off", "toggle"],
  cover: ["open_cover", "close_cover", "toggle"],
  media_player: ["turn_on", "turn_off", "media_play", "media_pause", "media_stop"],
  scene: ["turn_on"],
  script: ["turn_on"],
};

function getServicesForEntity(entityId: string): string[] {
  const domain = entityId.split(".")[0];
  return SERVICES[domain] ?? ["turn_on", "turn_off", "toggle"];
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-white/[0.07] bg-[#161922] p-5 ${className}`}>{children}</div>;
}

function Btn({
  children, onClick, disabled, variant = "primary", className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
}) {
  const base = "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";
  const styles: Record<string, string> = {
    primary: "bg-teal-600 text-white hover:bg-teal-500",
    secondary: "bg-white/[0.06] text-zinc-200 hover:bg-white/10 border border-white/10",
    ghost: "text-zinc-400 hover:text-zinc-200",
    danger: "bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-500/20",
  };
  return (
    <button className={`${base} ${styles[variant]} ${className}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
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

function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) {
  return (
    <select
      {...props}
      className={`w-full rounded-xl border border-white/10 bg-[#0f1117] px-3 py-2.5 text-sm text-zinc-100
        outline-none transition focus:border-teal-500/60 focus:ring-2 focus:ring-teal-500/20 ${props.className ?? ""}`}
    >
      {children}
    </select>
  );
}

export default function Gestures() {
  const [bindings, setBindings] = useState<GestureBinding[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);

  const [formName, setFormName] = useState("");
  const [formGesture, setFormGesture] = useState<GestureType>("swipe_right");
  const [formSensitivity, setFormSensitivity] = useState(1);
  const [formCooldown, setFormCooldown] = useState(2000);
  const [formZoneId, setFormZoneId] = useState<string | null>(null);
  const [formActions, setFormActions] = useState<GestureAction[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [g, z, d] = await Promise.all([api.getGestures(), api.getZones(), api.getDevices()]);
      setBindings(g);
      setZones(z.map((zn: { id: string; name: string }) => ({ id: zn.id, name: zn.name })));
      setDevices(d);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    return subscribe((data) => {
      if (data.type === "gesture_event") {
        setLiveEvents((prev) => [{
          bindingId: data.bindingId as string,
          gesture: data.gesture as string,
          targetId: data.targetId as number,
          confidence: data.confidence as number,
          time: Date.now(),
        }, ...prev].slice(0, 20));
      }
    });
  }, []);

  const selected = bindings.find((b) => b.id === selectedId) ?? null;

  useEffect(() => {
    if (selected) {
      setFormName(selected.name);
      setFormGesture(selected.gesture);
      setFormSensitivity(selected.sensitivity);
      setFormCooldown(selected.cooldown);
      setFormZoneId(selected.zoneId);
      setFormActions([...selected.actions]);
    }
  }, [selected]);

  function resetForm() {
    setFormName("");
    setFormGesture("swipe_right");
    setFormSensitivity(1);
    setFormCooldown(2000);
    setFormZoneId(null);
    setFormActions([]);
  }

  async function handleCreate() {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      const created = await api.createGesture({
        name: formName.trim(),
        gesture: formGesture,
        enabled: true,
        sensitivity: formSensitivity,
        cooldown: formCooldown,
        zoneId: formZoneId,
        actions: formActions,
      });
      setBindings((prev) => [...prev, created]);
      setShowCreate(false);
      setSelectedId(created.id);
      resetForm();
    } catch {
      alert("Failed to create gesture binding");
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    try {
      const updated = await api.updateGesture(selected.id, {
        ...selected,
        name: formName.trim(),
        gesture: formGesture,
        sensitivity: formSensitivity,
        cooldown: formCooldown,
        zoneId: formZoneId,
        actions: formActions,
      });
      setBindings((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    } catch {
      alert("Failed to save gesture binding");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteGesture(id);
      setBindings((prev) => prev.filter((b) => b.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch {
      alert("Failed to delete gesture binding");
    }
  }

  async function handleToggle(binding: GestureBinding) {
    try {
      const updated = await api.updateGesture(binding.id, { ...binding, enabled: !binding.enabled });
      setBindings((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    } catch {
      alert("Failed to toggle gesture binding");
    }
  }

  function addAction() {
    const entities = devices.flatMap((d) => d.sensors.map((s) => s.entityId));
    const entityId = entities[0] ?? "";
    setFormActions((prev) => [...prev, {
      id: `as-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      entityId,
      service: getServicesForEntity(entityId)[0] ?? "turn_on",
      delay: 0,
    }]);
  }

  function removeAction(id: string) {
    setFormActions((prev) => prev.filter((a) => a.id !== id));
  }

  function updateAction(id: string, field: string, value: string | number) {
    setFormActions((prev) => prev.map((a) => {
      if (a.id !== id) return a;
      if (field === "entityId") {
        const svc = getServicesForEntity(value as string);
        return { ...a, entityId: value as string, service: svc[0] ?? "turn_on" };
      }
      return { ...a, [field]: value };
    }));
  }

  const allEntities = devices.flatMap((d) =>
    d.sensors.map((s) => ({ entityId: s.entityId, deviceName: d.name })),
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zegy-500 border-t-transparent" />
      </div>
    );
  }

  function GestureForm({ mode }: { mode: "create" | "edit" }) {
    return (
      <div className="space-y-4">
        <div>
          <Label>Name</Label>
          <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. TV swipe control" />
        </div>
        <div>
          <Label>Gesture Type</Label>
          <Select value={formGesture} onChange={(e) => setFormGesture(e.target.value as GestureType)}>
            {GESTURE_TYPES.map((g) => (
              <option key={g.value} value={g.value}>{g.icon} {g.label}</option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Sensitivity ({formSensitivity.toFixed(1)}x)</Label>
            <input
              type="range" min="0.2" max="3" step="0.1"
              value={formSensitivity}
              onChange={(e) => setFormSensitivity(parseFloat(e.target.value))}
              className="w-full accent-teal-500"
            />
            <div className="flex justify-between text-[10px] text-zinc-500 mt-0.5">
              <span>Low</span><span>High</span>
            </div>
          </div>
          <div>
            <Label>Cooldown (ms)</Label>
            <Input type="number" min={0} step={100} value={formCooldown} onChange={(e) => setFormCooldown(parseInt(e.target.value) || 0)} />
          </div>
        </div>
        <div>
          <Label>Restrict to Zone (optional)</Label>
          <Select value={formZoneId ?? ""} onChange={(e) => setFormZoneId(e.target.value || null)}>
            <option value="">Any zone / anywhere</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </Select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Actions</Label>
            <Btn variant="ghost" onClick={addAction} className="!text-xs !px-2 !py-1">+ Add action</Btn>
          </div>
          {formActions.length === 0 && (
            <p className="text-xs text-zinc-500 italic">No actions configured. Add an action to trigger on gesture detection.</p>
          )}
          {formActions.map((action) => (
            <div key={action.id} className="flex flex-col gap-2 rounded-xl bg-[#0f1117] border border-white/[0.06] p-3 mb-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Select value={action.entityId} onChange={(e) => updateAction(action.id, "entityId", e.target.value)}>
                    {allEntities.length === 0 && <option value="">No entities available</option>}
                    {allEntities.map((e) => (
                      <option key={e.entityId} value={e.entityId}>{e.entityId}</option>
                    ))}
                  </Select>
                </div>
                <button onClick={() => removeAction(action.id)} className="text-red-400 hover:text-red-300 px-2 text-lg">×</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select value={action.service} onChange={(e) => updateAction(action.id, "service", e.target.value)}>
                  {getServicesForEntity(action.entityId).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
                <div className="flex items-center gap-1">
                  <Input type="number" min={0} step={100} value={action.delay}
                    onChange={(e) => updateAction(action.id, "delay", parseInt(e.target.value) || 0)} />
                  <span className="text-[10px] text-zinc-500 whitespace-nowrap">ms delay</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-2">
          {mode === "create" ? (
            <>
              <Btn onClick={handleCreate} disabled={saving || !formName.trim()}>Create</Btn>
              <Btn variant="ghost" onClick={() => { setShowCreate(false); resetForm(); }}>Cancel</Btn>
            </>
          ) : (
            <>
              <Btn onClick={handleSave} disabled={saving || !formName.trim()}>Save Changes</Btn>
              <Btn variant="danger" onClick={() => selected && handleDelete(selected.id)}>Delete</Btn>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Gestures</h1>
          <p className="page-subtitle">Configure gesture recognition and action bindings</p>
        </div>
        <Btn onClick={() => { resetForm(); setSelectedId(null); setShowCreate(true); }}>+ New Gesture</Btn>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Gesture list */}
        <div className="lg:col-span-2 space-y-3">
          {bindings.length === 0 && !showCreate && (
            <Card>
              <div className="text-center py-8">
                <p className="text-zinc-400 mb-1">No gesture bindings configured</p>
                <p className="text-xs text-zinc-500">Create a gesture binding to detect motion patterns and trigger automations</p>
              </div>
            </Card>
          )}

          {showCreate && (
            <Card className="border-teal-500/30">
              <h3 className="section-title mb-3">New Gesture Binding</h3>
              {GestureForm({ mode: "create" })}
            </Card>
          )}

          {bindings.map((binding) => {
            const gestureInfo = GESTURE_TYPES.find((g) => g.value === binding.gesture);
            const isSelected = selectedId === binding.id;
            const zone = binding.zoneId ? zones.find((z) => z.id === binding.zoneId) : null;
            const recentFire = liveEvents.find((e) => e.bindingId === binding.id && Date.now() - e.time < 3000);

            return (
              <Card
                key={binding.id}
                className={`cursor-pointer transition ${
                  isSelected ? "border-teal-500/40 bg-teal-500/[0.03]" : "hover:border-white/10"
                } ${recentFire ? "ring-2 ring-teal-400/50" : ""}`}
              >
                <div
                  className="flex items-start gap-4"
                  onClick={() => setSelectedId(isSelected ? null : binding.id)}
                >
                  <div className={`flex items-center justify-center w-10 h-10 rounded-xl text-lg ${
                    binding.enabled ? "bg-teal-500/15 text-teal-400" : "bg-zinc-700/30 text-zinc-500"
                  }`}>
                    {gestureInfo?.icon ?? "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-sm text-zinc-100 truncate">{binding.name}</span>
                      {!binding.enabled && <span className="badge text-[10px] bg-zinc-600/30 text-zinc-500">disabled</span>}
                      {recentFire && <span className="badge text-[10px] bg-teal-500/20 text-teal-400 animate-pulse">triggered</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-zinc-500">
                      <span>{gestureInfo?.label ?? binding.gesture}</span>
                      <span>·</span>
                      <span>{binding.sensitivity.toFixed(1)}x sens</span>
                      <span>·</span>
                      <span>{binding.cooldown}ms cd</span>
                      {zone && <><span>·</span><span className="text-teal-500">{zone.name}</span></>}
                    </div>
                    <div className="text-[11px] text-zinc-600 mt-1">
                      {binding.actions.length === 0
                        ? "No actions"
                        : `${binding.actions.length} action${binding.actions.length !== 1 ? "s" : ""}`}
                    </div>
                  </div>
                  <button
                    className={`w-10 h-6 rounded-full transition-colors ${binding.enabled ? "bg-teal-600" : "bg-zinc-700"}`}
                    onClick={(e) => { e.stopPropagation(); handleToggle(binding); }}
                  >
                    <div className={`w-4 h-4 rounded-full bg-white transition-transform mx-1 ${binding.enabled ? "translate-x-4" : "translate-x-0"}`} />
                  </button>
                </div>

                {isSelected && (
                  <div className="mt-4 pt-4 border-t border-white/[0.06]">
                    {GestureForm({ mode: "edit" })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        {/* Live activity feed */}
        <div className="space-y-3">
          <Card>
            <h3 className="section-title mb-3">Live Activity</h3>
            {liveEvents.length === 0 ? (
              <p className="text-xs text-zinc-500 text-center py-6 italic">
                Waiting for gesture detections...
              </p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {liveEvents.map((evt, i) => {
                  const binding = bindings.find((b) => b.id === evt.bindingId);
                  const gestureInfo = GESTURE_TYPES.find((g) => g.value === evt.gesture);
                  const age = Math.round((Date.now() - evt.time) / 1000);
                  return (
                    <div key={i} className="flex items-center gap-2 rounded-lg bg-[#0f1117] px-3 py-2 text-xs">
                      <span className="text-base">{gestureInfo?.icon ?? "?"}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-zinc-200 font-medium truncate block">{binding?.name ?? evt.bindingId}</span>
                        <span className="text-zinc-500">{Math.round(evt.confidence * 100)}% conf · T{evt.targetId}</span>
                      </div>
                      <span className="text-zinc-600 whitespace-nowrap">{age}s ago</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card>
            <h3 className="section-title mb-3">Supported Gestures</h3>
            <div className="grid grid-cols-3 gap-2">
              {GESTURE_TYPES.map((g) => (
                <div key={g.value} className="flex flex-col items-center gap-1 rounded-lg bg-[#0f1117] p-2.5 text-center">
                  <span className="text-lg">{g.icon}</span>
                  <span className="text-[10px] text-zinc-400 leading-tight">{g.label}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="section-title mb-2">Tips</h3>
            <ul className="text-xs text-zinc-500 space-y-1.5">
              <li>• Higher sensitivity detects smaller movements</li>
              <li>• Set cooldown to prevent rapid re-triggers</li>
              <li>• Restrict to a zone for area-specific gestures</li>
              <li>• Wave requires repeated left-right motion</li>
              <li>• Combine with zone presence for reliable detection</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
