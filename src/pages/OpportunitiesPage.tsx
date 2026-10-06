import { Plus, Search } from "lucide-react";
import { useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DirectoryLoading } from "../components/directory/DirectoryStates";
import { OpportunityCard } from "../components/opportunities/OpportunityCard";
import {
  LoadError,
  OpportunitiesEmpty,
  OpportunitiesNoMatch,
} from "../components/opportunities/OpportunityStates";
import { ButtonLink } from "../components/ui/Button";
import { opportunityKinds, opportunityLocation, type OpportunityKind } from "../data/opportunities";
import { useRemoteData } from "../hooks/useRemoteData";
import { loadOpportunities } from "../lib/opportunityRepository";

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function OpportunitiesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const kind = (searchParams.get("type") ?? "") as OpportunityKind | "";
  const country = searchParams.get("pays") ?? "";
  const remoteOnly = searchParams.get("distance") === "true";
  const includeExpired = searchParams.get("expirees") === "true";

  const load = useCallback(() => loadOpportunities({ includeExpired }), [includeExpired]);
  const { data, state, retry } = useRemoteData(load);
  const opportunities = useMemo(() => data ?? [], [data]);

  const updateFilter = (key: string, value: string | boolean) => {
    const next = new URLSearchParams(searchParams);
    if (typeof value === "boolean") value ? next.set(key, "true") : next.delete(key);
    else if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const countries = useMemo(
    () => [...new Set(opportunities.map((item) => item.country).filter((item): item is string => Boolean(item)))].sort(),
    [opportunities],
  );

  const filtered = useMemo(() => {
    const needle = normalize(query.trim());
    return opportunities.filter((item) => {
      const searchable = normalize(
        [item.title, item.organization, item.summary, item.domain ?? "", opportunityLocation(item)].join(" "),
      );
      return (
        (!needle || searchable.includes(needle)) &&
        (!kind || item.kind === kind) &&
        (!country || item.country === country) &&
        (!remoteOnly || item.isRemote)
      );
    });
  }, [country, kind, opportunities, query, remoteOnly]);

  const hasFilters = Boolean(query || kind || country || remoteOnly || includeExpired);

  return (
    <div className="directory-page opportunities-page">
      <header className="directory-hero">
        <div className="page-shell directory-hero__inner">
          <div className="directory-hero__copy">
            <p className="eyebrow">Offres LSNB</p>
            <h1>Bourses, stages, emplois :<br />ce que le réseau partage.</h1>
            <p className="directory-hero__lede">
              Les offres sont publiées par les membres, pour les membres. Vérifiez toujours
              l’organisme avant de postuler et signalez toute offre douteuse.
            </p>
            <ButtonLink to="/offres/nouvelle" variant="light" size="lg">
              <Plus aria-hidden="true" /> Publier une offre
            </ButtonLink>
          </div>
        </div>
      </header>

      <section className="page-shell directory-content" aria-label="Offres du réseau">
        <aside className="directory-filters" aria-label="Filtres de recherche">
          <div className="directory-filters__title">
            <h2>Affiner les offres.</h2>
            <p><Link to="/espace/offres">Voir mes offres</Link></p>
          </div>

          <div className="directory-filters__controls">
            <label className="directory-filter-field directory-filter-field--search">
              <span>Mot-clé</span>
              <span className="input-with-icon">
                <Search size={18} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  placeholder="Ex. master, énergie, Rabat…"
                  onChange={(event) => updateFilter("q", event.target.value)}
                />
              </span>
            </label>

            <label className="directory-filter-field">
              <span>Type</span>
              <select value={kind} onChange={(event) => updateFilter("type", event.target.value)}>
                <option value="">Tous les types</option>
                {opportunityKinds.map((item) => <option key={item.value} value={item.value}>{item.plural}</option>)}
              </select>
            </label>

            <label className="directory-filter-field">
              <span>Pays</span>
              <select value={country} onChange={(event) => updateFilter("pays", event.target.value)}>
                <option value="">Tous les pays</option>
                {countries.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>

            <label className="directory-filter-switch">
              <input type="checkbox" checked={remoteOnly} onChange={(event) => updateFilter("distance", event.target.checked)} />
              <span>À distance uniquement</span>
            </label>

            <label className="directory-filter-switch">
              <input type="checkbox" checked={includeExpired} onChange={(event) => updateFilter("expirees", event.target.checked)} />
              <span>Inclure les offres expirées</span>
            </label>
          </div>
        </aside>

        <div className="directory-results" aria-busy={state === "loading"}>
          <div className="directory-results__bar">
            <p role="status" aria-live="polite">
              {state === "loading" && "Chargement des offres…"}
              {state === "error" && "Offres indisponibles"}
              {state === "ready" && (
                <>
                  <b>{filtered.length}</b> offre{filtered.length > 1 ? "s" : ""} trouvée{filtered.length > 1 ? "s" : ""}
                </>
              )}
            </p>
            {state === "ready" && opportunities.some((item) => item.isDemo) && <span>Offres fictives · démonstration</span>}
          </div>

          {state === "loading" && <DirectoryLoading />}
          {state === "error" && <LoadError title="Impossible de charger les offres." onRetry={retry} />}
          {state === "ready" && opportunities.length === 0 && !hasFilters && <OpportunitiesEmpty />}
          {state === "ready" && opportunities.length === 0 && hasFilters && (
            <OpportunitiesNoMatch onReset={() => setSearchParams({})} />
          )}
          {state === "ready" && opportunities.length > 0 && filtered.length === 0 && (
            <OpportunitiesNoMatch onReset={() => setSearchParams({})} />
          )}
          {state === "ready" && filtered.length > 0 && (
            <div className="directory-grid">
              {filtered.map((item) => <OpportunityCard key={item.id} opportunity={item} />)}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
