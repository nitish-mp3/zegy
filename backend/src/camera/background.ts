import { setTimeout as sleep } from "node:timers/promises";
import { PassThrough, Readable } from "node:stream";
import * as path from "node:path";
import * as fs from "node:fs";
import * as http from "node:http";
import jpeg from "jpeg-js";
import type { CameraCalibration, CameraConfig, CameraGestureBinding, CameraGestureType } from "../types";
import { logger } from "../logger";
import { config } from "../config";
import { loadCameras, loadCameraGroups } from "./store";
import { triggerCameraGesture } from "./trigger";
import { subscribeSharedRtsp } from "./rtsp_shared";

function defineBrowserGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
}

defineBrowserGlobal("document", {
  createElement: () => ({ style: {}, appendChild: () => {}, removeChild: () => {} }),
  createDocumentFragment: () => ({ appendChild: () => {} }),
  addEventListener: () => {},
  removeEventListener: () => {},
  getElementById: () => null,
  body: { appendChild: () => {}, removeChild: () => {}, style: {} },
});
defineBrowserGlobal("window", globalThis);
defineBrowserGlobal("navigator", { userAgent: "node" });
defineBrowserGlobal("performance", globalThis.performance ?? { now: () => Date.now() });

const mediapipe = require("@mediapipe/tasks-vision");
const FilesetResolver = mediapipe.FilesetResolver;
const HandLandmarker = mediapipe.HandLandmarker;
type HandLandmarker = InstanceType<typeof mediapipe.HandLandmarker>;

const FINGER_TIPS = [4, 8, 12, 16, 20];
const FINGER_PIPS = [3, 6, 10, 14, 18];
const WRIST = 0;

let wasmHttpServer: http.Server | null = null;
let wasmBaseUrl: string | null = null;
let landmarkerInit: Promise<HandLandmarker> | null = null;

async function getWasmBaseUrl(): Promise<string> {
  if (wasmBaseUrl) return wasmBaseUrl;

  const mediapipeDir = path.join(process.cwd(), "node_modules", "@mediapipe", "tasks-vision");
  const wasmDir = path.join(mediapipeDir, "wasm");

  return new Promise<string>((resolve, reject) => {
    wasmHttpServer = http.createServer((req, res) => {
      const filePath = path.join(wasmDir, req.url?.replace(/^\//, "") || "");
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        res.writeHead(200, { "Content-Type": "application/wasm" });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    wasmHttpServer!.listen(0, () => {
      const addr = wasmHttpServer!.address() as { port: number };
      wasmBaseUrl = `http://127.0.0.1:${addr.port}/`;
      logger.info({ wasmBaseUrl }, "WASM HTTP server started");
      resolve(wasmBaseUrl);
    });
    wasmHttpServer!.on("error", reject);
  });
}

async function getLandmarker(): Promise<HandLandmarker> {
  if (landmarkerInit) return landmarkerInit;
  landmarkerInit = (async () => {
    const wasmUrl = await getWasmBaseUrl();
    const modelDir = path.join(process.cwd(), "node_modules", "@mediapipe", "tasks-vision");
    const modelPath = path.join(modelDir, "mediapipe", "hand_landmarker.task");

    let modelBuffer: Uint8Array;
    if (fs.existsSync(modelPath)) {
      modelBuffer = fs.readFileSync(modelPath);
    } else {
      const modelUrl = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";
      logger.info({ modelUrl }, "Downloading MediaPipe hand landmarker model");
      const res = await fetch(modelUrl);
      if (!res.ok) throw new Error(`Failed to download model: ${res.status}`);
      const arr = await res.arrayBuffer();
      modelBuffer = new Uint8Array(arr);
    }

    logger.info({ wasmUrl, modelPath: fs.existsSync(modelPath) ? modelPath : "cached" }, "Loading MediaPipe hand landmarker for background camera gestures");

    const vision = await FilesetResolver.forVisionTasks(wasmUrl);
    const landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetBuffer: modelBuffer, delegate: "CPU" },
      runningMode: "IMAGE",
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    logger.info("Background camera hand landmarker loaded");
    return landmarker;
  })();
  return landmarkerInit;
}

function distance3d(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function computeFingerExtensions(
  landmarks: { x: number; y: number; z: number }[],
): number[] {
  const wrist = landmarks[WRIST];
  return FINGER_TIPS.map((tipIdx, i) => {
    const tip = landmarks[tipIdx];
    const pip = landmarks[FINGER_PIPS[i]];
    const tipDist = distance3d(tip, wrist);
    const pipDist = distance3d(pip, wrist);
    return pipDist > 0 ? tipDist / pipDist : 0;
  });
}

function computeFeatureVector(
  landmarks: { x: number; y: number; z: number }[],
): number[] {
  const extensions = computeFingerExtensions(landmarks);
  const wrist = landmarks[WRIST];
  const palmCenter = landmarks[9];
  const handSize = distance3d(wrist, palmCenter);
  const avgTipDist =
    FINGER_TIPS.reduce((sum, idx) => sum + distance3d(landmarks[idx], palmCenter), 0) /
    FINGER_TIPS.length;
  const openness = handSize > 0 ? avgTipDist / handSize : 0;
  return [...extensions, openness];
}

function averageVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const len = vectors[0].length;
  const avg = new Array(len).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < len; i++) avg[i] += v[i];
  }
  return avg.map((s) => s / vectors.length);
}

function vectorDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

function classifyGesture(
  features: number[],
  calibration: CameraCalibration | null,
): { gesture: CameraGestureType | null; confidence: number } {
  const e = features;
  const thumb = e[0] ?? 0;
  const index = e[1] ?? 0;
  const middle = e[2] ?? 0;
  const ring = e[3] ?? 0;
  const pinky = e[4] ?? 0;
  const openness = e[5] ?? 0;

  const ext = (v: number) => v > 1.15;
  const curl = (v: number) => v < 1.08;

  if (ext(index) && curl(middle) && curl(ring) && curl(pinky)) {
    const conf = Math.min(0.93, 0.5 + (index - 1.15) * 0.75);
    if (conf > 0.45) return { gesture: "point", confidence: conf };
  }

  if (thumb > 1.22 && curl(index) && curl(middle) && curl(ring) && curl(pinky)) {
    const conf = Math.min(0.95, 0.5 + (thumb - 1.22) * 0.9);
    if (conf > 0.45) return { gesture: "thumbs_up", confidence: conf };
  }

  if (calibration && calibration.palmFeatures.length > 0 && calibration.fistFeatures.length > 0) {
    const palmCenter = averageVector(calibration.palmFeatures);
    const fistCenter = averageVector(calibration.fistFeatures);
    const palmDist = vectorDistance(features, palmCenter);
    const fistDist = vectorDistance(features, fistCenter);
    const total = palmDist + fistDist;
    if (total === 0) return { gesture: null, confidence: 0 };
    const conf = Math.max(palmDist, fistDist) / total;
    if (conf < 0.58) return { gesture: null, confidence: conf };
    return palmDist < fistDist ? { gesture: "palm", confidence: conf } : { gesture: "fist", confidence: conf };
  }

  if ([index, middle, ring, pinky].filter(ext).length >= 3 && openness > 1.15) {
    const extCount = [thumb, index, middle, ring, pinky].filter(ext).length;
    return { gesture: "palm", confidence: Math.min(0.97, 0.55 * (extCount / 5) + 0.42 * Math.min(openness / 2, 1)) };
  }

  if (curl(index) && curl(middle) && curl(ring) && curl(pinky) && openness < 1.0 && thumb < 1.22) {
    const curlCount = [index, middle, ring, pinky].filter(curl).length;
    return { gesture: "fist", confidence: Math.min(0.96, 0.55 * (curlCount / 4) + 0.41 * Math.min((1.5 - openness) / 1.5, 1)) };
  }

  return { gesture: null, confidence: 0 };
}

function hasEnabledCameraGestures(cam: CameraConfig): boolean {
  if (!cam.enabled) return false;
  if (cam.gestures.some((g) => g.enabled)) return true;
  if (!cam.groupId) return false;
  const group = loadCameraGroups().find((g) => g.id === cam.groupId);
  return !!group?.gestures?.some((g) => g.enabled);
}

function buildAuthHeaders(cam: CameraConfig): Record<string, string> {
  if (!cam.username) return {};
  return {
    Authorization: `Basic ${Buffer.from(`${cam.username}:${cam.password}`).toString("base64")}`,
  };
}

function getAllBindings(cam: CameraConfig): CameraGestureBinding[] {
  const bindings: CameraGestureBinding[] = [];
  for (const b of cam.gestures) if (b.enabled) bindings.push(b);
  if (cam.groupId) {
    const group = loadCameraGroups().find((g) => g.id === cam.groupId);
    if (group) for (const b of group.gestures) if (b.enabled) bindings.push(b);
  }
  return bindings;
}

type JpegFrameCallback = (jpegBytes: Buffer) => Promise<void> | void;

async function forEachJpegFrameFromStream(
  readable: NodeJS.ReadableStream,
  signal: AbortSignal,
  onFrame: JpegFrameCallback,
): Promise<void> {
  let buffer: Buffer = Buffer.alloc(0);

  const feed = async (chunk: Buffer) => {
    const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    buffer = buffer.length === 0 ? next : Buffer.concat([buffer, next]);
    for (;;) {
      const soi = buffer.indexOf(Buffer.from([0xff, 0xd8]));
      if (soi === -1) {
        if (buffer.length > 2_000_000) buffer = Buffer.alloc(0);
        return;
      }
      if (soi > 0) buffer = buffer.subarray(soi);
      const eoi = buffer.indexOf(Buffer.from([0xff, 0xd9]), 2);
      if (eoi === -1) return;
      const frame = buffer.subarray(0, eoi + 2);
      buffer = buffer.subarray(eoi + 2);
      await onFrame(frame);
      if (signal.aborted) return;
    }
  };

  for await (const chunk of readable) {
    if (signal.aborted) break;
    if (typeof chunk === "string") {
      await feed(Buffer.from(chunk));
    } else if (Buffer.isBuffer(chunk)) {
      await feed(chunk);
    } else {
      await feed(Buffer.from(chunk as Uint8Array));
    }
  }
}

async function openCameraFrameStream(
  cam: CameraConfig,
  signal: AbortSignal,
): Promise<{ stream: NodeJS.ReadableStream; close: () => void }> {
  if (/^ha:\/\//i.test(cam.url)) {
    const entityId = cam.url.slice("ha://".length);
    const haBase = config.isAddon ? "http://supervisor/core" : config.ha.supervisorUrl;
    const snapshotUrl = `${haBase}/api/camera_proxy/${encodeURIComponent(entityId)}`;

    const controller = new AbortController();
    const combinedSignal = AbortSignal.any([signal, controller.signal]);

    const out = new PassThrough();
    let closed = false;

    (async () => {
      while (!combinedSignal.aborted && !closed) {
        try {
          const snap = await fetch(snapshotUrl, {
            headers: { Authorization: `Bearer ${config.ha.supervisorToken}` },
            signal: AbortSignal.timeout(8000),
          });
          if (snap.ok) {
            const buf = Buffer.from(await snap.arrayBuffer());
            out.write(buf);
          }
        } catch (err) {
          if ((err as { name?: string }).name !== "AbortError") {
            logger.debug({ err, cameraId: cam.id }, "Background HA camera snapshot failed");
          }
        }
        await sleep(250);
      }
      out.end();
    })().catch(() => out.end());

    return {
      stream: out,
      close: () => {
        closed = true;
        controller.abort();
        out.end();
      },
    };
  }

  if (/^rtsp:\/\//i.test(cam.url)) {
    const embedMatch = cam.url.match(/^rtsp:\/\/([^:@]+):([^@]*)@(.+)$/i);
    const baseRtsp = embedMatch ? `rtsp://${embedMatch[3]}` : cam.url;
    const user = cam.username || (embedMatch ? embedMatch[1] : "");
    const pass = cam.password || (embedMatch ? embedMatch[2] : "");
    const rtspUrl = user
      ? `rtsp://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${baseRtsp.slice("rtsp://".length)}`
      : baseRtsp;
    const sub = subscribeSharedRtsp(cam.id, rtspUrl);
    sub.ensureStarted();
    const onAbort = () => sub.close();
    signal.addEventListener("abort", onAbort, { once: true });
    return {
      stream: sub.stream,
      close: () => {
        signal.removeEventListener("abort", onAbort);
        sub.close();
      },
    };
  }

  const controller = new AbortController();
  const combinedSignal = AbortSignal.any([signal, controller.signal]);

  const targetUrl = cam.snapshotUrl || cam.url;
  const isSnapshotOnly = !!cam.snapshotUrl && !/multipart/i.test(cam.snapshotUrl);

  if (isSnapshotOnly) {
    const out = new (require("node:stream").PassThrough)();
    let closed = false;
    (async () => {
      while (!combinedSignal.aborted && !closed) {
        try {
          const res = await fetch(targetUrl, {
            headers: buildAuthHeaders(cam),
            signal: AbortSignal.timeout(8000),
            cache: "no-store",
          });
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            out.write(buf);
          }
        } catch (err) {
          if ((err as { name?: string }).name !== "AbortError") {
            logger.debug({ err, cameraId: cam.id }, "Background camera snapshot failed");
          }
        }
        await sleep(250);
      }
      out.end();
    })().catch(() => out.end());

    return {
      stream: out,
      close: () => {
        closed = true;
        controller.abort();
        out.end();
      },
    };
  }

  const upstream = await fetch(cam.url, {
    headers: buildAuthHeaders(cam),
    signal: combinedSignal,
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) throw new Error("Camera stream unavailable");

  const readable = Readable.fromWeb(upstream.body as never);

  return {
    stream: readable,
    close: () => controller.abort(),
  };
}

function decodeJpegToImageData(buf: Buffer): { data: Uint8ClampedArray; width: number; height: number } | null {
  try {
    const decoded = jpeg.decode(buf, { useTArray: true });
    if (!decoded?.data || !decoded.width || !decoded.height) return null;
    const clamped = decoded.data instanceof Uint8ClampedArray ? decoded.data : new Uint8ClampedArray(decoded.data);
    return { data: clamped, width: decoded.width, height: decoded.height };
  } catch {
    return null;
  }
}

function nowMs(): number {
  return Date.now();
}

interface CameraRuntimeState {
  currentGesture: { gesture: CameraGestureType; sinceMs: number } | null;
  cooldownUntilMs: number;
  triggerInFlight: boolean;
}

async function runCameraLoop(cam: CameraConfig, signal: AbortSignal): Promise<void> {
  const state: CameraRuntimeState = {
    currentGesture: null,
    cooldownUntilMs: 0,
    triggerInFlight: false,
  };

  logger.info({ cameraId: cam.id, name: cam.name }, "Background camera gesture loop starting");
  let landmarker: HandLandmarker;
  try {
    landmarker = await getLandmarker();
  } catch (err) {
    logger.error({ err, cameraId: cam.id }, "Failed to initialize MediaPipe landmarker for background camera gestures");
    await sleep(5000);
    return;
  }

  while (!signal.aborted) {
    if (!hasEnabledCameraGestures(cam)) {
      await sleep(1000);
      continue;
    }

    const bindings = getAllBindings(cam);
    const bindingsByGesture = new Map<CameraGestureType, CameraGestureBinding>();
    for (const b of bindings) {
      if (!bindingsByGesture.has(b.gesture)) bindingsByGesture.set(b.gesture, b);
    }

    let closeStream: (() => void) | null = null;

    try {
      const { stream, close } = await openCameraFrameStream(cam, signal);
      closeStream = close;

      await forEachJpegFrameFromStream(stream, signal, async (jpegBytes) => {
        const t = nowMs();
        if (t < state.cooldownUntilMs) return;

        const img = decodeJpegToImageData(jpegBytes);
        if (!img) return;

        // MediaPipe expects an ImageData-like object. In Node we pass a compatible shape.
        const results = (landmarker as unknown as { detect: (i: unknown) => any }).detect(img as unknown);
        const landmarks = results?.landmarks?.[0] as { x: number; y: number; z: number }[] | undefined;
        if (!landmarks || landmarks.length === 0) {
          state.currentGesture = null;
          return;
        }

        const features = computeFeatureVector(landmarks);
        const { gesture, confidence } = classifyGesture(features, cam.calibration);
        if (!gesture || confidence <= 0.55) {
          state.currentGesture = null;
          return;
        }

        const binding = bindingsByGesture.get(gesture);
        if (!binding) {
          state.currentGesture = null;
          return;
        }

        if (state.currentGesture?.gesture === gesture) {
          const held = t - state.currentGesture.sinceMs;
          const holdTime = binding.holdTime ?? 800;
          if (held < holdTime) return;
          if (state.triggerInFlight) return;

          state.triggerInFlight = true;
          triggerCameraGesture(cam.id, gesture)
            .catch(() => {})
            .finally(() => {
              state.triggerInFlight = false;
            });

          const cooldown = binding.cooldown ?? 3000;
          state.cooldownUntilMs = t + cooldown;
          state.currentGesture = null;
          return;
        }

        state.currentGesture = { gesture, sinceMs: t };
      });
    } catch (err) {
      if (!signal.aborted) {
        logger.debug({ err, cameraId: cam.id }, "Background camera gesture loop error; retrying");
        await sleep(1500);
      }
    } finally {
      try {
        closeStream?.();
      } catch {
        // ignore
      }
    }

    await sleep(300);
  }
}

const cameraLoops = new Map<string, AbortController>();
let managerAbort: AbortController | null = null;
let managerTask: Promise<void> | null = null;

export function startBackgroundCameraGestures(): void {
  if (managerAbort) return;
  managerAbort = new AbortController();
  const signal = managerAbort.signal;

  managerTask = (async () => {
    logger.info("Starting background camera gesture service");
    while (!signal.aborted) {
      const cams = loadCameras();
      const desired = new Set(cams.filter(hasEnabledCameraGestures).map((c) => c.id));

      for (const [id, ac] of cameraLoops) {
        if (!desired.has(id) || ac.signal.aborted) {
          ac.abort();
          cameraLoops.delete(id);
        }
      }

      for (const cam of cams) {
        if (!hasEnabledCameraGestures(cam)) continue;
        if (cameraLoops.has(cam.id)) continue;
        const ac = new AbortController();
        cameraLoops.set(cam.id, ac);
        runCameraLoop(cam, AbortSignal.any([signal, ac.signal])).catch((err) => {
          logger.debug({ err, cameraId: cam.id }, "Background camera loop crashed");
          ac.abort();
          cameraLoops.delete(cam.id);
        });
      }

      await sleep(4000);
    }
  })().catch((err) => {
    logger.error({ err }, "Background camera gesture manager crashed");
  });
}

export async function stopBackgroundCameraGestures(): Promise<void> {
  if (!managerAbort) return;
  managerAbort.abort();
  managerAbort = null;
  for (const ac of cameraLoops.values()) ac.abort();
  cameraLoops.clear();
  try {
    await managerTask;
  } catch {
    // ignore
  } finally {
    managerTask = null;
  }
}

