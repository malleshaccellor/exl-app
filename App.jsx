import { htmlToSlateNodes } from "./htmlConversion";

// =============================================================================
// HELPERS
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
  const flat = (ns: any[]): any[] => ns.flatMap((n: any) => ("text" in n ? [n] : flat(n.children || [])));
  const result = flat(nodes);
  return result.length > 0 ? result : [{ text: "" }];
};

/**
 * Build a heading-five Slate node from saved HTML.
 *
 * headingHtml must be a full <h5 …>…</h5> string produced by serializeNode().
 * If absent or unparseable, falls back to a plain text heading.
 */
const makeHeadingFive = (fallback: string, headingHtml?: string): any => {
  if (headingHtml && /<h5[\s>]/i.test(headingHtml)) {
    const nodes = htmlToSlateNodes(headingHtml);
    if (nodes.length === 1 && nodes[0].type === "heading-five") return nodes[0];
    if (nodes.length > 0) {
      const flat = (ns: any[]): any[] => ns.flatMap((n: any) => ("text" in n ? [n] : flat(n.children || [])));
      return { type: "heading-five" as const, children: flat(nodes) };
    }
  }
  return { type: "heading-five" as const, children: [{ text: fallback }] };
};

// =============================================================================
// GENERIC BUILDERS (non-BRD)
// =============================================================================

export const createSlateTable = (data: any[]): any => {
  if (!data || data.length === 0) return { type: "paragraph", children: [{ text: "" }] };
  const headers = Object.keys(data[0]);
  return {
    type: "table" as const, className: "editor-custom-table",
    children: [
      {
        type: "table-row" as const,
        children: headers.map((h) => ({
          type: "table-cell-header" as const,
          children: [{ type: "paragraph" as const, children: [{ text: h.replace(/_/g, " "), bold: true }] }],
        })),
      },
      ...data.map((row) => ({
        type: "table-row" as const,
        children: headers.map((key) => {
          const val = row[key];
          if (Array.isArray(val))
            return { type: "table-cell" as const, children: val.length > 0
              ? val.map((v: string) => ({ type: "paragraph" as const, children: [{ text: String(v) }] }))
              : [{ type: "paragraph" as const, children: [{ text: "" }] }] };
          return { type: "table-cell" as const, children: [{ type: "paragraph" as const, children: [{ text: String(val || "") }] }] };
        }),
      })),
    ],
  };
};

export const createSlateBulletedList = (items: string[]): any => ({
  type: "bulleted-list" as const,
  children: items.map((item) => ({ type: "list-item" as const, children: [{ text: String(item) }] })),
});

export const createSlateNumberedList = (items: string[]): any => ({
  type: "numbered-list" as const,
  children: items.map((item) => ({ type: "list-item" as const, children: [{ text: String(item) }] })),
});

// =============================================================================
// BRD BUILDERS
// =============================================================================

const createBrdTable = (data: any[]): any => {
  if (!data || data.length === 0) return { type: "paragraph", children: [{ text: "" }] };
  const headers = Object.keys(data[0]);
  return {
    type: "table" as const, className: "editor-custom-table",
    children: [
      {
        type: "table-row" as const,
        children: headers.map((h) => ({
          type: "table-cell-header" as const,
          children: [{ type: "paragraph" as const, children: [{ text: h.replace(/_/g, " "), bold: true }] }],
        })),
      },
      ...data.map((row) => ({
        type: "table-row" as const,
        children: headers.map((key) => {
          const val = row[key];
          if (Array.isArray(val))
            return { type: "table-cell" as const, children: val.length > 0
              ? val.map((v: string) => ({ type: "paragraph" as const, children: htmlToParagraphChildren(String(v)) }))
              : [{ type: "paragraph" as const, children: [{ text: "" }] }] };
          const parsed = parseHtml(String(val || ""));
          const hasBlocks = parsed.some((n: any) => n.type && !("text" in n));
          return { type: "table-cell" as const, children: hasBlocks ? parsed : [{ type: "paragraph" as const, children: parsed }] };
        }),
      })),
    ],
  };
};

const createBrdBulletList = (items: string[]): any => ({
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
// Reads the JSON shape written by slateToBrdJson (converters.ts).
//
// NEW shape (with style persistence):
//   "Executive_Summary": {
//     "_title": "<h5 style='text-align:center'><strong>Executive Summary</strong></h5>",
//     "Introduction": {
//       "_title":   "<h5 style='padding-left:24px'>Introduction</h5>",
//       "_content": "<p>...</p>"
//     }
//   }
//   "Stakeholders_and_Key_Personnel": { "_title": "<h5>…</h5>", "_data": […] }
//   "Goals_and_Objectives":           { "_title": "<h5>…</h5>", "_data": […] }
//   "Process_Scope_Summary": {
//     "_title": "<h5>…</h5>",
//     "In_Scope":    { "_title": "<h5>…</h5>", "Summary": "…", "High_Level_Requirements": […] }
//     "Out_of_Scope":{ "_title": "<h5>…</h5>", "Summary": "…", "Exclusions": […] }
//   }
//
// BACKWARD COMPAT: also handles old shape where values were plain strings/arrays.
// "_headings" top-level map used as secondary fallback.

export const transformBRDDataToSlate = (obj: any): any[] => {
  if (!obj) return [{ type: "paragraph", children: [{ text: "" }] }];

  // Secondary fallback: old _headings map
  const oldHeadings: Record<string, string> = obj["_headings"] || {};

  // Get title HTML for a section: check _title in value, then _headings map
  const getTitleHtml = (key: string, value: any): string | undefined => {
    if (value && typeof value === "object" && typeof value._title === "string" && /<h5[\s>]/i.test(value._title))
      return value._title;
    const fromMap = oldHeadings[key];
    if (fromMap && /<h5[\s>]/i.test(fromMap)) return fromMap;
    return undefined;
  };

  // Get the actual data array from { _title, _data } or plain array
  const getData = (value: any): any[] => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object" && Array.isArray(value._data)) return value._data;
    return [];
  };

  // Get content string from { _title, _content } or plain string
  const getContent = (value: any): string => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && typeof value._content === "string") return value._content;
    return "";
  };

  // Get the plain-text fallback name from a key
  const keyToDisplay = (key: string): string => key.replace(/_/g, " ");

  return Object.entries(obj).flatMap(([key, value]) => {
    if (key === "_headings") return [];

    // ── Executive Summary ────────────────────────────────────────────────────
    if (key === "Executive_Summary") {
      const header = makeHeadingFive("Executive Summary", getTitleHtml(key, value));

      const sectionObj = (value && typeof value === "object" && !Array.isArray(value)) ? value : {};

      const subNodes = Object.entries(sectionObj).flatMap(([subKey, subValue]) => {
        if (subKey === "_title") return [];

        const subHtml    = getTitleHtml(subKey, subValue);
        const subHeading = makeHeadingFive(keyToDisplay(subKey), subHtml);

        const contentStr  = getContent(subValue);
        const parsed      = parseHtml(contentStr);
        const hasBlocks   = parsed.some((n: any) => n.type && !("text" in n));
        const content     = hasBlocks ? parsed : [{ type: "paragraph" as const, children: parsed }];

        return [subHeading, ...content];
      });

      return [header, ...subNodes];
    }

    // ── Stakeholders & Key Personnel ─────────────────────────────────────────
    if (key === "Stakeholders_and_Key_Personnel") {
      const data = getData(value);
      return [
        makeHeadingFive("Stakeholders & Key Personnel", getTitleHtml(key, value)),
        createBrdTable(data),
      ];
    }

    // ── Goals & Objectives ───────────────────────────────────────────────────
    if (key === "Goals_and_Objectives") {
      const data = getData(value);
      return [
        makeHeadingFive("Goals & objectives", getTitleHtml(key, value)),
        createBrdBulletList(data),
      ];
    }

    // ── Process Scope Summary ────────────────────────────────────────────────
    if (key === "Process_Scope_Summary") {
      const header = makeHeadingFive("Process Scope Summary", getTitleHtml(key, value));

      const sectionObj = (value && typeof value === "object" && !Array.isArray(value)) ? value : {};

      const scopeNodes = Object.entries(sectionObj).flatMap(([scopeKey, scopeValue]: [string, any]) => {
        if (scopeKey === "_title") return [];

        const scopeTitle = makeHeadingFive(keyToDisplay(scopeKey), getTitleHtml(scopeKey, scopeValue));

        const scopeObj = (scopeValue && typeof scopeValue === "object" && !Array.isArray(scopeValue))
          ? scopeValue : {};

        const content = Object.entries(scopeObj).flatMap(([sk, sv]: [string, any]) => {
          if (sk === "_title") return [];
          if (Array.isArray(sv)) return [createBrdBulletList(sv)];
          const parsed    = parseHtml(String(sv ?? ""));
          const hasBlocks = parsed.some((n: any) => n.type && !("text" in n));
          return hasBlocks ? parsed : [{ type: "paragraph" as const, children: parsed }];
        });

        return [scopeTitle, ...content];
      });

      return [header, ...scopeNodes];
    }

    // ── Glossary ─────────────────────────────────────────────────────────────
    if (key === "Glossary") {
      return [
        makeHeadingFive("Glossary", getTitleHtml(key, value)),
        createBrdTable(getData(value)),
      ];
    }

    // ── Actors / Personas ────────────────────────────────────────────────────
    if (key === "Actors_Personas") {
      return [
        makeHeadingFive("Actors/Personas", getTitleHtml(key, value)),
        createBrdTable(getData(value)),
      ];
    }

    // ── Section Citations (metadata only — skip) ─────────────────────────────
    if (key === "Section_Citations") return [];

    // ── Fallback ─────────────────────────────────────────────────────────────
    const contentStr = getContent(value);
    return [
      { type: "heading-one" as const, children: [{ text: key }] },
      { type: "paragraph" as const, children: htmlToParagraphChildren(
          contentStr || (typeof value === "object" ? JSON.stringify(value) : String(value ?? ""))) },
    ];
  });
};
