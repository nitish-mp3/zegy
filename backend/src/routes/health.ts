import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => ({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }));
}
