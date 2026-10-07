import { isSupabaseConfigured, supabase } from "./supabase";

export type RequestKind = "contact" | "mentoring";
export type RequestStatus = "pending" | "accepted" | "declined";
export type RequestDirection = "received" | "sent";

export type RequestPerson = {
  id: string;
  firstName: string;
  lastName: string;
  initials: string;
  photoUrl?: string;
};

export type MemberRequest = {
  id: string;
  direction: RequestDirection;
  kind: RequestKind;
  status: RequestStatus;
  message: string;
  createdAt: string;
  respondedAt?: string;
  opportunityId?: string;
  opportunityTitle?: string;
  /** The other member. */
  person: RequestPerson;
  sharedEmail?: string;
  sharedPhone?: string;
  /** Sent request that was answered and not yet looked at. */
  unseenAnswer: boolean;
};

export type SharedContact = { email?: string; phone?: string };

type ProfileEmbed = { id: string; first_name: string; last_name: string; photo_url: string | null };
type RequestRow = {
  id: string;
  requester_id: string;
  recipient_id: string;
  request_kind: RequestKind;
  status: RequestStatus;
  message: string;
  created_at: string;
  responded_at: string | null;
  opportunity_id: string | null;
  opportunity_title: string | null;
  shared_email: string | null;
  shared_phone: string | null;
  requester_seen_at: string | null;
  requester: ProfileEmbed | null;
  recipient: ProfileEmbed | null;
};

const COLUMNS =
  "id, requester_id, recipient_id, request_kind, status, message, created_at, responded_at, opportunity_id, opportunity_title, shared_email, shared_phone, requester_seen_at, " +
  "requester:profiles!requester_id(id, first_name, last_name, photo_url), " +
  "recipient:profiles!recipient_id(id, first_name, last_name, photo_url)";

/** Fired after any change so the header badge refreshes immediately. */
export const REQUESTS_CHANGED_EVENT = "lsnb:requests-changed";

function requireSupabase() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase n’est pas configuré.");
  return supabase;
}

function announceChange() {
  window.dispatchEvent(new Event(REQUESTS_CHANGED_EVENT));
}

function toPerson(profile: ProfileEmbed | null, fallbackId: string): RequestPerson {
  if (!profile) return { id: fallbackId, firstName: "Ancien", lastName: "membre", initials: "AM" };
  return {
    id: profile.id,
    firstName: profile.first_name,
    lastName: profile.last_name,
    initials: `${profile.first_name[0] ?? ""}${profile.last_name[0] ?? ""}`.toUpperCase(),
    ...(profile.photo_url ? { photoUrl: profile.photo_url } : {}),
  };
}

function mapRow(row: RequestRow, userId: string): MemberRequest {
  const received = row.recipient_id === userId;
  return {
    id: row.id,
    direction: received ? "received" : "sent",
    kind: row.request_kind,
    status: row.status,
    message: row.message,
    createdAt: row.created_at,
    ...(row.responded_at ? { respondedAt: row.responded_at } : {}),
    ...(row.opportunity_id ? { opportunityId: row.opportunity_id } : {}),
    ...(row.opportunity_title ? { opportunityTitle: row.opportunity_title } : {}),
    person: received ? toPerson(row.requester, row.requester_id) : toPerson(row.recipient, row.recipient_id),
    ...(row.shared_email ? { sharedEmail: row.shared_email } : {}),
    ...(row.shared_phone ? { sharedPhone: row.shared_phone } : {}),
    unseenAnswer: !received && row.status !== "pending" && row.requester_seen_at === null,
  };
}

export async function loadRequests(userId: string): Promise<MemberRequest[]> {
  const { data, error } = await requireSupabase()
    .from("connection_requests")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data as unknown as RequestRow[]).map((row) => mapRow(row, userId));
}

/** Requests waiting for my answer + answers I have not looked at yet. Drives the header badge. */
export async function countRequestBadge(userId: string): Promise<number> {
  const client = requireSupabase();
  const [waiting, unseen] = await Promise.all([
    client.from("connection_requests").select("id", { count: "exact", head: true })
      .eq("recipient_id", userId).eq("status", "pending"),
    client.from("connection_requests").select("id", { count: "exact", head: true })
      .eq("requester_id", userId).neq("status", "pending").is("requester_seen_at", null),
  ]);
  if (waiting.error) throw waiting.error;
  if (unseen.error) throw unseen.error;
  return (waiting.count ?? 0) + (unseen.count ?? 0);
}

export async function answerRequest(id: string, decision: "accepted" | "declined", share?: SharedContact) {
  const { data, error } = await requireSupabase()
    .from("connection_requests")
    .update({
      status: decision,
      shared_email: decision === "accepted" ? share?.email ?? null : null,
      shared_phone: decision === "accepted" ? share?.phone ?? null : null,
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Cette demande a déjà reçu une réponse ou n’existe plus.");
  announceChange();
  // A refusal is not announced by e-mail: the person sees it in "Demandes".
  if (decision === "accepted") void notifyRequestEvent(id, "accepted");
}

export async function withdrawRequest(id: string) {
  const { data, error } = await requireSupabase()
    .from("connection_requests")
    .delete()
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("Cette demande a déjà reçu une réponse.");
  announceChange();
}

export async function markAnswersSeen() {
  const { error } = await requireSupabase().rpc("mark_request_answers_seen");
  if (error) throw error;
  announceChange();
}

/**
 * Asks the API to send the e-mail notification. Best effort: the request is already
 * saved and visible in "Demandes", so a failure here must never block the member.
 */
export async function notifyRequestEvent(requestId: string, event: "created" | "accepted") {
  const apiUrl = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");
  if (!apiUrl || !supabase) return;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch(`${apiUrl}/api/v1/notifications/requests/${requestId}/${event}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      credentials: "omit",
      keepalive: true,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // Intentionally silent.
  }
}
