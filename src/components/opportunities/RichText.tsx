import { Fragment } from "react";
import { parseRichText, type Inline } from "../../lib/richText";

function renderInline(nodes: Inline[]) {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return <Fragment key={index}>{node.text}</Fragment>;
      case "strong":
        return <strong key={index}>{renderInline(node.children)}</strong>;
      case "em":
        return <em key={index}>{renderInline(node.children)}</em>;
      case "link":
        return (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer nofollow ugc">
            {node.text}
          </a>
        );
    }
  });
}

/** Renders the safe offer description format (see lib/richText.ts). Never injects raw HTML. */
export function RichText({ text }: { text: string }) {
  return (
    <div className="rich-text">
      {parseRichText(text).map((block, index) => {
        if (block.type === "heading") {
          const Tag = block.level === 2 ? "h3" : "h4";
          return <Tag key={index}>{renderInline(block.children)}</Tag>;
        }
        if (block.type === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag key={index}>
              {block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}
            </Tag>
          );
        }
        return <p key={index}>{renderInline(block.children)}</p>;
      })}
    </div>
  );
}
