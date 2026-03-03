import { htmlToLeaves, htmlToSlateNodes } from "./htmlConversion";

/**
 * valueToSlateChildren — converts a stored JSON string value into Slate children.
 * - Block HTML (<p>, <ul>, <h1-6>…): full deserialize via htmlToSlateNodes — preserves
 *   align, indent, fontSize, inline marks, bullet structure.
 * - Inline HTML (<strong>, <em>…): htmlToLeaves — returns marked text leaves.
 * - Plain text: single text leaf.
 */
const BLOCK_HTML_RE = /^\s*<(p|ul|ol|h[1-6]|blockquote|pre|div|li)[\s>]/i;

const valueToSlateChildren = (str: string): any[] => {
  if (!str) return [{ text: "" }];
  const trimmed = str.trim();
  if (BLOCK_HTML_RE.test(trimmed)) {
    // Full block HTML — returns paragraph/list/heading nodes WITH styles intact
    return htmlToSlateNodes(trimmed);
  }
  if (/<\/?[a-z][\s\S]*?>/i.test(trimmed)) {
    // Inline marks only — return leaves
    return htmlToLeaves(trimmed);
  }
  return [{ text: trimmed }];
};

/** Legacy alias used by non-BRD callers — inline only */
const parseInlineHtml = (str: string): any[] => {
  if (!str) return [{ text: "" }];
  if (/<\/?[a-z][\s\S]*?>/i.test(str)) return htmlToLeaves(str);
  return [{ text: str }];
};

export const createSlateTable = (data: any[]): any => {
  if (!data || data.length === 0)
    return { type: "paragraph", children: [{ text: "" }] };

  // Get headers from the first object's keys
  const headers = Object.keys(data[0]);

  return {
    type: "table" as const,
    className: "editor-custom-table",
    children: [
      // HEADER ROW
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
      // DATA ROWS
      ...data.map((row) => ({
        type: "table-row" as const,
        children: headers.map((key) => {
          const val = row[key];
          // Preserve arrays as multiple paragraphs (one per item)
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
            children: [
              {
                type: "paragraph" as const,
                children: [{ text: String(val || "") }],
              },
            ],
          };
        }),
      })),
    ],
  };
};

export const createSlateBulletedList = (items: string[]): any => {
  return {
    type: "bulleted-list" as const,
    children: items.map((item) => ({
      type: "list-item" as const,
      children: [{ text: String(item) }],
    })),
  };
};

export const createSlateNumberedList = (items: string[]): any => {
  return {
    type: "numbered-list" as const,
    children: items.map((item) => ({
      type: "list-item" as const,
      children: [{ text: String(item) }],
    })),
  };
};

/** BRD-specific table builder that parses inline HTML in cell values */
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
          if (Array.isArray(val)) {
            // Each array item may be block HTML like "<p style=...>text</p>"
            // valueToSlateChildren returns proper block nodes preserving all styles
            const arrayChildren = val.length > 0
              ? val.flatMap((item: string) => valueToSlateChildren(String(item)))
              : [{ type: "paragraph" as const, children: [{ text: "" }] }];
            return { type: "table-cell" as const, children: arrayChildren };
          }
          // Single string value — may be block HTML with styles
          const cellChildren = valueToSlateChildren(String(val || ""));
          return { type: "table-cell" as const, children: cellChildren };
        }),
      })),
    ],
  };
};

/** BRD-specific bulleted list — items may be block HTML like "<p style=...>text</p>" */
const createBrdBulletedList = (items: string[]): any => {
  return {
    type: "bulleted-list" as const,
    children: items.map((item) => {
      // valueToSlateChildren returns paragraph node(s) with all styles (align/indent/fontSize)
      // list-item must contain block children (paragraphs), never raw leaves
      const blockChildren = valueToSlateChildren(String(item));
      return { type: "list-item" as const, children: blockChildren };
    }),
  };
};

export const transformBRDDataToSlate = (obj: any) => {
  if (!obj) return [{ type: "paragraph", children: [{ text: "" }] }];

  return Object.entries(obj).flatMap(([key, value]) => {
    if (
      key === "Executive_Summary" &&
      typeof value === "object" &&
      value !== null
    ) {
      const sectionHeader = {
        type: "heading-five" as const,
        children: [{ text: "Executive Summary" }],
      };

      const subNodes = Object.entries(value).flatMap(([subKey, subValue]) => [
        {
          type: "heading-five" as const,
          children: [{ text: subKey.replace(/_/g, " ") }],
        },
        // subValue is block HTML like "<p style=...>text</p>" — spread the returned nodes
        ...valueToSlateChildren(String(subValue)),
      ]);

      return [sectionHeader, ...subNodes];
    }

    if (key === "Stakeholders_and_Key_Personnel" && Array.isArray(value)) {
      const sectionHeader = {
        type: "heading-five" as const,
        children: [{ text: "Stakeholders & Key Personnel" }],
      };

      const tableNode = createBrdSlateTable(value);

      return [sectionHeader, tableNode];
    }

    if (key === "Goals_and_Objectives" && Array.isArray(value)) {
      const sectionHeader = {
        type: "heading-five" as const,
        children: [{ text: "Goals & objectives" }],
      };

      const listNodes = createBrdBulletedList(value);

      return [sectionHeader, listNodes];
    }

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

          // Process the content inside In_Scope / Out_of_Scope
          const scopeContent = Object.entries(scopeValue as Record<string, any>).flatMap(
            ([_subKey, subValue]: [string, any]) => {
              // 1. If it's the list of requirements/exclusions (Array)
              if (Array.isArray(subValue)) {
                return [createBrdBulletedList(subValue)];
              }

              // 2. If it's the Summary (String) — may be block HTML with styles
              return valueToSlateChildren(String(subValue));
            },
          );

          return [scopeTitle, ...scopeContent];
        },
      );

      return [sectionHeader, ...scopeNodes];
    }

    if (key === "Glossary" && Array.isArray(value)) {
      const sectionHeader = {
        type: "heading-five" as const,
        children: [{ text: "Glossary" }],
      };

      const tableNode = createBrdSlateTable(value);

      return [sectionHeader, tableNode];
    }

    if (key === "Actors_Personas" && Array.isArray(value)) {
      const sectionHeader = {
        type: "heading-five" as const,
        children: [{ text: "Actors/Personas" }],
      };

      const tableNode = createBrdSlateTable(value);

      return [sectionHeader, tableNode];
    }

    return [
      { type: "heading-one" as const, children: [{ text: key }] },
      ...valueToSlateChildren(
        typeof value === "object" ? JSON.stringify(value) : String(value),
      ),
    ];
  });
};
