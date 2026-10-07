import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { countRequestBadge, REQUESTS_CHANGED_EVENT } from "../lib/requestRepository";
import { isSupabaseConfigured } from "../lib/supabase";

const POLL_INTERVAL_MS = 60_000;

/**
 * Number of requests that need the member's attention (waiting for an answer, or
 * answered and not yet seen). No realtime service is needed: it refreshes when the
 * route changes, when the tab regains focus, after any change made on the page, and
 * once a minute while the tab is visible.
 */
export function useRequestBadge() {
  const { user } = useAuth();
  const userId = user?.id;
  const location = useLocation();
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    if (!userId || !isSupabaseConfigured) {
      setCount(0);
      return Promise.resolve();
    }
    return countRequestBadge(userId)
      .then(setCount)
      // Keep the last known value: a network blip must not make the badge flicker.
      .catch(() => undefined);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh, location.pathname]);

  useEffect(() => {
    if (!userId) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(onVisible, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener(REQUESTS_CHANGED_EVENT, onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener(REQUESTS_CHANGED_EVENT, onVisible);
    };
  }, [refresh, userId]);

  return userId ? count : 0;
}
