import { loadJson, saveJson } from "../store";
import type { CameraConfig, CameraGroup } from "../types";

const CAMERAS_FILE = "cameras.json";
const CAMERA_GROUPS_FILE = "camera-groups.json";

export function loadCameras(): CameraConfig[] {
  const raw = loadJson<CameraConfig[]>(CAMERAS_FILE, []);
  return raw.map((c) => ({
    ...c,
    gestures: Array.isArray(c.gestures) ? c.gestures : [],
    calibration: c.calibration ?? null,
    groupId: c.groupId ?? null,
    snapshotUrl: c.snapshotUrl ?? "",
    username: c.username ?? "",
    password: c.password ?? "",
  }));
}

export function saveCameras(cameras: CameraConfig[]): void {
  saveJson(CAMERAS_FILE, cameras);
}

export function loadCameraGroups(): CameraGroup[] {
  return loadJson<CameraGroup[]>(CAMERA_GROUPS_FILE, []);
}

export function saveCameraGroups(groups: CameraGroup[]): void {
  saveJson(CAMERA_GROUPS_FILE, groups);
}

