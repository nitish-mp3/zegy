import { useEffect } from "react";
import { useApp } from "../contexts/AppContext";
import { subscribe } from "../api/ws";

export function useWebSocket() {
  const { dispatch } = useApp();

  useEffect(() => {
    const unsub = subscribe((data) => {
      if (data.type === "connected") {
        dispatch({ type: "SET_CONNECTED", payload: true });
      }
      if (data.type === "disconnected") {
        dispatch({ type: "SET_CONNECTED", payload: false });
      }

      if (data.type === "state_changed") {
        dispatch({
          type: "UPDATE_SENSOR",
          payload: {
            entityId: data.entity_id as string,
            value: data.state as string | number,
            timestamp: data.timestamp as string,
          },
        });
      }
    });

    return unsub;
  }, [dispatch]);
}
