import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { FloorPlanLayout } from "../types";
import { logger } from "../logger";

const DATA_DIR = process.env.ZEGY_DATA_DIR ?? "/config/zegy";
const LAYOUT_FILE = path.join(DATA_DIR, "floorplan.json");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadLayout(): FloorPlanLayout {
  ensureDataDir();
  if (fs.existsSync(LAYOUT_FILE)) {
    const raw = fs.readFileSync(LAYOUT_FILE, "utf-8");
    return JSON.parse(raw) as FloorPlanLayout;
  }
  return { width: 800, height: 600, backgroundUrl: null, nodes: [] };
}

function saveLayout(layout: FloorPlanLayout): void {
  ensureDataDir();
  fs.writeFileSync(LAYOUT_FILE, JSON.stringify(layout, null, 2), "utf-8");
}

export async function floorplanRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/floorplan", async (_req, reply) => {
    try {
      return reply.send(loadLayout());
    } catch (err) {
      logger.error({ err }, "Failed to load floor plan");
      return reply.status(500).send({ error: "Failed to load floor plan" });
    }
  });

  app.put("/api/floorplan", async (req, reply) => {
    try {
      const body = req.body as FloorPlanLayout;

      if (
        typeof body.width !== "number" ||
        typeof body.height !== "number" ||
        !Array.isArray(body.nodes)
      ) {
        return reply.status(400).send({ error: "Invalid floor plan data" });
      }

      const sanitized: FloorPlanLayout = {
        width: Math.max(100, Math.min(body.width, 4000)),
        height: Math.max(100, Math.min(body.height, 4000)),
        backgroundUrl: typeof body.backgroundUrl === "string" ? body.backgroundUrl : null,
        nodes: body.nodes
          .filter(
            (n) =>
              typeof n.id === "string" &&
              typeof n.entityId === "string" &&
              typeof n.x === "number" &&
              typeof n.y === "number",
          )
          .map((n) => ({
            id: n.id,
            entityId: n.entityId,
            label: typeof n.label === "string" ? n.label : n.entityId,
            x: n.x,
            y: n.y,
          })),
      };

      saveLayout(sanitized);
      return reply.send({ ok: true });
    } catch (err) {
      logger.error({ err }, "Failed to save floor plan");
      return reply.status(500).send({ error: "Failed to save floor plan" });
    }
  });
}
