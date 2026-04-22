import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { CameraConfig, CameraGroup, CameraGestureBinding, CameraGestureType } from "../api/client";

export type { CameraConfig, CameraGroup, CameraGestureBinding };

const CAMERAS_SYNC_EVENT = "zegy:cameras-sync";

function emitCamerasSync() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CAMERAS_SYNC_EVENT));
  }
}

export function useCameras() {
  const [cameras, setCameras] = useState<CameraConfig[]>([]);
  const [groups, setGroups] = useState<CameraGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [cams, grps] = await Promise.all([
        api.getCameras(),
        api.getCameraGroups(),
      ]);
      setCameras(cams);
      setGroups(grps);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();

    if (typeof window === "undefined") {
      return;
    }

    const onSync = () => {
      refresh();
    };

    window.addEventListener(CAMERAS_SYNC_EVENT, onSync);
    return () => {
      window.removeEventListener(CAMERAS_SYNC_EVENT, onSync);
    };
  }, [refresh]);

  const createCamera = useCallback(
    async (data: { name: string; url: string; snapshotUrl?: string; username?: string; password?: string; groupId?: string | null }) => {
      const created = await api.createCamera(data);
      setCameras((prev) => [...prev, created]);
      emitCamerasSync();
      return created;
    },
    [],
  );

  const updateCamera = useCallback(
    async (id: string, data: Partial<CameraConfig>) => {
      const updated = await api.updateCamera(id, data);
      setCameras((prev) => prev.map((c) => (c.id === id ? updated : c)));
      emitCamerasSync();
      return updated;
    },
    [],
  );

  const removeCamera = useCallback(async (id: string) => {
    await api.deleteCamera(id);
    setCameras((prev) => prev.filter((c) => c.id !== id));
    emitCamerasSync();
  }, []);

  const calibrate = useCallback(
    async (id: string, palmFeatures: number[][], fistFeatures: number[][]) => {
      const res = await api.calibrateCamera(id, palmFeatures, fistFeatures);
      setCameras((prev) =>
        prev.map((c) => (c.id === id ? { ...c, calibration: res.calibration } : c)),
      );
      emitCamerasSync();
      return res.calibration;
    },
    [],
  );

  const triggerGesture = useCallback(
    async (id: string, gesture: CameraGestureType) => {
      return api.triggerCameraGesture(id, gesture);
    },
    [],
  );

  const createGroup = useCallback(
    async (data: { name: string; gestures?: CameraGestureBinding[] }) => {
      const created = await api.createCameraGroup(data);
      setGroups((prev) => [...prev, created]);
      emitCamerasSync();
      return created;
    },
    [],
  );

  const updateGroup = useCallback(
    async (id: string, data: Partial<CameraGroup>) => {
      const updated = await api.updateCameraGroup(id, data);
      setGroups((prev) => prev.map((g) => (g.id === id ? updated : g)));
      emitCamerasSync();
      return updated;
    },
    [],
  );

  const removeGroup = useCallback(async (id: string) => {
    await api.deleteCameraGroup(id);
    setGroups((prev) => prev.filter((g) => g.id !== id));
    setCameras((prev) =>
      prev.map((c) => (c.groupId === id ? { ...c, groupId: null } : c)),
    );
    emitCamerasSync();
  }, []);

  return {
    cameras,
    groups,
    loading,
    refresh,
    createCamera,
    updateCamera,
    removeCamera,
    calibrate,
    triggerGesture,
    createGroup,
    updateGroup,
    removeGroup,
  };
}
