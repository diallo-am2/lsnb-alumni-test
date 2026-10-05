export const PROFILE_URL_MAX_LENGTH = 500;

/**
 * Validates an optional profile link. An empty value is valid (the field is
 * optional). Returns a French error message, or undefined when the value is OK.
 */
export function getProfileUrlError(value: string, label: string): string | undefined {
  const url = value.trim();
  if (!url) return undefined;

  if (!url.startsWith("https://")) {
    return `Le lien ${label} doit commencer par https:// (exemple : https://www.exemple.com).`;
  }
  if (/\s/.test(url)) {
    return `Le lien ${label} ne doit pas contenir d’espace.`;
  }
  if (url.length > PROFILE_URL_MAX_LENGTH) {
    return `Le lien ${label} est trop long (${PROFILE_URL_MAX_LENGTH} caractères maximum).`;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `Le lien ${label} n’est pas une adresse valide.`;
  }
  if (parsed.protocol !== "https:" || !parsed.hostname.includes(".") || parsed.username || parsed.password) {
    return `Le lien ${label} n’est pas une adresse valide.`;
  }
  return undefined;
}

/** Returns the trimmed URL if it is a safe https:// link, otherwise undefined. */
export function toSafeProfileUrl(value: string | null | undefined): string | undefined {
  const url = value?.trim();
  if (!url || getProfileUrlError(url, "")) return undefined;
  return url;
}
