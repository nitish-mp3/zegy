import type { Zone, TrackFrame, ZoneEvent, ZonePoint } from "../types";
import { callService } from "../ha/client";
import { logger } from "../logger";

type ZoneEventCallback = (event: ZoneEvent) => void;

interface ZoneState {
  occupied: boolean;
  targetCount: number;
  enterTime: number | null;
  lastSeen: number | null;
  dwellSatisfied: boolean;
  exitTimer: ReturnType<typeof setTimeout> | null;
}

const zoneStates = new Map<string, ZoneState>();
const eventListeners = new Set<ZoneEventCallback>();
const recentEvents: ZoneEvent[] = [];
const MAX_EVENTS = 200;

let eventCounter = 0;

export function onZoneEvent(cb: ZoneEventCallback): () => void {
  eventListeners.add(cb);
  return () => { eventListeners.delete(cb); };
}

export function getRecentEvents(): ZoneEvent[] {
  return recentEvents;
}

function getState(zoneId: string): ZoneState {
  let s = zoneStates.get(zoneId);
  if (!s) {
    s = {
      occupied: false,
      targetCount: 0,
      enterTime: null,
      lastSeen: null,
      dwellSatisfied: false,
      exitTimer: null,
    };
    zoneStates.set(zoneId, s);
  }
  return s;
}

/** Ray-casting point-in-polygon test */
function isPointInPolygon(px: number, py: number, polygon: ZonePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function emitEvent(event: ZoneEvent): void {
  recentEvents.unshift(event);
  if (recentEvents.length > MAX_EVENTS) recentEvents.pop();
  for (const cb of eventListeners) cb(event);
}

async function executeActions(
  actions: { entityId: string; service: string; data?: Record<string, unknown>; delay: number }[],
): Promise<void> {
  for (const action of actions) {
    if (action.delay > 0) {
      await new Promise<void>((r) => setTimeout(r, action.delay));
    }
    try {
      const domain = action.entityId.split(".")[0];
      await callService(domain, action.service, {
        entity_id: action.entityId,
        ...action.data,
      });
      logger.info({ entityId: action.entityId, service: action.service }, "Zone action executed");
    } catch (err) {
      logger.error({ err, entityId: action.entityId }, "Failed to execute zone action");
    }
  }
}

export function processTrackFrame(frame: TrackFrame, zones: Zone[]): void {
  const now = Date.now();

  for (const zone of zones) {
    if (!zone.enabled || zone.points.length < 3) continue;

    const targetsInZone = frame.targets.filter((t) =>
      isPointInPolygon(t.x, t.y, zone.points),
    );

    const state = getState(zone.id);
    const isOccupied = targetsInZone.length > 0;

    state.targetCount = targetsInZone.length;

    if (isOccupied) {
      state.lastSeen = now;

      // Cancel pending exit
      if (state.exitTimer) {
        clearTimeout(state.exitTimer);
        state.exitTimer = null;
      }

      // Start dwell timer tracking
      if (!state.enterTime) {
        state.enterTime = now;
      }

      // Check dwell time satisfaction
      if (!state.dwellSatisfied && (now - state.enterTime >= zone.dwellTime)) {
        state.dwellSatisfied = true;
        state.occupied = true;

        const event: ZoneEvent = {
          id: `ze-${++eventCounter}`,
          zoneId: zone.id,
          zoneName: zone.name,
          type: "enter",
          timestamp: new Date().toISOString(),
          targetCount: targetsInZone.length,
        };
        emitEvent(event);

        if (zone.onEnter.length > 0) {
          executeActions(zone.onEnter).catch(() => {});
        }
      }
    } else {
      // No targets in zone
      if (state.occupied && !state.exitTimer) {
        state.exitTimer = setTimeout(() => {
          state.occupied = false;
          state.dwellSatisfied = false;
          state.enterTime = null;
          state.exitTimer = null;

          const event: ZoneEvent = {
            id: `ze-${++eventCounter}`,
            zoneId: zone.id,
            zoneName: zone.name,
            type: "exit",
            timestamp: new Date().toISOString(),
            targetCount: 0,
          };
          emitEvent(event);

          if (zone.onExit.length > 0) {
            executeActions(zone.onExit).catch(() => {});
          }
        }, zone.exitDelay);
      }

      if (!state.occupied) {
        state.enterTime = null;
        state.dwellSatisfied = false;
      }
    }
  }
}

export function getZoneStates(): Map<string, { occupied: boolean; targetCount: number }> {
  const result = new Map<string, { occupied: boolean; targetCount: number }>();
  for (const [id, state] of zoneStates) {
    result.set(id, { occupied: state.occupied, targetCount: state.targetCount });
  }
  return result;
}

export function resetZoneStates(): void {
  for (const [, state] of zoneStates) {
    if (state.exitTimer) clearTimeout(state.exitTimer);
  }
  zoneStates.clear();
}
