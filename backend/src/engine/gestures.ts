import type { TrackFrame, GestureBinding, GestureEvent, GestureType } from "../types";
import { callService } from "../ha/client";
import { logger } from "../logger";

type GestureEventCallback = (event: GestureEvent) => void;

interface MotionSample {
  x: number;
  y: number;
  speed: number;
  time: number;
}

interface TargetHistory {
  samples: MotionSample[];
  lastGestureTime: Map<string, number>;
}

interface DebugTarget {
  targetId: number;
  nodeId: string;
  dx: number;
  dy: number;
  dist: number;
  scores: Partial<Record<GestureType, number>>;
  inCooldown: string[];
}

type GestureDebugCallback = (targets: DebugTarget[]) => void;

const WINDOW_MS = 800;
const MIN_SAMPLES = 4;
const MAX_SAMPLES = 40;
const DEBUG_INTERVAL_MS = 150;

const targetHistories = new Map<string, TargetHistory>();
const eventListeners = new Set<GestureEventCallback>();
const debugListeners = new Set<GestureDebugCallback>();
const recentGestureEvents: GestureEvent[] = [];
const MAX_EVENTS = 200;
let eventCounter = 0;
let lastDebugEmit = 0;

export function onGestureEvent(cb: GestureEventCallback): () => void {
  eventListeners.add(cb);
  return () => { eventListeners.delete(cb); };
}

export function onGestureDebug(cb: GestureDebugCallback): () => void {
  debugListeners.add(cb);
  return () => { debugListeners.delete(cb); };
}

export function getRecentGestureEvents(): GestureEvent[] {
  return recentGestureEvents;
}

function emitEvent(event: GestureEvent): void {
  recentGestureEvents.unshift(event);
  if (recentGestureEvents.length > MAX_EVENTS) recentGestureEvents.pop();
  for (const cb of eventListeners) cb(event);
}

function getHistory(key: string): TargetHistory {
  let h = targetHistories.get(key);
  if (!h) {
    h = { samples: [], lastGestureTime: new Map() };
    targetHistories.set(key, h);
  }
  return h;
}

function computeGestureScores(
  history: TargetHistory,
  sensitivity: number,
): Partial<Record<GestureType, number>> {
  const samples = history.samples;
  if (samples.length < 2) return {};

  const first = samples[0];
  const last = samples[samples.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const threshold = 0.3 / Math.max(0.3, sensitivity);
  const scores: Partial<Record<GestureType, number>> = {};

  const osc = countOscillations(samples);
  if (osc > 0) scores.wave = Math.min(1, osc * 0.5);

  if (dist > 0.04) {
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const distScore = Math.min(1, dist / threshold);

    if (absX > absY * 0.5) {
      scores[dx > 0 ? "swipe_right" : "swipe_left"] = distScore * (absX / (absX + absY));
    }
    if (absY > absX * 0.5) {
      scores[dy > 0 ? "swipe_down" : "swipe_up"] = distScore * (absY / (absX + absY));
    }

    const avgSpeed = samples.reduce((s, p) => s + p.speed, 0) / samples.length;
    const speedScore = Math.min(1, avgSpeed / (0.3 / Math.max(0.3, sensitivity)));
    if (speedScore > 0.2) {
      const angle = Math.atan2(dy, dx);
      if (Math.abs(angle) < Math.PI / 4) scores.push = speedScore;
      else if (Math.abs(angle) > (3 * Math.PI) / 4) scores.pull = speedScore;
      else if (dy < 0) scores.approach = speedScore;
      else scores.retreat = speedScore;
    }
  }

  return scores;
}

function detectGesture(history: TargetHistory, sensitivity: number): { type: GestureType; confidence: number } | null {
  const samples = history.samples;
  if (samples.length < MIN_SAMPLES) return null;

  const first = samples[0];
  const last = samples[samples.length - 1];
  const duration = last.time - first.time;
  if (duration < 100 || duration > WINDOW_MS) return null;

  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  const threshold = 0.3 / Math.max(0.3, sensitivity);

  if (dist < threshold) {
    const oscillations = countOscillations(samples);
    if (oscillations >= 2) {
      const conf = Math.min(1, (oscillations - 1) * 0.4);
      return { type: "wave", confidence: conf };
    }
    return null;
  }

  const confidence = Math.min(1, dist / (threshold * 3));
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (absX > absY * 1.4) {
    return { type: dx > 0 ? "swipe_right" : "swipe_left", confidence };
  }
  if (absY > absX * 1.4) {
    return { type: dy > 0 ? "swipe_down" : "swipe_up", confidence };
  }

  const avgSpeed = samples.reduce((s, p) => s + p.speed, 0) / samples.length;
  if (avgSpeed > 0.3 / Math.max(0.3, sensitivity)) {
    const angle = Math.atan2(dy, dx);
    if (Math.abs(angle) < Math.PI / 4) return { type: "push", confidence };
    if (Math.abs(angle) > (3 * Math.PI) / 4) return { type: "pull", confidence };
    if (dy < 0) return { type: "approach", confidence };
    return { type: "retreat", confidence };
  }

  return null;
}

function countOscillations(samples: MotionSample[]): number {
  let changes = 0;
  let prevDir = 0;
  for (let i = 1; i < samples.length; i++) {
    const dx = samples[i].x - samples[i - 1].x;
    const dir = dx > 0.02 ? 1 : dx < -0.02 ? -1 : 0;
    if (dir !== 0 && dir !== prevDir) {
      changes++;
      prevDir = dir;
    }
  }
  return Math.floor(changes / 2);
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
      logger.info({ entityId: action.entityId, service: action.service }, "Gesture action executed");
    } catch (err) {
      logger.error({ err, entityId: action.entityId }, "Failed to execute gesture action");
    }
  }
}

function isInZone(
  x: number, y: number,
  zonePoints: { x: number; y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = zonePoints.length - 1; i < zonePoints.length; j = i++) {
    const xi = zonePoints[i].x, yi = zonePoints[i].y;
    const xj = zonePoints[j].x, yj = zonePoints[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function processGestureFrame(
  frame: TrackFrame,
  bindings: GestureBinding[],
  zones: { id: string; points: { x: number; y: number }[] }[],
): void {
  const now = Date.now();

  for (const target of frame.targets) {
    const key = `${frame.nodeId}:${target.id}`;
    const history = getHistory(key);

    history.samples.push({
      x: target.x,
      y: target.y,
      speed: target.speed,
      time: now,
    });

    while (history.samples.length > MAX_SAMPLES) history.samples.shift();
    const cutoff = now - WINDOW_MS;
    while (history.samples.length > 0 && history.samples[0].time < cutoff) {
      history.samples.shift();
    }

    for (const binding of bindings) {
      if (!binding.enabled) continue;

      const lastFired = history.lastGestureTime.get(binding.id) ?? 0;
      if (now - lastFired < binding.cooldown) continue;

      if (binding.zoneId) {
        const zone = zones.find((z) => z.id === binding.zoneId);
        if (zone && !isInZone(target.x, target.y, zone.points)) continue;
      }

      const result = detectGesture(history, binding.sensitivity);
      if (!result || result.type !== binding.gesture) continue;
      if (result.confidence < 0.3) continue;

      history.lastGestureTime.set(binding.id, now);
      history.samples.length = 0;

      const event: GestureEvent = {
        id: `ge-${++eventCounter}`,
        bindingId: binding.id,
        gesture: result.type,
        timestamp: new Date().toISOString(),
        targetId: target.id,
        confidence: result.confidence,
        actionNames: binding.actions.map((a) => `${a.entityId} → ${a.service}`),
      };

      emitEvent(event);

      if (binding.actions.length > 0) {
        executeActions(binding.actions).catch(() => {});
      }
    }
  }

  if (debugListeners.size > 0 && now - lastDebugEmit >= DEBUG_INTERVAL_MS) {
    const debugTargets: DebugTarget[] = [];
    for (const [key, history] of targetHistories) {
      if (history.samples.length < 2) continue;
      const lastSample = history.samples[history.samples.length - 1];
      if (now - lastSample.time > 2000) continue;
      const colonIdx = key.indexOf(":");
      const nodeId = key.slice(0, colonIdx);
      const targetId = parseInt(key.slice(colonIdx + 1));
      const firstSample = history.samples[0];
      const dx = lastSample.x - firstSample.x;
      const dy = lastSample.y - firstSample.y;
      const inCooldown: string[] = [];
      for (const b of bindings) {
        const lastFired = history.lastGestureTime.get(b.id) ?? 0;
        if (now - lastFired < b.cooldown) inCooldown.push(b.id);
      }
      debugTargets.push({
        targetId,
        nodeId,
        dx,
        dy,
        dist: Math.hypot(dx, dy),
        scores: computeGestureScores(history, 1),
        inCooldown,
      });
    }
    if (debugTargets.length > 0) {
      for (const cb of debugListeners) cb(debugTargets);
      lastDebugEmit = now;
    }
  }

  for (const [key, history] of targetHistories) {
    if (history.samples.length > 0 && now - history.samples[history.samples.length - 1].time > 3000) {
      targetHistories.delete(key);
    }
  }
}

export function resetGestureStates(): void {
  targetHistories.clear();
}
