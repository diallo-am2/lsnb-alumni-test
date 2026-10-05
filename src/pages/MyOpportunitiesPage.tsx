import { ArrowLeft, EyeOff, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { DirectoryLoading } from "../components/directory/DirectoryStates";
import { OpportunityCard } from "../components/opportunities/OpportunityCard";
import { LoadError } from "../components/opportunities/OpportunityStates";
import { Button, ButtonLink } from "../components/ui/Button";
import { useRemoteData } from "../hooks/useRemoteData";
import { deleteOpportunity, loadMyOpportunities, setOpportunityStatus } from "../lib/opportunityRepository";

export function MyOpportunitiesPage() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const load = useCallback(() => loadMyOpportunities(userId), [userId]);
  const { data, state, retry } = useRemoteData(load);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    try {
      await action();
      retry();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L’action a échoué. Réessayez.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="opp-detail my-opportunities">
      <div className="page-shell">
        <Link to="/offres" className="back-link">
          <ArrowLeft size={17} aria-hidden="true" /> Retour aux offres
        </Link>
        <header className="opp-detail__header">
          <h1>Mes offres</h1>
          <p>Modifiez, clôturez une offre pourvue ou supprimez-la définitivement.</p>
          <ButtonLink to="/offres/nouvelle"><Plus aria-hidden="true" /> Publier une offre</ButtonLink>
        </header>

        {error && <div className="form-status form-status--error" role="alert">{error}</div>}

        <div aria-busy={state === "loading"}>
          {state === "loading" && <DirectoryLoading />}
          {state === "error" && <LoadError title="Impossible de charger vos offres." onRetry={retry} />}
          {state === "ready" && (data ?? []).length === 0 && (
            <div className="directory-empty directory-empty--new">
              <h2>Vous n’avez encore publié aucune offre.</h2>
              <p>Partagez une bourse, un stage ou un emploi avec le réseau.</p>
              <ButtonLink to="/offres/nouvelle" variant="outline">Publier une offre</ButtonLink>
            </div>
          )}
          {state === "ready" && (data ?? []).length > 0 && (
            <ul className="my-opportunities__list">
              {(data ?? []).map((item) => (
                <li key={item.id}>
                  <OpportunityCard opportunity={item} showStatus />
                  <div className="my-opportunities__actions">
                    {item.status !== "hidden" && (
                      <ButtonLink to={`/offres/${item.id}/modifier`} variant="outline" size="sm">
                        <Pencil aria-hidden="true" /> Modifier
                      </ButtonLink>
                    )}
                    {item.status === "published" && (
                      <Button variant="outline" size="sm" disabled={busyId === item.id}
                        onClick={() => void run(item.id, () => setOpportunityStatus(item.id, "closed"))}>
                        <EyeOff aria-hidden="true" /> Clôturer
                      </Button>
                    )}
                    {item.status === "closed" && (
                      <Button variant="outline" size="sm" disabled={busyId === item.id}
                        onClick={() => void run(item.id, () => setOpportunityStatus(item.id, "published"))}>
                        <RotateCcw aria-hidden="true" /> Rouvrir
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" disabled={busyId === item.id}
                      onClick={() => {
                        if (window.confirm(`Supprimer définitivement « ${item.title} » ?`)) {
                          void run(item.id, () => deleteOpportunity(item.id));
                        }
                      }}>
                      <Trash2 aria-hidden="true" /> Supprimer
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
