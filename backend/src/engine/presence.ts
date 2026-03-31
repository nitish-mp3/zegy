import { onStateChanged } from "../ha/subscriber";
import { logger } from "../logger";

const entityStateCache = new Map<string, { state: string; lastChanged: number }>();

const ACTIVE_STATES = new Set([
  "on", "detected", "home", "open", "playing",
  "active", "motion", "occupied", "true",
]);

const HOLD_AFTER_INACTIVE_MS = 30_000;

let initialized = false;

export function initPresenceFusion(): void {
  if (initialized) return;
  initialized = true;

  onStateChanged((entityId, newState) => {
    entityStateCache.set(entityId, { state: newState, lastChanged: Date.now() });
  });

  logger.info("Presence fusion initialized");
}

export function isAuxiliaryActive(entityIds: string[]): boolean {
  if (entityIds.length === 0) return false;

  const now = Date.now();
  for (const eid of entityIds) {
    const cached = entityStateCache.get(eid);
    if (!cached) continue;

    if (ACTIVE_STATES.has(cached.state.toLowerCase())) return true;

    if (now - cached.lastChanged < HOLD_AFTER_INACTIVE_MS) return true;
  }

  return false;
}

export function getAuxiliaryStates(entityIds: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const eid of entityIds) {
    const cached = entityStateCache.get(eid);
    result[eid] = cached?.state ?? "unknown";
  }
  return result;
}
