export interface SensorReading {
  entityId: string;
  value: string | number;
  unit: string;
  timestamp: string;
  deviceClass: string | null;
}

export interface DeviceSummary {
  id: string;
  name: string;
  manufacturer: string;
  model: string;
  area: string | null;
  firmware: string | null;
  sensors: SensorReading[];
  online: boolean;
}

export interface FloorPlanNode {
  id: string;
  entityId: string;
  label: string;
  x: number;
  y: number;
}

export interface FloorPlanLayout {
  width: number;
  height: number;
  backgroundUrl: string | null;
  nodes: FloorPlanNode[];
}

// ── Zone & Automation ──────────────────────────────────────────

export interface ZonePoint {
  x: number;
  y: number;
}

export type ActionStep =
  | { id: string; type?: "ha_service"; entityId: string; service: string; data?: Record<string, unknown>; delay: number }
  | { id: string; type: "mqtt_publish"; topic: string; payload: string; delay: number }
  | { id: string; type: "webhook"; url: string; method: string; body?: string; headers?: Record<string, string>; delay: number };

export interface Zone {
  id: string;
  name: string;
  color: string;
  points: ZonePoint[];
  enabled: boolean;
  dwellTime: number;
  exitDelay: number;
  onEnter: ActionStep[];
  onExit: ActionStep[];
  auxiliarySensors: string[];
}

export interface SensorNode {
  id: string;
  name: string;
  mqttTopic: string;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  lastSeen: string | null;
  status: "online" | "offline" | "unknown";
}

export type Posture = "standing" | "sitting" | "unknown";

export interface TrackTarget {
  id: number;
  x: number;
  y: number;
  speed: number;
  posture: Posture;
}

export interface TrackFrame {
  nodeId: string;
  timestamp: string;
  presence: boolean;
  targets: TrackTarget[];
}

export type EnvironmentSourceType = "ha" | "mqtt";

export interface EnvironmentMatcher {
  haEntityIds: string[];
  mqttTopicPatterns: string[];
  valueKeys: string[];
  keywords: string[];
}

export interface EnvironmentSettings {
  lux: EnvironmentMatcher;
  presence: EnvironmentMatcher;
  distance: EnvironmentMatcher;
}

export interface EnvironmentReading {
  kind: "lux" | "presence" | "distance";
  sourceType: EnvironmentSourceType;
  sourceId: string;
  value: number | boolean;
  unit: string;
  timestamp: string;
  rawKey: string | null;
}

export interface CombinedPresenceSnapshot {
  occupied: boolean;
  nearestDistance: number | null;
  lux: number | null;
  ld2450Targets: TrackTarget[];
  c4001Presence: boolean | null;
  c4001Distance: number | null;
  updatedAt: string | null;
}

export interface LuxAutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  operator: "below" | "above" | "between" | "outside";
  threshold: number;
  thresholdHigh: number | null;
  requirePresence: boolean;
  cooldown: number;
  actions: ActionStep[];
  lastTriggeredAt?: string | null;
}

export interface ZoneEvent {
  id: string;
  zoneId: string;
  zoneName: string;
  type: "enter" | "exit";
  timestamp: string;
  targetCount: number;
}

// ── Gesture Recognition ────────────────────────────────────────

export type GestureType =
  | "swipe_left"
  | "swipe_right"
  | "swipe_up"
  | "swipe_down"
  | "approach"
  | "retreat"
  | "wave"
  | "push"
  | "pull";

export interface GestureAction {
  id: string;
  entityId: string;
  service: string;
  data?: Record<string, unknown>;
  delay: number;
}

export interface GestureBinding {
  id: string;
  name: string;
  gesture: GestureType;
  enabled: boolean;
  sensitivity: number;
  cooldown: number;
  zoneId: string | null;
  actions: GestureAction[];
  stats?: { correct: number; incorrect: number };
}

export interface GestureEvent {
  id: string;
  bindingId: string;
  gesture: GestureType;
  timestamp: string;
  targetId: number;
  confidence: number;
  actionNames?: string[];
}

// ── Camera Gesture Control ─────────────────────────────────

export type CameraGestureType = "palm" | "fist" | "point" | "thumbs_up";

export interface CameraGestureBinding {
  id: string;
  gesture: CameraGestureType;
  name: string;
  holdTime: number;
  cooldown: number;
  actions: ActionStep[];
  enabled: boolean;
}

export interface CameraCalibration {
  palmFeatures: number[][];
  fistFeatures: number[][];
  calibratedAt: string;
}

export interface CameraConfig {
  id: string;
  name: string;
  url: string;
  snapshotUrl: string;
  username: string;
  password: string;
  enabled: boolean;
  groupId: string | null;
  gestures: CameraGestureBinding[];
  calibration: CameraCalibration | null;
}

export interface CameraGroup {
  id: string;
  name: string;
  gestures: CameraGestureBinding[];
}

export interface DiscoveredCamera {
  ip: string;
  port: number;
  name: string;
  streamUrl: string;
  snapshotUrl: string;
  brand: string | null;
  confidence: "confirmed" | "likely";
  requiresAuth: boolean;
}
