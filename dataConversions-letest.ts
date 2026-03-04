import type { Descendant } from "slate";
import type { CustomText } from "../types";

// =============================================================================
// SHARED HELPERS
// =============================================================================

const buildStyleAttr = (el: any): string => {
  const props: string[] = [];
  if (el.align && el.align !== "left") props.push(`text-align:${el.align}`);
  if (el.indent)                        props.push(`padding-left:${el.indent * 24}px`);
  if (el.fontSize)                      props.push(`font-size:${el.fontSize}px`);
  return props.length > 0 ? ` style="${props.join(";")}"` : "";
};

const serializeLeaf = (leaf: CustomText): string => {
  let html = leaf.text;
  if (leaf.code)          html = `<code>${html}</code>`;
  if (leaf.italic)        html = `<em>${html}</em>`;
  if (leaf.bold)          html = `<strong>${html}</strong>`;
  if (leaf.underline)     html = `<u>${html}</u>`;
  if (leaf.strikethrough) html = `<s>${html}</s>`;
  return html;
};

// =============================================================================
// FULL TAG MAP  (Slate type → HTML tag)
// =============================================================================

const FULL_TAG_MAP: Record<string, string> = {
  "heading-one":   "h1",
  "heading-two":   "h2",
  "heading-three": "h3",
  "heading-four":  "h4",
  "heading-five":  "h5",
  "heading-six":   "h6",
  "block-quote":   "blockquote",
  "numbered-list": "ol",
  "bulleted-list": "ul",
  "list-item":     "li",
  "paragraph":     "p",
};

// =============================================================================
// UNIFIED SERIALISER  (single source of truth for Slate → HTML)
// =============================================================================

const serializeNode = (node: Descendant): string => {
  if ("text" in node) return serializeLeaf(node as CustomText);

  const el    = node as any;
  const inner = (el.children || []).map((c: Descendant) => serializeNode(c)).join("");
  const style = buildStyleAttr(el);

  const tag = FULL_TAG_MAP[el.type];
  if (tag) return `<${tag}${style}>${inner}</${tag}>`;

  switch (el.type) {
    case "code-block":        return `<pre${style}><code>${inner}</code></pre>`;
    case "table":             return `<table${style}>${inner}</table>`;
    case "table-row":         return `<tr${style}>${inner}</tr>`;
    case "table-cell":
    case "table-cell-header": return `<td${style}>${inner}</td>`;
    default:
      return style ? `<div${style}>${inner}</div>` : inner;
  }
};

// =============================================================================
// PUBLIC SERIALISATION API
// =============================================================================

export const leafToHtml  = (leaf: CustomText): string  => serializeLeaf(leaf);
export const nodeToHtml  = (node: Descendant): string  => serializeNode(node);
export const slateToHtml = (nodes: Descendant[]): string =>
  nodes.map(serializeNode).join("\n");

export const cellToHtml = (cell: { children?: Descendant[] }): string =>
  (cell.children || []).map(serializeNode).join("\n");

export const cellToHtmlArray = (cell: { children?: Descendant[] }): string[] =>
  (cell.children || []).map(serializeNode).filter((t) => t.trim().length > 0);

// =============================================================================
// HTML → SLATE  (deserialiser)
// =============================================================================

export const htmlToLeaves = (html: string): CustomText[] => {
  if (!html || html.trim() === "") return [{ text: "" }];
  const leaves: CustomText[] = [];
  const parser = new DOMParser();
  const doc    = parser.parseFromString(html, "text/html");

  const walk = (node: Node, marks: Partial<CustomText>) => {
    if (node.nodeType === 3) {
      const text = node.textContent;
      if (text) leaves.push({ text, ...marks } as CustomText);
      return;
    }
    if (node.nodeType === 1) {
      const m   = { ...marks };
      const tag = (node as Element).tagName.toLowerCase();
      if (tag === "strong" || tag === "b") m.bold          = true;
      if (tag === "em"     || tag === "i") m.italic        = true;
      if (tag === "u")                     m.underline     = true;
      if (tag === "code")                  m.code          = true;
      if (tag === "s")                     m.strikethrough = true;
      for (const child of Array.from(node.childNodes)) walk(child, m);
    }
  };

  for (const child of Array.from(doc.body.childNodes)) walk(child, {});
  return leaves.length > 0 ? leaves : [{ text: "" }];
};

// HTML tag → Slate type (all six heading levels included)
const HTML_TAG_TO_SLATE: Record<string, string> = {
  h1:         "heading-one",
  h2:         "heading-two",
  h3:         "heading-three",
  h4:         "heading-four",
  h5:         "heading-five",
  h6:         "heading-six",
  blockquote: "block-quote",
  ol:         "numbered-list",
  ul:         "bulleted-list",
  li:         "list-item",
};

const extractNodeProps = (el: HTMLElement): Record<string, any> => {
  const props: Record<string, any> = {};
  if (el.style.textAlign) {
    props.align = el.style.textAlign;
  }
  if (el.style.paddingLeft) {
    const px = parseInt(el.style.paddingLeft, 10);
    if (!isNaN(px) && px > 0) props.indent = Math.round(px / 24);
  }
  if (el.style.fontSize) {
    const size = parseInt(el.style.fontSize, 10);
    if (!isNaN(size)) props.fontSize = size;
  }
  return props;
};

const deserialize = (domNode: Node, marks: Partial<CustomText> = {}): any[] => {
  if (domNode.nodeType === 3) return [{ text: domNode.textContent || "", ...marks }];
  if (domNode.nodeType !== 1) return [];

  const el  = domNode as HTMLElement;
  const tag = el.tagName.toLowerCase();

  const newMarks = { ...marks };
  if (tag === "strong" || tag === "b") newMarks.bold          = true;
  if (tag === "em"     || tag === "i") newMarks.italic        = true;
  if (tag === "u")                     newMarks.underline     = true;
  if (tag === "code")                  newMarks.code          = true;
  if (tag === "s" || tag === "del")    newMarks.strikethrough = true;

  // Extract block-level style props — spread onto EVERY matched Slate type
  const nodeProps    = extractNodeProps(el);
  const children     = Array.from(domNode.childNodes).flatMap((c) => deserialize(c, newMarks));
  const safeChildren = children.length > 0 ? children : [{ text: "", ...newMarks }];

  const slateType = HTML_TAG_TO_SLATE[tag];
  if (slateType) return [{ type: slateType, ...nodeProps, children: safeChildren }];

  if (tag === "p")   return [{ type: "paragraph",  ...nodeProps, children: safeChildren }];
  if (tag === "pre") return [{ type: "code-block", ...nodeProps, children: safeChildren }];
  if (tag === "br")  return [{ text: "\n", ...newMarks }];

  if (Object.keys(nodeProps).length > 0 && tag !== "body" && tag !== "html") {
    return [{ type: "paragraph", ...nodeProps, children: safeChildren }];
  }

  return children;
};

export const htmlToSlateNodes = (html: string): Descendant[] => {
  if (!html || html.trim() === "")
    return [{ type: "paragraph", children: [{ text: "" }] }];

  const parser  = new DOMParser();
  const doc     = parser.parseFromString(html, "text/html");
  const nodes   = deserialize(doc.body);

  return nodes.reduce((acc: any[], node) => {
    if ("text" in node) {
      const last = acc[acc.length - 1];
      if (last?.type === "paragraph") last.children.push(node);
      else acc.push({ type: "paragraph", children: [node] });
    } else {
      acc.push(node);
    }
    return acc;
  }, []);
};

export const htmlToCellChildren      = (html: string): Descendant[] => htmlToSlateNodes(html);
export const htmlArrayToCellChildren = (arr: string[]): Descendant[] => {
  if (!arr || arr.length === 0)
    return [{ type: "paragraph", children: [{ text: "" }] }];
  return arr.flatMap((item) => htmlToSlateNodes(item));
};
