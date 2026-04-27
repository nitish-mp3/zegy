import { useRef, useCallback, useEffect, useState } from "react";
import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { CameraCalibration, CameraGestureType } from "../api/client";

const INGRESS_BASE =
  typeof window !== "undefined"
    ? (window.location.pathname.match(/^\/api\/hassio_ingress\/[^/]+/)?.[0] ?? "")
    : "";
const ORIGIN = typeof window !== "undefined" ? window.location.origin : "";
const LOCAL_WASM_URL = `${ORIGIN}${INGRESS_BASE}/api/mediapipe/wasm`;
const LOCAL_MODEL_URL = `${ORIGIN}${INGRESS_BASE}/api/mediapipe/hand_landmarker.task`;
const CDN_WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";
const CDN_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";

const INIT_PLANS: { wasmUrl: string; modelUrl: string }[] = [
  { wasmUrl: LOCAL_WASM_URL, modelUrl: LOCAL_MODEL_URL },
  { wasmUrl: LOCAL_WASM_URL, modelUrl: CDN_MODEL_URL },
  { wasmUrl: CDN_WASM_URL, modelUrl: CDN_MODEL_URL },
];

let sharedLandmarker: HandLandmarker | null = null;
let sharedLandmarkerInit: Promise<HandLandmarker> | null = null;

const FINGER_TIPS = [4, 8, 12, 16, 20];
const FINGER_PIPS = [3, 6, 10, 14, 18];
const WRIST = 0;

export interface HandDetectionResult {
  gesture: CameraGestureType | null;
  confidence: number;
  landmarks: { x: number; y: number; z: number }[] | null;
  fingerExtensions: number[];
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

  // Point: index clearly up, all other fingers curled.
  // Checked first — not affected by calibration, high specificity.
  if (ext(index) && curl(middle) && curl(ring) && curl(pinky)) {
    const conf = Math.min(0.93, 0.5 + (index - 1.15) * 0.75);
    if (conf > 0.45) return { gesture: "point", confidence: conf };
  }

  // Thumbs Up: thumb clearly raised (threshold higher than ext to avoid fist overlap),
  // all four fingers curled. Checked before calibration for same reason as point.
  if (thumb > 1.22 && curl(index) && curl(middle) && curl(ring) && curl(pinky)) {
    const conf = Math.min(0.95, 0.5 + (thumb - 1.22) * 0.9);
    if (conf > 0.45) return { gesture: "thumbs_up", confidence: conf };
  }

  // Palm vs Fist: use calibration when available (better personal accuracy).
  if (calibration && calibration.palmFeatures.length > 0 && calibration.fistFeatures.length > 0) {
    const palmCenter = averageVector(calibration.palmFeatures);
    const fistCenter = averageVector(calibration.fistFeatures);
    const palmDist = vectorDistance(features, palmCenter);
    const fistDist = vectorDistance(features, fistCenter);
    const total = palmDist + fistDist;
    if (total === 0) return { gesture: null, confidence: 0 };
    const conf = Math.max(palmDist, fistDist) / total;
    if (conf < 0.58) return { gesture: null, confidence: conf };
    return palmDist < fistDist
      ? { gesture: "palm", confidence: conf }
      : { gesture: "fist", confidence: conf };
  }

  // Palm: 3+ non-thumb fingers extended, hand visibly open.
  if ([index, middle, ring, pinky].filter(ext).length >= 3 && openness > 1.15) {
    const extCount = [thumb, index, middle, ring, pinky].filter(ext).length;
    return { gesture: "palm", confidence: Math.min(0.97, 0.55 * (extCount / 5) + 0.42 * Math.min(openness / 2, 1)) };
  }

  // Fist: all 4 non-thumb fingers curled, thumb not raised, hand closed.
  if (curl(index) && curl(middle) && curl(ring) && curl(pinky) && openness < 1.0 && thumb < 1.22) {
    const curlCount = [index, middle, ring, pinky].filter(curl).length;
    return { gesture: "fist", confidence: Math.min(0.96, 0.55 * (curlCount / 4) + 0.41 * Math.min((1.5 - openness) / 1.5, 1)) };
  }

  return { gesture: null, confidence: 0 };
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
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function createLandmarker(): Promise<HandLandmarker> {
  let lastError: unknown = null;

  for (const plan of INIT_PLANS) {
    let vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

    try {
      vision = await withTimeout(
        FilesetResolver.forVisionTasks(plan.wasmUrl),
        15000,
        `WASM init (${plan.wasmUrl})`,
      );
    } catch (err) {
      lastError = err;
      continue;
    }

    for (const delegate of ["GPU", "CPU"] as const) {
      try {
        const landmarker = await withTimeout(
          HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: plan.modelUrl, delegate },
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          }),
          15000,
          `Model init (${delegate})`,
        );
        return landmarker;
      } catch (err) {
        lastError = err;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to load hand detection model");
}

function getSharedLandmarker(): Promise<HandLandmarker> {
  if (sharedLandmarker) {
    return Promise.resolve(sharedLandmarker);
  }

  if (sharedLandmarkerInit) {
    return sharedLandmarkerInit;
  }

  sharedLandmarkerInit = createLandmarker()
    .then((landmarker) => {
      sharedLandmarker = landmarker;
      return landmarker;
    })
    .catch((err) => {
      sharedLandmarkerInit = null;
      throw err;
    });

  return sharedLandmarkerInit;
}

export function useHandDetection(
  calibration: CameraCalibration | null,
  enabled: boolean,
) {
  const landmarkerRef = useRef<HandLandmarker | null>(sharedLandmarker);
  const calibrationRef = useRef<CameraCalibration | null>(calibration);
  const [ready, setReady] = useState(!!sharedLandmarker && enabled);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    calibrationRef.current = calibration;
  }, [calibration]);

  useEffect(() => {
    let disposed = false;

    if (!enabled) {
      setReady(false);
      setLoadError(null);
      return () => {
        disposed = true;
      };
    }

    setReady(!!sharedLandmarker);
    setLoadError(null);

    getSharedLandmarker()
      .then((landmarker) => {
        if (disposed) return;
        landmarkerRef.current = landmarker;
        setReady(true);
        setLoadError(null);
      })
      .catch((err) => {
        if (disposed) return;
        setReady(false);
        setLoadError(err instanceof Error ? err.message : "Failed to load hand detection model");
      });

    return () => {
      disposed = true;
    };
  }, [enabled]);

  const detectFromVideo = useCallback(
    (source: HTMLVideoElement | HTMLCanvasElement, timestamp: number): HandDetectionResult => {
      if (!landmarkerRef.current || !ready) {
        return { gesture: null, confidence: 0, landmarks: null, fingerExtensions: [] };
      }

      try {
        const results = landmarkerRef.current.detectForVideo(source as HTMLVideoElement, timestamp);
        if (!results.landmarks || results.landmarks.length === 0) {
          return { gesture: null, confidence: 0, landmarks: null, fingerExtensions: [] };
        }

        const landmarks = results.landmarks[0];
        const features = computeFeatureVector(landmarks);
        const { gesture, confidence } = classifyGesture(features, calibrationRef.current);
        const fingerExtensions = computeFingerExtensions(landmarks);

        return { gesture, confidence, landmarks, fingerExtensions };
      } catch {
        return { gesture: null, confidence: 0, landmarks: null, fingerExtensions: [] };
      }
    },
    [ready],
  );

  const captureFeatures = useCallback(
    (source: HTMLVideoElement | HTMLCanvasElement, timestamp: number): number[] | null => {
      if (!landmarkerRef.current || !ready) return null;
      try {
        const results = landmarkerRef.current.detectForVideo(source as HTMLVideoElement, timestamp);
        if (!results.landmarks || results.landmarks.length === 0) return null;
        return computeFeatureVector(results.landmarks[0]);
      } catch {
        return null;
      }
    },
    [ready],
  );

  return { ready, loadError, detectFromVideo, captureFeatures };
}
