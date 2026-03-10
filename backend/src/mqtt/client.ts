import * as mqtt from "mqtt";
import { config } from "../config";
import { logger } from "../logger";
import type { TrackFrame, TrackTarget, SensorNode } from "../types";

type TrackCallback = (frame: TrackFrame) => void;

let client: mqtt.MqttClient | null = null;
const trackListeners = new Set<TrackCallback>();
const nodeStatusMap = new Map<string, { lastSeen: string; status: "online" | "offline" }>();
const latestTargets = new Map<string, TrackTarget[]>();
let staleTimer: ReturnType<typeof setInterval> | null = null;
const NODE_STALE_MS = 120_000;

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
  const targets = transformTargets(rawTargets, node);
  latestTargets.set(nodeId, targets);

  const frame: TrackFrame = {
    nodeId,
    timestamp: new Date().toISOString(),
    presence: data.presence ?? rawTargets.length > 0,
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
          if (mqttId) latestTargets.delete(mqttId);
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
  if (staleTimer) { clearInterval(staleTimer); staleTimer = null; }
}

export function publishNodeConfig(nodeId: string, payload: Record<string, unknown>): void {
  if (!client) return;
  client.publish(`zegy/${nodeId}/config`, JSON.stringify(payload), { qos: 1 });
}
