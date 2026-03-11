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
  speed: number;
  lastSeen: number;
}

let client: mqtt.MqttClient | null = null;
const trackListeners = new Set<TrackCallback>();
const nodeStatusMap = new Map<string, { lastSeen: string; status: "online" | "offline" }>();
const latestTargets = new Map<string, TrackTarget[]>();
const filteredTracks = new Map<string, FilteredTrack>();
let staleTimer: ReturnType<typeof setInterval> | null = null;
const NODE_STALE_MS = 120_000;
const TRACK_HOLD_MS = 2_500;
const TRACK_MATCH_DISTANCE_M = 1.1;
const TRACK_ALPHA_MIN = 0.18;
const TRACK_ALPHA_MAX = 0.62;
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
  const existing = [...filteredTracks.entries()].filter(([, track]) => track.nodeId === nodeId);
  const claimed = new Set<string>();
  const output: TrackTarget[] = [];

  for (const raw of rawTargets) {
    let bestKey: string | null = null;
    let bestDist = TRACK_MATCH_DISTANCE_M;

    for (const [key, track] of existing) {
      if (claimed.has(key)) continue;
      const dist = distance(raw, { x: track.rawX, y: track.rawY });
      if (dist < bestDist) {
        bestDist = dist;
        bestKey = key;
      }
    }

    if (bestKey) {
      claimed.add(bestKey);
      const track = filteredTracks.get(bestKey)!;
      const alpha = getAdaptiveAlpha(raw.speed, bestDist);
      track.rawX = raw.x;
      track.rawY = raw.y;
      track.x += (raw.x - track.x) * alpha;
      track.y += (raw.y - track.y) * alpha;
      track.speed += (raw.speed - track.speed) * Math.min(alpha + 0.12, 0.82);
      track.lastSeen = now;
      output.push({ id: track.id, x: track.x, y: track.y, speed: track.speed });
      continue;
    }

    const stableId = nextFilteredTrackId++;
    const key = `${nodeId}:stable-${stableId}`;
    filteredTracks.set(key, {
      id: stableId,
      nodeId,
      rawX: raw.x,
      rawY: raw.y,
      x: raw.x,
      y: raw.y,
      speed: raw.speed,
      lastSeen: now,
    });
    output.push({ id: stableId, x: raw.x, y: raw.y, speed: raw.speed });
  }

  for (const [key, track] of existing) {
    if (claimed.has(key)) continue;
    const age = now - track.lastSeen;
    if (age <= TRACK_HOLD_MS) {
      track.speed *= 0.9;
      output.push({ id: track.id, x: track.x, y: track.y, speed: track.speed });
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
  // Resolve internal node id from the MQTT topic nodeId so the status lookup in /api/nodes works
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
