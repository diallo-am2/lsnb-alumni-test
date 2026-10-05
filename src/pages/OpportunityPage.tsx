import {
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  FileText,
  Flag,
  LoaderCircle,
  MapPin,
  MessageSquare,
  PencilLine,
} from "lucide-react";
import { useCallback, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { RichText } from "../components/opportunities/RichText";
import { LoadError } from "../components/opportunities/OpportunityStates";
import { Button, ButtonLink } from "../components/ui/Button";
import {
  formatDeadline,
  isExpired,
  opportunityKindLabel,
  opportunityLocation,
} from "../data/opportunities";
import { useRemoteData } from "../hooks/useRemoteData";
import { contactOpportunityAuthor, loadOpportunity, reportOpportunity } from "../lib/opportunityRepository";
import { OPPORTUNITY_LIMITS } from "../lib/opportunityValidation";
import { toSafeProfileUrl } from "../lib/profileLinks";
import { isSupabaseConfigured } from "../lib/supabase";

type Panel = "none" | "contact" | "report";
type Feedback = { kind: "idle" | "loading" | "success" | "error"; message?: string };

export function OpportunityPage() {
  const { opportunityId = "" } = useParams();
  const { user } = useAuth();
  const load = useCallback(() => loadOpportunity(opportunityId), [opportunityId]);
  const { data: opportunity, state, retry } = useRemoteData(load);

  const [panel, setPanel] = useState<Panel>("none");
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" });

  const openPanel = (next: Panel) => {
    setPanel((current) => (current === next ? "none" : next));
    setFeedback({ kind: "idle" });
  };

  if (state === "loading") {
    return (
      <div className="auth-state-page" role="status">
        <LoaderCircle className="spin" aria-hidden="true" />
        <p>Chargement de l’offre…</p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="page-shell opp-detail">
        <LoadError title="Impossible de charger cette offre." onRetry={retry} />
      </div>
    );
  }

  if (!opportunity) {
    return (
      <div className="page-shell opp-detail">
        <div className="directory-empty">
          <h2>Offre introuvable.</h2>
          <p>Elle a peut-être été clôturée, supprimée ou masquée après signalement.</p>
          <ButtonLink to="/offres" variant="outline">Retour aux offres</ButtonLink>
        </div>
      </div>
    );
  }

  const isAuthor = user?.id === opportunity.authorId;
  const expired = isExpired(opportunity);
  const applyUrl = toSafeProfileUrl(opportunity.applyUrl);
  const links = opportunity.extraLinks.flatMap((link) => {
    const url = toSafeProfileUrl(link.url);
    return url ? [{ label: link.label, url }] : [];
  });
  const images = opportunity.images.filter((image) => image.url);
  const banner =
    opportunity.status === "closed"
      ? "Cette offre est clôturée par son auteur."
      : opportunity.status === "hidden"
        ? "Cette offre a été masquée après plusieurs signalements."
        : expired
          ? "La date limite de cette offre est dépassée."
          : null;

  const limits = panel === "contact" ? OPPORTUNITY_LIMITS.contactMessage : OPPORTUNITY_LIMITS.reportReason;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const length = text.trim().length;
    if (length < limits[0] || length > limits[1]) {
      setFeedback({ kind: "error", message: `Le message doit contenir entre ${limits[0]} et ${limits[1]} caractères.` });
      return;
    }
    setFeedback({ kind: "loading" });
    try {
      if (panel === "contact") await contactOpportunityAuthor(opportunity, text);
      else await reportOpportunity(opportunity.id, text);
      setFeedback({
        kind: "success",
        message: panel === "contact" ? "Votre message a été transmis à l’auteur." : "Merci, votre signalement a été transmis.",
      });
      setText("");
      setPanel("none");
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "L’envoi a échoué. Réessayez." });
    }
  };

  return (
    <div className="opp-detail">
      <div className="page-shell">
        <Link to="/offres" className="back-link">
          <ArrowLeft size={17} aria-hidden="true" /> Retour aux offres
        </Link>

        <header className="opp-detail__header">
          <p className="opp-card__meta">
            <span className="opp-badge">{opportunityKindLabel(opportunity.kind)}</span>
            {opportunity.domain && <span>{opportunity.domain}</span>}
          </p>
          <h1>{opportunity.title}</h1>
          <p className="opp-detail__org">{opportunity.organization}</p>
          <ul className="opp-card__facts">
            <li><MapPin size={16} aria-hidden="true" /> {opportunityLocation(opportunity)}</li>
            {opportunity.deadline && (
              <li><CalendarClock size={16} aria-hidden="true" /> Date limite : {formatDeadline(opportunity.deadline)}</li>
            )}
          </ul>
          {banner && <p className="opp-detail__banner" role="status">{banner}</p>}
        </header>

        <div className="opp-detail__layout">
          <article className="opp-detail__main">
            {images.length > 0 && (
              <div className={`opp-gallery opp-gallery--${Math.min(images.length, 3)}`}>
                {images.map((image) => (
                  <a key={image.id} href={image.url} target="_blank" rel="noopener noreferrer">
                    <img src={image.url} alt={image.alt || `Illustration : ${opportunity.title}`} loading="lazy" />
                  </a>
                ))}
              </div>
            )}
            <p className="opp-detail__summary">{opportunity.summary}</p>
            <RichText text={opportunity.description} />
          </article>

          <aside className="opp-detail__aside" aria-label="Actions et liens">
            {applyUrl && (
              <a className="button button--primary button--lg" href={applyUrl} target="_blank" rel="noopener noreferrer nofollow ugc">
                Postuler <ArrowUpRight aria-hidden="true" />
              </a>
            )}

            {links.length > 0 && (
              <section className="opp-links">
                <h2>Liens utiles</h2>
                <ul>
                  {links.map((link) => (
                    <li key={link.url}>
                      <a href={link.url} target="_blank" rel="noopener noreferrer nofollow ugc">
                        {link.label} <ArrowUpRight size={14} aria-hidden="true" />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {opportunity.document?.url && (
              <a className="opp-document" href={opportunity.document.url} target="_blank" rel="noopener noreferrer">
                <FileText aria-hidden="true" /> Document joint (PDF)
              </a>
            )}

            <section className="opp-author">
              <p>Publiée par</p>
              {opportunity.isDemo ? <b>{opportunity.authorName}</b> : <Link to={`/alumni/${opportunity.authorId}`}>{opportunity.authorName}</Link>}
            </section>

            {isAuthor ? (
              <ButtonLink to={`/offres/${opportunity.id}/modifier`} variant="outline">
                <PencilLine aria-hidden="true" /> Modifier mon offre
              </ButtonLink>
            ) : (
              !opportunity.isDemo &&
              isSupabaseConfigured && (
                <div className="opp-actions">
                  <Button variant="outline" onClick={() => openPanel("contact")} aria-expanded={panel === "contact"}>
                    <MessageSquare aria-hidden="true" /> Contacter l’auteur
                  </Button>
                  <Button variant="ghost" onClick={() => openPanel("report")} aria-expanded={panel === "report"}>
                    <Flag aria-hidden="true" /> Signaler
                  </Button>
                </div>
              )
            )}

            {panel !== "none" && (
              <form className="opp-panel" onSubmit={submit}>
                <label className="field-group">
                  <span>{panel === "contact" ? "Votre message à l’auteur" : "Pourquoi signalez-vous cette offre ?"}</span>
                  <textarea
                    rows={5}
                    value={text}
                    onChange={(event) => {
                      setText(event.target.value);
                      setFeedback({ kind: "idle" });
                    }}
                    maxLength={limits[1]}
                    placeholder={panel === "contact" ? "Présentez-vous et précisez votre question." : "Arnaque, paiement demandé, lien douteux…"}
                  />
                  <small>{limits[0]} à {limits[1]} caractères.</small>
                </label>
                <Button type="submit" disabled={feedback.kind === "loading"}>
                  {feedback.kind === "loading" ? "Envoi…" : panel === "contact" ? "Envoyer" : "Envoyer le signalement"}
                </Button>
              </form>
            )}

            {feedback.kind !== "idle" && feedback.message && (
              <div className={`form-status form-status--${feedback.kind}`} role="status">{feedback.message}</div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
