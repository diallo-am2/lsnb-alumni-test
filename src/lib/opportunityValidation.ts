import { todayIso, type OpportunityLink } from "../data/opportunities";
import { getProfileUrlError } from "./profileLinks";

export const OPPORTUNITY_LIMITS = {
  title: [5, 140],
  organization: [2, 120],
  summary: [20, 280],
  description: [20, 8000],
  place: 80,
  linkLabel: 60,
  maxLinks: 5,
  maxImages: 5,
  contactMessage: [20, 900],
  reportReason: [10, 500],
} as const;

export const MAX_OPPORTUNITY_IMAGE_SIZE = 4 * 1024 * 1024;
export const MAX_OPPORTUNITY_DOCUMENT_SIZE = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type OpportunityFormValues = {
  title: string;
  organization: string;
  summary: string;
  description: string;
  country: string;
  city: string;
  domain: string;
  applyUrl: string;
  extraLinks: OpportunityLink[];
  deadline: string;
};

/** Keys are field names, or `link-<index>-label` / `link-<index>-url` for extra links. */
export type OpportunityErrors = Record<string, string>;

function lengthError(value: string, [min, max]: readonly [number, number], label: string) {
  const length = value.trim().length;
  if (length < min) return `${label} : ${min} caractères minimum.`;
  if (length > max) return `${label} : ${max} caractères maximum.`;
  return undefined;
}

export function validateOpportunity(values: OpportunityFormValues, initialDeadline = ""): OpportunityErrors {
  const errors: OpportunityErrors = {};
  const set = (key: string, message: string | undefined) => {
    if (message) errors[key] = message;
  };

  set("title", lengthError(values.title, OPPORTUNITY_LIMITS.title, "Le titre"));
  set("organization", lengthError(values.organization, OPPORTUNITY_LIMITS.organization, "L’organisme"));
  set("summary", lengthError(values.summary, OPPORTUNITY_LIMITS.summary, "Le résumé"));
  set("description", lengthError(values.description, OPPORTUNITY_LIMITS.description, "La description"));
  if (values.country.trim().length > OPPORTUNITY_LIMITS.place) set("country", "Pays trop long.");
  if (values.city.trim().length > OPPORTUNITY_LIMITS.place) set("city", "Ville trop longue.");
  set("applyUrl", getProfileUrlError(values.applyUrl, "de candidature"));

  if (values.deadline && values.deadline !== initialDeadline && values.deadline < todayIso()) {
    errors.deadline = "La date limite doit être aujourd’hui ou plus tard.";
  }

  values.extraLinks.forEach((link, index) => {
    const label = link.label.trim();
    const url = link.url.trim();
    if (!label && !url) return;
    if (!label) errors[`link-${index}-label`] = "Donnez un intitulé à ce lien.";
    else if (label.length > OPPORTUNITY_LIMITS.linkLabel) {
      errors[`link-${index}-label`] = `Intitulé trop long (${OPPORTUNITY_LIMITS.linkLabel} caractères maximum).`;
    }
    if (!url) errors[`link-${index}-url`] = "Indiquez l’adresse du lien (https://…).";
    else set(`link-${index}-url`, getProfileUrlError(url, "complémentaire"));
  });

  return errors;
}

export function getOpportunityImageError(file: File) {
  if (!IMAGE_TYPES.has(file.type)) return "Utilisez une image PNG, JPG ou WebP.";
  if (file.size > MAX_OPPORTUNITY_IMAGE_SIZE) return "Chaque image doit peser moins de 4 Mo.";
  return null;
}

export function getOpportunityDocumentError(file: File) {
  if (file.type !== "application/pdf") return "Le document doit être un fichier PDF.";
  if (file.size > MAX_OPPORTUNITY_DOCUMENT_SIZE) return "Le PDF doit peser moins de 8 Mo.";
  return null;
}

/** Links the author left completely empty are dropped before saving. */
export function cleanLinks(links: OpportunityLink[]): OpportunityLink[] {
  return links
    .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
    .filter((link) => link.label || link.url);
}
