import { Bold, Heading2, Italic, Link2, List, ListOrdered } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../../lib/cn";
import { applyFormat, type FormatAction } from "../../lib/richTextEditing";
import { RichText } from "./RichText";

type DescriptionEditorProps = {
  id: string;
  labelId: string;
  value: string;
  maxLength: number;
  invalid?: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
};

const TOOLS: { action: FormatAction; label: string; hint: string; Icon: typeof Bold }[] = [
  { action: "heading", label: "Titre de section", hint: "Titre de section", Icon: Heading2 },
  { action: "bold", label: "Gras", hint: "Gras (Ctrl+B)", Icon: Bold },
  { action: "italic", label: "Italique", hint: "Italique (Ctrl+I)", Icon: Italic },
  { action: "bullets", label: "Liste à puces", hint: "Liste à puces", Icon: List },
  { action: "numbers", label: "Liste numérotée", hint: "Liste numérotée", Icon: ListOrdered },
  { action: "link", label: "Lien", hint: "Lien (https://…)", Icon: Link2 },
];

/** Description field with a formatting toolbar and a live preview. Same safe format as the offer page. */
export function DescriptionEditor({ id, labelId, value, maxLength, invalid, describedBy, onChange }: DescriptionEditorProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  const format = (action: FormatAction) => {
    const textarea = area.current;
    if (!textarea) return;
    const result = applyFormat(action, value, textarea.selectionStart, textarea.selectionEnd, maxLength);
    if (!result) return;
    onChange(result.value);
    // The new text is rendered on the next frame: restore the selection once it is there.
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  };

  const shortcut = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "b" || key === "i") {
      event.preventDefault();
      format(key === "b" ? "bold" : "italic");
    }
  };

  return (
    <div className="opp-editor-field">
      <div className="opp-format">
        <div className="opp-format__tools" role="toolbar" aria-label="Mise en forme de la description" aria-controls={id}>
          {TOOLS.map(({ action, label, hint, Icon }) => (
            <button key={action} type="button" aria-label={label} title={hint} disabled={preview}
              onClick={() => format(action)}>
              <Icon size={17} aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="opp-format__modes" role="group" aria-label="Affichage">
          <button type="button" className={cn(!preview && "is-active")} aria-pressed={!preview} onClick={() => setPreview(false)}>
            Écrire
          </button>
          <button type="button" className={cn(preview && "is-active")} aria-pressed={preview} onClick={() => setPreview(true)}>
            Aperçu
          </button>
        </div>
      </div>

      {preview ? (
        <div className="opp-preview" aria-label="Aperçu de la description" tabIndex={0}>
          {value.trim() ? <RichText text={value} /> : <p className="opp-preview__empty">Rien à prévisualiser pour l’instant.</p>}
        </div>
      ) : (
        <textarea
          ref={area}
          id={id}
          rows={12}
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={shortcut}
          aria-labelledby={labelId}
          {...(invalid ? { "aria-invalid": true } : {})}
          {...(describedBy ? { "aria-describedby": describedBy } : {})}
        />
      )}
    </div>
  );
}
