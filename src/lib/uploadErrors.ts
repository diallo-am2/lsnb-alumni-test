/** Turns storage / network / database failures into something a member can act on. */
export function describeUploadError(error: unknown): string {
  const failure = (error ?? {}) as { message?: unknown; statusCode?: unknown; status?: unknown; code?: unknown; name?: unknown };
  const status = Number(failure.statusCode ?? failure.status);
  const message = typeof failure.message === "string" ? failure.message : "";
  const text = message.toLowerCase();

  // Rules raised by our own database triggers are already written for members.
  if (failure.code === "P0001" && message) return message;
  if (status === 413 || text.includes("exceeded the maximum allowed size") || text.includes("too large") || text.includes("payload")) {
    return "Le fichier est trop volumineux pour être envoyé. Réduisez-le (8 Mo maximum pour un PDF) puis réessayez.";
  }
  if (status === 415 || text.includes("mime type") || text.includes("not supported")) {
    return "Ce type de fichier n’est pas accepté (images PNG, JPG, WebP ou PDF).";
  }
  if (status === 401 || status === 403 || text.includes("row-level security") || text.includes("jwt")) {
    return "Votre session a expiré ou l’envoi n’est pas autorisé. Reconnectez-vous puis réessayez.";
  }
  if (text.includes("failed to fetch") || text.includes("network") || text.includes("load failed") || error instanceof TypeError) {
    return "L’envoi a été interrompu : connexion instable, ou fichier refusé par le serveur. Vérifiez votre connexion puis réessayez.";
  }
  return "L’envoi des fichiers a échoué. Réessayez dans un instant.";
}
