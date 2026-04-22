import { useEffect, useRef } from "react";
import { api } from "../api/client";
import { useHandDetection } from "../hooks/useHandDetection";
import { consumeMjpegStream } from "../utils/mjpeg";
import type { CameraConfig, CameraGestureType } from "../api/client";

interface GestureDetectorProps {
  camera: CameraConfig;
  onGestureDetected: (gesture: CameraGestureType) => void;
}

export default function GestureDetector({ camera, onGestureDetected }: GestureDetectorProps) {
  const lastDetectRef = useRef(0);
  const lastGestureRef = useRef<{ gesture: CameraGestureType; since: number } | null>(null);
  const cooldownUntilRef = useRef(0);
  const { ready, detectFromVideo } = useHandDetection(camera.calibration, camera.enabled);

  useEffect(() => {
    if (!camera.enabled || !ready || camera.gestures.length === 0) return;

    const ac = new AbortController();
    const streamUrl = api.getCameraStreamUrl(camera.id);

    (async () => {
      try {
        const res = await fetch(streamUrl, { signal: ac.signal });
        if (!res.ok || !res.body) return;
        await consumeMjpegStream(res.body, (bmp) => {
          // Create a temporary canvas for detection
          const canvas = document.createElement('canvas');
          canvas.width = bmp.width;
          canvas.height = bmp.height;
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.drawImage(bmp, 0, 0);
          bmp.close();

          // Run detection
          const now = performance.now();
          if (now - lastDetectRef.current >= 100) {
            lastDetectRef.current = now;
            try {
              const result = detectFromVideo(canvas, now);
              if (result.gesture && result.confidence > 0.55 && now > cooldownUntilRef.current) {
                const binding = camera.gestures.find(g => g.gesture === result.gesture && g.enabled);
                if (binding) {
                  if (lastGestureRef.current?.gesture === result.gesture) {
                    const held = now - lastGestureRef.current.since;
                    if (held >= (binding.holdTime ?? 800)) {
                      onGestureDetected(result.gesture);
                      cooldownUntilRef.current = now + (binding.cooldown ?? 3000);
                      lastGestureRef.current = null;
                    }
                  } else {
                    lastGestureRef.current = { gesture: result.gesture, since: now };
                  }
                }
              } else if (!result.gesture) {
                lastGestureRef.current = null;
              }
            } catch { /* skip */ }
          }
        }, ac.signal);
      } catch { /* AbortError */ }
    })();

    return () => ac.abort();
  }, [camera, ready, detectFromVideo, onGestureDetected]);

  return null; // No UI
}