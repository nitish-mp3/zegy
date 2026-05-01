import { executeActions } from "../actions";
import { loadJson, saveJson } from "../store";
import { logger } from "../logger";
import type {
  CombinedPresenceSnapshot,
  EnvironmentMatcher,
  EnvironmentReading,
  EnvironmentSettings,
  LuxAutomationRule,
  TrackFrame,
  TrackTarget,
} from "../types";

const SETTINGS_FILE = "environment-settings.json";
const LUX_RULES_FILE = "lux-automations.json";
const MAX_READINGS = 100;

const DEFAULT_SETTINGS: EnvironmentSettings = {
  lux: {
    haEntityIds: [],
    mqttTopicPatterns: ["zegy/+/lux", "zegy/+/light", "zegy/+/sensors", "zegy/+/state", "zegy/+/telemetry", "zegy/+/tracks"],
    valueKeys: ["lux", "illuminance", "light", "light_level", "ambient_lux"],
    keywords: ["lux", "illuminance", "light"],
  },
  presence: {
    haEntityIds: [],
    mqttTopicPatterns: ["zegy/+/presence", "zegy/+/occupancy", "zegy/+/sensors", "zegy/+/state", "zegy/+/telemetry", "zegy/+/tracks"],
    valueKeys: ["presence", "occupied", "occupancy", "human", "detected", "c4001_presence", "c4001OutPresence", "c4001RadarPresence"],
    keywords: ["presence", "occupancy", "occupied", "human", "c4001"],
  },
  distance: {
    haEntityIds: [],
    mqttTopicPatterns: ["zegy/+/distance", "zegy/+/range", "zegy/+/sensors", "zegy/+/state", "zegy/+/telemetry", "zegy/+/tracks"],
    valueKeys: ["distance", "range", "distance_m", "distance_cm", "nearest", "c4001_distance", "c4001DistanceM", "c4001DistanceCm"],
    keywords: ["distance", "range", "nearest", "c4001"],
  },
};

let settingsCache: EnvironmentSettings | null = null;
let rulesCache: LuxAutomationRule[] | null = null;
const readings: EnvironmentReading[] = [];
const latestByKind = new Map<EnvironmentReading["kind"], EnvironmentReading>();
const latestTracks = new Map<string, TrackTarget[]>();
const lastRuleFire = new Map<string, number>();
const listeners = new Set<(reading: EnvironmentReading) => void>();

function normalizeMatcher(matcher: Partial<EnvironmentMatcher> | undefined, fallback: EnvironmentMatcher): EnvironmentMatcher {
  return {
    haEntityIds: Array.isArray(matcher?.haEntityIds) ? matcher.haEntityIds.filter(Boolean) : fallback.haEntityIds,
    mqttTopicPatterns: Array.isArray(matcher?.mqttTopicPatterns) ? matcher.mqttTopicPatterns.filter(Boolean) : fallback.mqttTopicPatterns,
    valueKeys: Array.isArray(matcher?.valueKeys) ? matcher.valueKeys.filter(Boolean) : fallback.valueKeys,
    keywords: Array.isArray(matcher?.keywords) ? matcher.keywords.filter(Boolean) : fallback.keywords,
  };
}

export function loadEnvironmentSettings(): EnvironmentSettings {
  if (!settingsCache) {
    const saved = loadJson<Partial<EnvironmentSettings>>(SETTINGS_FILE, {});
    settingsCache = {
      lux: normalizeMatcher(saved.lux, DEFAULT_SETTINGS.lux),
      presence: normalizeMatcher(saved.presence, DEFAULT_SETTINGS.presence),
      distance: normalizeMatcher(saved.distance, DEFAULT_SETTINGS.distance),
    };
  }
  return settingsCache;
}

export function saveEnvironmentSettings(settings: EnvironmentSettings): EnvironmentSettings {
  settingsCache = {
    lux: normalizeMatcher(settings.lux, DEFAULT_SETTINGS.lux),
    presence: normalizeMatcher(settings.presence, DEFAULT_SETTINGS.presence),
    distance: normalizeMatcher(settings.distance, DEFAULT_SETTINGS.distance),
  };
  saveJson(SETTINGS_FILE, settingsCache);
  return settingsCache;
}

export function loadLuxAutomations(): LuxAutomationRule[] {
  if (!rulesCache) {
    rulesCache = loadJson<LuxAutomationRule[]>(LUX_RULES_FILE, []).map((rule) => ({
      ...rule,
      enabled: rule.enabled !== false,
      cooldown: Number.isFinite(rule.cooldown) ? rule.cooldown : 120000,
      thresholdHigh: rule.thresholdHigh ?? null,
      actions: Array.isArray(rule.actions) ? rule.actions : [],
      lastTriggeredAt: rule.lastTriggeredAt ?? null,
    }));
  }
  return rulesCache;
}

export function saveLuxAutomations(rules: LuxAutomationRule[]): LuxAutomationRule[] {
  rulesCache = rules.map((rule) => ({
    ...rule,
    enabled: rule.enabled !== false,
    threshold: Number(rule.threshold) || 0,
    thresholdHigh: rule.thresholdHigh == null ? null : Number(rule.thresholdHigh),
    cooldown: Number(rule.cooldown) || 0,
    actions: Array.isArray(rule.actions) ? rule.actions : [],
    lastTriggeredAt: rule.lastTriggeredAt ?? null,
  }));
  saveJson(LUX_RULES_FILE, rulesCache);
  return rulesCache;
}

export function onEnvironmentReading(cb: (reading: EnvironmentReading) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function lowerSet(values: string[]): Set<string> {
  return new Set(values.map((v) => v.toLowerCase()));
}

function matchesEntity(entityId: string, matcher: EnvironmentMatcher): boolean {
  const entity = entityId.toLowerCase();
  const ids = lowerSet(matcher.haEntityIds);
  if (ids.has(entity)) return true;
  return matcher.keywords.some((keyword) => entity.includes(keyword.toLowerCase()));
}

function topicPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split("/")
    .map((part) => {
      if (part === "+") return "[^/]+";
      if (part === "#") return ".+";
      return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesTopic(topic: string, matcher: EnvironmentMatcher): boolean {
  const t = topic.toLowerCase();
  if (matcher.mqttTopicPatterns.some((pattern) => topicPatternToRegExp(pattern).test(topic))) return true;
  return matcher.keywords.some((keyword) => t.includes(keyword.toLowerCase()));
}

function flattenPayload(value: unknown, prefix = ""): Array<{ key: string; value: unknown }> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return [{ key: prefix, value }];
  const out: Array<{ key: string; value: unknown }> = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    out.push(...flattenPayload(child, nextKey));
  }
  return out;
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["on", "true", "yes", "detected", "occupied", "present", "1"].includes(v)) return true;
    if (["off", "false", "no", "clear", "not_detected", "unoccupied", "0"].includes(v)) return false;
  }
  return null;
}

function compactKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findPayloadValue(payload: unknown, matcher: EnvironmentMatcher, kind: EnvironmentReading["kind"]): { value: number | boolean; key: string | null } | null {
  const fields = flattenPayload(payload);
  const keyNames = matcher.valueKeys.map((k) => k.toLowerCase());
  const compactKeyNames = matcher.valueKeys.map(compactKey);
  const keywords = matcher.keywords.map((k) => k.toLowerCase());
  const ranked = fields
    .map((field) => {
      const key = field.key.toLowerCase();
      const compact = compactKey(field.key);
      const exact = keyNames.some((name) => key === name || key.endsWith(`.${name}`)) || compactKeyNames.some((name) => compact.includes(name));
      const fuzzy = keywords.some((name) => key.includes(name) && (name !== "c4001" || key.includes(kind)));
      const distancePriority = kind === "distance" && compact.includes("distancem") ? 0.2 : kind === "distance" && compact.includes("distancecm") ? 0.1 : 0;
      return { ...field, score: exact ? 3 + distancePriority : fuzzy ? 1 : 0 };
    })
    .filter((field) => field.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const field of ranked) {
    if (kind === "presence") {
      const b = parseBoolean(field.value);
      if (b != null) return { value: b, key: field.key || null };
    } else {
      const n = parseNumeric(field.value);
      if (n != null) return { value: n, key: field.key || null };
    }
  }

  if (fields.length === 1) {
    const field = fields[0];
    if (kind === "presence") {
      const b = parseBoolean(field.value);
      if (b != null) return { value: b, key: field.key || null };
    } else {
      const n = parseNumeric(field.value);
      if (n != null) return { value: n, key: field.key || null };
    }
  }

  return null;
}

function hasPayloadMatch(payload: unknown, matcher: EnvironmentMatcher, kind: EnvironmentReading["kind"]): boolean {
  return findPayloadValue(payload, matcher, kind) != null;
}

function emitReading(reading: EnvironmentReading): void {
  readings.unshift(reading);
  if (readings.length > MAX_READINGS) readings.pop();
  latestByKind.set(reading.kind, reading);
  for (const cb of listeners) cb(reading);
  if (reading.kind === "lux") evaluateLuxAutomations(Number(reading.value));
}

export function recordHaState(entityId: string, state: string, attributes: Record<string, unknown>): void {
  const settings = loadEnvironmentSettings();
  const source = { entityId, state, attributes };
  for (const kind of ["lux", "presence", "distance"] as const) {
    const matcher = settings[kind];
    if (!matchesEntity(entityId, matcher)) continue;
    const found = findPayloadValue(source, matcher, kind) ?? findPayloadValue(state, matcher, kind);
    if (!found) continue;
    emitReading({
      kind,
      sourceType: "ha",
      sourceId: entityId,
      value: kind === "distance" && found.key?.toLowerCase().includes("cm") ? Number(found.value) / 100 : found.value,
      unit: kind === "lux" ? "lx" : kind === "distance" ? "m" : "",
      timestamp: new Date().toISOString(),
      rawKey: found.key,
    });
  }
}

export function recordMqttMessage(topic: string, payload: unknown): void {
  const settings = loadEnvironmentSettings();
  for (const kind of ["lux", "presence", "distance"] as const) {
    const matcher = settings[kind];
    if (!matchesTopic(topic, matcher) && !hasPayloadMatch(payload, matcher, kind)) continue;
    const found = findPayloadValue(payload, matcher, kind);
    if (!found) continue;
    emitReading({
      kind,
      sourceType: "mqtt",
      sourceId: topic,
      value: kind === "distance" && found.key?.toLowerCase().includes("cm") ? Number(found.value) / 100 : found.value,
      unit: kind === "lux" ? "lx" : kind === "distance" ? "m" : "",
      timestamp: new Date().toISOString(),
      rawKey: found.key,
    });
  }
}

export function recordTrackFrame(frame: TrackFrame): void {
  latestTracks.set(frame.nodeId, frame.targets);
}

function nearestLd2450Distance(): number | null {
  const targets = [...latestTracks.values()].flat();
  if (targets.length === 0) return null;
  return Math.min(...targets.map((target) => Math.sqrt(target.x * target.x + target.y * target.y)));
}

function ruleMatches(rule: LuxAutomationRule, lux: number): boolean {
  if (rule.operator === "below") return lux <= rule.threshold;
  if (rule.operator === "above") return lux >= rule.threshold;
  const high = rule.thresholdHigh ?? rule.threshold;
  if (rule.operator === "between") return lux >= rule.threshold && lux <= high;
  return lux < rule.threshold || lux > high;
}

function hasPresence(): boolean {
  const c4001 = latestByKind.get("presence")?.value;
  return c4001 === true || [...latestTracks.values()].some((targets) => targets.length > 0);
}

async function evaluateLuxAutomations(lux: number): Promise<void> {
  const now = Date.now();
  const rules = loadLuxAutomations();
  let changed = false;
  for (const rule of rules) {
    if (!rule.enabled || !ruleMatches(rule, lux)) continue;
    if (rule.requirePresence && !hasPresence()) continue;
    const last = lastRuleFire.get(rule.id) ?? (rule.lastTriggeredAt ? new Date(rule.lastTriggeredAt).getTime() : 0);
    if (last && now - last < rule.cooldown) continue;
    lastRuleFire.set(rule.id, now);
    rule.lastTriggeredAt = new Date(now).toISOString();
    changed = true;
    executeActions(rule.actions).catch((err) => {
      logger.error({ err, ruleId: rule.id }, "Failed to execute lux automation");
    });
  }
  if (changed) saveLuxAutomations(rules);
}

export function getEnvironmentReadings(): EnvironmentReading[] {
  return readings;
}

export function getCombinedPresenceSnapshot(): CombinedPresenceSnapshot {
  const lux = latestByKind.get("lux");
  const presence = latestByKind.get("presence");
  const distance = latestByKind.get("distance");
  const ld2450Targets = [...latestTracks.values()].flat();
  const ldDistance = nearestLd2450Distance();
  const c4001Distance = typeof distance?.value === "number" ? distance.value : null;
  const nearestDistance = [ldDistance, c4001Distance].filter((v): v is number => v != null).sort((a, b) => a - b)[0] ?? null;
  const latestTimes = [lux?.timestamp, presence?.timestamp, distance?.timestamp].filter((v): v is string => !!v);
  return {
    occupied: hasPresence(),
    nearestDistance,
    lux: typeof lux?.value === "number" ? lux.value : null,
    ld2450Targets,
    c4001Presence: typeof presence?.value === "boolean" ? presence.value : null,
    c4001Distance,
    updatedAt: latestTimes.sort().at(-1) ?? null,
  };
}
