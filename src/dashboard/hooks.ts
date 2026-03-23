/**
 * Custom hooks for the dashboard.
 */

import { useState, useEffect, useCallback } from "react";

/**
 * Auto-refresh hook: calls `loader` immediately and then every `intervalMs`.
 * Returns the latest data and a manual `refresh` trigger.
 */
export function useAutoRefresh<T>(
  loader: () => T,
  intervalMs: number,
): { data: T; refresh: () => void } {
  const [data, setData] = useState<T>(() => loader());

  const refresh = useCallback(() => {
    setData(loader());
  }, [loader]);

  useEffect(() => {
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  return { data, refresh };
}
