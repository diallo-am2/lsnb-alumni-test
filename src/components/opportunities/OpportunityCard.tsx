import { CalendarClock, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import {
  formatDeadline,
  isExpired,
  opportunityKindLabel,
  opportunityLocation,
  type Opportunity,
} from "../../data/opportunities";

export function OpportunityCard({ opportunity, showStatus = false }: { opportunity: Opportunity; showStatus?: boolean }) {
  const cover = opportunity.images[0]?.url;
  const expired = isExpired(opportunity);
  const statusLabel =
    opportunity.status === "closed" ? "Clôturée" : opportunity.status === "hidden" ? "Masquée (signalée)" : expired ? "Expirée" : null;

  return (
    <article className={`opp-card opp-card--${opportunity.kind}${expired || opportunity.status !== "published" ? " is-inactive" : ""}`}>
      {cover ? (
        <img className="opp-card__cover" src={cover} alt={opportunity.images[0]?.alt || ""} loading="lazy" />
      ) : (
        <div className="opp-card__cover opp-card__cover--empty" aria-hidden="true" />
      )}
      <div className="opp-card__body">
        <p className="opp-card__meta">
          <span className="opp-badge">{opportunityKindLabel(opportunity.kind)}</span>
          {opportunity.domain && <span>{opportunity.domain}</span>}
          {(showStatus || expired) && statusLabel && <span className="opp-badge opp-badge--muted">{statusLabel}</span>}
        </p>
        <h3>
          <Link to={`/offres/${opportunity.id}`}>{opportunity.title}</Link>
        </h3>
        <p className="opp-card__org">{opportunity.organization}</p>
        <p className="opp-card__summary">{opportunity.summary}</p>
      </div>
      <ul className="opp-card__facts">
        <li><MapPin size={15} aria-hidden="true" /> {opportunityLocation(opportunity)}</li>
        {opportunity.deadline && (
          <li><CalendarClock size={15} aria-hidden="true" /> Avant le {formatDeadline(opportunity.deadline)}</li>
        )}
      </ul>
    </article>
  );
}
