function detectBase(): string {
  const m = window.location.pathname.match(/^\/api\/hassio_ingress\/[^/]+/);
  return m ? m[0] : "";
}

const BASE = detectBase();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body != null ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${path}: ${body}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  getHealth: () => request<{ status: string; uptime: number }>("/api/health"),

  getDevices: () =>
    request<
      {
        id: string;
        name: string;
        manufacturer: string;
        model: string;
        area: string | null;
        firmware: string | null;
        sensors: {
          entityId: string;
          value: string | number;
          unit: string;
          timestamp: string;
          deviceClass: string | null;
        }[];
        online: boolean;
      }[]
    >("/api/devices"),

  getDevice: (id: string) =>
    request<{
      id: string;
      name: string;
      manufacturer: string;
      model: string;
      area: string | null;
      firmware: string | null;
      sensors: {
        entityId: string;
        value: string | number;
        unit: string;
        timestamp: string;
        deviceClass: string | null;
      }[];
      online: boolean;
    }>(`/api/devices/${encodeURIComponent(id)}`),

  getSensors: () =>
    request<
      {
        entityId: string;
        value: string | number;
        unit: string;
        timestamp: string;
        deviceClass: string | null;
      }[]
    >("/api/sensors"),

  getSensorSummary: () =>
    request<{
      total: number;
      available: number;
      unavailable: number;
      byClass: Record<string, number>;
    }>("/api/sensors/summary"),

  getAreas: () =>
    request<{ area_id: string; name: string; floor_id: string | null }[]>(
      "/api/areas",
    ),

  getFloorplan: () =>
    request<{
      width: number;
      height: number;
      backgroundUrl: string | null;
      nodes: { id: string; entityId: string; label: string; x: number; y: number }[];
    }>("/api/floorplan"),

  saveFloorplan: (layout: {
    width: number;
    height: number;
    backgroundUrl: string | null;
    nodes: { id: string; entityId: string; label: string; x: number; y: number }[];
  }) =>
    request<{ ok: boolean }>("/api/floorplan", {
      method: "PUT",
      body: JSON.stringify(layout),
    }),

  // Zones
  getZones: () => request<Zone[]>("/api/zones"),
  createZone: (zone: Omit<Zone, "id">) =>
    request<Zone>("/api/zones", { method: "POST", body: JSON.stringify(zone) }),
  updateZone: (id: string, zone: Zone) =>
    request<Zone>(`/api/zones/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(zone),
    }),
  deleteZone: (id: string) =>
    request<{ ok: boolean }>(`/api/zones/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  getZoneActivity: () => request<ZoneEvent[]>("/api/zones/activity"),

  // Nodes
  getNodes: () => request<SensorNode[]>("/api/nodes"),
  createNode: (node: Partial<SensorNode>) =>
    request<SensorNode>("/api/nodes", {
      method: "POST",
      body: JSON.stringify(node),
    }),
  updateNode: (id: string, data: Partial<SensorNode>) =>
    request<SensorNode>(`/api/nodes/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteNode: (id: string) =>
    request<{ ok: boolean }>(`/api/nodes/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  provisionNode: (id: string) =>
    request<{ ok: boolean; nodeId: string }>(
      `/api/nodes/${encodeURIComponent(id)}/provision`,
      { method: "POST" },
    ),

  // Settings
  getSettings: () =>
    request<{ mqttUrl: string; mqttUsername: string; mqttPasswordSet: boolean }>(
      "/api/settings",
    ),
  updateSettings: (settings: {
    mqttUrl?: string;
    mqttUsername?: string;
    mqttPassword?: string;
  }) =>
    request<{ mqttUrl: string; mqttUsername: string; mqttPasswordSet: boolean }>(
      "/api/settings",
      { method: "PUT", body: JSON.stringify(settings) },
    ),

  // Gestures
  getGestures: () => request<GestureBinding[]>("/api/gestures"),
  createGesture: (binding: Omit<GestureBinding, "id">) =>
    request<GestureBinding>("/api/gestures", { method: "POST", body: JSON.stringify(binding) }),
  updateGesture: (id: string, binding: GestureBinding) =>
    request<GestureBinding>(`/api/gestures/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(binding),
    }),
  deleteGesture: (id: string) =>
    request<{ ok: boolean }>(`/api/gestures/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  getGestureActivity: () => request<GestureEvent[]>("/api/gestures/activity"),
  submitGestureFeedback: (bindingId: string, correct: boolean) =>
    request<{ ok: boolean; stats: { correct: number; incorrect: number } }>("/api/gestures/feedback", {
      method: "POST",
      body: JSON.stringify({ bindingId, correct }),
    }),

  // Cameras
  getCameras: () => request<CameraConfig[]>("/api/cameras"),
  createCamera: (camera: { name: string; url: string; snapshotUrl?: string; username?: string; password?: string; groupId?: string | null }) =>
    request<CameraConfig>("/api/cameras", { method: "POST", body: JSON.stringify(camera) }),
  updateCamera: (id: string, data: Partial<CameraConfig>) =>
    request<CameraConfig>(`/api/cameras/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteCamera: (id: string) =>
    request<{ ok: boolean }>(`/api/cameras/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  calibrateCamera: (id: string, palmFeatures: number[][], fistFeatures: number[][]) =>
    request<{ ok: boolean; calibration: CameraCalibration }>(`/api/cameras/${encodeURIComponent(id)}/calibrate`, {
      method: "POST",
      body: JSON.stringify({ palmFeatures, fistFeatures }),
    }),
  triggerCameraGesture: (id: string, gesture: CameraGestureType) =>
    request<{ triggered: boolean; gesture: string; bindingsMatched?: number }>(`/api/cameras/${encodeURIComponent(id)}/trigger`, {
      method: "POST",
      body: JSON.stringify({ gesture }),
    }),
  getCameraStreamUrl: (id: string) => `${BASE}/api/cameras/${encodeURIComponent(id)}/stream`,
  getCameraSnapshotUrl: (id: string) => `${BASE}/api/cameras/${encodeURIComponent(id)}/snapshot`,

  // Camera Groups
  getCameraGroups: () => request<CameraGroup[]>("/api/camera-groups"),
  createCameraGroup: (group: { name: string; gestures?: CameraGestureBinding[] }) =>
    request<CameraGroup>("/api/camera-groups", { method: "POST", body: JSON.stringify(group) }),
  updateCameraGroup: (id: string, data: Partial<CameraGroup>) =>
    request<CameraGroup>(`/api/camera-groups/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteCameraGroup: (id: string) =>
    request<{ ok: boolean }>(`/api/camera-groups/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  discoverCameras: (subnet?: string) =>
    request<{ found: DiscoveredCamera[]; subnets: string[] }>(
      `/api/cameras/discover${subnet ? `?subnet=${encodeURIComponent(subnet)}` : ""}`,
    ),
};

export { BASE };

// Types used by the API
interface ActionStep {
  id: string;
  entityId: string;
  service: string;
  data?: Record<string, unknown>;
  delay: number;
}

interface Zone {
  id: string;
  name: string;
  color: string;
  points: { x: number; y: number }[];
  enabled: boolean;
  dwellTime: number;
  exitDelay: number;
  onEnter: ActionStep[];
  onExit: ActionStep[];
  auxiliarySensors: string[];
  state?: { occupied: boolean; targetCount: number };
}

interface ZoneEvent {
  id: string;
  zoneId: string;
  zoneName: string;
  type: "enter" | "exit";
  timestamp: string;
  targetCount: number;
}

interface SensorNode {
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
  stats?: { correct: number; incorrect: number };
}

interface GestureEvent {
  id: string;
  bindingId: string;
  gesture: GestureType;
  timestamp: string;
  targetId: number;
  confidence: number;
  actionNames?: string[];
}

export type CameraGestureType = "palm" | "fist" | "point" | "thumbs_up";

export interface CameraGestureDef {
  label: string;
  description: string;
  emoji: string;
}

export const CAMERA_GESTURE_DEFS: Record<CameraGestureType, CameraGestureDef> = {
  palm:      { label: "Open Palm",  description: "Hold hand open, all fingers spread wide",    emoji: "✋" },
  fist:      { label: "Fist",       description: "Close all fingers tightly into a fist",       emoji: "✊" },
  point:     { label: "Point",      description: "Index finger up, all other fingers curled",   emoji: "☝️" },
  thumbs_up: { label: "Thumbs Up",  description: "Thumb raised, all other fingers curled",     emoji: "👍" },
};

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

export interface CameraGestureBinding {
  id: string;
  gesture: CameraGestureType;
  name: string;
  holdTime: number;
  cooldown: number;
  actions: GestureAction[];
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
  passwordSet: boolean;
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
