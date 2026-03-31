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
  lastActivity: number;
  baseX: number | null;
  baseY: number | null;
  baseUpdated: number;
  inZone: boolean;
  zoneId: string | null;
}

interface TrajectoryFeatures {
  netDx: number;
  netDy: number;
  netDist: number;
  pathLen: number;
  linearity: number;
  swDx: number;
  swDy: number;
  axisRatio: number;
  dominantAxis: "x" | "y";
  axisSign: number;
  consistency: number;
  peakSpeed: number;
  avgSpeed: number;
  medianSpeed: number;
  peakSpeedPos: number;
  tailAvgSpeed: number;
  speedRange: number;
  spreadX: number;
  spreadY: number;
  duration: number;
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

const WINDOW_MS             = 1200;
const MIN_SAMPLES           = 6;
const MIN_DURATION_MS       = 200;
const MAX_SAMPLES           = 80;
const DEBUG_INTERVAL_MS     = 150;
const STALE_HISTORY_MS      = 5000;
const NOISE_STEP_M          = 0.025;
const GHOST_POS_M           = 0.04;
const GHOST_SPD_MS          = 0.04;

const SPEED_SPAN            = 3;
const MIN_BASE_DISP         = 0.12;

const IDLE_SPREAD_M         = 0.05;
const MIN_MEDIAN_SPEED      = 0.14;
const MIN_SPEED_RANGE       = 0.20;

const BASE_DISP_M           = 0.14;
const BASE_PATH_M           = 0.12;
const MIN_LINEARITY         = 0.45;
const MIN_AXIS_RATIO        = 1.4;
const MIN_CONSISTENCY       = 0.50;
const BASE_PEAK_SPD         = 0.38;
const MIN_PEAK_MEAN_RATIO   = 1.25;
const PUSH_PEAK_SPD         = 0.75;
const SETTLING_RATIO        = 0.85;
const MIN_CONFIDENCE        = 0.35;

const WAVE_MIN_SAMPLES      = 8;
const WAVE_MIN_CYCLES       = 2;
const WAVE_AMPLITUDE_M      = 0.08;
const WAVE_MAX_Y_RATIO      = 0.50;
const WAVE_AMP_CV_MAX       = 0.55;
const WAVE_PERIOD_CV_MAX    = 0.60;

const BASE_SPEED_THRESH     = 0.12;
const BASE_FRESH_MS         = 2000;
const BASE_SPREAD_M         = 0.10;
const MAX_DISP_M            = 0.90;
const PRE_PHASE_FRAC        = 0.20;
const PRE_DISP_MAX          = 0.12;

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

function getHistory(key: string, now: number): TargetHistory {
  let h = targetHistories.get(key);
  if (!h) {
    h = { samples: [], lastGestureTime: new Map(), lastActivity: now, baseX: null, baseY: null, baseUpdated: 0, inZone: false, zoneId: null };
    targetHistories.set(key, h);
  }
  return h;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function extractFeatures(samples: MotionSample[]): TrajectoryFeatures | null {
  if (samples.length < 3) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const duration = last.time - first.time;
  if (duration < 1) return null;

  const netDx = last.x - first.x;
  const netDy = last.y - first.y;
  const netDist = Math.sqrt(netDx * netDx + netDy * netDy);

  let pathLen = 0;
  let peakSpeed = 0;
  let peakIdx = 0;
  let minSpeed = Infinity;
  let totalSpeed = 0;
  let swDx = 0;
  let swDy = 0;
  const allPosSpeeds: number[] = [];

  for (let i = 1; i < samples.length; i++) {
    const sdx = samples[i].x - samples[i - 1].x;
    const sdy = samples[i].y - samples[i - 1].y;
    const frameDist = Math.sqrt(sdx * sdx + sdy * sdy);
    pathLen += frameDist;

    const j = Math.max(0, i - SPEED_SPAN);
    const spanDist = Math.hypot(samples[i].x - samples[j].x, samples[i].y - samples[j].y);
    const dtSec = Math.max((samples[i].time - samples[j].time) / 1000, 0.05);
    const posSpd = spanDist / dtSec;

    totalSpeed += posSpd;
    allPosSpeeds.push(posSpd);
    if (posSpd > peakSpeed) { peakSpeed = posSpd; peakIdx = i; }
    if (posSpd < minSpeed) minSpeed = posSpd;
    swDx += sdx * posSpd;
    swDy += sdy * posSpd;
  }

  const n = samples.length - 1;
  const avgSpeed = totalSpeed / n;
  const linearity = pathLen > 0.001 ? clamp(netDist / pathLen, 0, 1) : 0;
  const peakSpeedPos = n > 0 ? peakIdx / n : 0;
  const speedRange = peakSpeed - (isFinite(minSpeed) ? minSpeed : 0);

  let sumPosX = 0, sumPosY = 0;
  for (const s of samples) { sumPosX += s.x; sumPosY += s.y; }
  const meanPosX = sumPosX / samples.length;
  const meanPosY = sumPosY / samples.length;
  let varPosX = 0, varPosY = 0;
  for (const s of samples) {
    varPosX += (s.x - meanPosX) ** 2;
    varPosY += (s.y - meanPosY) ** 2;
  }
  const spreadX = Math.sqrt(varPosX / samples.length);
  const spreadY = Math.sqrt(varPosY / samples.length);

  const sortedSpeeds = [...allPosSpeeds].sort((a, b) => a - b);
  const mid = Math.floor(sortedSpeeds.length / 2);
  const medianSpeed = sortedSpeeds.length % 2 !== 0
    ? sortedSpeeds[mid]
    : (sortedSpeeds[mid - 1] + sortedSpeeds[mid]) / 2;

  const tailCount = Math.max(2, Math.round(allPosSpeeds.length * 0.22));
  let tailTotal = 0;
  for (let i = allPosSpeeds.length - tailCount; i < allPosSpeeds.length; i++) tailTotal += allPosSpeeds[i];
  const tailAvgSpeed = tailTotal / tailCount;

  const absSwDx = Math.abs(swDx);
  const absSwDy = Math.abs(swDy);
  const dominantAxis: "x" | "y" = absSwDx >= absSwDy ? "x" : "y";
  const axisRatio = absSwDx >= absSwDy
    ? absSwDx / Math.max(absSwDy, 0.0001)
    : absSwDy / Math.max(absSwDx, 0.0001);
  const axisSign = dominantAxis === "x" ? Math.sign(swDx) : Math.sign(swDy);

  let consistent = 0;
  let counted = 0;
  for (let i = 1; i < samples.length; i++) {
    const delta = dominantAxis === "x"
      ? samples[i].x - samples[i - 1].x
      : samples[i].y - samples[i - 1].y;
    if (Math.abs(delta) < NOISE_STEP_M) continue;
    counted++;
    if (Math.sign(delta) === axisSign) consistent++;
  }
  const consistency = counted >= 3 ? consistent / counted : 0;

  return {
    netDx, netDy, netDist, pathLen, linearity,
    swDx, swDy, axisRatio, dominantAxis, axisSign, consistency,
    peakSpeed, avgSpeed, medianSpeed, peakSpeedPos, tailAvgSpeed,
    speedRange, spreadX, spreadY, duration,
  };
}

function detectWave(
  samples: MotionSample[],
  sens: number,
  history: TargetHistory,
): { type: GestureType; confidence: number } | null {
  if (samples.length < WAVE_MIN_SAMPLES) return null;
  if (history.baseX === null || (Date.now() - history.baseUpdated) > BASE_FRESH_MS) return null;

  const wPreCount = Math.max(3, Math.round(samples.length * PRE_PHASE_FRAC));
  const wPreNetDx = samples[wPreCount - 1].x - samples[0].x;
  const wPreNetDy = samples[wPreCount - 1].y - samples[0].y;
  if (Math.sqrt(wPreNetDx * wPreNetDx + wPreNetDy * wPreNetDy) > PRE_DISP_MAX) return null;

  const minAmp = WAVE_AMPLITUDE_M / Math.max(0.2, sens);

  const amplitudes: number[] = [];
  const periods: number[] = [];
  let lastTurnX = samples[0].x;
  let lastTurnTime = samples[0].time;
  let lastDir = 0;
  let totalXMove = 0;
  let totalYMove = 0;

  for (let i = 1; i < samples.length; i++) {
    const dx = samples[i].x - samples[i - 1].x;
    const dy = samples[i].y - samples[i - 1].y;
    totalXMove += Math.abs(dx);
    totalYMove += Math.abs(dy);
    const dir = dx > NOISE_STEP_M ? 1 : dx < -NOISE_STEP_M ? -1 : 0;
    if (dir !== 0 && dir !== lastDir) {
      const amp = Math.abs(samples[i].x - lastTurnX);
      const period = samples[i].time - lastTurnTime;
      if (amp >= minAmp) {
        amplitudes.push(amp);
        periods.push(period);
        lastTurnX = samples[i].x;
        lastTurnTime = samples[i].time;
      }
      lastDir = dir;
    }
  }

  if (totalXMove > 0 && totalYMove / totalXMove > WAVE_MAX_Y_RATIO) return null;

  const fullCycles = Math.floor(amplitudes.length / 2);
  if (fullCycles < WAVE_MIN_CYCLES) return null;

  const ampMean = amplitudes.reduce((s, v) => s + v, 0) / amplitudes.length;
  const ampStd = Math.sqrt(amplitudes.reduce((s, v) => s + (v - ampMean) ** 2, 0) / amplitudes.length);
  const ampCv = ampStd / Math.max(ampMean, 0.0001);
  if (ampCv > WAVE_AMP_CV_MAX) return null;

  if (periods.length >= 3) {
    const perMean = periods.reduce((s, v) => s + v, 0) / periods.length;
    const perStd = Math.sqrt(periods.reduce((s, v) => s + (v - perMean) ** 2, 0) / periods.length);
    if (perStd / Math.max(perMean, 1) > WAVE_PERIOD_CV_MAX) return null;
  }

  const cycleScore = clamp((fullCycles - 1) / 3.5, 0, 1);
  const ampScore = clamp(ampMean / (minAmp * 2.5), 0, 1);
  const consistScore = clamp(1 - ampCv / WAVE_AMP_CV_MAX, 0, 1);
  const confidence = clamp(0.45 * cycleScore + 0.30 * ampScore + 0.25 * consistScore, 0, 1);
  if (confidence < 0.30) return null;

  return { type: "wave", confidence };
}

function detectDirectional(
  samples: MotionSample[],
  sens: number,
  history: TargetHistory,
): { type: GestureType; confidence: number } | null {
  if (samples.length < MIN_SAMPLES) return null;

  if (history.baseX === null || (Date.now() - history.baseUpdated) > BASE_FRESH_MS) return null;

  let maxBaseDist = 0;
  for (const s of samples) {
    const bd = Math.hypot(s.x - history.baseX, s.y - history.baseY!);
    if (bd > maxBaseDist) maxBaseDist = bd;
  }
  if (maxBaseDist < MIN_BASE_DISP) return null;

  const preCount = Math.max(3, Math.round(samples.length * PRE_PHASE_FRAC));
  const preNetDx = samples[preCount - 1].x - samples[0].x;
  const preNetDy = samples[preCount - 1].y - samples[0].y;
  if (Math.sqrt(preNetDx * preNetDx + preNetDy * preNetDy) > PRE_DISP_MAX) return null;

  const s = Math.max(0.2, sens);
  const m = extractFeatures(samples);
  if (!m) return null;

  if (m.duration < MIN_DURATION_MS) return null;

  const minDisp  = BASE_DISP_M / s;
  const minPath  = BASE_PATH_M / s;
  const minPeak  = BASE_PEAK_SPD / Math.sqrt(s);

  if (m.netDist < minDisp)                                        return null;
  if (m.netDist > MAX_DISP_M)                                     return null;
  if (m.pathLen < minPath)                                        return null;
  if (m.linearity < MIN_LINEARITY)                                return null;
  if (m.axisRatio < MIN_AXIS_RATIO)                               return null;
  if (m.consistency < MIN_CONSISTENCY)                            return null;
  if (m.peakSpeed < minPeak)                                      return null;
  if (m.peakSpeedPos < 0.08 || m.peakSpeedPos > 0.93)            return null;
  if (m.avgSpeed > 0 && m.peakSpeed < m.avgSpeed * MIN_PEAK_MEAN_RATIO) return null;
  if (m.duration > 500 && m.tailAvgSpeed > m.peakSpeed * SETTLING_RATIO) return null;

  const spreadDom = m.dominantAxis === "x" ? m.spreadX : m.spreadY;
  if (spreadDom < IDLE_SPREAD_M)                                      return null;
  if (m.medianSpeed < MIN_MEDIAN_SPEED)                               return null;
  if (m.speedRange < MIN_SPEED_RANGE)                                 return null;

  const dispScore   = clamp((m.netDist  - minDisp) / (minDisp * 2.0),         0, 1);
  const linScore    = clamp((m.linearity - MIN_LINEARITY) / (1 - MIN_LINEARITY), 0, 1);
  const conScore    = clamp((m.consistency - MIN_CONSISTENCY) / (1 - MIN_CONSISTENCY), 0, 1);
  const axScore     = clamp((m.axisRatio - MIN_AXIS_RATIO) / (MIN_AXIS_RATIO * 2.0), 0, 1);
  const spdScore    = clamp((m.peakSpeed  - minPeak)  / (minPeak * 3.0),       0, 1);
  const peakScore   = clamp((m.peakSpeed / Math.max(m.avgSpeed, 0.001) - MIN_PEAK_MEAN_RATIO) / 1.5, 0, 1);

  const rawConf = 0.22 * dispScore + 0.22 * linScore + 0.20 * conScore + 0.14 * axScore + 0.12 * spdScore + 0.10 * peakScore;
  const confidence = clamp(Math.pow(rawConf, 0.75), 0, 1);
  if (confidence < MIN_CONFIDENCE) return null;

  if (m.dominantAxis === "x") {
    return { type: m.axisSign > 0 ? "swipe_right" : "swipe_left", confidence };
  }

  const fastThresh = PUSH_PEAK_SPD / Math.sqrt(s);
  if (m.peakSpeed >= fastThresh) {
    return { type: m.axisSign > 0 ? "pull" : "push", confidence };
  }
  return { type: m.axisSign > 0 ? "swipe_down" : "swipe_up", confidence };
}

function detectGesture(
  history: TargetHistory,
  sensitivity: number,
): { type: GestureType; confidence: number } | null {
  const wave = detectWave(history.samples, sensitivity, history);
  if (wave) return wave;
  return detectDirectional(history.samples, sensitivity, history);
}

function computeGestureScores(
  history: TargetHistory,
  sensitivity: number,
): Partial<Record<GestureType, number>> {
  const samples = history.samples;
  if (samples.length < 3) return {};
  const scores: Partial<Record<GestureType, number>> = {};

  const wave = detectWave(samples, sensitivity, history);
  if (wave) scores.wave = wave.confidence;

  const dir = detectDirectional(samples, sensitivity, history);
  if (dir) { scores[dir.type] = dir.confidence; return scores; }

  const m = extractFeatures(samples);
  if (m && m.netDist > 0.04 && m.pathLen > 0.02) {
    const s = Math.max(0.2, sensitivity);
    const minDisp = BASE_DISP_M / s;
    const minPeak = BASE_PEAK_SPD / Math.sqrt(s);
    const partial = clamp(
      (m.netDist / minDisp) * 0.25 +
      m.linearity * 0.25 +
      m.consistency * 0.25 +
      clamp(m.peakSpeed / Math.max(minPeak * 2, 0.01), 0, 1) * 0.25,
      0, 0.70,
    );
    if (partial > 0.08 && !scores.wave) {
      if (m.dominantAxis === "x") {
        scores[m.axisSign > 0 ? "swipe_right" : "swipe_left"] = partial;
      } else {
        const fastThresh = PUSH_PEAK_SPD / Math.sqrt(s);
        if (m.peakSpeed >= fastThresh) {
          scores[m.axisSign > 0 ? "pull" : "push"] = partial;
        } else {
          scores[m.axisSign > 0 ? "swipe_down" : "swipe_up"] = partial;
        }
      }
    }
  }

  return scores;
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
    if (Math.abs(target.x) < GHOST_POS_M && Math.abs(target.y) < GHOST_POS_M && target.speed < GHOST_SPD_MS) continue;

    const key = `${frame.nodeId}:${target.id}`;
    const history = getHistory(key, now);
    history.lastActivity = now;

    let currentInZone = false;
    let currentZoneId: string | null = null;
    for (const zone of zones) {
      if (isInZone(target.x, target.y, zone.points)) {
        currentInZone = true;
        currentZoneId = zone.id;
        break;
      }
    }
    history.inZone = currentInZone;
    history.zoneId = currentZoneId;

    history.samples.push({ x: target.x, y: target.y, speed: target.speed, time: now });
    while (history.samples.length > MAX_SAMPLES) history.samples.shift();
    const cutoff = now - WINDOW_MS;
    while (history.samples.length > 0 && history.samples[0].time < cutoff) history.samples.shift();

    if (history.samples.length >= 3) {
      const tail = history.samples.slice(-3);
      const tailAvgSpd = tail.reduce((acc, v) => acc + v.speed, 0) / 3;
      const tailMx = tail.reduce((acc, v) => acc + v.x, 0) / 3;
      const tailMy = tail.reduce((acc, v) => acc + v.y, 0) / 3;
      let tailSpreadSq = 0;
      for (const s of tail) tailSpreadSq += (s.x - tailMx) ** 2 + (s.y - tailMy) ** 2;
      const tailSpread = Math.sqrt(tailSpreadSq / 3);
      if (tailAvgSpd < BASE_SPEED_THRESH && tailSpread < BASE_SPREAD_M) {
        const alpha = history.baseX === null ? 1.0 : 0.35;
        history.baseX = history.baseX === null ? tailMx : history.baseX + (tailMx - history.baseX) * alpha;
        history.baseY = history.baseY === null ? tailMy : history.baseY + (tailMy - history.baseY) * alpha;
        history.baseUpdated = now;
      }
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

      history.lastGestureTime.set(binding.id, now);
      history.samples = [];

      emitEvent({
        id: `ge-${++eventCounter}`,
        bindingId: binding.id,
        gesture: result.type,
        timestamp: new Date().toISOString(),
        targetId: target.id,
        confidence: result.confidence,
        actionNames: binding.actions.map((a) => `${a.entityId} → ${a.service}`),
      });

      if (binding.actions.length > 0) executeActions(binding.actions).catch(() => {});
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
        targetId, nodeId, dx, dy,
        dist: Math.hypot(dx, dy),
        scores: computeGestureScores(history, 1),
        inCooldown,
      });
    }
    for (const cb of debugListeners) cb(debugTargets);
    lastDebugEmit = now;
  }

  for (const [key, history] of targetHistories) {
    const age = now - history.lastActivity;
    const staleThreshold = history.inZone ? STALE_HISTORY_MS * 2 : STALE_HISTORY_MS;
    if (age > staleThreshold) {
      targetHistories.delete(key);
    }
  }
}

export function resetGestureStates(): void {
  targetHistories.clear();
}
