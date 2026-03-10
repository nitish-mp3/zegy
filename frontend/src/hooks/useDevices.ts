import { useEffect, useCallback } from "react";
import { useApp } from "../contexts/AppContext";
import { api } from "../api/client";

export function useDevices() {
  const { state, dispatch } = useApp();

  const refresh = useCallback(async () => {
    dispatch({ type: "SET_LOADING", payload: true });
    try {
      const devices = await api.getDevices();
      dispatch({ type: "SET_DEVICES", payload: devices });
      dispatch({ type: "SET_ERROR", payload: null });
    } catch (err) {
      dispatch({
        type: "SET_ERROR",
        payload: err instanceof Error ? err.message : "Failed to load devices",
      });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  }, [dispatch]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { devices: state.devices, loading: state.loading, error: state.error, refresh };
}
