import { useCallback, useEffect, useState } from "react";

export type RemoteState = "loading" | "error" | "ready";

/**
 * Runs `load` and exposes an explicit loading / error / ready state, plus
 * `retry()` to run it again. `load` must be stable (wrap it in useCallback):
 * a new function identity triggers a new request.
 */
export function useRemoteData<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [state, setState] = useState<RemoteState>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState("loading");
    load()
      .then((result) => {
        if (!active) return;
        setData(result);
        setState("ready");
      })
      .catch(() => {
        if (!active) return;
        setData(undefined);
        setState("error");
      });
    return () => {
      active = false;
    };
  }, [attempt, load]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  return { data, state, retry };
}
