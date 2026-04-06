import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { CameraConfig, CameraGroup, CameraGestureBinding } from "../api/client";

export type { CameraConfig, CameraGroup, CameraGestureBinding };

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
  }, [refresh]);

  const createCamera = useCallback(
    async (data: { name: string; url: string; snapshotUrl?: string; username?: string; password?: string; groupId?: string | null }) => {
      const created = await api.createCamera(data);
      setCameras((prev) => [...prev, created]);
      return created;
    },
    [],
  );

  const updateCamera = useCallback(
    async (id: string, data: Partial<CameraConfig>) => {
      const updated = await api.updateCamera(id, data);
      setCameras((prev) => prev.map((c) => (c.id === id ? updated : c)));
      return updated;
    },
    [],
  );

  const removeCamera = useCallback(async (id: string) => {
    await api.deleteCamera(id);
    setCameras((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const calibrate = useCallback(
    async (id: string, palmFeatures: number[][], fistFeatures: number[][]) => {
      const res = await api.calibrateCamera(id, palmFeatures, fistFeatures);
      setCameras((prev) =>
        prev.map((c) => (c.id === id ? { ...c, calibration: res.calibration } : c)),
      );
      return res.calibration;
    },
    [],
  );

  const triggerGesture = useCallback(
    async (id: string, gesture: "palm" | "fist") => {
      return api.triggerCameraGesture(id, gesture);
    },
    [],
  );

  const createGroup = useCallback(
    async (data: { name: string; gestures?: CameraGestureBinding[] }) => {
      const created = await api.createCameraGroup(data);
      setGroups((prev) => [...prev, created]);
      return created;
    },
    [],
  );

  const updateGroup = useCallback(
    async (id: string, data: Partial<CameraGroup>) => {
      const updated = await api.updateCameraGroup(id, data);
      setGroups((prev) => prev.map((g) => (g.id === id ? updated : g)));
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
