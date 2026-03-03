import { htmlToSlateNodes, htmlToLeaves } from "./htmlConversion";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect whether a string is block-level HTML (starts with a block tag).
 * Used to decide whether to use the full deserializer or inline-only.
 */
const BLOCK_TAG_RE = /^\s*<(p|h[1-6]|ul|ol|li|blockquote|pre|div|table)[>\s]/i;

/**
 * valueToNodes — converts a stored JSON string value into Slate nodes.
 *
 * - Block HTML  "<p style="...">…</p>"  → htmlToSlateNodes → full nodes WITH styles
 * - Inline HTML "<strong>…</strong>"     → htmlToLeaves    → marked text leaves
 * - Plain text  "hello"                  → single text leaf
 *
 * Always returns an array of valid Slate nodes (block or leaf).
 */
const valueToNodes = (val: string): any[] => {
  const s = (val ?? "").trim();
  if (!s) return [{ text: "" }];
  if (BLOCK_TAG_RE.test(s)) return htmlToSlateNodes(s);          // full block HTML
  if (/<\/?[a-z][\s\S]*?>/i.test(s)) return htmlToLeaves(s);    // inline HTML only
  return [{ text: s }];                                           // plain text
};

/**
 * blockNodes — same as valueToNodes but guarantees the result is block nodes.
 * When the value is plain text or inline HTML (leaves), wraps in a paragraph.
 * Used wherever we need valid table-cell / list-item children.
 */
const blockNodes = (val: string): any[] => {
  const nodes = valueToNodes(val);
  // If the first node has "text" it's a leaf — wrap everything in a paragraph
  if (nodes.length > 0 && "text" in nodes[0]) {
    return [{ type: "paragraph", children: nodes }];
  }
  return nodes; // already block nodes (paragraphs / lists / etc.)
};

// ─────────────────────────────────────────────────────────────────────────────
// Generic table / list builders (non-BRD, plain text values)
// ─────────────────────────────────────────────────────────────────────────────

export const createSlateTable = (data: any[]): any => {
  if (!data?.length) return { type: "paragraph", children: [{ text: "" }] };
  const headers = Object.keys(data[0]);
  return {
    type: "table" as const,
    className: "editor-custom-table",
    children: [
      {
        type: "table-row" as const,
        children: headers.map((h) => ({
          type: "table-cell-header" as const,
          children: [{ type: "paragraph", children: [{ text: h.replace(/_/g, " "), bold: true }] }],
        })),
      },
      ...data.map((row) => ({
        type: "table-row" as const,
        children: headers.map((key) => {
          const val = row[key];
          return {
            type: "table-cell" as const,
            children: Array.isArray(val)
              ? val.length
                ? val.map((item: string) => ({ type: "paragraph", children: [{ text: String(item) }] }))
                : [{ type: "paragraph", children: [{ text: "" }] }]
              : [{ type: "paragraph", children: [{ text: String(val ?? "") }] }],
          };
        }),
      })),
    ],
  };
};

export const createSlateBulletedList = (items: string[]): any => ({
  type: "bulleted-list" as const,
  children: items.map((item) => ({
    type: "list-item" as const,
    children: [{ type: "paragraph", children: [{ text: String(item) }] }],
  })),
});

export const createSlateNumberedList = (items: string[]): any => ({
  type: "numbered-list" as const,
  children: items.map((item) => ({
    type: "list-item" as const,
    children: [{ type: "paragraph", children: [{ text: String(item) }] }],
  })),
});

// ─────────────────────────────────────────────────────────────────────────────
// BRD-specific builders (values may be rich HTML from slateToBrdJson)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * brdTable — builds a Slate table from BRD data.
 * Cell values may be HTML strings like "<p style="font-size:18px">…</p>"
 * or arrays of HTML strings. All formatting is preserved.
 */
const brdTable = (data: any[]): any => {
  if (!data?.length) return { type: "paragraph", children: [{ text: "" }] };
  const headers = Object.keys(data[0]);
  return {
    type: "table" as const,
    className: "editor-custom-table",
    children: [
      {
        type: "table-row" as const,
        children: headers.map((h) => ({
          type: "table-cell-header" as const,
          children: [{ type: "paragraph", children: [{ text: h.replace(/_/g, " "), bold: true }] }],
        })),
      },
      ...data.map((row) => ({
        type: "table-row" as const,
        children: headers.map((key) => {
          const val = row[key];
          if (Array.isArray(val)) {
            // Each array item is an HTML string → deserialize each, concatenate as cell children
            const children = val.length
              ? val.flatMap((item: string) => blockNodes(String(item)))
              : [{ type: "paragraph", children: [{ text: "" }] }];
            return { type: "table-cell" as const, children };
          }
          // Single HTML string → deserialize, must be block nodes
          return { type: "table-cell" as const, children: blockNodes(String(val ?? "")) };
        }),
      })),
    ],
  };
};

/**
 * brdBulletedList — builds a bulleted list from BRD data.
 * Each item may be an HTML string like "<p style="text-align:center">…</p>".
 * list-item children must be block nodes (paragraphs), never raw leaves.
 */
const brdBulletedList = (items: string[]): any => ({
  type: "bulleted-list" as const,
  children: items.map((item) => ({
    type: "list-item" as const,
    children: blockNodes(String(item ?? "")),
  })),
});

// ─────────────────────────────────────────────────────────────────────────────
// transformBRDDataToSlate
// ─────────────────────────────────────────────────────────────────────────────

export const transformBRDDataToSlate = (obj: any): any[] => {
  if (!obj) return [{ type: "paragraph", children: [{ text: "" }] }];

  return Object.entries(obj).flatMap(([key, value]) => {

    // ── Executive Summary ────────────────────────────────────────────────────
    if (key === "Executive_Summary" && typeof value === "object" && value !== null) {
      return [
        { type: "heading-five" as const, children: [{ text: "Executive Summary" }] },
        ...Object.entries(value).flatMap(([subKey, subVal]) => [
          { type: "heading-five" as const, children: [{ text: subKey.replace(/_/g, " ") }] },
          // subVal is block HTML — deserialize it fully so styles are preserved
          ...blockNodes(String(subVal ?? "")),
        ]),
      ];
    }

    // ── Stakeholders & Key Personnel ─────────────────────────────────────────
    if (key === "Stakeholders_and_Key_Personnel" && Array.isArray(value)) {
      return [
        { type: "heading-five" as const, children: [{ text: "Stakeholders & Key Personnel" }] },
        brdTable(value),
      ];
    }

    // ── Goals & Objectives ───────────────────────────────────────────────────
    if (key === "Goals_and_Objectives" && Array.isArray(value)) {
      return [
        { type: "heading-five" as const, children: [{ text: "Goals & objectives" }] },
        brdBulletedList(value),
      ];
    }

    // ── Process Scope Summary ────────────────────────────────────────────────
    if (key === "Process_Scope_Summary" && typeof value === "object" && value !== null) {
      return [
        { type: "heading-five" as const, children: [{ text: "Process Scope Summary" }] },
        ...Object.entries(value).flatMap(([scopeKey, scopeVal]: [string, any]) => [
          { type: "heading-five" as const, children: [{ text: scopeKey.replace(/_/g, " ") }] },
          ...Object.entries(scopeVal as Record<string, any>).flatMap(([, subVal]: [string, any]) =>
            Array.isArray(subVal)
              ? [brdBulletedList(subVal)]
              : blockNodes(String(subVal ?? "")),
          ),
        ]),
      ];
    }

    // ── Glossary ─────────────────────────────────────────────────────────────
    if (key === "Glossary" && Array.isArray(value)) {
      return [
        { type: "heading-five" as const, children: [{ text: "Glossary" }] },
        brdTable(value),
      ];
    }

    // ── Actors / Personas ────────────────────────────────────────────────────
    if (key === "Actors_Personas" && Array.isArray(value)) {
      return [
        { type: "heading-five" as const, children: [{ text: "Actors/Personas" }] },
        brdTable(value),
      ];
    }

    // ── Fallback (unknown sections) ──────────────────────────────────────────
    return [
      { type: "heading-one" as const, children: [{ text: key }] },
      ...blockNodes(typeof value === "object" ? JSON.stringify(value) : String(value ?? "")),
    ];
  });
};
