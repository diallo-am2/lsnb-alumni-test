/**
 * Formatting helpers behind the toolbar of the offer description. They only insert
 * the markers understood by lib/richText.ts ("## ", "- ", "1. ", "**", "*", links).
 * Pure functions: given the text and the selection, return the new text and selection.
 */
export type FormatAction = "bold" | "italic" | "heading" | "bullets" | "numbers" | "link";
export type EditResult = { value: string; selectionStart: number; selectionEnd: number };

function wrap(value: string, start: number, end: number, marker: string, placeholder: string): EditResult {
  const before = value.slice(0, start);
  const selected = value.slice(start, end);
  const after = value.slice(end);
  const single = marker === "*";

  // Same action twice = toggle off. For "*", do not mistake one half of "**bold**" for italics.
  const wrappedAround = single
    ? /(^|[^*])\*$/.test(before) && /^\*([^*]|$)/.test(after)
    : before.endsWith(marker) && after.startsWith(marker);
  if (selected && wrappedAround) {
    const text = before.slice(0, -marker.length) + selected + after.slice(marker.length);
    const from = start - marker.length;
    return { value: text, selectionStart: from, selectionEnd: from + selected.length };
  }
  const selectedWrapped = single
    ? /^\*[^*]/.test(selected) && /[^*]\*$/.test(selected)
    : selected.length >= marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker);
  if (selectedWrapped) {
    const inner = selected.slice(marker.length, selected.length - marker.length);
    return { value: before + inner + after, selectionStart: start, selectionEnd: start + inner.length };
  }

  const text = selected || placeholder;
  const from = start + marker.length;
  return { value: before + marker + text + marker + after, selectionStart: from, selectionEnd: from + text.length };
}

function mapLines(value: string, start: number, end: number, transform: (lines: string[]) => string[]): EditResult {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const reach = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const found = value.indexOf("\n", reach);
  const lineEnd = found === -1 ? value.length : found;
  const original = value.slice(lineStart, lineEnd);
  const block = transform(original.split("\n")).join("\n");
  const next = value.slice(0, lineStart) + block + value.slice(lineEnd);
  // On an empty line, leave the caret after the new marker so the member can type right away.
  const caretOnly = start === end && original.trim() === "";
  return { value: next, selectionStart: caretOnly ? lineStart + block.length : lineStart, selectionEnd: lineStart + block.length };
}

const LIST_OR_HEADING = /^(?:#{1,3}\s+|[-*]\s+|\d+\.\s+)/;

function prefixLines(lines: string[], prefix: (index: number) => string, already: RegExp) {
  const hasContent = lines.some((line) => line.trim() !== "");
  // Every line already has this marker: a second click removes it.
  if (hasContent && lines.filter((line) => line.trim() !== "").every((line) => already.test(line))) {
    return lines.map((line) => line.replace(already, ""));
  }
  let index = 0;
  return lines.map((line, position) => {
    // Blank lines stay blank, except when nothing is filled in: then the first line gets the marker.
    if (hasContent ? line.trim() === "" : position > 0) return line;
    return `${prefix(index++)}${line.replace(LIST_OR_HEADING, "")}`;
  });
}

export function applyFormat(
  action: FormatAction,
  value: string,
  start: number,
  end: number,
  maxLength: number,
): EditResult | null {
  let result: EditResult;
  switch (action) {
    case "bold":
      result = wrap(value, start, end, "**", "texte en gras");
      break;
    case "italic":
      result = wrap(value, start, end, "*", "texte en italique");
      break;
    case "heading":
      result = mapLines(value, start, end, (lines) => prefixLines(lines, () => "## ", /^##\s+/));
      break;
    case "bullets":
      result = mapLines(value, start, end, (lines) => prefixLines(lines, () => "- ", /^-\s+/));
      break;
    case "numbers":
      result = mapLines(value, start, end, (lines) => prefixLines(lines, (index) => `${index + 1}. `, /^\d+\.\s+/));
      break;
    case "link": {
      const selected = value.slice(start, end);
      const before = value.slice(0, start);
      const after = value.slice(end);
      if (/^https:\/\/\S+$/.test(selected)) {
        const text = `[lien](${selected})`;
        result = { value: before + text + after, selectionStart: start + 1, selectionEnd: start + 5 };
      } else if (selected) {
        const text = `[${selected}](https://)`;
        const urlStart = start + selected.length + 3;
        result = { value: before + text + after, selectionStart: urlStart, selectionEnd: urlStart + "https://".length };
      } else {
        const text = "[texte du lien](https://)";
        result = { value: before + text + after, selectionStart: start + 1, selectionEnd: start + 1 + "texte du lien".length };
      }
      break;
    }
  }
  return result.value.length > maxLength ? null : result;
}
