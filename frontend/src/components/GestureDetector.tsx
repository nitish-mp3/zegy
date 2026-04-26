import { useEffect, useMemo, useRef } from "react";
import { api } from "../api/client";
import { useHandDetection } from "../hooks/useHandDetection";
import { consumeMjpegStream } from "../utils/mjpeg";
import type { CameraConfig, CameraGestureType } from "../api/client";

interface GestureDetectorProps {
  camera: CameraConfig;
  bindings?: CameraConfig["gestures"];
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export default function GestureDetector({ camera, bindings }: GestureDetectorProps) {
  const lastDetectRef = useRef(0);
  const lastGestureRef = useRef<{ gesture: CameraGestureType; since: number } | null>(null);
  const cooldownUntilRef = useRef(0);
  const triggerInFlightRef = useRef(false);
  const { ready, detectFromVideo } = useHandDetection(camera.calibration, camera.enabled);
  const enabledBindings = useMemo(
    () => (bindings ?? camera.gestures).filter((g) => g.enabled),
    [bindings, camera.gestures],
  );
  const bindingsSignature = useMemo(
    () => enabledBindings.map((b) => `${b.id}:${b.gesture}:${b.holdTime}:${b.cooldown}`).join("|"),
    [enabledBindings],
  );
  const sourceSignature = `${camera.url}:${camera.snapshotUrl}:${camera.username}:${camera.passwordSet}`;

  useEffect(() => {
    if (!camera.enabled || !ready || enabledBindings.length === 0) return;

    const ac = new AbortController();
    const streamUrl = api.getCameraStreamUrl(camera.id);
    const bindingsByGesture = new Map(enabledBindings.map((b) => [b.gesture, b]));

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    (async () => {
      let reconnectDelay = 500;

      while (!ac.signal.aborted) {
        let hadFrame = false;

        try {
          const res = await fetch(streamUrl, {
            signal: ac.signal,
            cache: "no-store",
          });

          if (!res.ok || !res.body) {
            throw new Error("Stream unavailable");
          }

          await consumeMjpegStream(
            res.body,
            (bmp) => {
              hadFrame = true;

              if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
                canvas.width = bmp.width;
                canvas.height = bmp.height;
              }

              if (ctx) ctx.drawImage(bmp, 0, 0);
              bmp.close();

              const now = performance.now();
              if (now - lastDetectRef.current < 100) return;
              lastDetectRef.current = now;

              try {
                const result = detectFromVideo(canvas, now);
                if (
                  !result.gesture ||
                  result.confidence <= 0.55 ||
                  now <= cooldownUntilRef.current
                ) {
                  if (!result.gesture) lastGestureRef.current = null;
                  return;
                }

                const binding = bindingsByGesture.get(result.gesture);
                if (!binding) {
                  lastGestureRef.current = null;
                  return;
                }

                if (lastGestureRef.current?.gesture === result.gesture) {
                  const held = now - lastGestureRef.current.since;
                  if (held < (binding.holdTime ?? 800)) return;
                  if (triggerInFlightRef.current) return;

                  triggerInFlightRef.current = true;
                  api
                    .triggerCameraGesture(camera.id, result.gesture)
                    .finally(() => {
                      triggerInFlightRef.current = false;
                    });

                  cooldownUntilRef.current = now + (binding.cooldown ?? 3000);
                  lastGestureRef.current = null;
                  return;
                }

                lastGestureRef.current = { gesture: result.gesture, since: now };
              } catch {
                lastGestureRef.current = null;
              }
            },
            ac.signal,
          );

          reconnectDelay = hadFrame ? 500 : Math.min(reconnectDelay * 2, 5000);
        } catch {
          if (ac.signal.aborted) break;
          reconnectDelay = Math.min(reconnectDelay * 2, 5000);
        }

        if (ac.signal.aborted) break;
        await wait(reconnectDelay, ac.signal);
      }
    })();

    return () => ac.abort();
  }, [camera.id, camera.enabled, ready, detectFromVideo, bindingsSignature, sourceSignature]);

  return null;
}
