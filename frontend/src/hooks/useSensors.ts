import { useEffect, useCallback } from "react";
import { useApp } from "../contexts/AppContext";
import { api } from "../api/client";

export function useSensors() {
  const { state, dispatch } = useApp();

  const refresh = useCallback(async () => {
    dispatch({ type: "SET_LOADING", payload: true });
    try {
      const sensors = await api.getSensors();
      dispatch({ type: "SET_SENSORS", payload: sensors });
      dispatch({ type: "SET_ERROR", payload: null });
    } catch (err) {
      dispatch({
        type: "SET_ERROR",
        payload: err instanceof Error ? err.message : "Failed to load sensors",
      });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  }, [dispatch]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { sensors: state.sensors, loading: state.loading, error: state.error, refresh };
}
