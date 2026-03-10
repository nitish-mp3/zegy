import { useEffect, useCallback } from "react";
import { useApp } from "../contexts/AppContext";
import { api } from "../api/client";
import type { FloorPlanLayout } from "../contexts/AppContext";

export function useFloorPlan() {
  const { state, dispatch } = useApp();

  const refresh = useCallback(async () => {
    try {
      const layout = await api.getFloorplan();
      dispatch({ type: "SET_FLOORPLAN", payload: layout });
    } catch {
      // Use default layout
    }
  }, [dispatch]);

  const save = useCallback(
    async (layout: FloorPlanLayout) => {
      await api.saveFloorplan(layout);
      dispatch({ type: "SET_FLOORPLAN", payload: layout });
    },
    [dispatch],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { floorplan: state.floorplan, refresh, save };
}
