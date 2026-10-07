import { useState, type FormEvent } from "react";
import { validateShare } from "../../lib/requestValidation";
import type { SharedContact } from "../../lib/requestRepository";
import { Button } from "../ui/Button";

type AcceptFormProps = {
  firstName: string;
  defaultEmail: string;
  busy: boolean;
  onConfirm: (share: SharedContact) => void;
  onCancel: () => void;
};

/** Shown before an acceptance is validated: the member decides what, if anything, to share. */
export function AcceptForm({ firstName, defaultEmail, busy, onConfirm, onCancel }: AcceptFormProps) {
  const [shareEmail, setShareEmail] = useState(true);
  const [email, setEmail] = useState(defaultEmail);
  const [sharePhone, setSharePhone] = useState(false);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validateShare({ shareEmail, email, sharePhone, phone });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    onConfirm({
      ...(result.email ? { email: result.email } : {}),
      ...(result.phone ? { phone: result.phone } : {}),
    });
  };

  return (
    <form className="request-accept" onSubmit={submit} noValidate>
      <fieldset disabled={busy}>
        <legend>Que souhaitez-vous partager avec {firstName} ?</legend>
        <p className="request-accept__hint">
          Ces informations ne seront visibles que par vous deux, dans « Demandes ». Elles ne sont pas
          ajoutées à votre profil.
        </p>

        <div className="request-accept__option">
          <label className="request-accept__check">
            <input type="checkbox" checked={shareEmail} onChange={(event) => setShareEmail(event.target.checked)} />
            <span>Mon adresse e-mail</span>
          </label>
          {shareEmail && (
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              aria-label="Adresse e-mail à partager"
              placeholder="vous@exemple.org"
            />
          )}
        </div>

        <div className="request-accept__option">
          <label className="request-accept__check">
            <input type="checkbox" checked={sharePhone} onChange={(event) => setSharePhone(event.target.checked)} />
            <span>Mon numéro WhatsApp <em>(facultatif)</em></span>
          </label>
          {sharePhone && (
            <>
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                autoComplete="tel"
                aria-label="Numéro WhatsApp à partager"
                aria-describedby="request-accept-phone-help"
                placeholder="+226 70 12 34 56"
              />
              <small id="request-accept-phone-help">Format international, avec l’indicatif du pays.</small>
            </>
          )}
        </div>

        {error && <p className="form-status form-status--error" role="alert">{error}</p>}

        <div className="request-accept__actions">
          <Button type="submit" size="sm" disabled={busy}>Confirmer l’acceptation</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Annuler</Button>
        </div>
      </fieldset>
    </form>
  );
}
