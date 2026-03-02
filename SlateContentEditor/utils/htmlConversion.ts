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
  if (leaf.strikethrough) html = `<s>${html}</s>`;
  return html;
};

export const nodeToHtml = (node: Descendant): string => {
  // 1. Handle Text Leaves
  if ("text" in node) {
    return leafToHtml(node as CustomText);
  }

  const el = node as any; // Cast to access custom properties
  
  // 2. Process Children Recursively
  const inner = (el.children || [])
    .map((child: Descendant) => nodeToHtml(child))
    .join("");

  // 3. Build the Style Attribute
  const styleProps: string[] = [];
  if (el.align && el.align !== "left") styleProps.push(`text-align:${el.align}`);
  if (el.indent) styleProps.push(`padding-left:${el.indent * 24}px`);
  if (el.fontSize) styleProps.push(`font-size:${el.fontSize}px`);
  
  const styleAttr = styleProps.length > 0 ? ` style="${styleProps.join(";")}"` : "";

  // 4. Map to HTML Tag
  const tag = el.type ? BLOCK_TAG_MAP[el.type] : undefined;

  if (tag) {
    return `<${tag}${styleAttr}>${inner}</${tag}>`;
  }

  // 5. Fallback for unknown types (wrap in div if styles exist to preserve them)
  return styleAttr ? `<div${styleAttr}>${inner}</div>` : inner;
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
  const children = (el.children || []).map((child: Descendant) => serializeNode(child)).join("");

  // 1. Build Style String
  const styleProps: string[] = [];
  if (el.align && el.align !== "left") styleProps.push(`text-align:${el.align}`);
  if (el.indent) styleProps.push(`padding-left:${el.indent * 24}px`);
  if (el.fontSize) styleProps.push(`font-size:${el.fontSize}px`);
  const styleAttr = styleProps.length > 0 ? ` style="${styleProps.join(";")}"` : "";

  // 2. Map to Tag
  const tag = FULL_TAG_MAP[el.type];
  
  if (tag) return `<${tag}${styleAttr}>${children}</${tag}>`;

  // Fallback for special types
  switch (el.type) {
    case "code-block":
      return `<pre${styleAttr}><code>${children}</code></pre>`;
    case "table":
      return `<table${styleAttr}>${children}</table>`;
    case "table-row":
      return `<tr${styleAttr}>${children}</tr>`;
    case "table-cell":
      return `<td${styleAttr}>${children}</td>`;
    default:
      // Critical fix: ensure alignment/indent works even on unknown blocks by using a div
      return styleAttr ? `<div${styleAttr}>${children}</div>` : children;
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
      if (tag === "s") newMarks.strikethrough = true;
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

const deserialize = (domNode: Node, marks: Partial<CustomText> = {}): any[] => {
  if (domNode.nodeType === 3) {
    return [{ text: domNode.textContent || "", ...marks }];
  }

  if (domNode.nodeType !== 1) return [];

  const el = domNode as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const newMarks = { ...marks };

  // Inline Marks
  if (tag === "strong" || tag === "b") newMarks.bold = true;
  if (tag === "em" || tag === "i") newMarks.italic = true;
  if (tag === "u") newMarks.underline = true;
  if (tag === "code") newMarks.code = true;
  if (tag === "s" || tag === "del") newMarks.strikethrough = true;

  // Extract Styles (Alignment, Indent, Font Size)
  const nodeProps: any = {};
  if (el.style.textAlign) nodeProps.align = el.style.textAlign;
  if (el.style.paddingLeft) {
    const px = parseInt(el.style.paddingLeft, 10);
    if (!isNaN(px)) nodeProps.indent = Math.round(px / 24);
  }
  if (el.style.fontSize) {
    const size = parseInt(el.style.fontSize, 10);
    if (!isNaN(size)) nodeProps.fontSize = size;
  }

  const children = Array.from(domNode.childNodes)
    .flatMap((child) => deserialize(child, newMarks));

  const slateType = HTML_TAG_TO_SLATE[tag];

  if (slateType) {
    return [{
      type: slateType,
      ...nodeProps, // Apply extracted styles here
      children: children.length > 0 ? children : [{ text: "", ...newMarks }],
    }];
  }

  if (tag === "br") return [{ text: "\n", ...newMarks }];

  // If it's a styled div/span without a specific slate type, treat as paragraph to keep styles
  if (Object.keys(nodeProps).length > 0 && tag !== "body" && tag !== "html") {
    return [{
      type: "paragraph",
      ...nodeProps,
      children: children.length > 0 ? children : [{ text: "" }]
    }];
  }

  return children;
};

export const htmlToSlateNodes = (html: string): Descendant[] => {
  if (!html || html.trim() === "")
    return [{ type: "paragraph", children: [{ text: "" }] }];

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const fragment = deserialize(doc.body);

  // Wrap loose leaves in paragraphs for Slate compatibility
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

// Update these helpers to use the unified logic
export const htmlToCellChildren = (html: string): Descendant[] => {
  return htmlToSlateNodes(html);
};

export const htmlArrayToCellChildren = (arr: string[]): Descendant[] => {
  if (!arr || arr.length === 0)
    return [{ type: "paragraph", children: [{ text: "" }] }];
  return arr.flatMap((item) => htmlToSlateNodes(item));
};
