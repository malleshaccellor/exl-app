import type { Descendant } from "slate";
import type { CustomText } from "../types";

// --- Slate -> HTML ---

const BLOCK_TAG_MAP: Record<string, string> = {
  "heading-one": "h1",
  "heading-two": "h2",
  "block-quote": "blockquote",
  "numbered-list": "ol",
  "bulleted-list": "ul",
  "list-item": "li",
};

export const leafToHtml = (leaf: CustomText): string => {
  let html = leaf.text;
  if (leaf.code) html = `<code>${html}</code>`;
  if (leaf.italic) html = `<em>${html}</em>`;
  if (leaf.bold) html = `<strong>${html}</strong>`;
  if (leaf.underline) html = `<u>${html}</u>`;
  return html;
};

export const nodeToHtml = (node: Descendant): string => {
  if ("text" in node) {
    return leafToHtml(node as CustomText);
  }
  const el = node as Descendant & { type?: string; children?: Descendant[] };
  const inner = (el.children || []).map((child: Descendant) => nodeToHtml(child)).join("");
  const tag = el.type ? BLOCK_TAG_MAP[el.type] : undefined;
  if (tag) return `<${tag}>${inner}</${tag}>`;
  return inner;
};

// --- Full Slate tree → HTML (handles all element types) ---

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
  "paragraph": "p",
};

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const serializeNode = (node: Descendant): string => {
  // Text leaf
  if ("text" in node) {
    let html = escapeHtml(node.text);
    const leaf = node as CustomText;
    if (leaf.code) html = `<code>${html}</code>`;
    if (leaf.italic) html = `<em>${html}</em>`;
    if (leaf.bold) html = `<strong>${html}</strong>`;
    if (leaf.underline) html = `<u>${html}</u>`;
    if (leaf.strikethrough) html = `<s>${html}</s>`;
    return html;
  }

  const el = node as any;
  const children = (el.children || [])
    .map((child: Descendant) => serializeNode(child))
    .join("");

  // Style attributes
  const styleProps: string[] = [];
  if (el.align && el.align !== "left") styleProps.push(`text-align:${el.align}`);
  if (el.indent) styleProps.push(`padding-left:${el.indent * 24}px`);
  if (el.fontSize) styleProps.push(`font-size:${el.fontSize}px`);
  const styleAttr = styleProps.length > 0 ? ` style="${styleProps.join(";")}"` : "";

  // Simple tag mapping
  const tag = FULL_TAG_MAP[el.type];
  if (tag) return `<${tag}${styleAttr}>${children}</${tag}>`;

  // Tables
  switch (el.type) {
    case "code-block":
      return `<pre${styleAttr}><code>${children}</code></pre>`;
    case "table":
      return `<table>${children}</table>`;
    case "table-row":
      return `<tr>${children}</tr>`;
    case "table-cell-header":
      return `<th${styleAttr}>${children}</th>`;
    case "table-cell":
      if (el.isHeader) return `<th${styleAttr}>${children}</th>`;
      return `<td${styleAttr}>${children}</td>`;
    default:
      return children;
  }
};

export const slateToHtml = (nodes: Descendant[]): string => {
  return nodes.map((node) => serializeNode(node)).join("\n");
};

export const cellToHtml = (cell: { children?: Descendant[] }): string => {
  const children = cell.children || [];
  return children.map((child: Descendant) => nodeToHtml(child)).join("\n");
};

export const cellToHtmlArray = (cell: { children?: Descendant[] }): string[] => {
  const children = cell.children || [];
  return children
    .map((child: Descendant) => nodeToHtml(child))
    .filter((t: string) => t.trim().length > 0);
};

// --- HTML -> Slate ---

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
      for (const child of Array.from(node.childNodes)) {
        walk(child, newMarks);
      }
    }
  };

  for (const child of Array.from(doc.body.childNodes)) {
    walk(child, {});
  }

  return leaves.length > 0 ? leaves : [{ text: "" }];
};

const HTML_TAG_TO_SLATE: Record<string, string> = {
  h1: "heading-one",
  h2: "heading-two",
  blockquote: "block-quote",
  ol: "numbered-list",
  ul: "bulleted-list",
  li: "list-item",
};

export const htmlToSlateNodes = (html: string): Descendant[] => {
  if (!html || html.trim() === "")
    return [{ type: "paragraph", children: [{ text: "" }] }];

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const parseNode = (domNode: Node): Descendant | null => {
    if (domNode.nodeType === 3) {
      const text = domNode.textContent;
      if (!text || text.trim() === "") return null;
      return { type: "paragraph", children: [{ text }] };
    }

    if (domNode.nodeType !== 1) return null;

    const tag = (domNode as Element).tagName.toLowerCase();
    const slateType = HTML_TAG_TO_SLATE[tag];

    if (slateType) {
      if (tag === "ol" || tag === "ul") {
        const items = Array.from(domNode.childNodes)
          .map((child) => parseNode(child))
          .filter(Boolean) as Descendant[];
        return {
          type: slateType as "numbered-list" | "bulleted-list",
          children:
            items.length > 0
              ? (items as any)
              : [{ type: "list-item", children: [{ text: "" }] }],
        };
      }
      const leaves: CustomText[] = [];
      const walkInline = (node: Node, marks: Partial<CustomText>) => {
        if (node.nodeType === 3) {
          const text = node.textContent;
          if (text) leaves.push({ text, ...marks } as CustomText);
          return;
        }
        if (node.nodeType === 1) {
          const newMarks = { ...marks };
          const t = (node as Element).tagName.toLowerCase();
          if (t === "strong" || t === "b") newMarks.bold = true;
          if (t === "em" || t === "i") newMarks.italic = true;
          if (t === "u") newMarks.underline = true;
          if (t === "code") newMarks.code = true;
          for (const child of Array.from(node.childNodes)) {
            walkInline(child, newMarks);
          }
        }
      };
      for (const child of Array.from(domNode.childNodes)) {
        walkInline(child, {});
      }
      return {
        type: slateType as any,
        children: leaves.length > 0 ? leaves : [{ text: "" }],
      };
    }

    return {
      type: "paragraph",
      children: htmlToLeaves(
        (domNode as Element).innerHTML || domNode.textContent || ""
      ),
    };
  };

  const nodes = Array.from(doc.body.childNodes)
    .map((child) => parseNode(child))
    .filter(Boolean) as Descendant[];

  return nodes.length > 0
    ? nodes
    : [{ type: "paragraph", children: [{ text: "" }] }];
};

export const htmlToCellChildren = (html: string): Descendant[] => {
  if (!html) return [{ type: "paragraph", children: [{ text: "" }] }];
  return htmlToSlateNodes(html);
};

export const htmlArrayToCellChildren = (arr: string[]): Descendant[] => {
  if (!arr || arr.length === 0)
    return [{ type: "paragraph", children: [{ text: "" }] }];
  return arr.flatMap((item) => htmlToSlateNodes(item));
};
