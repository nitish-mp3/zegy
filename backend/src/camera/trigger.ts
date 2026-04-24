import { executeActions } from "../actions";
import { logger } from "../logger";
import type { CameraGestureBinding, CameraGestureType } from "../types";
import { loadCameras, loadCameraGroups } from "./store";

export async function triggerCameraGesture(cameraId: string, gesture: CameraGestureType): Promise<{
  triggered: boolean;
  bindingsMatched: number;
  actionCount: number;
  reason?: string;
}> {
  const cameras = loadCameras();
  const camera = cameras.find((c) => c.id === cameraId);
  if (!camera) return { triggered: false, bindingsMatched: 0, actionCount: 0, reason: "Camera not found" };

  const matchingBindings: CameraGestureBinding[] = [];

  for (const g of camera.gestures) {
    if (g.enabled && g.gesture === gesture) matchingBindings.push(g);
  }

  if (camera.groupId) {
    const groups = loadCameraGroups();
    const group = groups.find((g) => g.id === camera.groupId);
    if (group) {
      for (const g of group.gestures) {
        if (g.enabled && g.gesture === gesture) matchingBindings.push(g);
      }
    }
  }

  if (matchingBindings.length === 0) {
    return { triggered: false, bindingsMatched: 0, actionCount: 0, reason: "No matching bindings" };
  }

  const allActions = matchingBindings.flatMap((b) => b.actions);
  if (allActions.length > 0) {
    executeActions(allActions).catch(() => {});
  }

  logger.info({ cameraId, gesture, bindings: matchingBindings.length }, "Camera gesture triggered");
  return { triggered: true, bindingsMatched: matchingBindings.length, actionCount: allActions.length };
}

