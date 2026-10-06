import {
  demoOpportunities,
  todayIso,
  type Opportunity,
  type OpportunityKind,
  type OpportunityLink,
  type OpportunityStatus,
} from "../data/opportunities";
import { cleanLinks, type OpportunityFormValues } from "./opportunityValidation";
import { isSupabaseConfigured, supabase } from "./supabase";

const BUCKET = "opportunity-media";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

type MediaRow = {
  id: string;
  kind: "image" | "document";
  storage_path: string;
  alt_text: string | null;
  position: number;
};

type OpportunityRow = {
  id: string;
  author_id: string;
  kind: OpportunityKind;
  title: string;
  organization: string;
  summary: string;
  description?: string | null;
  country: string | null;
  city: string | null;
  is_remote: boolean;
  domain: string | null;
  apply_url: string | null;
  extra_links?: OpportunityLink[] | null;
  deadline: string | null;
  status: OpportunityStatus;
  created_at: string;
  author: { first_name: string; last_name: string } | null;
  opportunity_media: MediaRow[] | null;
};

const LIST_COLUMNS =
  "id, author_id, kind, title, organization, summary, country, city, is_remote, domain, apply_url, deadline, status, created_at, author:profiles!author_id(first_name, last_name), opportunity_media(id, kind, storage_path, alt_text, position)";
const DETAIL_COLUMNS = LIST_COLUMNS.replace("summary,", "summary, description, extra_links,");

function requireSupabase() {
  if (!supabase) throw new Error("Supabase n’est pas configuré.");
  return supabase;
}

function mapRow(row: OpportunityRow): Opportunity {
  const media = [...(row.opportunity_media ?? [])].sort((a, b) => a.position - b.position);
  const document = media.find((item) => item.kind === "document");
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: row.author ? `${row.author.first_name} ${row.author.last_name}`.trim() : "Un membre du réseau",
    kind: row.kind,
    title: row.title,
    organization: row.organization,
    summary: row.summary,
    description: row.description ?? "",
    country: row.country ?? undefined,
    city: row.city ?? undefined,
    isRemote: row.is_remote,
    domain: row.domain ?? undefined,
    applyUrl: row.apply_url ?? undefined,
    extraLinks: Array.isArray(row.extra_links) ? row.extra_links : [],
    deadline: row.deadline ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    images: media
      .filter((item) => item.kind === "image")
      .map((item) => ({ id: item.id, path: item.storage_path, alt: item.alt_text ?? "" })),
    document: document
      ? { id: document.id, path: document.storage_path, name: document.storage_path.split("/").pop() ?? "document.pdf" }
      : undefined,
  };
}

/** Signed URLs for private files. A failure only means "no image", never a broken page. */
async function signedUrls(paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (!supabase || paths.length === 0) return urls;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return urls;
  for (const item of data) {
    if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  return urls;
}

async function attachUrls(opportunities: Opportunity[], scope: "cover" | "all"): Promise<Opportunity[]> {
  const paths = opportunities.flatMap((item) => [
    ...(scope === "cover" ? item.images.slice(0, 1) : item.images).map((image) => image.path),
    ...(scope === "all" && item.document ? [item.document.path] : []),
  ]);
  const urls = await signedUrls(paths);
  return opportunities.map((item) => ({
    ...item,
    images: item.images.map((image) => ({ ...image, url: urls.get(image.path) })),
    document: item.document ? { ...item.document, url: urls.get(item.document.path) } : undefined,
  }));
}

export async function loadOpportunities(options: { includeExpired: boolean }): Promise<Opportunity[]> {
  if (!isSupabaseConfigured) {
    return options.includeExpired ? demoOpportunities : demoOpportunities.filter((item) => !item.deadline || item.deadline >= todayIso());
  }
  const client = requireSupabase();
  let query = client
    .from("opportunities")
    .select(LIST_COLUMNS)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(200);
  if (!options.includeExpired) query = query.or(`deadline.is.null,deadline.gte.${todayIso()}`);

  const { data, error } = await query;
  if (error) throw error;
  return attachUrls((data as unknown as OpportunityRow[]).map(mapRow), "cover");
}

export async function loadOpportunity(id: string): Promise<Opportunity | null> {
  if (!isSupabaseConfigured) return demoOpportunities.find((item) => item.id === id) ?? null;
  const { data, error } = await requireSupabase().from("opportunities").select(DETAIL_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [opportunity] = await attachUrls([mapRow(data as unknown as OpportunityRow)], "all");
  return opportunity ?? null;
}

/** Every offer written by `userId`, whatever its status. */
export async function loadMyOpportunities(userId: string): Promise<Opportunity[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await requireSupabase()
    .from("opportunities")
    .select(LIST_COLUMNS)
    .eq("author_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return attachUrls((data as unknown as OpportunityRow[]).map(mapRow), "cover");
}

// Writing ---------------------------------------------------------------------

export type NewImage = { file: File; alt: string };

export type SaveOpportunityPayload = {
  id?: string;
  kind: OpportunityKind;
  values: OpportunityFormValues;
  isRemote: boolean;
  newImages: NewImage[];
  removedMediaIds: string[];
  newDocument: File | null;
};

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

async function uploadFile(userId: string, opportunityId: string, file: File) {
  const client = requireSupabase();
  const path = `${userId}/${opportunityId}/${crypto.randomUUID()}.${EXTENSIONS[file.type] ?? "bin"}`;
  const { error } = await client.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: "3600",
  });
  if (error) throw error;
  return path;
}

export async function saveOpportunity(userId: string, payload: SaveOpportunityPayload): Promise<string> {
  const client = requireSupabase();
  const { values } = payload;
  const row = {
    kind: payload.kind,
    title: values.title.trim(),
    organization: values.organization.trim(),
    summary: values.summary.trim(),
    description: values.description.trim(),
    country: values.country.trim() || null,
    city: values.city.trim() || null,
    is_remote: payload.isRemote,
    domain: values.domain.trim() || null,
    apply_url: values.applyUrl.trim() || null,
    extra_links: cleanLinks(values.extraLinks),
    deadline: values.deadline || null,
  };

  const isNew = !payload.id;
  let opportunityId = payload.id ?? "";
  if (isNew) {
    const { data, error } = await client
      .from("opportunities")
      .insert({ ...row, author_id: userId })
      .select("id")
      .single();
    if (error) throw error;
    opportunityId = data.id as string;
  } else {
    const { error } = await client.from("opportunities").update(row).eq("id", opportunityId).select("id").single();
    if (error) throw error;
  }

  const uploaded: string[] = [];
  try {
    let position = 0;
    if (!isNew) {
      const { data } = await client
        .from("opportunity_media")
        .select("position")
        .eq("opportunity_id", opportunityId)
        .eq("kind", "image");
      position = data?.length ? Math.max(...data.map((item) => item.position as number)) + 1 : 0;
    }

    for (const image of payload.newImages) {
      const path = await uploadFile(userId, opportunityId, image.file);
      uploaded.push(path);
      const { error } = await client.from("opportunity_media").insert({
        opportunity_id: opportunityId,
        kind: "image",
        storage_path: path,
        alt_text: image.alt.trim() || null,
        position: Math.min(position++, 10),
      });
      if (error) throw error;
    }

    if (payload.newDocument) {
      const path = await uploadFile(userId, opportunityId, payload.newDocument);
      uploaded.push(path);
      const { error } = await client
        .from("opportunity_media")
        .insert({ opportunity_id: opportunityId, kind: "document", storage_path: path, position: 0 });
      if (error) throw error;
    }

    // Only remove the old files once the new ones are safely uploaded — removing
    // first would lose the existing file if the new upload then failed.
    if (payload.removedMediaIds.length > 0) await deleteMedia(payload.removedMediaIds);
  } catch (error) {
    // A half-created offer is worse than none: undo a failed creation completely.
    if (uploaded.length > 0) await client.storage.from(BUCKET).remove(uploaded);
    if (isNew) await client.from("opportunities").delete().eq("id", opportunityId);
    throw error;
  }
  return opportunityId;
}

async function deleteMedia(mediaIds: string[]) {
  const client = requireSupabase();
  const { data } = await client.from("opportunity_media").select("id, storage_path").in("id", mediaIds);
  const paths = (data ?? []).map((item) => item.storage_path as string);
  if (paths.length > 0) await client.storage.from(BUCKET).remove(paths);
  const { error } = await client.from("opportunity_media").delete().in("id", mediaIds);
  if (error) throw error;
}

export async function setOpportunityStatus(id: string, status: Extract<OpportunityStatus, "published" | "closed">) {
  const { error } = await requireSupabase().from("opportunities").update({ status }).eq("id", id).select("id").single();
  if (error) throw error;
}

export async function deleteOpportunity(id: string) {
  const client = requireSupabase();
  const { data } = await client.from("opportunity_media").select("storage_path").eq("opportunity_id", id);
  const paths = (data ?? []).map((item) => item.storage_path as string);
  if (paths.length > 0) await client.storage.from(BUCKET).remove(paths);
  const { error } = await client.from("opportunities").delete().eq("id", id);
  if (error) throw error;
}

// Reporting and contact ---------------------------------------------------------

const DUPLICATE_KEY = "23505";

export async function reportOpportunity(opportunityId: string, reason: string) {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error("Connectez-vous pour signaler une offre.");
  const { error } = await client
    .from("opportunity_reports")
    .insert({ opportunity_id: opportunityId, reporter_id: auth.user.id, reason: reason.trim() });
  if (error) {
    if (error.code === DUPLICATE_KEY) throw new Error("Vous avez déjà signalé cette offre.");
    throw error;
  }
}

/** Contact request to the author, using the existing member-to-member request system. */
export async function contactOpportunityAuthor(opportunity: Pick<Opportunity, "authorId" | "title">, message: string) {
  const client = requireSupabase();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) throw new Error("Connectez-vous pour contacter l’auteur.");
  if (auth.user.id === opportunity.authorId) throw new Error("Vous ne pouvez pas vous contacter vous-même.");

  const { error } = await client.from("connection_requests").insert({
    requester_id: auth.user.id,
    recipient_id: opportunity.authorId,
    request_kind: "contact",
    message: `À propos de l’offre « ${opportunity.title} » — ${message.trim()}`,
  });
  if (error) {
    if (error.code === DUPLICATE_KEY) {
      throw new Error("Vous avez déjà une demande en attente auprès de cet auteur.");
    }
    throw error;
  }
}
