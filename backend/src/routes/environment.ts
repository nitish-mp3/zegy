import type { FastifyInstance } from "fastify";
import {
  getCombinedPresenceSnapshot,
  getEnvironmentReadings,
  loadEnvironmentSettings,
  loadLuxAutomations,
  saveEnvironmentSettings,
  saveLuxAutomations,
} from "../engine";
import type { EnvironmentSettings, LuxAutomationRule } from "../types";

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeRule(input: Partial<LuxAutomationRule>, existing?: LuxAutomationRule): LuxAutomationRule {
  return {
    id: existing?.id ?? input.id ?? newId("la"),
    name: String(input.name ?? existing?.name ?? "Lux automation"),
    enabled: input.enabled ?? existing?.enabled ?? true,
    operator: input.operator ?? existing?.operator ?? "below",
    threshold: Number(input.threshold ?? existing?.threshold ?? 50),
    thresholdHigh: input.thresholdHigh === undefined ? existing?.thresholdHigh ?? null : input.thresholdHigh == null ? null : Number(input.thresholdHigh),
    requirePresence: input.requirePresence ?? existing?.requirePresence ?? true,
    cooldown: Number(input.cooldown ?? existing?.cooldown ?? 120000),
    actions: Array.isArray(input.actions) ? input.actions : existing?.actions ?? [],
    lastTriggeredAt: existing?.lastTriggeredAt ?? null,
  };
}

export async function environmentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/environment", async (_req, reply) => {
    return reply.send({
      settings: loadEnvironmentSettings(),
      luxAutomations: loadLuxAutomations(),
      readings: getEnvironmentReadings(),
      presence: getCombinedPresenceSnapshot(),
    });
  });

  app.put<{ Body: EnvironmentSettings }>("/api/environment/settings", async (req, reply) => {
    return reply.send(saveEnvironmentSettings(req.body));
  });

  app.get("/api/environment/lux-automations", async (_req, reply) => {
    return reply.send(loadLuxAutomations());
  });

  app.post<{ Body: Partial<LuxAutomationRule> }>("/api/environment/lux-automations", async (req, reply) => {
    const rules = loadLuxAutomations();
    const rule = normalizeRule(req.body);
    const saved = saveLuxAutomations([rule, ...rules]);
    return reply.send(saved[0]);
  });

  app.put<{ Params: { id: string }; Body: Partial<LuxAutomationRule> }>("/api/environment/lux-automations/:id", async (req, reply) => {
    const rules = loadLuxAutomations();
    const idx = rules.findIndex((rule) => rule.id === req.params.id);
    if (idx === -1) return reply.status(404).send({ error: "Lux automation not found" });
    rules[idx] = normalizeRule(req.body, rules[idx]);
    return reply.send(saveLuxAutomations(rules)[idx]);
  });

  app.delete<{ Params: { id: string } }>("/api/environment/lux-automations/:id", async (req, reply) => {
    saveLuxAutomations(loadLuxAutomations().filter((rule) => rule.id !== req.params.id));
    return reply.send({ ok: true });
  });
}
