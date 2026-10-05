import { BriefcaseBusiness, RotateCcw, Search, TriangleAlert } from "lucide-react";
import { Button, ButtonLink } from "../ui/Button";

export function LoadError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <div className="directory-empty directory-empty--error" role="alert">
      <TriangleAlert size={34} aria-hidden="true" />
      <h2>{title}</h2>
      <p>La connexion a échoué ou le service ne répond pas. Vos filtres sont conservés.</p>
      <Button onClick={onRetry}>
        <RotateCcw size={16} aria-hidden="true" /> Réessayer
      </Button>
    </div>
  );
}

export function OpportunitiesEmpty() {
  return (
    <div className="directory-empty directory-empty--new">
      <BriefcaseBusiness size={34} aria-hidden="true" />
      <h2>Aucune offre pour le moment.</h2>
      <p>Une bourse, un stage ou un emploi à partager ? Soyez le premier à publier.</p>
      <ButtonLink to="/offres/nouvelle" variant="outline">Publier une offre</ButtonLink>
    </div>
  );
}

export function OpportunitiesNoMatch({ onReset }: { onReset: () => void }) {
  return (
    <div className="directory-empty">
      <Search size={34} aria-hidden="true" />
      <h2>Aucune offre ne correspond à votre recherche.</h2>
      <p>Essayez un autre type, retirez un filtre ou incluez les offres expirées.</p>
      <Button variant="outline" onClick={onReset}>Voir toutes les offres</Button>
    </div>
  );
}
