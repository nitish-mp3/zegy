import type { FastifyInstance } from "fastify";
import { loadJson, saveJson } from "../store";
import { getNodeStatus, publishNodeConfig } from "../mqtt";
import type { SensorNode } from "../types";
import { logger } from "../logger";

const NODES_FILE = "nodes.json";

export function loadNodes(): SensorNode[] {
  return loadJson<SensorNode[]>(NODES_FILE, []);
}

function saveNodes(nodes: SensorNode[]): void {
  saveJson(NODES_FILE, nodes);
}

/** Auto-create a node entry when MQTT receives from an unknown sensor. */
export function autoCreateNodeEntry(mqttNodeId: string): SensorNode | null {
  const nodes = loadNodes();
  const topic = `zegy/${mqttNodeId}`;
  if (nodes.some((n) => n.mqttTopic === topic)) return nodes.find((n) => n.mqttTopic === topic)!;
  const node: SensorNode = {
    id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: mqttNodeId,
    mqttTopic: topic,
    x: 4,
    y: 3,
    rotation: 0,
    scale: 2,
    lastSeen: new Date().toISOString(),
    status: "online",
  };
  nodes.push(node);
  saveNodes(nodes);
  return node;
}

export async function nodeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/nodes", async (_req, reply) => {
    try {
      const nodes = loadNodes();
      const status = getNodeStatus();
      const result = nodes.map((n) => {
        const s = status.get(n.id);
        return {
          ...n,
          status: s?.status ?? n.status,
          lastSeen: s?.lastSeen ?? n.lastSeen,
        };
      });
      return reply.send(result);
    } catch (err) {
      logger.error({ err }, "Failed to load nodes");
      return reply.status(500).send({ error: "Failed to load nodes" });
    }
  });

  app.post("/api/nodes", async (req, reply) => {
    try {
      const b = req.body as Record<string, unknown>;
      if (typeof b.name !== "string" || !b.name.trim()) {
        return reply.status(400).send({ error: "Node name is required" });
      }

      const safeName = (b.name as string).trim();
      const topic = typeof b.mqttTopic === "string" ? b.mqttTopic : `zegy/${safeName.toLowerCase().replace(/\s+/g, "-")}`;

      const nodes = loadNodes();
      if (nodes.some((n) => n.mqttTopic === topic)) {
        return reply.status(409).send({ error: `A node with topic "${topic}" already exists` });
      }

      const node: SensorNode = {
        id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: safeName,
        mqttTopic: topic,
        x: typeof b.x === "number" ? b.x : 400,
        y: typeof b.y === "number" ? b.y : 300,
        rotation: typeof b.rotation === "number" ? b.rotation : 0,
        scale: typeof b.scale === "number" ? b.scale : 2,
        lastSeen: null,
        status: "unknown",
      };

      nodes.push(node);
      saveNodes(nodes);
      return reply.status(201).send(node);
    } catch (err) {
      logger.error({ err }, "Failed to create node");
      return reply.status(500).send({ error: "Failed to create node" });
    }
  });

  app.put<{ Params: { id: string } }>("/api/nodes/:id", async (req, reply) => {
    try {
      const { id } = req.params;
      const nodes = loadNodes();
      const idx = nodes.findIndex((n) => n.id === id);
      if (idx === -1) return reply.status(404).send({ error: "Node not found" });

      const b = req.body as Record<string, unknown>;
      const existing = nodes[idx];
      nodes[idx] = {
        ...existing,
        name: typeof b.name === "string" ? b.name.trim() : existing.name,
        x: typeof b.x === "number" ? b.x : existing.x,
        y: typeof b.y === "number" ? b.y : existing.y,
        rotation: typeof b.rotation === "number" ? b.rotation : existing.rotation,
        scale: typeof b.scale === "number" ? b.scale : existing.scale,
      };

      saveNodes(nodes);
      return reply.send(nodes[idx]);
    } catch (err) {
      logger.error({ err }, "Failed to update node");
      return reply.status(500).send({ error: "Failed to update node" });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/nodes/:id", async (req, reply) => {
    try {
      const { id } = req.params;
      const nodes = loadNodes();
      const filtered = nodes.filter((n) => n.id !== id);
      if (filtered.length === nodes.length) {
        return reply.status(404).send({ error: "Node not found" });
      }
      saveNodes(filtered);
      return reply.send({ ok: true });
    } catch (err) {
      logger.error({ err }, "Failed to delete node");
      return reply.status(500).send({ error: "Failed to delete node" });
    }
  });

  // Send a config packet to the device via MQTT so its Node ID / settings
  // can be updated OTA without re-flashing.
  app.post<{ Params: { id: string } }>("/api/nodes/:id/provision", async (req, reply) => {
    try {
      const { id } = req.params;
      const nodes = loadNodes();
      const node = nodes.find((n) => n.id === id);
      if (!node) return reply.status(404).send({ error: "Node not found" });

      // Derive the nodeId from the MQTT topic  (e.g. "zegy/radar-01/tracks" → "radar-01")
      const parts = node.mqttTopic.split("/");
      const mqttNodeId = parts.length >= 2 ? parts[1] : node.id;

      publishNodeConfig(mqttNodeId, { nodeId: mqttNodeId });

      logger.info({ nodeId: mqttNodeId }, "Provision packet sent");
      return reply.send({ ok: true, nodeId: mqttNodeId });
    } catch (err) {
      logger.error({ err }, "Failed to provision node");
      return reply.status(500).send({ error: "Failed to provision node" });
    }
  });
}
