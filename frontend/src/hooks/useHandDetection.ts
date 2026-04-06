import { useRef, useCallback, useEffect, useState } from "react";
import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { CameraCalibration, CameraGestureType } from "../api/client";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";

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
  if (calibration && calibration.palmFeatures.length > 0 && calibration.fistFeatures.length > 0) {
    const palmCenter = averageVector(calibration.palmFeatures);
    const fistCenter = averageVector(calibration.fistFeatures);
    const palmDist = vectorDistance(features, palmCenter);
    const fistDist = vectorDistance(features, fistCenter);
    const total = palmDist + fistDist;
    if (total === 0) return { gesture: null, confidence: 0 };
    if (palmDist < fistDist) return { gesture: "palm", confidence: fistDist / total };
    return { gesture: "fist", confidence: palmDist / total };
  }

  // extensions[0]=thumb, [1]=index, [2]=middle, [3]=ring, [4]=pinky, [5]=openness
  const e = features;
  const thumb = e[0] ?? 0;
  const index = e[1] ?? 0;
  const middle = e[2] ?? 0;
  const ring = e[3] ?? 0;
  const pinky = e[4] ?? 0;
  const openness = e[5] ?? 0;

  const ext = (v: number) => v > 1.15;
  const curl = (v: number) => v < 1.05;

  // Palm: 4+ fingers clearly extended
  if ([thumb, index, middle, ring, pinky].filter(ext).length >= 4 && openness > 1.2) {
    const extCount = [thumb, index, middle, ring, pinky].filter(ext).length;
    return { gesture: "palm", confidence: Math.min(0.98, 0.6 * (extCount / 5) + 0.38 * Math.min(openness / 2, 1)) };
  }

  // Fist: all 4 fingers curled (thumb excluded)
  if (curl(index) && curl(middle) && curl(ring) && curl(pinky) && openness < 0.95) {
    const curlCount = [index, middle, ring, pinky].filter(curl).length;
    if (!ext(thumb)) {
      return { gesture: "fist", confidence: Math.min(0.97, 0.6 * (curlCount / 4) + 0.37 * Math.min((1.5 - openness) / 1.5, 1)) };
    }
  }

  // Thumbs Up: only thumb extended, four fingers curled
  if (ext(thumb) && curl(index) && curl(middle) && curl(ring) && curl(pinky)) {
    return { gesture: "thumbs_up", confidence: Math.min(0.95, 0.5 + (thumb - 1.15) * 0.8) };
  }

  // Peace: index + middle extended, ring + pinky curled
  if (ext(index) && ext(middle) && curl(ring) && curl(pinky)) {
    return { gesture: "peace", confidence: Math.min(0.93, 0.55 + ((index + middle) / 2 - 1.15) * 0.6) };
  }

  // Point: only index extended, others including middle curled
  if (ext(index) && curl(middle) && curl(ring) && curl(pinky)) {
    return { gesture: "point", confidence: Math.min(0.92, 0.5 + (index - 1.15) * 0.7) };
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

export function useHandDetection(
  calibration: CameraCalibration | null,
  enabled: boolean,
) {
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const initPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (landmarkerRef.current) {
      setReady(true);
      return;
    }

    if (initPromiseRef.current) return;

    initPromiseRef.current = (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        landmarkerRef.current = landmarker;
        setReady(true);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load hand detection model");
      }
    })();

    return () => {
      if (landmarkerRef.current) {
        landmarkerRef.current.close();
        landmarkerRef.current = null;
        initPromiseRef.current = null;
        setReady(false);
      }
    };
  }, [enabled]);

  const detectFromVideo = useCallback(
    (video: HTMLVideoElement, timestamp: number): HandDetectionResult => {
      if (!landmarkerRef.current || !ready) {
        return { gesture: null, confidence: 0, landmarks: null, fingerExtensions: [] };
      }

      try {
        const results = landmarkerRef.current.detectForVideo(video, timestamp);
        if (!results.landmarks || results.landmarks.length === 0) {
          return { gesture: null, confidence: 0, landmarks: null, fingerExtensions: [] };
        }

        const landmarks = results.landmarks[0];
        const features = computeFeatureVector(landmarks);
        const { gesture, confidence } = classifyGesture(features, calibration);
        const fingerExtensions = computeFingerExtensions(landmarks);

        return { gesture, confidence, landmarks, fingerExtensions };
      } catch {
        return { gesture: null, confidence: 0, landmarks: null, fingerExtensions: [] };
      }
    },
    [calibration, ready],
  );

  const captureFeatures = useCallback(
    (video: HTMLVideoElement, timestamp: number): number[] | null => {
      if (!landmarkerRef.current || !ready) return null;
      try {
        const results = landmarkerRef.current.detectForVideo(video, timestamp);
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
