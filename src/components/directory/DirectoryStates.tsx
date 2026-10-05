import { RotateCcw, Search, TriangleAlert, Users } from "lucide-react";
import { Button, ButtonLink } from "../ui/Button";

const SKELETON_CARDS = 6;

/** Placeholder cards shown while the profiles are being fetched. */
export function DirectoryLoading() {
  return (
    <div className="directory-grid directory-grid--loading" aria-hidden="true">
      {Array.from({ length: SKELETON_CARDS }, (_, index) => (
        <div className="directory-skeleton" key={index}>
          <div className="directory-skeleton__top">
            <i className="directory-skeleton__avatar" />
            <i className="directory-skeleton__line directory-skeleton__line--short" />
          </div>
          <div className="directory-skeleton__body">
            <i className="directory-skeleton__line directory-skeleton__line--tiny" />
            <i className="directory-skeleton__line directory-skeleton__line--title" />
            <i className="directory-skeleton__line" />
            <i className="directory-skeleton__line directory-skeleton__line--short" />
          </div>
          <i className="directory-skeleton__line directory-skeleton__line--footer" />
        </div>
      ))}
    </div>
  );
}

/** Shown when the request fails (network or Supabase error). */
export function DirectoryError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="directory-empty directory-empty--error" role="alert">
      <TriangleAlert size={34} aria-hidden="true" />
      <h2>Impossible de charger l’annuaire.</h2>
      <p>La connexion a échoué ou le service ne répond pas. Vos filtres sont conservés.</p>
      <Button onClick={onRetry}>
        <RotateCcw size={16} aria-hidden="true" /> Réessayer
      </Button>
    </div>
  );
}

/** Shown when the directory itself has no profile yet. */
export function DirectoryEmpty() {
  return (
    <div className="directory-empty directory-empty--new">
      <Users size={34} aria-hidden="true" />
      <h2>L’annuaire est encore vide.</h2>
      <p>Les premiers profils apparaîtront ici dès que des membres auront créé le leur.</p>
      <ButtonLink to="/rejoindre" variant="outline">Créer mon profil</ButtonLink>
    </div>
  );
}

/** Shown when profiles exist but none matches the current search or filters. */
export function DirectoryNoMatch({ onReset }: { onReset: () => void }) {
  return (
    <div className="directory-empty">
      <Search size={34} aria-hidden="true" />
      <h2>Aucun membre ne correspond à votre recherche.</h2>
      <p>Essayez une spécialité plus large ou retirez un filtre.</p>
      <Button variant="outline" onClick={onReset}>
        Voir tous les profils
      </Button>
    </div>
  );
}
