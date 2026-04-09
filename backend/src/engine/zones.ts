import type { Zone, TrackFrame, ZoneEvent, ZonePoint } from "../types";
import { executeActions } from "../actions";
import { isAuxiliaryActive } from "./presence";
import { logger } from "../logger";

type ZoneEventCallback = (event: ZoneEvent) => void;

const STATIONARY_SPEED_THRESH = 0.10;
const STATIONARY_HOLD_MS = 15_000;

interface StationaryRecord {
  lastSeen: number;
  x: number;
  y: number;
}

interface ZoneState {
  occupied: boolean;
  targetCount: number;
  enterTime: number | null;
  lastSeen: number | null;
  dwellSatisfied: boolean;
  exitTimer: ReturnType<typeof setTimeout> | null;
  stationaryTargets: Map<number, StationaryRecord>;
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
      stationaryTargets: new Map(),
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

export function processTrackFrame(frame: TrackFrame, zones: Zone[]): void {
  const now = Date.now();

  for (const zone of zones) {
    if (!zone.enabled || zone.points.length < 3) continue;

    const targetsInZone = frame.targets.filter((t) =>
      isPointInPolygon(t.x, t.y, zone.points),
    );

    const state = getState(zone.id);

    for (const t of targetsInZone) {
      if (t.speed < STATIONARY_SPEED_THRESH) {
        state.stationaryTargets.set(t.id, { lastSeen: now, x: t.x, y: t.y });
      } else {
        state.stationaryTargets.delete(t.id);
      }
    }

    const activeTargetIds = new Set(targetsInZone.map((t) => t.id));
    for (const [tid, rec] of state.stationaryTargets) {
      if (!activeTargetIds.has(tid) && (now - rec.lastSeen) > STATIONARY_HOLD_MS) {
        state.stationaryTargets.delete(tid);
      }
    }

    const directCount = targetsInZone.length;
    const heldStationaryCount = [...state.stationaryTargets.entries()]
      .filter(([tid]) => !activeTargetIds.has(tid))
      .length;
    const effectiveCount = directCount + heldStationaryCount;
    const isOccupied = effectiveCount > 0;

    state.targetCount = effectiveCount;

    if (isOccupied) {
      state.lastSeen = now;

      if (state.exitTimer) {
        clearTimeout(state.exitTimer);
        state.exitTimer = null;
      }

      if (!state.enterTime) {
        state.enterTime = now;
      }

      if (!state.dwellSatisfied && (now - state.enterTime >= zone.dwellTime)) {
        state.dwellSatisfied = true;
        state.occupied = true;

        const event: ZoneEvent = {
          id: `ze-${++eventCounter}`,
          zoneId: zone.id,
          zoneName: zone.name,
          type: "enter",
          timestamp: new Date().toISOString(),
          targetCount: effectiveCount,
        };
        emitEvent(event);

        if (zone.onEnter.length > 0) {
          executeActions(zone.onEnter).catch(() => {});
        }
      }
    } else {
      const auxActive = zone.auxiliarySensors?.length
        ? isAuxiliaryActive(zone.auxiliarySensors)
        : false;

      if (state.occupied && !state.exitTimer && !auxActive) {
        state.exitTimer = setTimeout(() => {
          state.occupied = false;
          state.dwellSatisfied = false;
          state.enterTime = null;
          state.exitTimer = null;
          state.stationaryTargets.clear();

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

      if (auxActive && state.exitTimer) {
        clearTimeout(state.exitTimer);
        state.exitTimer = null;
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
