import * as mqtt from "mqtt";
import { config } from "../config";
import { logger } from "../logger";
import type { TrackFrame, TrackTarget, SensorNode } from "../types";

type TrackCallback = (frame: TrackFrame) => void;

interface FilteredTrack {
  id: number;
  nodeId: string;
  rawX: number;
  rawY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  lastSeen: number;
  age: number;
  coastCount: number;
  stationarySince: number;
  posture: "standing" | "sitting" | "unknown";
  positionHistory: Array<{ x: number; y: number; t: number }>;
}

let client: mqtt.MqttClient | null = null;
const trackListeners = new Set<TrackCallback>();
const nodeStatusMap = new Map<string, { lastSeen: string; status: "online" | "offline" }>();
const latestTargets = new Map<string, TrackTarget[]>();
const filteredTracks = new Map<string, FilteredTrack>();
let staleTimer: ReturnType<typeof setInterval> | null = null;
const NODE_STALE_MS = 120_000;
const TRACK_HOLD_MS = 4_000;
const TRACK_HOLD_STATIONARY_MS = 12_000;
const TRACK_MATCH_DISTANCE_M = 1.1;
const TRACK_VELOCITY_GATE = 1.8;
const TRACK_PREDICTION_DT = 0.15;
const TRACK_MAX_COAST = 8;
const TRACK_MAX_COAST_STATIONARY = 24;
const TRACK_MIN_AGE_FOR_PRIORITY = 2000;
const TRACK_ALPHA_MIN = 0.18;
const TRACK_ALPHA_MAX = 0.62;
const STATIONARY_SPEED_THRESH = 0.08;
const STATIONARY_CONFIRM_MS = 3000;
const POSTURE_WINDOW_SIZE = 30;
const POSTURE_SITTING_VARIANCE_M = 0.035;
const POSTURE_SITTING_MIN_SAMPLES = 15;
const POSTURE_SITTING_STATIONARITY_MS = 8000;
const POSTURE_STANDING_STATIONARITY_MS = 3000;
let nextFilteredTrackId = 1;

// Track the MQTT nodeId ↔ internal node.id mapping for stale cleanup
const nodeIdToMqttId = new Map<string, string>();

let resolveNodes: () => SensorNode[] = () => [];
let autoCreateNodeFn: ((mqttNodeId: string) => SensorNode | null) | null = null;

export function setNodeResolver(fn: () => SensorNode[]): void {
  resolveNodes = fn;
}

export function setAutoCreateNode(fn: (mqttNodeId: string) => SensorNode | null): void {
  autoCreateNodeFn = fn;
}

export function onTrackFrame(cb: TrackCallback): () => void {
  trackListeners.add(cb);
  return () => { trackListeners.delete(cb); };
}

export function getNodeStatus(): Map<string, { lastSeen: string; status: "online" | "offline" }> {
  return nodeStatusMap;
}

export function getLatestTargets(): Map<string, TrackTarget[]> {
  return latestTargets;
}

// Clean up tracks that haven't been updated for a long time to prevent memory bloat [10/41] [13/03/26]

function isTrackStationary(track: FilteredTrack, now: number): boolean {
  return track.stationarySince > 0 && (now - track.stationarySince) >= STATIONARY_CONFIRM_MS;
}

function classifyPosture(track: FilteredTrack, now: number): "standing" | "sitting" | "unknown" {
  if (track.stationarySince === 0) return "standing";

  const stationaryDuration = now - track.stationarySince;
  if (stationaryDuration < POSTURE_STANDING_STATIONARITY_MS) return "unknown";

  const history = track.positionHistory;
  if (history.length < POSTURE_SITTING_MIN_SAMPLES) {
    return stationaryDuration >= POSTURE_SITTING_STATIONARITY_MS ? "sitting" : "standing";
  }

  let sumX = 0, sumY = 0;
  for (const p of history) { sumX += p.x; sumY += p.y; }
  const meanX = sumX / history.length;
  const meanY = sumY / history.length;

  let variance = 0;
  for (const p of history) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    variance += dx * dx + dy * dy;
  }
  variance = Math.sqrt(variance / history.length);

  if (variance <= POSTURE_SITTING_VARIANCE_M && stationaryDuration >= POSTURE_SITTING_STATIONARITY_MS) {
    return "sitting";
  }

  return stationaryDuration >= POSTURE_STANDING_STATIONARITY_MS ? "standing" : "unknown";
}

function cleanUpOldTracks(): void {
  const now = Date.now();
  for (const [key, track] of filteredTracks) {
    const stationary = isTrackStationary(track, now);
    const holdMs = stationary ? TRACK_HOLD_STATIONARY_MS : TRACK_HOLD_MS;
    const maxCoast = stationary ? TRACK_MAX_COAST_STATIONARY : TRACK_MAX_COAST;
    if (now - track.lastSeen > holdMs * 2 || track.coastCount > maxCoast + 2) {
      filteredTracks.delete(key);
    }
  }
}



function transformTargets(
  raw: { id: number; x: number; y: number; speed: number }[],
  node: SensorNode,
): TrackTarget[] {
  const rad = (node.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return raw.map((t) => ({
    id: t.id,
    x: node.x + (t.x * cos - t.y * sin) * node.scale,
    y: node.y - (t.x * sin + t.y * cos) * node.scale,
    speed: t.speed,
    posture: "unknown" as const,
  }));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getAdaptiveAlpha(speed: number, dist: number): number {
  return clamp(0.2 + Math.min(speed, 1.5) * 0.18 + Math.min(dist, 1.5) * 0.14, TRACK_ALPHA_MIN, TRACK_ALPHA_MAX);
}

function stabilizeTargets(nodeId: string, rawTargets: TrackTarget[]): TrackTarget[] {
  const now = Date.now();
  cleanUpOldTracks();
  const existing = [...filteredTracks.entries()].filter(([, track]) => track.nodeId === nodeId);

  existing.sort(([, a], [, b]) => b.age - a.age);

  const associations: Array<{ trackKey: string; rawIdx: number; score: number }> = [];
  const usedTracks = new Set<string>();
  const usedRaws = new Set<number>();

  for (const [trackKey, track] of existing) {
    if (usedTracks.has(trackKey)) continue;

    const dtSec = clamp((now - track.lastSeen) / 1000, 0.05, 0.35);
    const predX = track.x + track.vx * dtSec;
    const predY = track.y + track.vy * dtSec;

    let bestRawIdx = -1;
    let bestScore = Infinity;

    for (let i = 0; i < rawTargets.length; i++) {
      if (usedRaws.has(i)) continue;

      const raw = rawTargets[i];
      const posDist = distance({ x: predX, y: predY }, raw);

      if (posDist > TRACK_MATCH_DISTANCE_M) continue;

      const candVx = (raw.x - track.x) / dtSec;
      const candVy = (raw.y - track.y) / dtSec;
      const velDist = Math.hypot(track.vx - candVx, track.vy - candVy);
      if (velDist > TRACK_VELOCITY_GATE + posDist * 1.2) continue;

      const score = posDist * 0.75 + Math.min(velDist, 3) * 0.25;
      if (score < bestScore) {
        bestScore = score;
        bestRawIdx = i;
      }
    }

    if (bestRawIdx >= 0) {
      associations.push({ trackKey, rawIdx: bestRawIdx, score: bestScore });
      usedTracks.add(trackKey);
      usedRaws.add(bestRawIdx);
    }
  }

  for (const [trackKey, track] of existing) {
    if (usedTracks.has(trackKey)) continue;

    let bestRawIdx = -1;
    let bestDist = TRACK_MATCH_DISTANCE_M;

    for (let i = 0; i < rawTargets.length; i++) {
      if (usedRaws.has(i)) continue;
      const dist = distance(track, rawTargets[i]);
      if (dist < bestDist) {
        bestDist = dist;
        bestRawIdx = i;
      }
    }

    if (bestRawIdx >= 0) {
      associations.push({ trackKey, rawIdx: bestRawIdx, score: bestDist + 10 });
      usedTracks.add(trackKey);
      usedRaws.add(bestRawIdx);
    }
  }

  const output: TrackTarget[] = [];
  for (const assoc of associations) {
    const track = filteredTracks.get(assoc.trackKey)!;
    const raw = rawTargets[assoc.rawIdx];
    const seenMs = Math.max(50, now - track.lastSeen);
    const dtSec = clamp(seenMs / 1000, 0.05, 0.35);
    const prevX = track.x;
    const prevY = track.y;

    const baseAlpha = getAdaptiveAlpha(raw.speed, assoc.score);
    const ageBoost = track.age < 500 ? 0.30 : track.age < 1500 ? 0.12 : 0;
    const alpha = Math.min(0.92, baseAlpha + ageBoost);
    track.rawX = raw.x;
    track.rawY = raw.y;
    track.x += (raw.x - track.x) * alpha;
    track.y += (raw.y - track.y) * alpha;

    track.vx = (track.x - prevX) / dtSec;
    track.vy = (track.y - prevY) / dtSec;
    track.speed = Math.sqrt(track.vx * track.vx + track.vy * track.vy);

    if (track.speed < STATIONARY_SPEED_THRESH) {
      if (track.stationarySince === 0) track.stationarySince = now;
      track.positionHistory.push({ x: track.x, y: track.y, t: now });
      if (track.positionHistory.length > POSTURE_WINDOW_SIZE) {
        track.positionHistory.shift();
      }
      track.posture = classifyPosture(track, now);
    } else {
      track.stationarySince = 0;
      track.posture = "standing";
      track.positionHistory.length = 0;
    }

    track.lastSeen = now;
    track.age += seenMs;
    track.coastCount = 0;

    output.push({ id: track.id, x: track.x, y: track.y, speed: track.speed, posture: track.posture });
  }

  for (let i = 0; i < rawTargets.length; i++) {
    if (usedRaws.has(i)) continue;

    const raw = rawTargets[i];
    const stableId = nextFilteredTrackId++;
    const key = `${nodeId}:stable-${stableId}`;
    filteredTracks.set(key, {
      id: stableId,
      nodeId,
      rawX: raw.x,
      rawY: raw.y,
      x: raw.x,
      y: raw.y,
      vx: 0,
      vy: 0,
      speed: 0,
      lastSeen: now,
      age: 0,
      coastCount: 0,
      stationarySince: 0,
      posture: "unknown",
      positionHistory: [],
    });
    output.push({ id: stableId, x: raw.x, y: raw.y, speed: raw.speed, posture: "unknown" });
  }

  for (const [key, track] of existing) {
    if (usedTracks.has(key)) continue;

    track.coastCount++;
    const stationary = isTrackStationary(track, now);
    const maxCoast = stationary ? TRACK_MAX_COAST_STATIONARY : TRACK_MAX_COAST;
    const holdMs = stationary ? TRACK_HOLD_STATIONARY_MS : TRACK_HOLD_MS;
    if (track.coastCount > maxCoast) {
      filteredTracks.delete(key);
      continue;
    }

    if (!stationary) {
      track.x += track.vx * TRACK_PREDICTION_DT;
      track.y += track.vy * TRACK_PREDICTION_DT;
    }
    track.speed *= 0.95;
    track.age += TRACK_PREDICTION_DT * 1000;

    const age = now - track.lastSeen;
    if (age <= holdMs) {
      output.push({ id: track.id, x: track.x, y: track.y, speed: track.speed, posture: track.posture });
    } else {
      filteredTracks.delete(key);
    }
  }

  return output.sort((a, b) => a.id - b.id);
}

function handleTrackMessage(
  nodeId: string,
  data: { presence?: boolean; targets?: { id: number; x: number; y: number; speed: number }[] },
): void {
  const nodes = resolveNodes();
  // Match by mqttTopic — accept both "zegy/<id>" (base) and "zegy/<id>/tracks" (full) forms
  let node = nodes.find((n) => n.mqttTopic === `zegy/${nodeId}` || n.mqttTopic === `zegy/${nodeId}/tracks`);

  // Auto-discover: create a node entry when an unknown sensor publishes
  if (!node && autoCreateNodeFn) {
    node = autoCreateNodeFn(nodeId) ?? undefined;
    if (node) logger.info({ nodeId, id: node.id }, "Auto-discovered new sensor node");
  }
  if (!node) return;

  nodeStatusMap.set(node.id, { lastSeen: new Date().toISOString(), status: "online" });
  nodeIdToMqttId.set(node.id, nodeId);

  const rawTargets = Array.isArray(data.targets) ? data.targets : [];
  const targets = stabilizeTargets(nodeId, transformTargets(rawTargets, node));
  latestTargets.set(nodeId, targets);

  const frame: TrackFrame = {
    nodeId,
    timestamp: new Date().toISOString(),
    presence: targets.length > 0 || data.presence === true,
    targets,
  };

  for (const cb of trackListeners) {
    cb(frame);
  }
}

function handleStatusMessage(nodeId: string, data: { status?: string }): void {
  const status = data.status === "online" ? "online" as const : "offline" as const;
  const nodes = resolveNodes();
  const node = nodes.find((n) => n.mqttTopic === `zegy/${nodeId}` || n.mqttTopic === `zegy/${nodeId}/tracks`);
  const mapKey = node ? node.id : nodeId;
  nodeStatusMap.set(mapKey, { lastSeen: new Date().toISOString(), status });
}

export function startMqtt(): void {
  if (!config.mqtt.url) {
    logger.info("No MQTT_URL configured — skipping MQTT connection");
    return;
  }

  logger.info({ url: config.mqtt.url }, "Connecting to MQTT broker");

  client = mqtt.connect(config.mqtt.url, {
    username: config.mqtt.username || undefined,
    password: config.mqtt.password || undefined,
    clientId: `zegy-${Date.now()}`,
    reconnectPeriod: 3000,
    keepalive: 60,
    connectTimeout: 10_000,
  });

  client.on("connect", () => {
    logger.info("MQTT connected");
    client?.subscribe("zegy/+/tracks", (err) => {
      if (err) logger.error({ err }, "Failed to subscribe to tracks topic");
    });
    client?.subscribe("zegy/+/status", (err) => {
      if (err) logger.error({ err }, "Failed to subscribe to status topic");
    });
  });

  client.on("message", (topic: string, payload: Buffer) => {
    try {
      const parts = topic.split("/");
      if (parts.length !== 3 || parts[0] !== "zegy") return;

      const nodeId = parts[1];
      const msgType = parts[2];
      const data = JSON.parse(payload.toString());

      if (msgType === "tracks") {
        handleTrackMessage(nodeId, data);
      } else if (msgType === "status") {
        handleStatusMessage(nodeId, data);
      }
    } catch (err) {
      logger.debug({ err, topic }, "Failed to process MQTT message");
    }
  });

  client.on("reconnect", () => {
    logger.info("MQTT reconnecting...");
  });

  client.on("error", (err: Error) => {
    logger.error({ err }, "MQTT error");
  });

  client.on("offline", () => {
    logger.warn("MQTT offline, will reconnect...");
  });

  client.on("close", () => {
    logger.warn("MQTT connection closed");
  });

  startStaleDetection();
}

function startStaleDetection(): void {
  staleTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of nodeStatusMap) {
      if (entry.status === "online") {
        const lastMs = new Date(entry.lastSeen).getTime();
        if (now - lastMs > NODE_STALE_MS) {
          entry.status = "offline";
          // Clean up latestTargets using the correct MQTT nodeId key
          const mqttId = nodeIdToMqttId.get(id);
          if (mqttId) {
            latestTargets.delete(mqttId);
            for (const [trackKey, track] of filteredTracks) {
              if (track.nodeId === mqttId) filteredTracks.delete(trackKey);
            }
          }
          logger.info({ nodeId: id }, "Node marked offline (no data for 2 min)");
        }
      }
    }
  }, 30_000);
}

export function stopMqtt(): void {
  client?.end(true);
  client = null;
  trackListeners.clear();
  latestTargets.clear();
  filteredTracks.clear();
  if (staleTimer) { clearInterval(staleTimer); staleTimer = null; }
}

export function publishNodeConfig(nodeId: string, payload: Record<string, unknown>): void {
  if (!client) return;
  client.publish(`zegy/${nodeId}/config`, JSON.stringify(payload), { qos: 1 });
}

export function mqttPublish(topic: string, payload: string): void {
  if (!client) return;
  client.publish(topic, payload);
}
