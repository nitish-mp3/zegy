import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

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

export function useNodes() {
  const [nodes, setNodes] = useState<SensorNode[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getNodes();
      setNodes(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(async (node: Partial<SensorNode>) => {
    const created = await api.createNode(node);
    setNodes((prev) => [...prev, created]);
    return created;
  }, []);

  const update = useCallback(async (id: string, data: Partial<SensorNode>) => {
    const updated = await api.updateNode(id, data);
    setNodes((prev) => prev.map((n) => (n.id === id ? updated : n)));
    return updated;
  }, []);

  const remove = useCallback(async (id: string) => {
    await api.deleteNode(id);
    setNodes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return { nodes, loading, refresh, create, update, remove };
}
