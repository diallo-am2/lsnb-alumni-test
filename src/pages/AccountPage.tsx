import { ArrowLeft, CalendarClock, Check, LoaderCircle, LogOut, UserRoundX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../components/ui/Button";
import { cancelAccountDeletion, DELETION_GRACE_DAYS, formatLongDate, loadDeletionRequestedAt, notifyAccountDeletion, purgeDateFor, requestAccountDeletion } from "../lib/accountRepository";
import { supabase } from "../lib/supabase";

type LoadState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; requestedAt: string | null };

export function AccountPage() {
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState<"delete" | "cancel" | "signout" | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string }>();
  const [dialogError, setDialogError] = useState<string>();
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setState({ kind: "loading" });
    loadDeletionRequestedAt(userId)
      .then((requestedAt) => { if (active) setState({ kind: "ready", requestedAt }); })
      .catch(() => { if (active) setState({ kind: "error" }); });
    return () => { active = false; };
  }, [userId, reloadKey]);

  const confirmDeletion = async () => {
    if (busy) return;
    setBusy("delete");
    setDialogError(undefined);
    try {
      const requestedAt = await requestAccountDeletion();
      await notifyAccountDeletion();
      navigate(`/compte-supprime?date=${encodeURIComponent(purgeDateFor(requestedAt).toISOString())}`, { replace: true });
      await supabase?.auth.signOut();
    } catch {
      setDialogError("La demande n’a pas pu être enregistrée. Réessayez dans un instant.");
      setBusy(null);
    }
  };

  const cancelDeletion = async () => {
    if (busy) return;
    setBusy("cancel");
    setMessage(undefined);
    try {
      await cancelAccountDeletion();
      await refreshProfile();
      setState({ kind: "ready", requestedAt: null });
      setMessage({ kind: "success", text: "Suppression annulée. Votre profil est de nouveau visible dans l’annuaire." });
    } catch {
      setMessage({ kind: "error", text: "L’annulation n’a pas pu être enregistrée. Réessayez." });
    }
    setBusy(null);
  };

  const signOut = async () => {
    setBusy("signout");
    await supabase?.auth.signOut();
    navigate("/", { replace: true });
  };

  if (state.kind === "loading") return <div className="auth-state-page" role="status"><LoaderCircle className="spin" aria-hidden="true" /><p>Chargement de votre compte…</p></div>;
  if (state.kind === "error") return <div className="auth-state-page" role="alert"><p>Impossible de charger l’état de votre compte.</p><Button onClick={() => setReloadKey((key) => key + 1)}>Réessayer</Button></div>;

  const pendingDate = state.requestedAt ? formatLongDate(purgeDateFor(state.requestedAt)) : null;
  return (
    <div className="account-settings-page">
      <div className="page-shell account-settings">
        {!pendingDate && <Link to="/espace" className="back-link"><ArrowLeft size={17} aria-hidden="true" /> Retour à mon espace</Link>}
        <p className="eyebrow eyebrow--dark">Compte et données</p>
        <h1>{pendingDate ? "Suppression programmée." : "Mon compte."}</h1>
        {message && <div className={`form-status form-status--${message.kind}`} role={message.kind === "error" ? "alert" : "status"}><Check aria-hidden="true" /> {message.text}</div>}
        {pendingDate ? (
          <section className="account-card account-card--pending" aria-labelledby="account-pending-title">
            <h2 id="account-pending-title"><CalendarClock size={20} aria-hidden="true" /> Votre compte sera supprimé le {pendingDate}</h2>
            <p>Votre profil n’apparaît plus dans l’annuaire. À cette date, votre compte, vos demandes, vos offres et vos fichiers seront effacés définitivement.</p>
            <p>Vous pouvez tout annuler jusque-là : votre profil redevient visible. Votre proposition de mentorat avait été retirée, vous pourrez la réactiver dans « Modifier mon profil ».</p>
            <div className="account-card__actions">
              <Button onClick={() => void cancelDeletion()} disabled={busy !== null}>{busy === "cancel" && <LoaderCircle className="spin" aria-hidden="true" />} Annuler la suppression</Button>
              <Button variant="quiet" onClick={() => void signOut()} disabled={busy !== null}><LogOut aria-hidden="true" /> Se déconnecter</Button>
            </div>
          </section>
        ) : (
          <section className="account-card" aria-labelledby="account-delete-title">
            <h2 id="account-delete-title">Supprimer mon compte</h2>
            <p>Votre profil disparaît tout de suite de l’annuaire. Vos données sont effacées définitivement après {DELETION_GRACE_DAYS} jours, et vous pouvez annuler pendant ce délai.</p>
            <Button variant="quiet" onClick={() => { setDialogError(undefined); dialogRef.current?.showModal(); }}><UserRoundX aria-hidden="true" /> Supprimer mon compte…</Button>
          </section>
        )}
      </div>
      <dialog ref={dialogRef} className="confirm-dialog" aria-labelledby="confirm-deletion-title" onCancel={(event) => { if (busy) event.preventDefault(); }}>
        <div className="confirm-dialog__body">
          <h2 id="confirm-deletion-title">Supprimer votre compte ?</h2>
          <ul>
            <li>Votre profil est masqué de l’annuaire immédiatement, et vous êtes déconnecté.</li>
            <li>Votre compte, vos demandes, vos offres et vos fichiers seront effacés définitivement dans 30 jours.</li>
            <li>Jusqu’à cette date, il vous suffit de vous reconnecter pour annuler.</li>
          </ul>
          {dialogError && <p className="form-status form-status--error" role="alert">{dialogError}</p>}
          <div className="confirm-dialog__actions">
            <Button variant="quiet" onClick={() => dialogRef.current?.close()} disabled={busy !== null}>Garder mon compte</Button>
            <Button variant="danger" onClick={() => void confirmDeletion()} disabled={busy !== null}>{busy === "delete" && <LoaderCircle className="spin" aria-hidden="true" />} Supprimer mon compte</Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
