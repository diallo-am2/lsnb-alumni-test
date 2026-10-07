import { ArrowLeft, Inbox } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { DirectoryLoading } from "../components/directory/DirectoryStates";
import { LoadError } from "../components/opportunities/OpportunityStates";
import { RequestItem } from "../components/requests/RequestItem";
import { ButtonLink } from "../components/ui/Button";
import { useRemoteData } from "../hooks/useRemoteData";
import { cn } from "../lib/cn";
import {
  answerRequest,
  loadRequests,
  markAnswersSeen,
  withdrawRequest,
  type RequestDirection,
  type SharedContact,
} from "../lib/requestRepository";
import { isSupabaseConfigured } from "../lib/supabase";

export function RequestsPage() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const load = useCallback(() => loadRequests(userId), [userId]);
  const { data, state, retry } = useRemoteData(load);

  const [tab, setTab] = useState<RequestDirection | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Answers that were not seen when the page opened keep their "Nouveau" tag until the next visit.
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(new Set());
  const initialised = useRef(false);
  const markedSeen = useRef(false);

  const requests = data ?? [];
  const received = requests.filter((request) => request.direction === "received");
  const sent = requests.filter((request) => request.direction === "sent");
  const waiting = received.filter((request) => request.status === "pending").length;
  const unseen = sent.filter((request) => request.unseenAnswer).length;

  // First load: remember what is new and open the tab that needs attention.
  useEffect(() => {
    if (state !== "ready" || initialised.current) return;
    initialised.current = true;
    setNewIds(new Set(sent.filter((request) => request.unseenAnswer).map((request) => request.id)));
    setTab(waiting === 0 && unseen > 0 ? "sent" : "received");
  }, [state, sent, waiting, unseen]);

  // Looking at the sent tab clears the badge for the answers shown there.
  useEffect(() => {
    if (tab !== "sent" || unseen === 0 || markedSeen.current) return;
    markedSeen.current = true;
    void markAnswersSeen().catch(() => {
      markedSeen.current = false;
    });
  }, [tab, unseen]);

  const run = async (id: string, action: () => Promise<void>, success?: string) => {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
      retry();
    } catch (cause) {
      setError(cause instanceof Error && cause.message.startsWith("Cette demande")
        ? cause.message
        : "L’action a échoué. Vérifiez votre connexion et réessayez.");
    } finally {
      setBusyId(null);
    }
  };

  const visible = tab === "sent" ? sent : received;

  return (
    <div className="opp-detail requests-page">
      <div className="page-shell">
        <Link to="/espace" className="back-link">
          <ArrowLeft size={17} aria-hidden="true" /> Retour à mon espace
        </Link>
        <header className="opp-detail__header">
          <h1>Demandes</h1>
          <p>
            Les messages reçus depuis votre profil ou vos offres, vos demandes de mentorat, et les réponses
            à celles que vous avez envoyées.
          </p>
        </header>

        {!isSupabaseConfigured && (
          <div className="form-status" role="status">Les demandes ne sont pas disponibles en mode démonstration.</div>
        )}
        {error && <div className="form-status form-status--error" role="alert">{error}</div>}
        {notice && <div className="form-status form-status--success" role="status">{notice}</div>}

        <div className="request-tabs" role="group" aria-label="Choisir les demandes à afficher">
          <button type="button" className={cn("request-tab", tab !== "sent" && "is-active")}
            aria-pressed={tab !== "sent"} onClick={() => setTab("received")}>
            Reçues {waiting > 0 && <span className="request-count" aria-label={`${waiting} en attente`}>{waiting}</span>}
          </button>
          <button type="button" className={cn("request-tab", tab === "sent" && "is-active")}
            aria-pressed={tab === "sent"} onClick={() => setTab("sent")}>
            Envoyées {unseen > 0 && <span className="request-count" aria-label={`${unseen} nouvelles réponses`}>{unseen}</span>}
          </button>
        </div>

        <div aria-busy={state === "loading"}>
          {state === "loading" && !data && <DirectoryLoading />}
          {state === "error" && <LoadError title="Impossible de charger vos demandes." onRetry={retry} />}
          {state !== "error" && data && visible.length === 0 && (
            <div className="directory-empty directory-empty--new">
              <Inbox size={34} aria-hidden="true" />
              {tab === "sent" ? (
                <>
                  <h2>Vous n’avez encore envoyé aucune demande.</h2>
                  <p>Écrivez à un membre depuis l’annuaire, ou à l’auteur d’une offre.</p>
                  <ButtonLink to="/annuaire" variant="outline">Parcourir l’annuaire</ButtonLink>
                </>
              ) : (
                <>
                  <h2>Aucune demande reçue pour l’instant.</h2>
                  <p>Quand un membre vous écrit, depuis votre profil, une de vos offres ou une demande de mentorat, le message apparaît ici.</p>
                </>
              )}
            </div>
          )}
          {state !== "error" && data && visible.length > 0 && (
            <ul className="request-list">
              {visible.map((request) => (
                <RequestItem
                  key={request.id}
                  request={request}
                  isNew={newIds.has(request.id)}
                  defaultEmail={user?.email ?? ""}
                  busy={busyId === request.id}
                  onAccept={(id: string, share: SharedContact) =>
                    void run(id, () => answerRequest(id, "accepted", share),
                      `Demande acceptée. ${request.person.firstName} verra les coordonnées que vous avez choisi de partager.`)}
                  onDecline={(id) => void run(id, () => answerRequest(id, "declined"), "Demande déclinée.")}
                  onWithdraw={(id) => void run(id, () => withdrawRequest(id), "Demande retirée.")}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
