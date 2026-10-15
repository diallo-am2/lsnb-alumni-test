import { ArrowLeft, Check, LoaderCircle, LockKeyhole } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { getAuthCallbackUrl } from "../lib/auth";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

type Status = { kind: "idle" | "loading" | "success" | "error"; message?: string };

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status.kind === "loading") return;
    setStatus({ kind: "loading" });

    if (!supabase || !isSupabaseConfigured) {
      setStatus({
        kind: "error",
        message: "La récupération du mot de passe nécessite une connexion à Supabase.",
      });
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: getAuthCallbackUrl(),
    });
    setStatus(error
      ? { kind: "error", message: "Impossible d’envoyer l’e-mail. Vérifiez l’adresse et réessayez." }
      : { kind: "success", message: "Si un compte correspond à cette adresse, un lien de réinitialisation vient d’être envoyé." });
  };

  return (
    <div className="auth-state-page account-page">
      <div className="page-shell account-form-wrap">
        <Link to="/connexion" className="back-link"><ArrowLeft size={17} aria-hidden="true" /> Retour à la connexion</Link>
        <p className="eyebrow eyebrow--dark">Accès au compte</p>
        <h1>Réinitialiser votre mot de passe.</h1>
        <p>Indiquez l’adresse utilisée pour votre compte. Le lien reçu ne peut être utilisé qu’une seule fois.</p>
        <form className="account-form" onSubmit={submit}>
          <label className="field-group">
            <span>Adresse e-mail</span>
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          {status.message && (
            <div className={`form-status form-status--${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>
              {status.kind === "success" ? <Check aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
              {status.message}
            </div>
          )}
          <Button type="submit" size="lg" disabled={status.kind === "loading"}>
            {status.kind === "loading" && <LoaderCircle className="spin" aria-hidden="true" />}
            Envoyer le lien
          </Button>
        </form>
      </div>
    </div>
  );
}
