import { CheckCircle2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { ButtonLink } from "../components/ui/Button";
import { formatLongDate } from "../lib/accountRepository";

export function AccountDeletedPage() {
  const [params] = useSearchParams();
  const parsed = new Date(params.get("date") ?? "");
  const date = Number.isNaN(parsed.getTime()) ? null : formatLongDate(parsed);

  return (
    <div className="auth-state-page account-page">
      <div className="page-shell account-deleted">
        <CheckCircle2 size={34} aria-hidden="true" />
        <p className="eyebrow eyebrow--dark">Compte désactivé</p>
        <h1>Votre suppression est programmée.</h1>
        <p>
          Votre profil n’est plus visible dans l’annuaire.
          {date ? <> Votre compte et vos données seront supprimés définitivement le <strong>{date}</strong>.</> : " Votre compte et vos données seront supprimés définitivement dans 30 jours."}
        </p>
        <p>Un e-mail de confirmation vous a été envoyé. Vous avez changé d’avis ? Reconnectez-vous avant cette date pour annuler.</p>
        <div className="account-deleted__actions">
          <ButtonLink to="/connexion?next=/espace/compte" variant="outline">Me reconnecter pour annuler</ButtonLink>
          <ButtonLink to="/" variant="quiet">Retour à l’accueil</ButtonLink>
        </div>
      </div>
    </div>
  );
}
