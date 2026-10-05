import { useCallback, useEffect, useState } from "react";
import type { AlumniProfile } from "../data/alumni";
import { loadProfiles } from "../lib/profileRepository";

export type DirectoryLoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; source: "demo" | "supabase" };

export type DirectoryLoader = () => Promise<{ profiles: AlumniProfile[]; source: "demo" | "supabase" }>;

/**
 * Loads the directory profiles and exposes an explicit loading / error / ready
 * state. `retry()` runs the request again.
 */
export function useDirectoryProfiles(load: DirectoryLoader = loadProfiles) {
  const [profiles, setProfiles] = useState<AlumniProfile[]>([]);
  const [state, setState] = useState<DirectoryLoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    load()
      .then((result) => {
        if (!active) return;
        setProfiles(result.profiles);
        setState({ status: "ready", source: result.source });
      })
      .catch(() => {
        if (!active) return;
        setProfiles([]);
        setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [attempt, load]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  return { profiles, state, retry };
}
