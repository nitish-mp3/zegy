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

export interface TrackTarget {
  id: number;
  x: number;
  y: number;
  speed: number;
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
