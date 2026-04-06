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

export interface ActionStep {
  id: string;
  entityId: string;
  service: string;
  data?: Record<string, unknown>;
  delay: number;
}

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

export type CameraGestureType = "palm" | "fist";

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
