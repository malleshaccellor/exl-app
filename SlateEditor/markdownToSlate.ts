import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Descendant } from "slate";

export function markdownToSlate(markdown: string): Descendant[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);

  const nodes = tree.children.flatMap(normalizeNode);

  return nodes.length
    ? nodes
    : [{ type: "paragraph", children: [{ text: "" }] }];
}

function normalizeNode(node: any): Descendant[] {
  switch (node.type) {
    case "heading":
      return [
        {
          type: `heading-${node.depth}`,
          children: normalizeInline(node.children),
        },
      ];

    case "paragraph":
      return [
        {
          type: "paragraph",
          children: normalizeInline(node.children),
        },
      ];

    case "list":
      return [
        {
          type: node.ordered ? "numbered-list" : "bulleted-list",
          children: node.children.flatMap(normalizeNode),
        },
      ];

    case "listItem":
      return [
        {
          type: "list-item",
          children: node.children.flatMap(normalizeNode),
        },
      ];

    case "blockquote":
      return [
        {
          type: "block-quote",
          children: node.children.flatMap(normalizeNode),
        },
      ];

    case "code":
      return [
        {
          type: "code-block",
          language: node.lang,
          children: [{ text: node.value }],
        },
      ];

    default:
      // 🔐 UNKNOWN BLOCK → SAFE PARAGRAPH
      return [
        {
          type: "paragraph",
          children: extractText(node),
        },
      ];
  }
}

function normalizeInline(nodes: any[]): any[] {
  if (!nodes) return [{ text: "" }];

  return nodes.flatMap((node) => {
    switch (node.type) {
      case "text":
        return [{ text: node.value }];

      case "strong":
        return normalizeInline(node.children).map((n) => ({
          ...n,
          bold: true,
        }));

      case "emphasis":
        return normalizeInline(node.children).map((n) => ({
          ...n,
          italic: true,
        }));

      case "delete":
        return normalizeInline(node.children).map((n) => ({
          ...n,
          strikethrough: true,
        }));

      case "inlineCode":
        return [{ text: node.value, code: true }];

      case "link":
        return normalizeInline(node.children).map((n) => ({
          ...n,
          link: node.url,
        }));

      default:
        return extractText(node);
    }
  });
}

function extractText(node: any): any[] {
  if (node.value) return [{ text: String(node.value) }];
  if (Array.isArray(node.children)) {
    return node.children.flatMap(extractText);
  }
  return [{ text: "" }];
}
