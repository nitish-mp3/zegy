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

const LERP_FACTOR = 0.25;
const TARGET_TIMEOUT_MS = 8000;
const FADE_MS = 2000;
const MAX_JUMP_M = 4.0;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function useTrackingEngine() {
  const mapRef = useRef(new Map<string, TrackedTarget>());
  const [targets, setTargets] = useState<SmoothedTarget[]>([]);
  const rafRef = useRef(0);
  const activeRef = useRef(false);

  const ingestFrame = useCallback((nodeId: string, rawTargets: RawTarget[]) => {
    const now = Date.now();
    const map = mapRef.current;

    // Mark all targets from this node as "not updated yet"
    const updatedKeys = new Set<string>();

    for (const t of rawTargets) {
      const key = `${nodeId}:${t.id}`;
      updatedKeys.add(key);
      const existing = map.get(key);

      if (existing) {
        const dx = t.x - existing.rawX;
        const dy = t.y - existing.rawY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > MAX_JUMP_M) {
          existing.x = t.x;
          existing.y = t.y;
        }
        existing.rawX = t.x;
        existing.rawY = t.y;
        existing.speed = t.speed;
        existing.lastSeen = now;
        existing.opacity = 1;
      } else {
        map.set(key, {
          id: t.id,
          nodeId,
          rawX: t.x,
          rawY: t.y,
          x: t.x,
          y: t.y,
          speed: t.speed,
          lastSeen: now,
          opacity: 1,
        });
      }
    }

    if (!activeRef.current && map.size > 0) {
      activeRef.current = true;
    }
  }, []);

  useEffect(() => {
    let lastTime = performance.now();

    function tick(time: number) {
      const dt = Math.min(time - lastTime, 100);
      lastTime = time;
      const now = Date.now();
      const map = mapRef.current;

      if (map.size === 0) {
        activeRef.current = false;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const t = 1 - Math.pow(1 - LERP_FACTOR, dt / 16.67);

      for (const [key, target] of map) {
        const age = now - target.lastSeen;

        if (age > TARGET_TIMEOUT_MS) {
          const fadeProgress = Math.min((age - TARGET_TIMEOUT_MS) / FADE_MS, 1);
          target.opacity = 1 - fadeProgress;
          if (fadeProgress >= 1) {
            map.delete(key);
            continue;
          }
        }

        target.x = lerp(target.x, target.rawX, t);
        target.y = lerp(target.y, target.rawY, t);
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
        });
      }
      setTargets(output);

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const clearTargets = useCallback(() => {
    mapRef.current.clear();
    setTargets([]);
  }, []);

  return { targets, ingestFrame, clearTargets };
}
