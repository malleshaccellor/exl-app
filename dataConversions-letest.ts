import type { Descendant } from "slate";
import type { CustomText } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// SLATE → HTML
// ─────────────────────────────────────────────────────────────────────────────

const buildStyle = (el: any): string => {
  const parts: string[] = [];
  if (el.align && el.align !== "left") parts.push(`text-align:${el.align}`);
  if (el.indent) parts.push(`padding-left:${el.indent * 24}px`);
  if (el.fontSize) parts.push(`font-size:${el.fontSize}px`);
  return parts.length ? ` style="${parts.join(";")}"` : "";
};

const serializeLeaf = (leaf: CustomText): string => {
  let html = leaf.text;
  if (leaf.code) html = `<code>${html}</code>`;
  if (leaf.italic) html = `<em>${html}</em>`;
  if (leaf.bold) html = `<strong>${html}</strong>`;
  if (leaf.underline) html = `<u>${html}</u>`;
  if (leaf.strikethrough) html = `<s>${html}</s>`;
  return html;
};

const SLATE_TO_TAG: Record<string, string> = {
  paragraph: "p",
  "heading-one": "h1",
  "heading-two": "h2",
  "heading-three": "h3",
  "heading-four": "h4",
  "heading-five": "h5",
  "heading-six": "h6",
  "block-quote": "blockquote",
  "bulleted-list": "ul",
  "numbered-list": "ol",
  "list-item": "li",
  table: "table",
  "table-row": "tr",
  "table-cell": "td",
  "table-cell-header": "th",
};

/**
 * nodeToHtml — single authoritative Slate→HTML serializer.
 * Preserves align / indent / fontSize on every block node.
 * Exported so dataConversions.ts can use it directly.
 */
export const nodeToHtml = (node: Descendant): string => {
  if ("text" in node) return serializeLeaf(node as CustomText);

  const el = node as any;
  const style = buildStyle(el);
  const inner = (el.children || []).map((c: Descendant) => nodeToHtml(c)).join("");
  const tag = SLATE_TO_TAG[el.type];

  if (el.type === "code-block") return `<pre${style}><code>${inner}</code></pre>`;
  if (tag) return `<${tag}${style}>${inner}</${tag}>`;
  return style ? `<div${style}>${inner}</div>` : inner;
};

export const leafToHtml = (leaf: CustomText): string => serializeLeaf(leaf);
export const slateToHtml = (nodes: Descendant[]): string => nodes.map(nodeToHtml).join("");
export const cellToHtml = (cell: { children?: Descendant[] }): string =>
  (cell.children || []).map(nodeToHtml).join("");
export const cellToHtmlArray = (cell: { children?: Descendant[] }): string[] =>
  (cell.children || []).map(nodeToHtml).filter((s) => s.trim().length > 0);

// ─────────────────────────────────────────────────────────────────────────────
// HTML → SLATE
// ─────────────────────────────────────────────────────────────────────────────

const TAG_TO_SLATE: Record<string, string> = {
  p: "paragraph",
  h1: "heading-one",
  h2: "heading-two",
  h3: "heading-three",
  h4: "heading-four",
  h5: "heading-five",
  h6: "heading-six",
  blockquote: "block-quote",
  ul: "bulleted-list",
  ol: "numbered-list",
  li: "list-item",
  pre: "code-block",
  table: "table",
  tr: "table-row",
  td: "table-cell",
  th: "table-cell-header",
};

const INLINE_TAGS = new Set(["strong", "b", "em", "i", "u", "s", "del", "code", "span", "a"]);
// These block types must have block children (paragraphs), not raw leaves
const NEEDS_BLOCK_CHILDREN = new Set(["list-item", "table-cell", "table-cell-header"]);

const extractStyle = (el: HTMLElement): Record<string, any> => {
  const props: Record<string, any> = {};
  if (el.style.textAlign) props.align = el.style.textAlign;
  if (el.style.paddingLeft) {
    const px = parseInt(el.style.paddingLeft, 10);
    if (!isNaN(px) && px > 0) props.indent = Math.round(px / 24);
  }
  if (el.style.fontSize) {
    const size = parseInt(el.style.fontSize, 10);
    if (!isNaN(size)) props.fontSize = String(size);
  }
  return props;
};

const wrapLooseLeaves = (nodes: any[]): any[] => {
  const out: any[] = [];
  for (const n of nodes) {
    if ("text" in n) {
      const last = out[out.length - 1];
      if (last?.type === "paragraph") last.children.push(n);
      else out.push({ type: "paragraph", children: [n] });
    } else {
      out.push(n);
    }
  }
  return out.length ? out : [{ type: "paragraph", children: [{ text: "" }] }];
};

const deserialize = (domNode: Node, marks: Partial<CustomText> = {}): any[] => {
  if (domNode.nodeType === 3) {
    const text = domNode.textContent || "";
    return text ? [{ text, ...marks }] : [];
  }
  if (domNode.nodeType !== 1) return [];

  const el = domNode as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const newMarks = { ...marks };

  if (tag === "strong" || tag === "b") newMarks.bold = true;
  if (tag === "em" || tag === "i") newMarks.italic = true;
  if (tag === "u") newMarks.underline = true;
  if (tag === "code") newMarks.code = true;
  if (tag === "s" || tag === "del") newMarks.strikethrough = true;
  if (tag === "br") return [{ text: "\n", ...newMarks }];

  const styleProps = extractStyle(el);
  const children = Array.from(domNode.childNodes).flatMap((c) => deserialize(c, newMarks));
  const safeChildren = children.length ? children : [{ text: "", ...newMarks }];
  const slateType = TAG_TO_SLATE[tag];

  if (slateType) {
    const finalChildren = NEEDS_BLOCK_CHILDREN.has(slateType)
      ? wrapLooseLeaves(safeChildren)
      : safeChildren;
    return [{ type: slateType, ...styleProps, children: finalChildren }];
  }

  if (INLINE_TAGS.has(tag)) return children;

  if (Object.keys(styleProps).length > 0 && tag !== "body" && tag !== "html") {
    return [{ type: "paragraph", ...styleProps, children: safeChildren }];
  }

  return children;
};

export const htmlToSlateNodes = (html: string): Descendant[] => {
  if (!html?.trim()) return [{ type: "paragraph", children: [{ text: "" }] }];

  const doc = new DOMParser().parseFromString(html, "text/html");
  const nodes = deserialize(doc.body);

  return nodes.reduce((acc: any[], n) => {
    if ("text" in n) {
      const last = acc[acc.length - 1];
      if (last?.type === "paragraph") last.children.push(n);
      else acc.push({ type: "paragraph", children: [n] });
    } else {
      acc.push(n);
    }
    return acc;
  }, []);
};

export const htmlToLeaves = (html: string): CustomText[] => {
  if (!html?.trim()) return [{ text: "" }];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const leaves: CustomText[] = [];
  const walk = (node: Node, marks: Partial<CustomText>) => {
    if (node.nodeType === 3) {
      const text = node.textContent;
      if (text) leaves.push({ text, ...marks } as CustomText);
      return;
    }
    if (node.nodeType === 1) {
      const m = { ...marks };
      const t = (node as Element).tagName.toLowerCase();
      if (t === "strong" || t === "b") m.bold = true;
      if (t === "em" || t === "i") m.italic = true;
      if (t === "u") m.underline = true;
      if (t === "code") m.code = true;
      if (t === "s" || t === "del") m.strikethrough = true;
      node.childNodes.forEach((c) => walk(c, m));
    }
  };
  doc.body.childNodes.forEach((c) => walk(c, {}));
  return leaves.length ? leaves : [{ text: "" }];
};

export const htmlToCellChildren = (html: string): Descendant[] => htmlToSlateNodes(html);
export const htmlArrayToCellChildren = (arr: string[]): Descendant[] => {
  if (!arr?.length) return [{ type: "paragraph", children: [{ text: "" }] }];
  return arr.flatMap((item) => htmlToSlateNodes(item));
};
