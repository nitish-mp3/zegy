import type { FastifyInstance } from "fastify";
import { getAreaRegistry } from "../ha/client";
import { logger } from "../logger";

export async function areaRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/areas", async (_req, reply) => {
    try {
      const areas = await getAreaRegistry();
      return reply.send(areas);
    } catch (err) {
      logger.error({ err }, "Failed to fetch areas");
      return reply.status(502).send({ error: "Failed to reach Home Assistant" });
    }
  });
}
