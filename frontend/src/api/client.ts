function detectBase(): string {
  const m = window.location.pathname.match(/^\/api\/hassio_ingress\/[^/]+/);
  return m ? m[0] : "";
}

const BASE = detectBase();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
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
};

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
