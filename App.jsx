import { htmlToSlateNodes } from "./htmlConversion";

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

const parseHtml = (str: string): any[] => {
  if (!str) return [{ text: "" }];
  if (/<\/?[a-z][\s\S]*?>/i.test(str)) return htmlToSlateNodes(str);
  return [{ text: str }];
};

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
 * Build a Slate heading-five node from saved HTML.
 *
 * Reads from (in priority order):
 *   1. headingHtml  — full serialised HTML of the heading node
 *   2. fallbackText — plain text fallback for fresh AI-generated content
 */
const makeHeadingFive = (fallbackText: string, headingHtml?: string): any => {
  if (headingHtml) {
    const nodes = htmlToSlateNodes(headingHtml);
    if (nodes.length === 1 && nodes[0].type === "heading-five") return nodes[0];
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
// JSON shape written by slateToBrdJson (new format):
//
//   "Executive_Summary": {
//     "_title":   "<h5 style='...'>...</h5>",   ← heading HTML with all styles
//     "Introduction": {
//       "_title":   "<h5 ...>Introduction</h5>",
//       "_content": "<p ...>content</p>"
//     }
//   }
//
//   "Stakeholders_and_Key_Personnel": {
//     "_title": "<h5>...</h5>",
//     "_data":  [ ...rows... ]
//   }
//
//   "Goals_and_Objectives": {
//     "_title": "<h5>...</h5>",
//     "_data":  [ ...items... ]
//   }
//
// Also supports OLD format (plain string values / plain arrays) for backward
// compatibility with JSON saved before this fix.
//
// "_headings" top-level map is also supported as a further fallback.

export const transformBRDDataToSlate = (obj: any): any[] => {
  if (!obj) return [{ type: "paragraph", children: [{ text: "" }] }];

  // Top-level _headings map (backward compat / secondary fallback)
  const headingsMap: Record<string, string> = obj["_headings"] || {};

  // Helper: get heading HTML for a key, checking _title inside value first,
  // then _headings map, then nothing (plain text fallback in makeHeadingFive).
  const getTitleHtml = (key: string, value?: any): string | undefined => {
    if (value && typeof value === "object" && typeof value._title === "string")
      return value._title;
    return headingsMap[key];
  };

  // Helper: get the actual data from a section value that may be wrapped in
  // the new { _title, _data } shape or the old plain shape.
  const unwrapData = (value: any): any => {
    if (value && typeof value === "object" && !Array.isArray(value) && "_data" in value)
      return value._data;
    return value;
  };

  // Helper: get content string from a sub-section value that may be wrapped
  // in { _title, _content } or may be a plain string.
  const unwrapContent = (value: any): string => {
    if (value && typeof value === "object" && !Array.isArray(value) && "_content" in value)
      return value._content ?? "";
    if (typeof value === "string") return value;
    return String(value ?? "");
  };

  return Object.entries(obj).flatMap(([key, value]) => {
    if (key === "_headings") return [];  // internal metadata

    // ── Executive Summary ────────────────────────────────────────────────────
    if (key === "Executive_Summary") {
      const sectionHeader = makeHeadingFive(
        "Executive Summary", getTitleHtml(key, value));

      // value may be { _title, Introduction: { _title, _content }, ... }
      // or old format { Introduction: "plain string", ... }
      const sectionData = (typeof value === "object" && value !== null) ? value : {};

      const subNodes = Object.entries(sectionData).flatMap(([subKey, subValue]) => {
        if (subKey === "_title") return []; // skip metadata

        const subDisplayText = subKey.replace(/_/g, " ");
        const subHeadingHtml = getTitleHtml(subKey, subValue);
        const subHeadingNode = makeHeadingFive(subDisplayText, subHeadingHtml);

        const contentStr  = unwrapContent(subValue);
        const contentNodes = parseHtml(contentStr);
        const hasBlocks    = contentNodes.some((n: any) => n.type !== undefined && !("text" in n));
        const contentBlock = hasBlocks
          ? contentNodes
          : [{ type: "paragraph" as const, children: contentNodes }];

        return [subHeadingNode, ...contentBlock];
      });

      return [sectionHeader, ...subNodes];
    }

    // ── Stakeholders & Key Personnel ─────────────────────────────────────────
    if (key === "Stakeholders_and_Key_Personnel") {
      const data = unwrapData(value);
      return [
        makeHeadingFive("Stakeholders & Key Personnel", getTitleHtml(key, value)),
        ...(Array.isArray(data) ? [createBrdSlateTable(data)] : []),
      ];
    }

    // ── Goals & Objectives ───────────────────────────────────────────────────
    if (key === "Goals_and_Objectives") {
      const data = unwrapData(value);
      return [
        makeHeadingFive("Goals & objectives", getTitleHtml(key, value)),
        ...(Array.isArray(data) ? [createBrdBulletedList(data)] : []),
      ];
    }

    // ── Process Scope Summary ────────────────────────────────────────────────
    if (key === "Process_Scope_Summary") {
      const sectionHeader = makeHeadingFive(
        "Process Scope Summary", getTitleHtml(key, value));

      const sectionData = (typeof value === "object" && value !== null) ? value : {};

      const scopeNodes = Object.entries(sectionData).flatMap(
        ([scopeKey, scopeValue]: [string, any]) => {
          if (scopeKey === "_title") return [];

          const scopeDisplayText = scopeKey.replace(/_/g, " ");
          const scopeTitleHtml   = getTitleHtml(scopeKey, scopeValue);
          const scopeTitle       = makeHeadingFive(scopeDisplayText, scopeTitleHtml);

          // scopeValue may be { _title, Summary, High_Level_Requirements, Exclusions }
          const scopeData = (typeof scopeValue === "object" && scopeValue !== null)
            ? scopeValue : {};

          const scopeContent = Object.entries(scopeData).flatMap(
            ([_subKey, subValue]: [string, any]) => {
              if (_subKey === "_title") return [];
              if (Array.isArray(subValue)) return [createBrdBulletedList(subValue)];
              const parsed    = parseHtml(String(subValue ?? ""));
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

    // ── Glossary ─────────────────────────────────────────────────────────────
    if (key === "Glossary") {
      const data = unwrapData(value);
      return [
        makeHeadingFive("Glossary", getTitleHtml(key, value)),
        ...(Array.isArray(data) ? [createBrdSlateTable(data)] : []),
      ];
    }

    // ── Actors / Personas ────────────────────────────────────────────────────
    if (key === "Actors_Personas") {
      const data = unwrapData(value);
      return [
        makeHeadingFive("Actors/Personas", getTitleHtml(key, value)),
        ...(Array.isArray(data) ? [createBrdSlateTable(data)] : []),
      ];
    }

    // ── Section Citations (skip — metadata only) ─────────────────────────────
    if (key === "Section_Citations") return [];

    // ── Fallback ─────────────────────────────────────────────────────────────
    return [
      { type: "heading-one" as const, children: [{ text: key }] },
      {
        type: "paragraph" as const,
        children: htmlToParagraphChildren(
          typeof value === "object" ? JSON.stringify(value) : String(value)),
      },
    ];
  });
};
