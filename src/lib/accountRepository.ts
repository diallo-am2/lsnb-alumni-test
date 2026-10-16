import { supabase } from "./supabase";

export const DELETION_GRACE_DAYS = 30;
const DAY_MS = 86_400_000;

export function purgeDateFor(requestedAt: string | Date): Date {
  return new Date(new Date(requestedAt).getTime() + DELETION_GRACE_DAYS * DAY_MS);
}

export function formatLongDate(date: Date): string {
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function requireSupabase() {
  if (!supabase) throw new Error("Supabase n’est pas configuré.");
  return supabase;
}

export async function loadDeletionRequestedAt(userId: string): Promise<string | null> {
  const { data, error } = await requireSupabase().from("profiles")
    .select("deletion_requested_at").eq("id", userId).single();
  if (error || !data) throw new Error("Impossible de charger l’état de votre compte.");
  return (data as { deletion_requested_at: string | null }).deletion_requested_at;
}

export async function requestAccountDeletion(): Promise<string> {
  const { data, error } = await requireSupabase().rpc("request_account_deletion");
  if (error || typeof data !== "string") throw new Error("La demande n’a pas pu être enregistrée.");
  return data;
}

export async function cancelAccountDeletion(): Promise<boolean> {
  const { data, error } = await requireSupabase().rpc("cancel_account_deletion");
  if (error) throw new Error("L’annulation n’a pas pu être enregistrée.");
  return data === true;
}

export async function notifyAccountDeletion(timeoutMs = 6000): Promise<void> {
  const apiUrl = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");
  if (!apiUrl || !supabase) return;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch(`${apiUrl}/api/v1/notifications/account-deletion`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      credentials: "omit",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // The deletion request is already persisted; mail delivery is best effort.
  }
}
