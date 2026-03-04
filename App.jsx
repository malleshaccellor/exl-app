import { htmlToSlateNodes } from "./htmlConversion";

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Parse an HTML string into full Slate nodes, preserving every style prop
 * (fontSize, indent, align) and inline mark (bold, italic, etc.).
 */
const parseHtml = (str: string): any[] => {
  if (!str) return [{ text: "" }];
  if (/<\/?[a-z][\s\S]*?>/i.test(str)) return htmlToSlateNodes(str);
  return [{ text: str }];
};

/**
 * Return the children array suitable for a single paragraph node.
 *
 * • If parseHtml returns exactly one paragraph → unwrap its children.
 * • Otherwise flatten to leaves (avoids nesting blocks inside blocks).
 */
const htmlToParagraphChildren = (str: string): any[] => {
  if (!str) return [{ text: "" }];
  const nodes = parseHtml(str);
  if (nodes.length === 1 && nodes[0].type === "paragraph")
    return nodes[0].children ?? [{ text: "" }];
  const flatten = (ns: any[]): any[] =>
    ns.flatMap((n: any) => ("text" in n ? [n] : flatten(n.children || [])));
  const flat = flatten(nodes);
  return flat.length > 0 ? flat : [{ text: "" }];
};

/**
 * Build a Slate heading-five node.
 *
 * If `headingHtml` is provided (from the saved `_headings` map) we fully
 * deserialise it so bold / italic / fontSize / indent / align are all restored.
 * Otherwise we fall back to a plain text heading.
 */
const makeHeadingFive = (fallbackText: string, headingHtml?: string): any => {
  if (headingHtml) {
    const nodes = htmlToSlateNodes(headingHtml);
    // htmlToSlateNodes wraps <h5> content in a heading-five node — return it
    if (nodes.length === 1 && nodes[0].type === "heading-five") return nodes[0];
    // Unexpected shape — still better than losing styles: wrap in heading-five
    if (nodes.length > 0) {
      const flat = (ns: any[]): any[] =>
        ns.flatMap((n: any) => ("text" in n ? [n] : flat(n.children || [])));
      return { type: "heading-five" as const, children: flat(nodes) };
    }
  }
  return { type: "heading-five" as const, children: [{ text: fallbackText }] };
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
          children: [{
            type: "paragraph" as const,
            children: [{ text: header.replace(/_/g, " "), bold: true }],
          }],
        })),
      },
      ...data.map((row) => ({
        type: "table-row" as const,
        children: headers.map((key) => {
          const val = row[key];
          if (Array.isArray(val)) {
            return {
              type: "table-cell" as const,
              children: val.length > 0
                ? val.map((item: string) => ({
                    type: "paragraph" as const,
                    children: [{ text: String(item) }],
                  }))
                : [{ type: "paragraph" as const, children: [{ text: "" }] }],
            };
          }
          return {
            type: "table-cell" as const,
            children: [{ type: "paragraph" as const, children: [{ text: String(val || "") }] }],
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
 * Build a Slate table from BRD JSON data.
 * Cell values are fully deserialised so fontSize/indent/align/marks survive.
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
          children: [{
            type: "paragraph" as const,
            children: [{ text: header.replace(/_/g, " "), bold: true }],
          }],
        })),
      },
      ...data.map((row) => ({
        type: "table-row" as const,
        children: headers.map((key) => {
          const val = row[key];
          if (Array.isArray(val)) {
            return {
              type: "table-cell" as const,
              children: val.length > 0
                ? val.map((item: string) => ({
                    type: "paragraph" as const,
                    children: htmlToParagraphChildren(String(item)),
                  }))
                : [{ type: "paragraph" as const, children: [{ text: "" }] }],
            };
          }
          const parsed    = parseHtml(String(val || ""));
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
 * Each item is fully deserialised so inline marks survive.
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
// KEY DESIGN: `_headings` metadata map
// ─────────────────────────────────────
// slateToBrdJson now saves a `_headings` object alongside the section data:
//
//   {
//     "Executive_Summary": { "Introduction": "…", … },
//     "_headings": {
//       "Executive_Summary": "<h5 style='font-size:20px'><strong>…</strong></h5>",
//       "Introduction":      "<h5 style='text-align:center'>Introduction</h5>",
//       "Stakeholders_and_Key_Personnel": "<h5><em>Stakeholders…</em></h5>",
//       …
//     }
//   }
//
// Here we read that map and pass each entry into makeHeadingFive(), which
// deserialises the HTML back into a full Slate heading-five node — restoring
// every style the user applied (bold, italic, fontSize, indent, align).
//
// If no `_headings` entry exists for a key (e.g. fresh AI-generated content),
// makeHeadingFive() falls back gracefully to a plain text heading.

export const transformBRDDataToSlate = (obj: any): any[] => {
  if (!obj) return [{ type: "paragraph", children: [{ text: "" }] }];

  // Extract and remove the headings metadata before processing sections
  const headingsMap: Record<string, string> = obj["_headings"] || {};

  return Object.entries(obj).flatMap(([key, value]) => {
    // Skip the internal metadata key — it is not a content section
    if (key === "_headings") return [];

    // ── Executive Summary ──────────────────────────────────────────────────
    if (key === "Executive_Summary" && typeof value === "object" && value !== null) {
      // Restore the top-level heading with its saved styles
      const sectionHeader = makeHeadingFive("Executive Summary", headingsMap["Executive_Summary"]);

      const subNodes = Object.entries(value).flatMap(([subKey, subValue]) => {
        const subDisplayText = subKey.replace(/_/g, " ");

        // Restore the sub-heading (Introduction, Problem Statement, etc.)
        const subHeadingNode = makeHeadingFive(subDisplayText, headingsMap[subKey]);

        // Restore the content (paragraphs, possibly with block styles)
        const contentNodes = parseHtml(String(subValue));
        const hasBlocks    = contentNodes.some((n: any) => n.type !== undefined && !("text" in n));
        const contentBlock = hasBlocks
          ? contentNodes
          : [{ type: "paragraph" as const, children: contentNodes }];

        return [subHeadingNode, ...contentBlock];
      });

      return [sectionHeader, ...subNodes];
    }

    // ── Stakeholders & Key Personnel ───────────────────────────────────────
    if (key === "Stakeholders_and_Key_Personnel" && Array.isArray(value)) {
      return [
        makeHeadingFive("Stakeholders & Key Personnel", headingsMap["Stakeholders_and_Key_Personnel"]),
        createBrdSlateTable(value),
      ];
    }

    // ── Goals & Objectives ─────────────────────────────────────────────────
    if (key === "Goals_and_Objectives" && Array.isArray(value)) {
      return [
        makeHeadingFive("Goals & objectives", headingsMap["Goals_and_Objectives"]),
        createBrdBulletedList(value),
      ];
    }

    // ── Process Scope Summary ──────────────────────────────────────────────
    if (key === "Process_Scope_Summary" && typeof value === "object" && value !== null) {
      const sectionHeader = makeHeadingFive("Process Scope Summary", headingsMap["Process_Scope_Summary"]);

      const scopeNodes = Object.entries(value).flatMap(
        ([scopeKey, scopeValue]: [string, any]) => {
          const scopeDisplayText = scopeKey.replace(/_/g, " ");
          const scopeTitle = makeHeadingFive(scopeDisplayText, headingsMap[scopeKey]);

          const scopeContent = Object.entries(scopeValue as Record<string, any>).flatMap(
            ([_subKey, subValue]: [string, any]) => {
              if (Array.isArray(subValue)) return [createBrdBulletedList(subValue)];
              const parsed    = parseHtml(String(subValue));
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

    // ── Glossary ───────────────────────────────────────────────────────────
    if (key === "Glossary" && Array.isArray(value)) {
      return [
        makeHeadingFive("Glossary", headingsMap["Glossary"]),
        createBrdSlateTable(value),
      ];
    }

    // ── Actors / Personas ──────────────────────────────────────────────────
    if (key === "Actors_Personas" && Array.isArray(value)) {
      return [
        makeHeadingFive("Actors/Personas", headingsMap["Actors_Personas"]),
        createBrdSlateTable(value),
      ];
    }

    // ── Fallback (unknown keys) ────────────────────────────────────────────
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
