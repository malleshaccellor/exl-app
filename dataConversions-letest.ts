import type { Descendant } from "slate";
import type { CustomText } from "../types";

// ─── Slate → HTML ────────────────────────────────────────────────────────────

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/** Build a style attribute string from a Slate block element node */
const buildStyleAttr = (el: any): string => {
  const props: string[] = [];
  if (el.align && el.align !== "left") props.push(`text-align:${el.align}`);
  if (el.indent) props.push(`padding-left:${el.indent * 24}px`);
  if (el.fontSize) props.push(`font-size:${el.fontSize}px`);
  return props.length > 0 ? ` style="${props.join(";")}"` : "";
};

/** Serialize a single leaf (text node) with inline marks → HTML */
const serializeLeaf = (leaf: CustomText, escape = true): string => {
  let html = escape ? escapeHtml(leaf.text) : leaf.text;
  if (leaf.code) html = `<code>${html}</code>`;
  if (leaf.italic) html = `<em>${html}</em>`;
  if (leaf.bold) html = `<strong>${html}</strong>`;
  if (leaf.underline) html = `<u>${html}</u>`;
  if (leaf.strikethrough) html = `<s>${html}</s>`;
  return html;
};

const FULL_TAG_MAP: Record<string, string> = {
  "heading-one": "h1",
  "heading-two": "h2",
  "heading-three": "h3",
  "heading-four": "h4",
  "heading-five": "h5",
  "heading-six": "h6",
  "block-quote": "blockquote",
  "numbered-list": "ol",
  "bulleted-list": "ul",
  "list-item": "li",
  paragraph: "p",
};

/** Full recursive serializer — preserves ALL block formatting (align, indent, fontSize) */
const serializeNode = (node: Descendant): string => {
  if ("text" in node) return serializeLeaf(node as CustomText);

  const el = node as any;
  const children = (el.children || [])
    .map((child: Descendant) => serializeNode(child))
    .join("");
  const styleAttr = buildStyleAttr(el);
  const tag = FULL_TAG_MAP[el.type];

  if (tag) return `<${tag}${styleAttr}>${children}</${tag}>`;

  switch (el.type) {
    case "code-block":
      return `<pre${styleAttr}><code>${children}</code></pre>`;
    case "table":
      return `<table${styleAttr}>${children}</table>`;
    case "table-row":
      return `<tr${styleAttr}>${children}</tr>`;
    case "table-cell-header":
      return `<th${styleAttr}>${children}</th>`;
    case "table-cell":
      return (el.isHeader)
        ? `<th${styleAttr}>${children}</th>`
        : `<td${styleAttr}>${children}</td>`;
    default:
      return styleAttr ? `<div${styleAttr}>${children}</div>` : children;
  }
};

export const slateToHtml = (nodes: Descendant[]): string =>
  nodes.map((node) => serializeNode(node)).join("\n");

// ─── Inline-only serializer (no escaping, for BRD round-trip) ────────────────

export const leafToHtml = (leaf: CustomText): string =>
  serializeLeaf(leaf, false);

/**
 * nodeToHtml — used by cellToHtml / cellToHtmlArray.
 * Serializes a node with full inline marks AND block styles preserved.
 */
export const nodeToHtml = (node: Descendant): string => {
  if ("text" in node) return leafToHtml(node as CustomText);

  const el = node as any;
  const inner = (el.children || [])
    .map((child: Descendant) => nodeToHtml(child))
    .join("");
  const styleAttr = buildStyleAttr(el);
  const tag = FULL_TAG_MAP[el.type];

  if (tag) return `<${tag}${styleAttr}>${inner}</${tag}>`;

  switch (el.type) {
    case "code-block":
      return `<pre${styleAttr}><code>${inner}</code></pre>`;
    case "table":
      return `<table${styleAttr}>${inner}</table>`;
    case "table-row":
      return `<tr${styleAttr}>${inner}</tr>`;
    case "table-cell-header":
      return `<th${styleAttr}>${inner}</th>`;
    case "table-cell":
      return (el.isHeader)
        ? `<th${styleAttr}>${inner}</th>`
        : `<td${styleAttr}>${inner}</td>`;
    default:
      return styleAttr ? `<div${styleAttr}>${inner}</div>` : inner;
  }
};

export const cellToHtml = (cell: { children?: Descendant[] }): string =>
  (cell.children || []).map((child: Descendant) => nodeToHtml(child)).join("\n");

export const cellToHtmlArray = (cell: { children?: Descendant[] }): string[] =>
  (cell.children || [])
    .map((child: Descendant) => nodeToHtml(child))
    .filter((t: string) => t.trim().length > 0);

// ─── HTML → Slate ─────────────────────────────────────────────────────────────

/** htmlToLeaves: extracts inline marks only (used by parseInlineHtml in BRD builder) */
export const htmlToLeaves = (html: string): CustomText[] => {
  if (!html || html.trim() === "") return [{ text: "" }];

  const leaves: CustomText[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const walk = (node: Node, marks: Partial<CustomText>) => {
    if (node.nodeType === 3) {
      const text = node.textContent;
      if (text) leaves.push({ text, ...marks } as CustomText);
      return;
    }
    if (node.nodeType === 1) {
      const newMarks = { ...marks };
      const tag = (node as Element).tagName.toLowerCase();
      if (tag === "strong" || tag === "b") newMarks.bold = true;
      if (tag === "em" || tag === "i") newMarks.italic = true;
      if (tag === "u") newMarks.underline = true;
      if (tag === "code") newMarks.code = true;
      if (tag === "s") newMarks.strikethrough = true;
      for (const child of Array.from(node.childNodes)) walk(child, newMarks);
    }
  };

  for (const child of Array.from(doc.body.childNodes)) walk(child, {});
  return leaves.length > 0 ? leaves : [{ text: "" }];
};

// Full HTML tag → Slate type map (for deserialize)
const HTML_TAG_TO_SLATE: Record<string, string> = {
  h1: "heading-one",
  h2: "heading-two",
  h3: "heading-three",
  h4: "heading-four",
  h5: "heading-five",
  h6: "heading-six",
  blockquote: "block-quote",
  ol: "numbered-list",
  ul: "bulleted-list",
  li: "list-item",
  p: "paragraph",
  pre: "code-block",
  table: "table",
  tr: "table-row",
  td: "table-cell",
  th: "table-cell-header",
};

/** Extract block formatting props from an HTML element's inline styles */
const extractBlockProps = (el: HTMLElement): Record<string, any> => {
  const props: Record<string, any> = {};
  if (el.style.textAlign) props.align = el.style.textAlign;
  if (el.style.paddingLeft) {
    const px = parseInt(el.style.paddingLeft, 10);
    if (!isNaN(px)) props.indent = Math.round(px / 24);
  }
  if (el.style.fontSize) {
    const size = parseInt(el.style.fontSize, 10);
    if (!isNaN(size)) props.fontSize = String(size);
  }
  return props;
};

const INLINE_TAGS = new Set(["strong", "b", "em", "i", "u", "s", "del", "code", "span"]);

const deserialize = (domNode: Node, marks: Partial<CustomText> = {}): any[] => {
  if (domNode.nodeType === 3) {
    const text = domNode.textContent || "";
    return text ? [{ text, ...marks }] : [];
  }
  if (domNode.nodeType !== 1) return [];

  const el = domNode as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const newMarks = { ...marks };

  // Accumulate inline marks
  if (tag === "strong" || tag === "b") newMarks.bold = true;
  if (tag === "em" || tag === "i") newMarks.italic = true;
  if (tag === "u") newMarks.underline = true;
  if (tag === "code") newMarks.code = true;
  if (tag === "s" || tag === "del") newMarks.strikethrough = true;

  const blockProps = extractBlockProps(el);
  const children = Array.from(domNode.childNodes).flatMap((child) =>
    deserialize(child, newMarks),
  );
  const safeChildren = children.length > 0 ? children : [{ text: "", ...newMarks }];

  if (tag === "br") return [{ text: "\n", ...newMarks }];

  const slateType = HTML_TAG_TO_SLATE[tag];

  if (slateType) {
    // list-item and table cells need a paragraph wrapper around their leaf children
    if (slateType === "list-item" || slateType === "table-cell" || slateType === "table-cell-header") {
      const wrappedChildren = wrapLeavesInParagraphs(safeChildren);
      return [{ type: slateType, ...blockProps, children: wrappedChildren }];
    }
    return [{ type: slateType, ...blockProps, children: safeChildren }];
  }

  // Inline tags with no block type: return children (with accumulated marks)
  if (INLINE_TAGS.has(tag)) return children;

  // Styled div/span → paragraph
  if (Object.keys(blockProps).length > 0 && tag !== "body" && tag !== "html") {
    return [{ type: "paragraph", ...blockProps, children: safeChildren }];
  }

  return children;
};

/** Wrap any raw text leaves among block children into paragraph nodes */
const wrapLeavesInParagraphs = (nodes: any[]): any[] => {
  const result: any[] = [];
  for (const node of nodes) {
    if (node.text !== undefined) {
      const last = result[result.length - 1];
      if (last && last.type === "paragraph") {
        last.children.push(node);
      } else {
        result.push({ type: "paragraph", children: [node] });
      }
    } else {
      result.push(node);
    }
  }
  return result.length > 0 ? result : [{ type: "paragraph", children: [{ text: "" }] }];
};

export const htmlToSlateNodes = (html: string): Descendant[] => {
  if (!html || html.trim() === "")
    return [{ type: "paragraph", children: [{ text: "" }] }];

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const fragment = deserialize(doc.body);

  // Wrap any top-level loose leaves into paragraphs
  return fragment.reduce((acc: any[], node) => {
    if (node.text !== undefined) {
      const last = acc[acc.length - 1];
      if (last && last.type === "paragraph") {
        last.children.push(node);
      } else {
        acc.push({ type: "paragraph", children: [node] });
      }
    } else {
      acc.push(node);
    }
    return acc;
  }, []);
};

export const htmlToCellChildren = (html: string): Descendant[] =>
  htmlToSlateNodes(html);

export const htmlArrayToCellChildren = (arr: string[]): Descendant[] => {
  if (!arr || arr.length === 0)
    return [{ type: "paragraph", children: [{ text: "" }] }];
  return arr.flatMap((item) => htmlToSlateNodes(item));
};
