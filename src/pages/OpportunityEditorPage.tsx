import { ArrowLeft, FileText, ImagePlus, LoaderCircle, Plus, Save, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { DescriptionEditor } from "../components/opportunities/DescriptionEditor";
import { LoadError } from "../components/opportunities/OpportunityStates";
import { Button, ButtonLink } from "../components/ui/Button";
import { COUNTRIES, findCountry } from "../data/countries";
import { DOMAIN_SUGGESTIONS } from "../data/domains";
import { opportunityKinds, type Opportunity, type OpportunityKind } from "../data/opportunities";
import { useRemoteData } from "../hooks/useRemoteData";
import { formatFileSize } from "../lib/fileSize";
import { prepareImage } from "../lib/imageResize";
import { loadOpportunity, saveOpportunity } from "../lib/opportunityRepository";
import {
  OPPORTUNITY_LIMITS,
  getOpportunityDocumentError,
  getOpportunityImageError,
  getOpportunityImageInputError,
  validateOpportunity,
  type OpportunityErrors,
  type OpportunityFormValues,
} from "../lib/opportunityValidation";
import { isSupabaseConfigured } from "../lib/supabase";

type Status = {
  kind: "idle" | "loading" | "error";
  message?: string;
  /** Files sent so far, shown as a progress bar while saving. */
  progress?: { done: number; total: number };
};
type PendingImage = { key: string; file: File; alt: string; preview: string };

const emptyValues: OpportunityFormValues = {
  title: "",
  organization: "",
  summary: "",
  description: "",
  country: "",
  city: "",
  domain: "",
  applyUrl: "",
  extraLinks: [],
  deadline: "",
};

function valuesFrom(opportunity: Opportunity | null): OpportunityFormValues {
  if (!opportunity) return emptyValues;
  return {
    title: opportunity.title,
    organization: opportunity.organization,
    summary: opportunity.summary,
    description: opportunity.description,
    country: opportunity.country ?? "",
    city: opportunity.city ?? "",
    domain: opportunity.domain ?? "",
    applyUrl: opportunity.applyUrl ?? "",
    extraLinks: opportunity.extraLinks.map((link) => ({ ...link })),
    deadline: opportunity.deadline ?? "",
  };
}

/** Create (/offres/nouvelle) or edit (/offres/:id/modifier) an offer. */
export function OpportunityEditorPage() {
  const { opportunityId } = useParams();
  const { user } = useAuth();
  const load = useCallback(
    () => (opportunityId ? loadOpportunity(opportunityId) : Promise.resolve(null)),
    [opportunityId],
  );
  const { data, state, retry } = useRemoteData(load);

  if (state === "loading") {
    return (
      <div className="auth-state-page" role="status">
        <LoaderCircle className="spin" aria-hidden="true" />
        <p>Chargement…</p>
      </div>
    );
  }
  if (state === "error") {
    return <div className="page-shell opp-detail"><LoadError title="Impossible de charger cette offre." onRetry={retry} /></div>;
  }
  if (opportunityId && (!data || data.authorId !== user?.id || data.status === "hidden")) {
    return (
      <div className="page-shell opp-detail">
        <div className="directory-empty">
          <h2>Offre introuvable ou non modifiable.</h2>
          <p>Seul l’auteur peut modifier une offre, et une offre masquée après signalement est verrouillée.</p>
          <ButtonLink to="/espace/offres" variant="outline">Mes offres</ButtonLink>
        </div>
      </div>
    );
  }
  return <OpportunityForm initial={data ?? null} userId={user?.id ?? ""} />;
}

function OpportunityForm({ initial, userId }: { initial: Opportunity | null; userId: string }) {
  const navigate = useNavigate();
  const isEdit = Boolean(initial);
  const [kind, setKind] = useState<OpportunityKind>(initial?.kind ?? "scholarship");
  const [isRemote, setIsRemote] = useState(initial?.isRemote ?? false);
  const [values, setValues] = useState<OpportunityFormValues>(() => valuesFrom(initial));
  const [errors, setErrors] = useState<OpportunityErrors>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const [existingImages, setExistingImages] = useState(initial?.images ?? []);
  const [removedMediaIds, setRemovedMediaIds] = useState<string[]>([]);
  const [newImages, setNewImages] = useState<PendingImage[]>([]);
  const [removeDocument, setRemoveDocument] = useState(false);
  const [newDocument, setNewDocument] = useState<File | null>(null);

  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const set = <Key extends keyof OpportunityFormValues>(key: Key, value: OpportunityFormValues[Key]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key as string]) return current;
      const { [key as string]: _removed, ...rest } = current;
      return rest;
    });
    setStatus({ kind: "idle" });
  };

  const imageCount = existingImages.length + newImages.length;
  const attachedDocument = initial?.document;

  const handleImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) return;
    let room = OPPORTUNITY_LIMITS.maxImages - imageCount;
    const accepted: PendingImage[] = [];
    let problem: string | null = null;
    setStatus({ kind: "loading", message: "Préparation des images…" });
    for (const original of files) {
      const inputError = getOpportunityImageInputError(original);
      if (inputError) {
        problem = `${original.name} : ${inputError}`;
        break;
      }
      if (room <= 0) {
        problem = `Maximum ${OPPORTUNITY_LIMITS.maxImages} images par offre.`;
        break;
      }
      // Big photos are shrunk here instead of being refused.
      const file = await prepareImage(original);
      const fileError = getOpportunityImageError(file);
      if (fileError) {
        problem = `${original.name} : ${fileError}`;
        break;
      }
      room -= 1;
      const preview = URL.createObjectURL(file);
      previews.current.push(preview);
      accepted.push({ key: crypto.randomUUID(), file, alt: "", preview });
    }
    if (accepted.length > 0) setNewImages((current) => [...current, ...accepted]);
    setStatus(problem ? { kind: "error", message: problem } : { kind: "idle" });
  };

  const handleDocument = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const error = getOpportunityDocumentError(file);
    if (error) return setStatus({ kind: "error", message: error });
    setNewDocument(file);
    // Choosing a file while one is attached means "replace it": the old one goes away on save.
    if (initial?.document) setRemoveDocument(true);
    setStatus({ kind: "idle" });
  };

  const updateLink = (index: number, field: "label" | "url", value: string) => {
    set("extraLinks", values.extraLinks.map((link, i) => (i === index ? { ...link, [field]: value } : link)));
    setErrors((current) => {
      const { [`link-${index}-${field}`]: _removed, ...rest } = current;
      return rest;
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isSupabaseConfigured) {
      return setStatus({ kind: "error", message: "Mode démonstration : la publication nécessite Supabase." });
    }

    const found = validateOpportunity(values, initial?.deadline ?? "", initial?.country ?? "");
    setErrors(found);
    const firstInvalid = Object.keys(found)[0];
    if (firstInvalid) {
      setStatus({ kind: "error", message: "Corrigez les champs signalés avant de publier." });
      document.getElementById(`opp-${firstInvalid}`)?.focus();
      return;
    }

    // Applicants plan around the deadline: gently check before publishing a scholarship without one
    // (only when creating: someone fixing a typo should not be asked again).
    if (!isEdit && kind === "scholarship" && !values.deadline && !window.confirm(
      "Aucune date limite n’est indiquée pour cette bourse. Les candidats en ont besoin pour s’organiser.\n\nPublier quand même ?",
    )) {
      document.getElementById("opp-deadline")?.focus();
      return;
    }

    const idleMessage = isEdit ? "Enregistrement…" : "Publication de l’offre…";
    setStatus({ kind: "loading", message: idleMessage });
    try {
      const removed = [...removedMediaIds];
      if (removeDocument && initial?.document) removed.push(initial.document.id);
      const id = await saveOpportunity(userId, {
        id: initial?.id,
        kind,
        values,
        isRemote,
        newImages: newImages.map(({ file, alt }) => ({ file, alt })),
        removedMediaIds: removed,
        newDocument,
        onProgress: ({ done, total }) =>
          setStatus({
            kind: "loading",
            message: total > 0 && done < total ? `Envoi du fichier ${done + 1} sur ${total}…` : idleMessage,
            ...(total > 0 ? { progress: { done, total } } : {}),
          }),
      });
      navigate(`/offres/${id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : (error as { message?: string })?.message;
      setStatus({ kind: "error", message: message || "L’enregistrement a échoué. Réessayez." });
    }
  };

  const fieldError = (key: string) => errors[key];
  const invalid = (key: string) => (errors[key] ? { "aria-invalid": true, "aria-describedby": `opp-${key}-error` } : {});
  const error = (key: string) =>
    errors[key] ? <small id={`opp-${key}-error`} className="field-error" role="alert">{errors[key]}</small> : null;

  return (
    <div className="account-page profile-editor-page opp-editor">
      <div className="page-shell account-page__grid profile-editor-page__grid">
        <aside className="account-story profile-editor-story">
          <Link to={isEdit ? `/offres/${initial?.id}` : "/offres"} className="back-link">
            <ArrowLeft size={17} aria-hidden="true" /> Retour
          </Link>
          <p className="eyebrow eyebrow--dark">{isEdit ? "Modifier l’offre" : "Nouvelle offre"}</p>
          <h1>Partagez une opportunité utile.</h1>
          <p>
            Votre offre est visible immédiatement par tous les membres connectés. Soyez précis :
            organisme, conditions, date limite et lien officiel.
          </p>

          <div className="opp-help">
            <h2>Une offre qui se lit bien</h2>
            <p>
              Le <b>résumé</b> apparaît dans la liste, la <b>description</b> sur la page de l’offre.
              Utilisez la barre au-dessus de la description pour les titres, les listes et les liens,
              puis vérifiez le résultat avec « Aperçu ».
            </p>
          </div>
          <div className="opp-help">
            <h2>Rester prudent</h2>
            <p>Ne demandez jamais d’argent aux candidats. Une offre signalée par trois membres est masquée automatiquement.</p>
          </div>
        </aside>

        <section className="account-form-wrap" aria-labelledby="opp-form-title">
          <div className="account-form-wrap__header">
            <p id="opp-form-title">{isEdit ? "Modifier mon offre" : "Publier une offre"}</p>
            <span>Visible par les membres connectés</span>
          </div>

          <form className="account-form" onSubmit={handleSubmit}>
            <section className="opp-section" aria-labelledby="opp-section-essential">
            <h2 id="opp-section-essential" className="opp-section__title">L’essentiel</h2>
            <label className="field-group">
              <span>Type d’offre</span>
              <select value={kind} onChange={(event) => setKind(event.target.value as OpportunityKind)}>
                {opportunityKinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>

            <label className={`field-group${fieldError("title") ? " field-group--invalid" : ""}`}>
              <span>Titre</span>
              <input id="opp-title" value={values.title} maxLength={OPPORTUNITY_LIMITS.title[1]}
                onChange={(event) => set("title", event.target.value)} {...invalid("title")} />
              {error("title")}
            </label>

            <label className={`field-group${fieldError("organization") ? " field-group--invalid" : ""}`}>
              <span>Organisme</span>
              <input id="opp-organization" value={values.organization} maxLength={OPPORTUNITY_LIMITS.organization[1]}
                onChange={(event) => set("organization", event.target.value)} {...invalid("organization")} />
              {error("organization")}
            </label>

            <label className={`field-group${fieldError("summary") ? " field-group--invalid" : ""}`}>
              <span>Résumé (affiché sur la carte)</span>
              <textarea id="opp-summary" rows={3} value={values.summary} maxLength={OPPORTUNITY_LIMITS.summary[1]}
                onChange={(event) => set("summary", event.target.value)} {...invalid("summary")} />
              <small>
                {values.summary.trim().length}/{OPPORTUNITY_LIMITS.summary[1]} — une ou deux phrases, affichées
                dans la liste des offres.
              </small>
              {error("summary")}
            </label>

            <div className={`field-group${fieldError("description") ? " field-group--invalid" : ""}`}>
              <span id="opp-description-label">Description détaillée</span>
              <DescriptionEditor id="opp-description" labelId="opp-description-label" value={values.description}
                maxLength={OPPORTUNITY_LIMITS.description[1]} invalid={Boolean(errors.description)}
                describedBy="opp-description-error" onChange={(next) => set("description", next)} />
              <small>
                {values.description.trim().length}/{OPPORTUNITY_LIMITS.description[1]} — conditions, public visé,
                pièces à fournir, étapes de sélection.
              </small>
              {error("description")}
            </div>
            </section>

            <section className="opp-section" aria-labelledby="opp-section-where">
            <h2 id="opp-section-where" className="opp-section__title">Où et quand</h2>
            <div className="form-row">
              <label className={`field-group${fieldError("country") ? " field-group--invalid" : ""}`}>
                <span>Pays (facultatif)</span>
                <input id="opp-country" list="opp-countries" autoComplete="off" value={values.country}
                  placeholder="Commencez à taper : Maroc, France…"
                  onChange={(event) => set("country", event.target.value)}
                  onBlur={() => {
                    // "morocco", "cote d'ivoire"… become the one canonical spelling.
                    const canonical = findCountry(values.country);
                    if (canonical && canonical !== values.country) set("country", canonical);
                  }}
                  {...invalid("country")} />
                <datalist id="opp-countries">{COUNTRIES.map((name) => <option key={name} value={name} />)}</datalist>
                {error("country")}
              </label>
              <label className="field-group">
                <span>Ville (facultatif)</span>
                <input id="opp-city" value={values.city} onChange={(event) => set("city", event.target.value)} />
              </label>
            </div>

            <div className="form-row">
              <label className="field-group">
                <span>Domaine (facultatif)</span>
                <input id="opp-domain" list="opp-domains" value={values.domain} maxLength={80}
                  onChange={(event) => set("domain", event.target.value)} placeholder="Choisissez ou saisissez un domaine" />
                <datalist id="opp-domains">{DOMAIN_SUGGESTIONS.map((name) => <option key={name} value={name} />)}</datalist>
              </label>
              <label className={`field-group${fieldError("deadline") ? " field-group--invalid" : ""}`}>
                <span>{kind === "scholarship" ? "Date limite (recommandée)" : "Date limite (facultatif)"}</span>
                <input id="opp-deadline" type="date" value={values.deadline}
                  onChange={(event) => set("deadline", event.target.value)} {...invalid("deadline")} />
                {kind === "scholarship" && !values.deadline && (
                  <small>Les candidats s’organisent autour de cette date : indiquez-la si elle existe.</small>
                )}
                {error("deadline")}
              </label>
            </div>

            <label className="form-check">
              <input type="checkbox" checked={isRemote} onChange={(event) => setIsRemote(event.target.checked)} />
              <span><b>Possible à distance</b> Télétravail ou candidature sans déplacement.</span>
            </label>

            </section>

            <section className="opp-section" aria-labelledby="opp-section-apply">
            <h2 id="opp-section-apply" className="opp-section__title">Pour postuler</h2>
            <label className={`field-group${fieldError("applyUrl") ? " field-group--invalid" : ""}`}>
              <span>Lien pour postuler (facultatif)</span>
              <input id="opp-applyUrl" type="text" inputMode="url" value={values.applyUrl}
                onChange={(event) => set("applyUrl", event.target.value)} placeholder="https://organisme.org/candidater"
                {...invalid("applyUrl")} />
              <small>Les membres peuvent aussi vous écrire depuis la page de l’offre.</small>
              {error("applyUrl")}
            </label>

            <fieldset className="opp-links-editor">
              <legend>Liens complémentaires ({values.extraLinks.length}/{OPPORTUNITY_LIMITS.maxLinks})</legend>
              {values.extraLinks.map((link, index) => (
                <div className="form-row opp-links-editor__row" key={index}>
                  <label className={`field-group${fieldError(`link-${index}-label`) ? " field-group--invalid" : ""}`}>
                    <span>Intitulé</span>
                    <input id={`opp-link-${index}-label`} value={link.label} maxLength={OPPORTUNITY_LIMITS.linkLabel}
                      onChange={(event) => updateLink(index, "label", event.target.value)} {...invalid(`link-${index}-label`)} />
                    {error(`link-${index}-label`)}
                  </label>
                  <label className={`field-group${fieldError(`link-${index}-url`) ? " field-group--invalid" : ""}`}>
                    <span>Adresse</span>
                    <input id={`opp-link-${index}-url`} type="text" inputMode="url" value={link.url} placeholder="https://…"
                      onChange={(event) => updateLink(index, "url", event.target.value)} {...invalid(`link-${index}-url`)} />
                    {error(`link-${index}-url`)}
                  </label>
                  <Button variant="ghost" size="sm" aria-label={`Retirer le lien ${index + 1}`}
                    onClick={() => set("extraLinks", values.extraLinks.filter((_, i) => i !== index))}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ))}
              {values.extraLinks.length < OPPORTUNITY_LIMITS.maxLinks && (
                <Button variant="outline" size="sm"
                  onClick={() => set("extraLinks", [...values.extraLinks, { label: "", url: "" }])}>
                  <Plus aria-hidden="true" /> Ajouter un lien
                </Button>
              )}
            </fieldset>

            </section>

            <section className="opp-section" aria-labelledby="opp-section-files">
            <h2 id="opp-section-files" className="opp-section__title">Fichiers joints (facultatif)</h2>
            <fieldset className="opp-media-editor">
              <legend>Images ({imageCount}/{OPPORTUNITY_LIMITS.maxImages}) — la première sert de couverture</legend>
              <ul className="opp-media-editor__grid">
                {existingImages.map((image) => (
                  <li key={image.id}>
                    {image.url ? <img src={image.url} alt={image.alt} /> : <span className="opp-media-editor__missing">Image</span>}
                    <button type="button" aria-label="Retirer cette image"
                      onClick={() => {
                        setExistingImages((current) => current.filter((item) => item.id !== image.id));
                        setRemovedMediaIds((current) => [...current, image.id]);
                      }}><X aria-hidden="true" /></button>
                  </li>
                ))}
                {newImages.map((image) => (
                  <li key={image.key}>
                    <img src={image.preview} alt="" />
                    <span className="opp-media-editor__size">{formatFileSize(image.file.size)}</span>
                    <input aria-label={`Description de ${image.file.name}`} placeholder="Description (accessibilité)"
                      value={image.alt} maxLength={200}
                      onChange={(event) => setNewImages((current) =>
                        current.map((item) => (item.key === image.key ? { ...item, alt: event.target.value } : item)))} />
                    <button type="button" aria-label="Retirer cette image"
                      onClick={() => setNewImages((current) => current.filter((item) => item.key !== image.key))}>
                      <X aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
              {imageCount < OPPORTUNITY_LIMITS.maxImages && (
                <label className="button button--outline button--sm opp-file-button">
                  <ImagePlus aria-hidden="true" /> Ajouter des images
                  <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => void handleImages(event)} />
                </label>
              )}
              <small>PNG, JPG ou WebP. Les grandes photos sont réduites automatiquement avant l’envoi.</small>
            </fieldset>

            <fieldset className="opp-media-editor">
              <legend>Document PDF (facultatif)</legend>
              {attachedDocument && !removeDocument && (
                <p className="opp-media-editor__doc">
                  <FileText aria-hidden="true" />
                  {attachedDocument.url ? (
                    <a href={attachedDocument.url} target="_blank" rel="noopener noreferrer">{attachedDocument.name}</a>
                  ) : (
                    <span>{attachedDocument.name}</span>
                  )}
                  <label className="button button--outline button--sm opp-file-button">
                    Remplacer
                    <input type="file" accept="application/pdf" onChange={handleDocument} />
                  </label>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRemoveDocument(true)}>Retirer</Button>
                </p>
              )}
              {newDocument && (
                <p className="opp-media-editor__doc">
                  <FileText aria-hidden="true" />
                  <span>
                    {newDocument.name} <em>({formatFileSize(newDocument.size)})</em>
                    {attachedDocument && <> — remplacera « {attachedDocument.name} »</>}
                  </span>
                  <Button type="button" variant="ghost" size="sm"
                    onClick={() => {
                      setNewDocument(null);
                      setRemoveDocument(false);
                    }}>
                    {attachedDocument ? "Annuler le remplacement" : "Retirer"}
                  </Button>
                </p>
              )}
              {attachedDocument && removeDocument && !newDocument && (
                <p className="opp-media-editor__doc">
                  <FileText aria-hidden="true" />
                  <span>« {attachedDocument.name} » sera retiré à l’enregistrement.</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRemoveDocument(false)}>Annuler</Button>
                </p>
              )}
              {(!attachedDocument || removeDocument) && !newDocument && (
                <label className="button button--outline button--sm opp-file-button">
                  <FileText aria-hidden="true" /> {attachedDocument ? "Joindre un autre PDF" : "Joindre un PDF"}
                  <input type="file" accept="application/pdf" onChange={handleDocument} />
                </label>
              )}
              <small>Un seul PDF, 8 Mo maximum (dossier de candidature, cahier des charges…).</small>
            </fieldset>

            </section>

            {status.kind !== "idle" && status.message && (
              <div className={`form-status form-status--${status.kind}`} role="status">
                {status.kind === "loading" && <LoaderCircle className="spin" aria-hidden="true" />}
                {status.message}
                {status.progress && (
                  <progress className="opp-progress" max={status.progress.total} value={status.progress.done}
                    aria-label="Progression de l’envoi des fichiers" />
                )}
              </div>
            )}

            <div className="profile-editor-actions">
              <ButtonLink to={isEdit ? `/offres/${initial?.id}` : "/offres"} size="lg" variant="outline">Annuler</ButtonLink>
              <Button type="submit" size="lg" disabled={status.kind === "loading"}>
                <Save aria-hidden="true" />
                {status.kind === "loading" ? "Patientez…" : isEdit ? "Enregistrer" : "Publier l’offre"}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
