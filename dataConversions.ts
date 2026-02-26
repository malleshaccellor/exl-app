import type { Descendant } from "slate";
import type { CustomText } from "../types";

/* =========================================================
   TAG MAPS
========================================================= */

const BLOCK_TAG_MAP: Record<string, string> = {
  paragraph: "p",
  block_quote: "blockquote",
  bulleted_list: "ul",
  numbered_list: "ol",
  list_item: "li",
  heading_one: "h1",
  heading_two: "h2",
  heading_three: "h3",
  heading_four: "h4",
  heading_five: "h5",
  heading_six: "h6",
};

const INLINE_TAG_MAP: Record<string, string> = {
  bold: "strong",
  italic: "em",
  underline: "u",
  code: "code",
};

/* =========================================================
   HTML ESCAPE (XSS SAFE)
========================================================= */

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

/* =========================================================
   LEAF SERIALIZER (FIXED - ESCAPES HTML)
========================================================= */

export const leafToHtml = (leaf: CustomText): string => {
  let html = escapeHtml(leaf.text);

  Object.entries(INLINE_TAG_MAP).forEach(([key, tag]) => {
    if ((leaf as any)[key]) {
      html = `<${tag}>${html}</${tag}>`;
    }
  });

  return html;
};

/* =========================================================
   SINGLE SOURCE SERIALIZER
========================================================= */

export const serializeNode = (node: Descendant): string => {
  if ("text" in node) {
    return leafToHtml(node as CustomText);
  }

  const children = node.children.map(serializeNode).join("");

  switch (node.type) {
    case "link":
      return `<a href="${escapeHtml(
        (node as any).url || ""
      )}">${children}</a>`;

    case "table":
      return `<table>${children}</table>`;

    case "table-row":
      return `<tr>${children}</tr>`;

    case "table-cell":
      return `<td>${children}</td>`;

    default: {
      const tag = BLOCK_TAG_MAP[node.type as string] ?? "div";
      return `<${tag}>${children}</${tag}>`;
    }
  }
};

/* =========================================================
   PUBLIC SERIALIZERS
========================================================= */

export const nodeToHtml = serializeNode;

export const slateToHtml = (nodes: Descendant[]): string =>
  nodes.map(serializeNode).join("");

export const cellToHtml = (cell?: { children?: Descendant[] }) =>
  slateToHtml(cell?.children ?? []);

/* =========================================================
   DESERIALIZER (SSR SAFE)
========================================================= */

const deserialize = (el: any): Descendant | Descendant[] | null => {
  if (el.nodeType === 3) {
    return { text: el.textContent ?? "" };
  }

  if (el.nodeType !== 1) return null;

  if (el.nodeName === "BR") {
    return { text: "\n" };
  }

  const children: Descendant[] = Array.from(el.childNodes)
    .map(deserialize)
    .flat()
    .filter(Boolean) as Descendant[];

  const tag = el.nodeName.toLowerCase();

  switch (tag) {
    case "strong":
      return children.map((child: any) => ({
        ...child,
        bold: true,
      }));

    case "em":
      return children.map((child: any) => ({
        ...child,
        italic: true,
      }));

    case "u":
      return children.map((child: any) => ({
        ...child,
        underline: true,
      }));

    case "code":
      return children.map((child: any) => ({
        ...child,
        code: true,
      }));

    case "a":
      return {
        type: "link",
        url: el.getAttribute("href"),
        children,
      };

    case "ul":
      return { type: "bulleted_list", children };

    case "ol":
      return { type: "numbered_list", children };

    case "li":
      return { type: "list_item", children };

    case "p":
      return { type: "paragraph", children };

    case "table":
      return { type: "table", children };

    case "tr":
      return { type: "table-row", children };

    case "td":
      return { type: "table-cell", children };

    default:
      return children;
  }
};

/* =========================================================
   HTML -> SLATE
========================================================= */

export const htmlToSlateNodes = (html: string): Descendant[] => {
  if (typeof window === "undefined") {
    return [{ type: "paragraph", children: [{ text: html }] }];
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  return Array.from(doc.body.childNodes)
    .map(deserialize)
    .flat()
    .filter(Boolean) as Descendant[];
};

export const htmlToLeaves = htmlToSlateNodes;

export const htmlToCellChildren = htmlToSlateNodes;
