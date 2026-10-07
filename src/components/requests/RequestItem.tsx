import { Check, MessageCircle, Phone, Mail, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "../../lib/cn";
import type { MemberRequest, SharedContact } from "../../lib/requestRepository";
import { formatPhone, whatsappLink } from "../../lib/requestValidation";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { AcceptForm } from "./AcceptForm";

type RequestItemProps = {
  request: MemberRequest;
  /** Shown as "new" because the answer had not been seen when the page was opened. */
  isNew: boolean;
  defaultEmail: string;
  busy: boolean;
  onAccept: (id: string, share: SharedContact) => void;
  onDecline: (id: string) => void;
  onWithdraw: (id: string) => void;
};

const dateFormat = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const STATUS_LABEL = { pending: "En attente", accepted: "Acceptée", declined: "Déclinée" } as const;

function SharedContacts({ request }: { request: MemberRequest }) {
  const mine = request.direction === "received";
  return (
    <div className="request-shared">
      <p className="request-shared__title">
        {mine ? "Vous avez partagé" : `Coordonnées partagées par ${request.person.firstName}`}
      </p>
      <ul>
        {request.sharedEmail && (
          <li>
            <Mail size={16} aria-hidden="true" />
            {mine ? request.sharedEmail : <a href={`mailto:${request.sharedEmail}`}>{request.sharedEmail}</a>}
          </li>
        )}
        {request.sharedPhone && (
          <li>
            <Phone size={16} aria-hidden="true" />
            {mine ? (
              formatPhone(request.sharedPhone)
            ) : (
              <a href={whatsappLink(request.sharedPhone)} target="_blank" rel="noreferrer">
                {formatPhone(request.sharedPhone)} · WhatsApp
              </a>
            )}
          </li>
        )}
      </ul>
    </div>
  );
}

export function RequestItem({ request, isNew, defaultEmail, busy, onAccept, onDecline, onWithdraw }: RequestItemProps) {
  const [accepting, setAccepting] = useState(false);
  const { person } = request;
  const received = request.direction === "received";
  const kindLabel = request.kind === "mentoring" ? "Mentorat" : "Message";

  return (
    <li className={cn("request-item", `request-item--${request.status}`, isNew && "is-new")}>
      <div className="request-item__head">
        <Avatar initials={person.initials} avatarTone="sand" {...(person.photoUrl ? { photoUrl: person.photoUrl } : {})}
          className="request-item__avatar" label={`Portrait de ${person.firstName} ${person.lastName}`} />
        <div className="request-item__who">
          <p className="request-item__name">
            <Link to={`/alumni/${person.id}`}>{person.firstName} {person.lastName}</Link>
            <span className="request-item__direction">{received ? "vous a écrit" : "— votre demande"}</span>
          </p>
          <p className="request-item__meta">
            <span className="request-chip">{kindLabel}</span>
            <time dateTime={request.createdAt}>{dateFormat.format(new Date(request.createdAt))}</time>
            {request.opportunityTitle && (
              <span>
                À propos de l’offre{" "}
                {request.opportunityId ? (
                  <Link to={`/offres/${request.opportunityId}`}>« {request.opportunityTitle} »</Link>
                ) : (
                  <>« {request.opportunityTitle} »</>
                )}
              </span>
            )}
          </p>
        </div>
        <p className="request-item__status">
          {isNew && <span className="request-new">Nouveau</span>}
          <span className={cn("request-status", `request-status--${request.status}`)}>{STATUS_LABEL[request.status]}</span>
        </p>
      </div>

      <p className="request-item__message">{request.message}</p>

      {request.status === "accepted" && (request.sharedEmail || request.sharedPhone) && <SharedContacts request={request} />}
      {!received && request.status === "declined" && (
        <p className="request-item__note">Cette demande n’a pas été retenue. Vous pouvez en envoyer une autre plus tard.</p>
      )}

      {request.status === "pending" && received && !accepting && (
        <div className="request-item__actions">
          <Button size="sm" disabled={busy} onClick={() => setAccepting(true)}>
            <Check size={16} aria-hidden="true" /> Accepter
          </Button>
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => {
              if (window.confirm(`Décliner la demande de ${person.firstName} ? Aucune coordonnée ne sera partagée.`)) onDecline(request.id);
            }}>
            <X size={16} aria-hidden="true" /> Décliner
          </Button>
        </div>
      )}
      {request.status === "pending" && received && accepting && (
        <AcceptForm firstName={person.firstName} defaultEmail={defaultEmail} busy={busy}
          onCancel={() => setAccepting(false)} onConfirm={(share) => onAccept(request.id, share)} />
      )}
      {request.status === "pending" && !received && (
        <div className="request-item__actions">
          <p className="request-item__note"><MessageCircle size={15} aria-hidden="true" /> En attente de la réponse de {person.firstName}.</p>
          <Button size="sm" variant="ghost" disabled={busy}
            onClick={() => {
              if (window.confirm("Retirer cette demande ?")) onWithdraw(request.id);
            }}>
            Retirer ma demande
          </Button>
        </div>
      )}
    </li>
  );
}
