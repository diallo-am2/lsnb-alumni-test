/** Same rules as the database constraints on connection_requests.shared_email / shared_phone. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;

export function normalizePhone(input: string): string | null {
  // "+33 (0)6 12 34 56 78": the (0) is the national trunk digit, not part of the international number.
  const compact = input.trim().replace(/\(0\)/g, "").replace(/[\s.\-()]/g, "");
  const international = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  return PHONE_PATTERN.test(international) ? international : null;
}

export function isValidEmail(input: string) {
  const email = input.trim();
  return email.length <= 254 && EMAIL_PATTERN.test(email);
}

export type ShareChoice = {
  shareEmail: boolean;
  email: string;
  sharePhone: boolean;
  phone: string;
};

export type ShareResult =
  | { ok: true; email?: string; phone?: string }
  | { ok: false; error: string };

/** What the recipient agrees to share when accepting. At least one contact is required. */
export function validateShare(choice: ShareChoice): ShareResult {
  if (!choice.shareEmail && !choice.sharePhone) {
    return { ok: false, error: "Choisissez au moins un moyen de contact à partager, ou déclinez la demande." };
  }
  const result: { ok: true; email?: string; phone?: string } = { ok: true };
  if (choice.shareEmail) {
    if (!isValidEmail(choice.email)) return { ok: false, error: "Saisissez une adresse e-mail valide." };
    result.email = choice.email.trim();
  }
  if (choice.sharePhone) {
    const phone = normalizePhone(choice.phone);
    if (!phone) {
      return {
        ok: false,
        error: "Saisissez le numéro WhatsApp au format international, par exemple +226 70 12 34 56.",
      };
    }
    result.phone = phone;
  }
  return result;
}

/** wa.me wants the number without "+" or separators. */
export function whatsappLink(phone: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

/** "+22670123456" → "+226 70 12 34 56"-like grouping is country specific: keep it simple and readable. */
export function formatPhone(phone: string) {
  return phone.replace(/^(\+\d{1,3})(\d+)$/, (_, code: string, rest: string) =>
    `${code} ${rest.replace(/(\d{2})(?=\d)/g, "$1 ")}`);
}
