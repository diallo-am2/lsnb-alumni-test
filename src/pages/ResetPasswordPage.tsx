import { ArrowLeft, Check, LoaderCircle, LockKeyhole } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { supabase } from "../lib/supabase";

type Status = { kind: "idle" | "loading" | "success" | "error"; message?: string };

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status.kind === "loading") return;
    if (password.length < 8) {
      setStatus({ kind: "error", message: "Le mot de passe doit contenir au moins 8 caractères." });
      return;
    }
    if (password !== confirmation) {
      setStatus({ kind: "error", message: "Les deux mots de passe ne correspondent pas." });
      return;
    }
    if (!supabase) {
      setStatus({ kind: "error", message: "La récupération du mot de passe n’est pas configurée." });
      return;
    }

    setStatus({ kind: "loading" });
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setStatus({ kind: "error", message: "Ce lien est expiré ou a déjà été utilisé. Demandez un nouveau lien." });
      return;
    }

    setStatus({ kind: "success", message: "Votre mot de passe a été mis à jour. Vous allez être redirigé vers la connexion." });
    await supabase.auth.signOut();
    window.setTimeout(() => navigate("/connexion", { replace: true }), 1200);
  };

  return (
    <div className="auth-state-page account-page">
      <div className="page-shell account-form-wrap">
        <Link to="/connexion" className="back-link"><ArrowLeft size={17} aria-hidden="true" /> Retour à la connexion</Link>
        <p className="eyebrow eyebrow--dark">Accès au compte</p>
        <h1>Choisir un nouveau mot de passe.</h1>
        <p>Utilisez au moins 8 caractères. Ce lien de réinitialisation ne peut être utilisé qu’une seule fois.</p>
        <form className="account-form" onSubmit={submit}>
          <label className="field-group">
            <span>Nouveau mot de passe</span>
            <input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          <label className="field-group">
            <span>Confirmer le mot de passe</span>
            <input type="password" autoComplete="new-password" minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
          </label>
          {status.message && (
            <div className={`form-status form-status--${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>
              {status.kind === "success" ? <Check aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
              {status.message}
            </div>
          )}
          <Button type="submit" size="lg" disabled={status.kind === "loading" || status.kind === "success"}>
            {status.kind === "loading" && <LoaderCircle className="spin" aria-hidden="true" />}
            Enregistrer le nouveau mot de passe
          </Button>
        </form>
      </div>
    </div>
  );
}
