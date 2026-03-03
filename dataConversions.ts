import {
  htmlToLeaves,
  htmlToSlateNodes,
  htmlToCellChildren,
  htmlArrayToCellChildren,
} from "./htmlConversion";

/** Block-level HTML tags that indicate a value is a full block node, not inline markup. */
const BLOCK_HTML_RE = /^<(p|h[1-6]|ul|ol|li|blockquote|pre|div|table|tr|td|th)[\s>]/i;

/**
 * parseHtmlValue — smart dispatcher:
 *
 * - Plain text (no HTML)          → single text leaf
 * - Inline HTML (<strong> etc.)   → htmlToLeaves  → text leaves with marks
 * - Block HTML (<p>, <ul> etc.)   → htmlToSlateNodes → full Slate block nodes
 *                                   WITH align / indent / fontSize preserved
 *
 * Returns an array of Slate nodes (either leaves or block elements).
 */
const parseHtmlValue = (str: string): any[] => {
  if (!str) return [{ text: "" }];
  const trimmed = str.trim();
  if (!/<\/?[a-z][\s\S]*?>/i.test(trimmed)) {
    return [{ text: trimmed }];
  }
  if (BLOCK_HTML_RE.test(trimmed)) {
    return htmlToSlateNodes(trimmed);
  }
  return htmlToLeaves(trimmed);
};

/**
 * cellChildrenFromValue — turn a single string value into valid table-cell children.
 * Table cells must contain block elements (paragraphs), never raw leaves.
 *
 * - Block HTML (<p style="...">…</p>)  → htmlToSlateNodes → preserves styles ✓
 * - Inline HTML / plain text           → wrap in a single paragraph
 */
const cellChildrenFromValue = (val: string): any[] => {
  const trimmed = (val ?? "").trim();
  if (!trimmed) return [{ type: "paragraph", children: [{ text: "" }] }];

  if (BLOCK_HTML_RE.test(trimmed)) {
    // Full-block HTML: deserialize directly; result is already paragraph/heading/list nodes
    return htmlToSlateNodes(trimmed);
  }
  // Plain text or inline HTML: wrap in a paragraph
  return [{ type: "paragraph", children: parseHtmlValue(trimmed) }];
};

/**
 * cellChildrenFromArray — turn an array of string values into table-cell children.
 * Each item becomes its own paragraph (or set of paragraphs if it is block HTML).
 */
const cellChildrenFromArray = (arr: string[]): any[] => {
  if (!arr || arr.length === 0)
    return [{ type: "paragraph", children: [{ text: "" }] }];

  return arr.flatMap((item) => {
    const trimmed = String(item ?? "").trim();
    if (!trimmed) return [{ type: "paragraph", children: [{ text: "" }] }];
    if (BLOCK_HTML_RE.test(trimmed)) {
      return htmlToSlateNodes(trimmed);
    }
    return [{ type: "paragraph", children: parseHtmlValue(trimmed) }];
  });
};

// ─── Public table / list builders ────────────────────────────────────────────

export const createSlateTable = (data: any[]): any => {
  if (!data || data.length === 0)
    return { type: "paragraph", children: [{ text: "" }] };

  const headers = Object.keys(data[0]);

  return {
    type: "table" as const,
    className: "editor-custom-table",
    children: [
      {
        type: "table-row" as const,
        children: headers.map((header) => ({
          type: "table-cell-header" as const,
          children: [
            {
              type: "paragraph" as const,
              children: [{ text: header.replace(/_/g, " "), bold: true }],
            },
          ],
        })),
      },
      ...data.map((row) => ({
        type: "table-row" as const,
        children: headers.map((key) => {
          const val = row[key];
          return {
            type: "table-cell" as const,
            children: Array.isArray(val)
              ? cellChildrenFromArray(val.map(String))
              : cellChildrenFromValue(String(val ?? "")),
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
    children: [{ type: "paragraph" as const, children: [{ text: String(item) }] }],
  })),
});

export const createSlateNumberedList = (items: string[]): any => ({
  type: "numbered-list" as const,
  children: items.map((item) => ({
    type: "list-item" as const,
    children: [{ type: "paragraph" as const, children: [{ text: String(item) }] }],
  })),
});

// ─── BRD-specific builders ────────────────────────────────────────────────────

/**
 * createBrdSlateTable — like createSlateTable but values may be full block HTML.
 * Uses cellChildrenFromValue / cellChildrenFromArray so styles are never lost.
 */
const createBrdSlateTable = (data: any[]): any => {
  if (!data || data.length === 0)
    return { type: "paragraph", children: [{ text: "" }] };

  const headers = Object.keys(data[0]);

  return {
    type: "table" as const,
    className: "editor-custom-table",
    children: [
      {
        type: "table-row" as const,
        children: headers.map((header) => ({
          type: "table-cell-header" as const,
          children: [
            {
              type: "paragraph" as const,
              children: [{ text: header.replace(/_/g, " "), bold: true }],
            },
          ],
        })),
      },
      ...data.map((row) => ({
        type: "table-row" as const,
        children: headers.map((key) => {
          const val = row[key];
          return {
            type: "table-cell" as const,
            // Array values (e.g. Actors Role/Access_Type): each item → its own paragraph
            // String values: may be "<p style="...">text</p>" → styles preserved
            children: Array.isArray(val)
              ? cellChildrenFromArray(val.map(String))
              : cellChildrenFromValue(String(val ?? "")),
          };
        }),
      })),
    ],
  };
};

/**
 * createBrdBulletedList — list items may be full block HTML like "<p>text</p>"
 * or "<p style="...">text</p>". We extract the paragraph node(s) from each item
 * and use them directly as the list-item's children instead of double-wrapping.
 */
const createBrdBulletedList = (items: string[]): any => ({
  type: "bulleted-list" as const,
  children: items.map((item) => {
    const trimmed = String(item ?? "").trim();
    // If the item is block HTML, deserialize it to get paragraph nodes with styles
    const blockChildren = BLOCK_HTML_RE.test(trimmed)
      ? htmlToSlateNodes(trimmed)
      : [{ type: "paragraph" as const, children: parseHtmlValue(trimmed) }];

    return {
      type: "list-item" as const,
      // list-item children must be block nodes (paragraphs), never raw leaves
      children: blockChildren,
    };
  }),
});

// ─── Main BRD transformer ─────────────────────────────────────────────────────

export const transformBRDDataToSlate = (obj: any) => {
  if (!obj) return [{ type: "paragraph", children: [{ text: "" }] }];

  return Object.entries(obj).flatMap(([key, value]) => {
    // ── Executive Summary ──────────────────────────────────────────────────
    if (key === "Executive_Summary" && typeof value === "object" && value !== null) {
      const sectionHeader = {
        type: "heading-five" as const,
        children: [{ text: "Executive Summary" }],
      };

      const subNodes = Object.entries(value).flatMap(([subKey, subValue]) => [
        {
          type: "heading-five" as const,
          children: [{ text: subKey.replace(/_/g, " ") }],
        },
        // subValue is block HTML like "<p>...</p>" — use full deserializer
        // so styles (strikethrough, alignment, fontSize) are preserved
        ...cellChildrenFromValue(String(subValue ?? "")),
      ]);

      return [sectionHeader, ...subNodes];
    }

    // ── Stakeholders & Key Personnel ───────────────────────────────────────
    if (key === "Stakeholders_and_Key_Personnel" && Array.isArray(value)) {
      return [
        {
          type: "heading-five" as const,
          children: [{ text: "Stakeholders & Key Personnel" }],
        },
        createBrdSlateTable(value),
      ];
    }

    // ── Goals & Objectives ─────────────────────────────────────────────────
    if (key === "Goals_and_Objectives" && Array.isArray(value)) {
      return [
        {
          type: "heading-five" as const,
          children: [{ text: "Goals & objectives" }],
        },
        createBrdBulletedList(value),
      ];
    }

    // ── Process Scope Summary ──────────────────────────────────────────────
    if (key === "Process_Scope_Summary" && typeof value === "object" && value !== null) {
      const sectionHeader = {
        type: "heading-five" as const,
        children: [{ text: "Process Scope Summary" }],
      };

      const scopeNodes = Object.entries(value).flatMap(
        ([scopeKey, scopeValue]: [string, any]) => {
          const scopeTitle = {
            type: "heading-five" as const,
            children: [{ text: scopeKey.replace(/_/g, " ") }],
          };

          const scopeContent = Object.entries(
            scopeValue as Record<string, any>,
          ).flatMap(([_subKey, subValue]: [string, any]) => {
            if (Array.isArray(subValue)) {
              return [createBrdBulletedList(subValue)];
            }
            // Summary string — may be block HTML
            return cellChildrenFromValue(String(subValue ?? ""));
          });

          return [scopeTitle, ...scopeContent];
        },
      );

      return [sectionHeader, ...scopeNodes];
    }

    // ── Glossary ───────────────────────────────────────────────────────────
    if (key === "Glossary" && Array.isArray(value)) {
      return [
        { type: "heading-five" as const, children: [{ text: "Glossary" }] },
        createBrdSlateTable(value),
      ];
    }

    // ── Actors / Personas ──────────────────────────────────────────────────
    if (key === "Actors_Personas" && Array.isArray(value)) {
      return [
        {
          type: "heading-five" as const,
          children: [{ text: "Actors/Personas" }],
        },
        createBrdSlateTable(value),
      ];
    }

    // ── Fallback ───────────────────────────────────────────────────────────
    return [
      { type: "heading-one" as const, children: [{ text: key }] },
      ...cellChildrenFromValue(
        typeof value === "object" ? JSON.stringify(value) : String(value ?? ""),
      ),
    ];
  });
};
