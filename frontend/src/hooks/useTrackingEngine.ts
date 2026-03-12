import { useRef, useState, useCallback, useEffect } from "react";

export interface RawTarget {
  id: number;
  x: number;
  y: number;
  speed: number;
}

export interface SmoothedTarget {
  id: number;
  nodeId: string;
  x: number;
  y: number;
  speed: number;
  opacity: number;
  stale: boolean;
  lastSeen: number;
}

export interface StaticEcho {
  x: number;
  y: number;
  strength: number;
}

interface TrackedTarget {
  id: number;
  nodeId: string;
  rawX: number;
  rawY: number;
  x: number;
  y: number;
  speed: number;
  lastSeen: number;
  opacity: number;
}

interface EchoCell {
  x: number;
  y: number;
  strength: number;
  lastSeen: number;
}

const SMOOTH_ALPHA_MIN = 0.08;
const SMOOTH_ALPHA_MAX = 0.52;
const TARGET_TIMEOUT_MS = 15000;
const FADE_MS = 3000;
const MAX_JUMP_M = 1.25;
const MAX_REASSIGN_M = 1.0;
const STATIONARY_SPEED_MS = 0.06;
const STATIONARY_LOCK_M = 0.12;
const ECHO_GRID = 0.25;
const ECHO_SPEED_THRESHOLD = 0.04;
const ECHO_GAIN = 0.04;
const ECHO_DECAY_PER_FRAME = 0.0004;
const ECHO_MIN_STRENGTH = 0.05;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getAdaptiveAlpha(speed: number, dist: number): number {
  return clamp(0.18 + Math.min(speed, 1.5) * 0.16 + Math.min(dist, 1.2) * 0.12, SMOOTH_ALPHA_MIN, SMOOTH_ALPHA_MAX);
}

function echoKey(x: number, y: number): string {
  return `${Math.round(x / ECHO_GRID)},${Math.round(y / ECHO_GRID)}`;
}

export function useTrackingEngine() {
  const mapRef = useRef(new Map<string, TrackedTarget>());
  const echoMapRef = useRef(new Map<string, EchoCell>());
  const [targets, setTargets] = useState<SmoothedTarget[]>([]);
  const [staticEchoes, setStaticEchoes] = useState<StaticEcho[]>([]);
  const rafRef = useRef(0);
  const nextIdRef = useRef(0);

  const ingestFrame = useCallback((nodeId: string, rawTargets: RawTarget[]) => {
    const now = Date.now();
    const map = mapRef.current;
    const echoMap = echoMapRef.current;

    const existingForNode: Array<{ key: string; v: TrackedTarget }> = [];
    for (const [key, v] of map) {
      if (v.nodeId === nodeId) existingForNode.push({ key, v });
    }

    const taken = new Set<string>();

    for (const t of rawTargets) {
      let bestKey: string | null = null;
      let bestDist = MAX_REASSIGN_M;

      for (const { key, v } of existingForNode) {
        if (taken.has(key)) continue;
        const dx = t.x - v.rawX;
        const dy = t.y - v.rawY;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < bestDist) {
          bestDist = d;
          bestKey = key;
        }
      }

      if (bestKey) {
        taken.add(bestKey);
        const existing = map.get(bestKey)!;
        existing.rawX = t.x;
        existing.rawY = t.y;
        existing.speed = lerp(existing.speed, t.speed, t.speed > existing.speed ? 0.45 : 0.22);
        existing.lastSeen = now;
        if (existing.opacity < 1) existing.opacity = Math.min(1, existing.opacity + 0.15);
      } else {
        const key = `${nodeId}:uid-${nextIdRef.current++}`;
        map.set(key, {
          id: t.id,
          nodeId,
          rawX: t.x,
          rawY: t.y,
          x: t.x,
          y: t.y,
          speed: t.speed,
          lastSeen: now,
          opacity: 0.15,
        });
      }

      if (Math.abs(t.speed) <= ECHO_SPEED_THRESHOLD) {
        const k = echoKey(t.x, t.y);
        const cx = Math.round(t.x / ECHO_GRID) * ECHO_GRID;
        const cy = Math.round(t.y / ECHO_GRID) * ECHO_GRID;
        const cell = echoMap.get(k);
        if (cell) {
          cell.strength = Math.min(1.0, cell.strength + ECHO_GAIN);
          cell.lastSeen = now;
        } else {
          echoMap.set(k, { x: cx, y: cy, strength: ECHO_GAIN, lastSeen: now });
        }
      }
    }
  }, []);

  useEffect(() => {
    let lastTime = performance.now();
    let echoTick = 0;

    function tick(time: number) {
      const dt = Math.min(time - lastTime, 100);
      lastTime = time;
      const now = Date.now();
      const map = mapRef.current;
      const echoMap = echoMapRef.current;

      for (const [key, target] of map) {
        const age = now - target.lastSeen;

        if (age > TARGET_TIMEOUT_MS) {
          const fadeProgress = Math.min((age - TARGET_TIMEOUT_MS) / FADE_MS, 1);
          target.opacity = 1 - fadeProgress;
          if (fadeProgress >= 1) {
            map.delete(key);
            continue;
          }
        } else if (target.opacity < 1) {
          target.opacity = Math.min(1, target.opacity + dt / 250);
        }

        const dx = target.rawX - target.x;
        const dy = target.rawY - target.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > MAX_JUMP_M) {
          target.x = target.rawX;
          target.y = target.rawY;
        } else if (target.speed <= STATIONARY_SPEED_MS && dist < STATIONARY_LOCK_M) {
          if (dist < 0.025) {
            target.x = target.rawX;
            target.y = target.rawY;
          } else {
            const lockT = 1 - Math.pow(1 - 0.06, dt / 16.67);
            target.x = lerp(target.x, target.rawX, lockT);
            target.y = lerp(target.y, target.rawY, lockT);
          }
        } else {
          const moveT = 1 - Math.pow(1 - getAdaptiveAlpha(target.speed, dist), dt / 16.67);
          target.x = lerp(target.x, target.rawX, moveT);
          target.y = lerp(target.y, target.rawY, moveT);
        }
      }

      const output: SmoothedTarget[] = [];
      for (const v of map.values()) {
        output.push({
          id: v.id,
          nodeId: v.nodeId,
          x: v.x,
          y: v.y,
          speed: v.speed,
          opacity: v.opacity,
          stale: now - v.lastSeen > TARGET_TIMEOUT_MS,
          lastSeen: v.lastSeen,
        });
      }
      output.sort((a, b) => a.nodeId.localeCompare(b.nodeId) || a.id - b.id);
      setTargets(output);

      echoTick++;
      if (echoTick % 6 === 0) {
        const echoDecay = ECHO_DECAY_PER_FRAME * 6;
        const echoOutput: StaticEcho[] = [];
        for (const [k, cell] of echoMap) {
          cell.strength -= echoDecay;
          if (cell.strength < ECHO_MIN_STRENGTH) {
            echoMap.delete(k);
          } else {
            echoOutput.push({ x: cell.x, y: cell.y, strength: cell.strength });
          }
        }
        setStaticEchoes(echoOutput);
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const clearTargets = useCallback(() => {
    mapRef.current.clear();
    echoMapRef.current.clear();
    setTargets([]);
    setStaticEchoes([]);
  }, []);

  return { targets, staticEchoes, ingestFrame, clearTargets };
}

