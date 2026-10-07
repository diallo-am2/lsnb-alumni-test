export type NotificationEvent = "created" | "accepted";
export type RequestKind = "contact" | "mentoring";

export type EmailContent = { subject: string; text: string; html: string };

export type EmailInput = {
  event: NotificationEvent;
  kind: RequestKind;
  /** Title of the offer the request is about, if any. */
  opportunityTitle: string | null;
  /** The member who wrote (event "created") or who accepted (event "accepted"). */
  personName: string;
  /** Link to the inbox. The e-mail never carries the message or any contact detail. */
  link: string;
};

const NAVY = "#0c2948";
const AMBER = "#c27d38";
const CREAM = "#faf8f3";

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Names and titles come from members: strip control characters, collapse spaces, cap the length. */
export function cleanText(value: string, max: number) {
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function copy(input: EmailInput) {
  const name = cleanText(input.personName, 80) || "Un membre du réseau";
  const offer = input.opportunityTitle ? cleanText(input.opportunityTitle, 140) : "";

  if (input.event === "accepted") {
    return {
      subject: `${name} a accepté votre demande`,
      heading: "Votre demande a été acceptée",
      lead: offer
        ? `${name} a accepté votre message à propos de l’offre « ${offer} ».`
        : `${name} a accepté votre demande.`,
      detail: "Les coordonnées partagées sont disponibles dans votre espace, après connexion.",
      button: "Voir la réponse",
    };
  }
  if (input.kind === "mentoring") {
    return {
      subject: "Nouvelle demande de mentorat sur LSNB Réseau",
      heading: "Vous avez reçu une demande de mentorat",
      lead: `${name} souhaite échanger avec vous dans le cadre du mentorat.`,
      detail: "Lisez la demande dans votre espace, puis acceptez ou déclinez.",
      button: "Lire la demande",
    };
  }
  if (offer) {
    return {
      subject: "Un message à propos de votre offre sur LSNB Réseau",
      heading: "Quelqu’un s’intéresse à votre offre",
      lead: `${name} vous a écrit à propos de votre offre « ${offer} ».`,
      detail: "Lisez le message dans votre espace, puis acceptez ou déclinez.",
      button: "Lire le message",
    };
  }
  return {
    subject: "Un membre du réseau vous a écrit sur LSNB Réseau",
    heading: "Vous avez reçu un message",
    lead: `${name} vous a écrit via votre profil.`,
    detail: "Lisez le message dans votre espace, puis acceptez ou déclinez.",
    button: "Lire le message",
  };
}

export function buildEmail(input: EmailInput): EmailContent {
  const c = copy(input);
  const safe = (value: string) => escapeHtml(value);
  const note =
    "Pour votre sécurité, cet e-mail ne contient ni le texte de la demande ni aucune coordonnée : tout se passe sur le site, après connexion.";

  const text = [c.heading, "", c.lead, c.detail, "", `${c.button} : ${input.link}`, "", note, "", "LSNB Réseau"].join("\n");

  const html = `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;background:${CREAM};font-family:Arial,Helvetica,sans-serif;color:${NAVY};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${CREAM};">
      <tr><td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;">
          <tr><td style="background:${NAVY};padding:20px 28px;color:#ffffff;font-size:18px;font-weight:bold;letter-spacing:0.3px;">LSNB Réseau</td></tr>
          <tr><td style="background:#ffffff;padding:32px 28px;border:1px solid #eadac6;border-top:0;">
            <h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:${NAVY};">${safe(c.heading)}</h1>
            <p style="margin:0 0 12px;font-size:16px;line-height:1.5;">${safe(c.lead)}</p>
            <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">${safe(c.detail)}</p>
            <a href="${safe(input.link)}" style="display:inline-block;background:${AMBER};color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:12px 22px;">${safe(c.button)}</a>
            <p style="margin:28px 0 0;font-size:13px;line-height:1.5;color:#5b6b7d;">${safe(note)}</p>
          </td></tr>
          <tr><td style="padding:16px 28px;font-size:12px;color:#5b6b7d;">Lycée Scientifique National de Bobo-Dioulasso · réseau des élèves et alumni</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject: cleanText(c.subject, 150), text, html };
}
