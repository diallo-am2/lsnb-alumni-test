import { toSafeProfileUrl } from "./profileLinks";

/**
 * Tiny, safe rich-text format for offer descriptions. Nothing is ever turned
 * into raw HTML: the parser returns a plain tree that React renders as elements.
 *
 * Supported: "## Titre" / "### Sous-titre", "- puce", "1. liste", **gras**,
 * *italique*, [texte](https://…) and bare https:// links. Blank line = new paragraph.
 */
export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "link"; href: string; text: string };

export type Block =
  | { type: "heading"; level: 2 | 3; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] };

const INLINE_PATTERN =
  /\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]{1,500})\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|(https:\/\/[^\s<>]*[^\s<>.,;:!?)\]'"»])/g;

export function parseInline(source: string, depth = 0): Inline[] {
  const nodes: Inline[] = [];
  let cursor = 0;
  const pushText = (text: string) => {
    if (text) nodes.push({ type: "text", text });
  };

  for (const match of source.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    pushText(source.slice(cursor, index));
    cursor = index + match[0].length;

    const [raw, linkText, linkUrl, bold, italic, bareUrl] = match;
    if (linkText !== undefined && linkUrl !== undefined) {
      const href = toSafeProfileUrl(linkUrl);
      if (href) nodes.push({ type: "link", href, text: linkText });
      else pushText(raw);
    } else if (bold !== undefined) {
      nodes.push({ type: "strong", children: depth < 2 ? parseInline(bold, depth + 1) : [{ type: "text", text: bold }] });
    } else if (italic !== undefined) {
      nodes.push({ type: "em", children: depth < 2 ? parseInline(italic, depth + 1) : [{ type: "text", text: italic }] });
    } else if (bareUrl !== undefined) {
      const href = toSafeProfileUrl(bareUrl);
      if (href) nodes.push({ type: "link", href, text: bareUrl });
      else pushText(raw);
    }
  }
  pushText(source.slice(cursor));
  return nodes;
}

export function parseRichText(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", children: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: "list", ordered: list.ordered, items: list.items.map((item) => parseInline(item)) });
    list = null;
  };

  for (const rawLine of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d{1,2}[.)]\s+(.+)$/.exec(line);

    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1]!.length >= 3 ? 3 : 2, children: parseInline(heading[2]!) });
    } else if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}
