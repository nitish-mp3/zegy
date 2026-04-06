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

    if (palmDist < fistDist) {
      return { gesture: "palm", confidence: fistDist / total };
    }
    return { gesture: "fist", confidence: palmDist / total };
  }

  const extensions = features.slice(0, 5);
  const openness = features[5] ?? 0;
  const extendedCount = extensions.filter((e) => e > 1.15).length;

  if (extendedCount >= 4 && openness > 1.2) {
    const conf = Math.min(1, (extendedCount / 5) * 0.6 + Math.min(openness / 2, 0.4));
    return { gesture: "palm", confidence: conf };
  }

  if (extendedCount <= 1 && openness < 0.9) {
    const conf = Math.min(1, ((5 - extendedCount) / 5) * 0.6 + Math.min((1.5 - openness) / 1.5, 0.4));
    return { gesture: "fist", confidence: conf };
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
