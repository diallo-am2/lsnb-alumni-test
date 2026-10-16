import type { NotificationConfig } from "../config.js";
import type { Mailer } from "./mailer.js";
import { buildAccountDeletionEmail, buildEmail, type NotificationEvent, type RequestKind } from "./templates.js";

export type NotificationServiceConfig = Pick<NotificationConfig, "url" | "secretKey" | "publishableKey" | "siteUrl">;
export type NotifyResult = "sent" | "already_sent";

/** Messages are shown to the member: never put upstream details in them. */
export class NotificationError extends Error {
  constructor(readonly statusCode: 401 | 404 | 409 | 502, message: string) {
    super(message);
    this.name = "NotificationError";
  }
}

type RequestRow = {
  id: string;
  requester_id: string;
  recipient_id: string;
  request_kind: RequestKind;
  status: string;
  opportunity_title: string | null;
};
type ProfileRow = { id: string; first_name: string; last_name: string };

export type NotificationService = {
  notify(event: NotificationEvent, requestId: string, accessToken: string): Promise<NotifyResult>;
  notifyAccountDeletion(accessToken: string): Promise<NotifyResult>;
};

export function createNotificationService(
  config: NotificationServiceConfig,
  mailer: Mailer,
  fetchImpl: typeof fetch = fetch,
): NotificationService {
  const serverHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = { apikey: config.secretKey };
    // Legacy service_role JWTs require Authorization; new sb_secret keys are resolved by the gateway.
    if (config.secretKey.startsWith("eyJ")) headers.Authorization = `Bearer ${config.secretKey}`;
    return headers;
  };

  async function rest<T>(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<T> {
    const headers = serverHeaders();
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.prefer) headers.Prefer = init.prefer;
    const response = await fetchImpl(`${config.url}/rest/v1/${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Storage request failed (${response.status}).`);
    const text = await response.text();
    return (text ? JSON.parse(text) : []) as T;
  }

  /** Asks the auth service who owns the session token. Never trust an id sent by the browser. */
  async function sessionUser(accessToken: string): Promise<{ id: string; email?: string }> {
    let response: Response;
    try {
      response = await fetchImpl(`${config.url}/auth/v1/user`, {
        headers: { apikey: config.publishableKey, Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new NotificationError(502, "Le service d’authentification ne répond pas.");
    }
    if (!response.ok) throw new NotificationError(401, "Session invalide ou expirée.");
    const user = (await response.json().catch(() => null)) as { id?: unknown; email?: unknown } | null;
    if (!user || typeof user.id !== "string") throw new NotificationError(401, "Session invalide ou expirée.");
    return { id: user.id, ...(typeof user.email === "string" && user.email ? { email: user.email } : {}) };
  }

  async function userIdFor(accessToken: string) { return (await sessionUser(accessToken)).id; }

  async function notify(event: NotificationEvent, requestId: string, accessToken: string): Promise<NotifyResult> {
    const userId = await userIdFor(accessToken);

    let row: RequestRow | undefined;
    try {
      const rows = await rest<RequestRow[]>(`connection_requests?${new URLSearchParams({
        id: `eq.${requestId}`,
        select: "id,requester_id,recipient_id,request_kind,status,opportunity_title",
        limit: "1",
      })}`);
      row = rows[0];
    } catch {
      throw new NotificationError(502, "Les demandes sont momentanément indisponibles.");
    }

    // Same answer for "does not exist" and "not yours": no way to probe other people's requests.
    const author = event === "created" ? row?.requester_id : row?.recipient_id;
    if (!row || author !== userId) throw new NotificationError(404, "Demande introuvable.");
    if (row.status !== (event === "created" ? "pending" : "accepted")) {
      throw new NotificationError(409, "Cette demande n’est pas dans l’état attendu.");
    }

    const claimQuery = `request_notifications?${new URLSearchParams({ on_conflict: "request_id,event" })}`;
    const releaseQuery = `request_notifications?${new URLSearchParams({ request_id: `eq.${row.id}`, event: `eq.${event}` })}`;

    let claimed: unknown[];
    try {
      claimed = await rest<unknown[]>(claimQuery, {
        body: { request_id: row.id, event },
        prefer: "resolution=ignore-duplicates,return=representation",
      });
    } catch {
      throw new NotificationError(502, "Les demandes sont momentanément indisponibles.");
    }
    if (claimed.length === 0) return "already_sent";

    try {
      const targetId = event === "created" ? row.recipient_id : row.requester_id;
      const [profiles, contacts] = await Promise.all([
        rest<ProfileRow[]>(`profiles?${new URLSearchParams({
          id: `in.(${row.requester_id},${row.recipient_id})`,
          select: "id,first_name,last_name",
        })}`),
        rest<{ email: string }[]>(`profile_contacts?${new URLSearchParams({
          profile_id: `eq.${targetId}`,
          select: "email",
          limit: "1",
        })}`),
      ]);
      const email = contacts[0]?.email;
      if (!email) throw new Error("No e-mail address on file.");
      const person = profiles.find((profile) => profile.id === userId);

      await mailer.send({
        to: email,
        ...buildEmail({
          event,
          kind: row.request_kind,
          opportunityTitle: row.opportunity_title,
          personName: person ? `${person.first_name} ${person.last_name}` : "",
          link: `${config.siteUrl}/espace/demandes`,
        }),
      });
      return "sent";
    } catch {
      // Let the member retry later: nothing was sent, so release the claim.
      await rest(releaseQuery, { method: "DELETE" }).catch(() => undefined);
      throw new NotificationError(502, "L’e-mail de notification n’a pas pu être envoyé.");
    }
  }

  async function notifyAccountDeletion(accessToken: string): Promise<NotifyResult> {
    const { id, email } = await sessionUser(accessToken);
    if (!email) throw new NotificationError(404, "Adresse e-mail introuvable.");
    type DeletionRow = { first_name: string; deletion_requested_at: string | null; deletion_notice_sent_at: string | null };
    const own = `profiles?${new URLSearchParams({ id: `eq.${id}` })}`;
    let row: DeletionRow | undefined;
    try {
      row = (await rest<DeletionRow[]>(`${own}&${new URLSearchParams({ select: "first_name,deletion_requested_at,deletion_notice_sent_at", limit: "1" })}`))[0];
    } catch { throw new NotificationError(502, "Le profil est momentanément indisponible."); }
    if (!row?.deletion_requested_at) throw new NotificationError(409, "Aucune suppression de compte n’est en attente.");
    if (row.deletion_notice_sent_at) return "already_sent";
    let claimed: unknown[];
    try {
      claimed = await rest<unknown[]>(`${own}&${new URLSearchParams({ deletion_notice_sent_at: "is.null", deletion_requested_at: "not.is.null", select: "id" })}`, { method: "PATCH", body: { deletion_notice_sent_at: new Date().toISOString() }, prefer: "return=representation" });
    } catch { throw new NotificationError(502, "Le profil est momentanément indisponible."); }
    if (claimed.length === 0) return "already_sent";
    try {
      const purgeDate = new Date(new Date(row.deletion_requested_at).getTime() + 30 * 86_400_000);
      await mailer.send({ to: email, ...buildAccountDeletionEmail({ firstName: row.first_name, purgeDate: purgeDate.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }), link: `${config.siteUrl}/espace/compte` }) });
      return "sent";
    } catch {
      await rest(own, { method: "PATCH", body: { deletion_notice_sent_at: null } }).catch(() => undefined);
      throw new NotificationError(502, "L’e-mail de confirmation n’a pas pu être envoyé.");
    }
  }

  return { notify, notifyAccountDeletion };
}
