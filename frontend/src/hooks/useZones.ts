import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

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
  state?: { occupied: boolean; targetCount: number };
}

export function useZones() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getZones();
      setZones(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(async (zone: Omit<Zone, "id">) => {
    const created = await api.createZone(zone);
    setZones((prev) => [...prev, created]);
    return created;
  }, []);

  const update = useCallback(async (id: string, zone: Zone) => {
    const updated = await api.updateZone(id, zone);
    setZones((prev) => prev.map((z) => (z.id === id ? updated : z)));
    return updated;
  }, []);

  const remove = useCallback(async (id: string) => {
    await api.deleteZone(id);
    setZones((prev) => prev.filter((z) => z.id !== id));
  }, []);

  return { zones, loading, refresh, create, update, remove, setZones };
}
