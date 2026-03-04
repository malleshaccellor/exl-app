import { htmlToSlateNodes } from "./htmlConversion";

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Parse an HTML string into full Slate nodes (preserving fontSize, indent,
 * align, bold, italic, etc.).
 *
 * FIX: the old version called htmlToLeaves() which only extracted inline marks
 * and silently discarded every block-level style property.
 */
const parseInlineHtml = (str: string): any[] => {
  if (!str) return [{ text: "" }];
  if (/<\/?[a-z][\s\S]*?>/i.test(str)) {
    return htmlToSlateNodes(str);
  }
  return [{ text: str }];
};

/**
 * Turn a parsed-HTML result into the children array of a single paragraph.
 *
 * If htmlToSlateNodes returned exactly one paragraph we unwrap it so the
 * caller's own paragraph wrapper doesn't create a double-nested paragraph.
 * If it returned multiple blocks (e.g. a heading + paragraph) we return them
 * as-is so they can be spread directly into the parent node list.
 */
const htmlToParagraphChildren = (str: string): any[] => {
  if (!str) return [{ text: "" }];
  const nodes = parseInlineHtml(str);
  if (nodes.length === 1 && nodes[0].type === "paragraph") {
    return nodes[0].children ?? [{ text: "" }];
  }
  // Multiple or non-paragraph blocks — return leaf text from the first node
  // to avoid nesting block nodes inside another block's children array.
  // Callers that need full block output should use parseInlineHtml() directly.
  if (nodes.length === 1 && "text" in nodes[0]) return nodes;
  // Flatten to leaves when content is complex
  const flatten = (ns: any[]): any[] =>
    ns.flatMap((n: any) =>
      "text" in n ? [n] : flatten(n.children || []),
    );
  const flat = flatten(nodes);
  return flat.length > 0 ? flat : [{ text: "" }];
};

// =============================================================================
// GENERIC SLATE BUILDERS  (non-BRD)
// =============================================================================

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
          if (Array.isArray(val)) {
            return {
              type: "table-cell" as const,
              children:
                val.length > 0
                  ? val.map((item: string) => ({
                      type: "paragraph" as const,
                      children: [{ text: String(item) }],
                    }))
                  : [{ type: "paragraph" as const, children: [{ text: "" }] }],
            };
          }
          return {
            type: "table-cell" as const,
            children: [
              { type: "paragraph" as const, children: [{ text: String(val || "") }] },
            ],
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
    children: [{ text: String(item) }],
  })),
});

export const createSlateNumberedList = (items: string[]): any => ({
  type: "numbered-list" as const,
  children: items.map((item) => ({
    type: "list-item" as const,
    children: [{ text: String(item) }],
  })),
});

// =============================================================================
// BRD-SPECIFIC BUILDERS
// =============================================================================

/**
 * Build a Slate table from BRD JSON data, fully preserving inline HTML styles.
 *
 * FIX: array items and string values are both run through htmlToParagraphChildren
 * (backed by htmlToSlateNodes) so fontSize, indent, align, bold, italic etc.
 * are all preserved as proper Slate marks and block props.
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

          // Array → one paragraph per item with full HTML deserialisation
          if (Array.isArray(val)) {
            return {
              type: "table-cell" as const,
              children:
                val.length > 0
                  ? val.map((item: string) => ({
                      type: "paragraph" as const,
                      children: htmlToParagraphChildren(String(item)),
                    }))
                  : [{ type: "paragraph" as const, children: [{ text: "" }] }],
            };
          }

          // String value — detect whether it parsed into block nodes
          const parsed    = parseInlineHtml(String(val || ""));
          const hasBlocks = parsed.some((n: any) => n.type !== undefined && !("text" in n));
          return {
            type: "table-cell" as const,
            children: hasBlocks
              ? parsed
              : [{ type: "paragraph" as const, children: parsed }],
          };
        }),
      })),
    ],
  };
};

/**
 * Build a Slate bulleted list from BRD JSON items.
 *
 * FIX: each item is run through htmlToParagraphChildren so bold/italic/
 * fontSize inside an item's HTML string is preserved as Slate marks.
 */
const createBrdBulletedList = (items: string[]): any => ({
  type: "bulleted-list" as const,
  children: items.map((item) => ({
    type: "list-item" as const,
    children: htmlToParagraphChildren(String(item)),
  })),
});

// =============================================================================
// transformBRDDataToSlate
// =============================================================================
//
// FIX summary for heading nodes:
//
// Previously every section header was created as a plain heading-five with
// a hardcoded text leaf:
//   { type:"heading-five", children:[{ text:"Executive Summary" }] }
//
// This means any fontSize / align / indent / bold / italic the user applied
// to that heading in the editor was thrown away on every save→reload cycle
// because slateToBrdJson stores the section by its plain-text key name, not
// as HTML.
//
// The correct fix is twofold:
//   1. When READING from JSON: keep hardcoded headings for known section keys
//      (they're structural, not user-editable content) — no change needed here.
//   2. When WRITING to JSON: slateToBrdJson must use serializeBlockNode (not
//      childrenToText) for content nodes inside sections so styles survive.
//      That is handled in converters.ts.
//
// Sub-section headings inside Executive Summary (e.g. "Introduction",
// "Problem Statement") are CONTENT headings — the user can style them.
// They are stored as HTML strings in the JSON (e.g.
// "<h5 style=\"font-size:20px\"><strong>Introduction</strong></h5>").
// On reload htmlToSlateNodes correctly deserialises them with all styles.

export const transformBRDDataToSlate = (obj: any): any[] => {
  if (!obj) return [{ type: "paragraph", children: [{ text: "" }] }];

  return Object.entries(obj).flatMap(([key, value]) => {

    // ── Executive Summary ───────────────────────────────────────────────────
    if (key === "Executive_Summary" && typeof value === "object" && value !== null) {
      const sectionHeader = {
        type: "heading-five" as const,
        children: [{ text: "Executive Summary" }],
      };

      const subNodes = Object.entries(value).flatMap(([subKey, subValue]) => {
        // Sub-heading: may have been saved as plain text or as HTML
        // (e.g. "<h5 style='font-size:20px'>Introduction</h5>")
        const subHeadingText = subKey.replace(/_/g, " ");
        const parsedHeading  = parseInlineHtml(subHeadingText);

        // If the stored subKey itself is HTML use it; otherwise build a plain heading
        const subHeadingNode = /<\/?[a-z]/i.test(subKey)
          ? parsedHeading          // already full Slate nodes
          : [{ type: "heading-five" as const, children: [{ text: subHeadingText }] }];

        // Content: fully deserialised so styles survive
        const contentNodes = parseInlineHtml(String(subValue));
        const hasBlocks    = contentNodes.some((n: any) => n.type !== undefined && !("text" in n));
        const contentBlock = hasBlocks
          ? contentNodes
          : [{ type: "paragraph" as const, children: contentNodes }];

        return [...subHeadingNode, ...contentBlock];
      });

      return [sectionHeader, ...subNodes];
    }

    // ── Stakeholders & Key Personnel ────────────────────────────────────────
    if (key === "Stakeholders_and_Key_Personnel" && Array.isArray(value)) {
      return [
        { type: "heading-five" as const, children: [{ text: "Stakeholders & Key Personnel" }] },
        createBrdSlateTable(value),
      ];
    }

    // ── Goals & Objectives ──────────────────────────────────────────────────
    if (key === "Goals_and_Objectives" && Array.isArray(value)) {
      return [
        { type: "heading-five" as const, children: [{ text: "Goals & objectives" }] },
        createBrdBulletedList(value),
      ];
    }

    // ── Process Scope Summary ───────────────────────────────────────────────
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

          const scopeContent = Object.entries(scopeValue as Record<string, any>).flatMap(
            ([_subKey, subValue]: [string, any]) => {
              if (Array.isArray(subValue)) {
                return [createBrdBulletedList(subValue)];
              }
              // FIX: full deserialisation preserves fontSize/align/indent/marks
              const parsed    = parseInlineHtml(String(subValue));
              const hasBlocks = parsed.some((n: any) => n.type !== undefined && !("text" in n));
              return hasBlocks
                ? parsed
                : [{ type: "paragraph" as const, children: parsed }];
            },
          );

          return [scopeTitle, ...scopeContent];
        },
      );

      return [sectionHeader, ...scopeNodes];
    }

    // ── Glossary ────────────────────────────────────────────────────────────
    if (key === "Glossary" && Array.isArray(value)) {
      return [
        { type: "heading-five" as const, children: [{ text: "Glossary" }] },
        createBrdSlateTable(value),
      ];
    }

    // ── Actors / Personas ───────────────────────────────────────────────────
    if (key === "Actors_Personas" && Array.isArray(value)) {
      return [
        { type: "heading-five" as const, children: [{ text: "Actors/Personas" }] },
        createBrdSlateTable(value),
      ];
    }

    // ── Fallback ────────────────────────────────────────────────────────────
    return [
      { type: "heading-one" as const, children: [{ text: key }] },
      {
        type: "paragraph" as const,
        children: htmlToParagraphChildren(
          typeof value === "object" ? JSON.stringify(value) : String(value),
        ),
      },
    ];
  });
};
