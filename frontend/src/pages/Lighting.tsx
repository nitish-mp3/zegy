import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, type ActionStep, type CombinedPresenceSnapshot, type EnvironmentMatcher, type EnvironmentReading, type EnvironmentSettings, type LuxAutomationRule } from "../api/client";
import { subscribe } from "../api/ws";

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card p-4 ${className}`}>{children}</div>;
}

function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium text-gray-400">{children}</label>;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ""}`} />;
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`input ${props.className ?? ""}`} />;
}

function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function joinList(value: string[]): string {
  return value.join(", ");
}

function matcherToDraft(matcher: EnvironmentMatcher) {
  return {
    haEntityIds: joinList(matcher.haEntityIds),
    mqttTopicPatterns: joinList(matcher.mqttTopicPatterns),
    valueKeys: joinList(matcher.valueKeys),
    keywords: joinList(matcher.keywords),
  };
}

function draftToMatcher(draft: ReturnType<typeof matcherToDraft>): EnvironmentMatcher {
  return {
    haEntityIds: splitList(draft.haEntityIds),
    mqttTopicPatterns: splitList(draft.mqttTopicPatterns),
    valueKeys: splitList(draft.valueKeys),
    keywords: splitList(draft.keywords),
  };
}

function defaultAction(): ActionStep {
  return {
    id: `as-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type: "ha_service",
    entityId: "",
    service: "turn_on",
    delay: 0,
  };
}

function defaultRule(): Omit<LuxAutomationRule, "id"> {
  return {
    name: "Low light while occupied",
    enabled: true,
    operator: "below",
    threshold: 80,
    thresholdHigh: null,
    requirePresence: true,
    cooldown: 120000,
    actions: [defaultAction()],
    lastTriggeredAt: null,
  };
}

function ActionEditor({ actions, onChange }: { actions: ActionStep[]; onChange: (actions: ActionStep[]) => void }) {
  const update = (idx: number, patch: Partial<ActionStep>) => {
    onChange(actions.map((action, i) => (i === idx ? { ...action, ...patch } as ActionStep : action)));
  };

  return (
    <div className="space-y-2">
      {actions.map((action, idx) => {
        const type = action.type ?? "ha_service";
        return (
          <div key={action.id} className="rounded-xl border border-white/[0.06] bg-surface-overlay p-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <div>
                <Label>Type</Label>
                <Select value={type} onChange={(e) => update(idx, { type: e.target.value as ActionStep["type"] })}>
                  <option value="ha_service">HA service</option>
                  <option value="mqtt_publish">MQTT publish</option>
                  <option value="webhook">Webhook</option>
                </Select>
              </div>
              <div>
                <Label>Delay ms</Label>
                <Input type="number" value={action.delay} onChange={(e) => update(idx, { delay: Number(e.target.value) })} />
              </div>
              {type === "ha_service" && (
                <>
                  <div>
                    <Label>Entity</Label>
                    <Input value={(action as Extract<ActionStep, { type?: "ha_service" }>).entityId ?? ""} onChange={(e) => update(idx, { entityId: e.target.value })} placeholder="light.living_room" />
                  </div>
                  <div>
                    <Label>Service</Label>
                    <Input value={(action as Extract<ActionStep, { type?: "ha_service" }>).service ?? ""} onChange={(e) => update(idx, { service: e.target.value })} placeholder="turn_on" />
                  </div>
                </>
              )}
              {type === "mqtt_publish" && (
                <>
                  <div>
                    <Label>Topic</Label>
                    <Input value={(action as Extract<ActionStep, { type: "mqtt_publish" }>).topic ?? ""} onChange={(e) => update(idx, { topic: e.target.value })} />
                  </div>
                  <div>
                    <Label>Payload</Label>
                    <Input value={(action as Extract<ActionStep, { type: "mqtt_publish" }>).payload ?? ""} onChange={(e) => update(idx, { payload: e.target.value })} />
                  </div>
                </>
              )}
              {type === "webhook" && (
                <>
                  <div>
                    <Label>URL</Label>
                    <Input value={(action as Extract<ActionStep, { type: "webhook" }>).url ?? ""} onChange={(e) => update(idx, { url: e.target.value })} />
                  </div>
                  <div>
                    <Label>Method</Label>
                    <Input value={(action as Extract<ActionStep, { type: "webhook" }>).method ?? "POST"} onChange={(e) => update(idx, { method: e.target.value })} />
                  </div>
                </>
              )}
            </div>
            <button className="btn-ghost mt-2 text-xs text-gray-500" onClick={() => onChange(actions.filter((_, i) => i !== idx))}>Remove action</button>
          </div>
        );
      })}
      <button className="btn-secondary text-xs" onClick={() => onChange([...actions, defaultAction()])}>Add action</button>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <p className="text-[11px] text-gray-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-100">{value}</p>
      {sub && <p className="mt-1 text-[11px] text-gray-600">{sub}</p>}
    </Card>
  );
}

export default function Lighting() {
  const [settings, setSettings] = useState<EnvironmentSettings | null>(null);
  const [drafts, setDrafts] = useState<Record<keyof EnvironmentSettings, ReturnType<typeof matcherToDraft>> | null>(null);
  const [rules, setRules] = useState<LuxAutomationRule[]>([]);
  const [readings, setReadings] = useState<EnvironmentReading[]>([]);
  const [presence, setPresence] = useState<CombinedPresenceSnapshot | null>(null);
  const [editingRule, setEditingRule] = useState<LuxAutomationRule | Omit<LuxAutomationRule, "id"> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const data = await api.getEnvironment();
    setSettings(data.settings);
    setDrafts({
      lux: matcherToDraft(data.settings.lux),
      presence: matcherToDraft(data.settings.presence),
      distance: matcherToDraft(data.settings.distance),
    });
    setRules(data.luxAutomations);
    setReadings(data.readings);
    setPresence(data.presence);
  };

  useEffect(() => {
    load().catch(() => {});
  }, []);

  useEffect(() => {
    const unsub = subscribe((data) => {
      if (data.type !== "environment_update") return;
      const reading = data as unknown as EnvironmentReading;
      setReadings((prev) => [reading, ...prev].slice(0, 100));
      api.getEnvironment().then((next) => {
        setPresence(next.presence);
        setRules(next.luxAutomations);
      }).catch(() => {});
    });
    return unsub;
  }, []);

  const matcherStats = useMemo(() => {
    if (!presence) return { occupied: "Unknown", distance: "-", lux: "-" };
    return {
      occupied: presence.occupied ? "Occupied" : "Clear",
      distance: presence.nearestDistance == null ? "-" : `${presence.nearestDistance.toFixed(2)} m`,
      lux: presence.lux == null ? "-" : `${Math.round(presence.lux)} lx`,
    };
  }, [presence]);

  async function saveSettings() {
    if (!drafts) return;
    setSaving(true);
    try {
      const next = {
        lux: draftToMatcher(drafts.lux),
        presence: draftToMatcher(drafts.presence),
        distance: draftToMatcher(drafts.distance),
      };
      const saved = await api.updateEnvironmentSettings(next);
      setSettings(saved);
      setDrafts({
        lux: matcherToDraft(saved.lux),
        presence: matcherToDraft(saved.presence),
        distance: matcherToDraft(saved.distance),
      });
    } finally {
      setSaving(false);
    }
  }

  async function saveRule() {
    if (!editingRule) return;
    setSaving(true);
    try {
      const saved = "id" in editingRule
        ? await api.updateLuxAutomation(editingRule.id, editingRule)
        : await api.createLuxAutomation(editingRule);
      setRules((prev) => {
        const exists = prev.some((rule) => rule.id === saved.id);
        return exists ? prev.map((rule) => rule.id === saved.id ? saved : rule) : [saved, ...prev];
      });
      setEditingRule(null);
    } finally {
      setSaving(false);
    }
  }

  const updateDraft = (kind: keyof EnvironmentSettings, field: keyof EnvironmentMatcher, value: string) => {
    if (!drafts) return;
    setDrafts({ ...drafts, [kind]: { ...drafts[kind], [field]: value } });
  };

  const updateRule = (patch: Partial<LuxAutomationRule>) => {
    if (!editingRule) return;
    setEditingRule({ ...editingRule, ...patch });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Lighting</h1>
        <p className="page-subtitle">Lux sensing, C4001 presence, LD2450 distance, and light automations</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Current Lux" value={matcherStats.lux} sub={readings.find((r) => r.kind === "lux")?.sourceId} />
        <Stat label="Presence" value={matcherStats.occupied} sub={`LD2450 targets: ${presence?.ld2450Targets.length ?? 0}`} />
        <Stat label="Nearest Distance" value={matcherStats.distance} sub={presence?.c4001Distance == null ? "LD2450 only" : "C4001 and LD2450 fused"} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="section-title">Sensor Matching</h2>
              <p className="mt-1 text-xs text-gray-600">Override entity IDs, MQTT topics, payload keys, and fallback keywords when sensor naming changes.</p>
            </div>
            <button className="btn-primary" onClick={saveSettings} disabled={saving || !settings}>Save</button>
          </div>

          {drafts && (["lux", "presence", "distance"] as const).map((kind) => (
            <div key={kind} className="mb-4 rounded-xl border border-white/[0.06] bg-surface-overlay p-4 last:mb-0">
              <h3 className="mb-3 text-sm font-semibold capitalize text-gray-200">{kind}</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label>HA entity IDs</Label>
                  <Input value={drafts[kind].haEntityIds} onChange={(e) => updateDraft(kind, "haEntityIds", e.target.value)} placeholder="sensor.room_lux, binary_sensor.c4001_presence" />
                </div>
                <div>
                  <Label>MQTT topic patterns</Label>
                  <Input value={drafts[kind].mqttTopicPatterns} onChange={(e) => updateDraft(kind, "mqttTopicPatterns", e.target.value)} placeholder="zegy/+/sensors, zegy/+/lux" />
                </div>
                <div>
                  <Label>Payload keys</Label>
                  <Input value={drafts[kind].valueKeys} onChange={(e) => updateDraft(kind, "valueKeys", e.target.value)} placeholder="lux, illuminance, distance_m" />
                </div>
                <div>
                  <Label>Fallback keywords</Label>
                  <Input value={drafts[kind].keywords} onChange={(e) => updateDraft(kind, "keywords", e.target.value)} placeholder="lux, c4001, presence" />
                </div>
              </div>
            </div>
          ))}
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="section-title">Lux Automations</h2>
              <p className="mt-1 text-xs text-gray-600">Rules execute backend-side when matching lux readings arrive.</p>
            </div>
            <button className="btn-secondary" onClick={() => setEditingRule(defaultRule())}>New</button>
          </div>

          <div className="space-y-2">
            {rules.length === 0 && <p className="py-8 text-center text-sm text-gray-600">No lux rules yet</p>}
            {rules.map((rule) => (
              <div key={rule.id} className="rounded-xl border border-white/[0.06] bg-surface-overlay p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-200">{rule.name}</p>
                    <p className="mt-1 text-[11px] text-gray-600">
                      {rule.operator} {rule.threshold}{rule.thresholdHigh != null ? ` to ${rule.thresholdHigh}` : ""} lx
                      {rule.requirePresence ? " with presence" : ""}
                    </p>
                  </div>
                  <button className={`badge ${rule.enabled ? "bg-zegy-600/15 text-zegy-400" : "bg-gray-800 text-gray-500"}`} onClick={() => api.updateLuxAutomation(rule.id, { ...rule, enabled: !rule.enabled }).then((next) => setRules((prev) => prev.map((r) => r.id === next.id ? next : r)))}>
                    {rule.enabled ? "Enabled" : "Disabled"}
                  </button>
                </div>
                <div className="mt-3 flex gap-2">
                  <button className="btn-secondary text-xs" onClick={() => setEditingRule(rule)}>Edit</button>
                  <button className="btn-ghost text-xs text-gray-500" onClick={() => api.deleteLuxAutomation(rule.id).then(() => setRules((prev) => prev.filter((r) => r.id !== rule.id)))}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {editingRule && (
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="section-title">Rule Details</h2>
            <button className="btn-ghost text-sm text-gray-500" onClick={() => setEditingRule(null)}>Close</button>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <Label>Name</Label>
              <Input value={editingRule.name} onChange={(e) => updateRule({ name: e.target.value })} />
            </div>
            <div>
              <Label>Operator</Label>
              <Select value={editingRule.operator} onChange={(e) => updateRule({ operator: e.target.value as LuxAutomationRule["operator"] })}>
                <option value="below">Below</option>
                <option value="above">Above</option>
                <option value="between">Between</option>
                <option value="outside">Outside</option>
              </Select>
            </div>
            <div>
              <Label>Presence</Label>
              <Select value={editingRule.requirePresence ? "yes" : "no"} onChange={(e) => updateRule({ requirePresence: e.target.value === "yes" })}>
                <option value="yes">Required</option>
                <option value="no">Not required</option>
              </Select>
            </div>
            <div>
              <Label>Threshold</Label>
              <Input type="number" value={editingRule.threshold} onChange={(e) => updateRule({ threshold: Number(e.target.value) })} />
            </div>
            <div>
              <Label>High threshold</Label>
              <Input type="number" value={editingRule.thresholdHigh ?? ""} onChange={(e) => updateRule({ thresholdHigh: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <div>
              <Label>Cooldown ms</Label>
              <Input type="number" value={editingRule.cooldown} onChange={(e) => updateRule({ cooldown: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={editingRule.enabled ? "enabled" : "disabled"} onChange={(e) => updateRule({ enabled: e.target.value === "enabled" })}>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </Select>
            </div>
          </div>
          <div className="mt-4">
            <Label>Actions</Label>
            <ActionEditor actions={editingRule.actions} onChange={(actions) => updateRule({ actions })} />
          </div>
          <div className="mt-4 flex justify-end">
            <button className="btn-primary" onClick={saveRule} disabled={saving}>Save rule</button>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="section-title">Recent Sensor Updates</h2>
        <div className="mt-3 max-h-72 overflow-y-auto">
          {readings.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-600">Waiting for lux, presence, or distance updates</p>
          ) : (
            <div className="space-y-2">
              {readings.slice(0, 30).map((reading, idx) => (
                <div key={`${reading.timestamp}-${idx}`} className="grid gap-2 rounded-xl border border-white/[0.06] bg-surface-overlay px-3 py-2 text-xs sm:grid-cols-[90px_1fr_120px_120px]">
                  <span className="font-medium capitalize text-gray-300">{reading.kind}</span>
                  <span className="truncate text-gray-500">{reading.sourceId}{reading.rawKey ? ` / ${reading.rawKey}` : ""}</span>
                  <span className="tabular-nums text-gray-200">{String(reading.value)} {reading.unit}</span>
                  <span className="text-gray-600">{new Date(reading.timestamp).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
