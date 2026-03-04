import { htmlToSlateNodes } from "./htmlConversion";

// ── Inline-HTML parser (full block + mark deserialisation) ───────────────────
// FIX: was using htmlToLeaves() which only extracted inline marks and silently
// dropped fontSize / indent / align / block structure.  Now uses
// htmlToSlateNodes() which fully deserialises every CSS style.

const parseInlineHtml = (str: string): any[] => {
  if (!str) return [{ text: "" }];
  if (/<\/?[a-z][\s\S]*?>/i.test(str)) {
    return htmlToSlateNodes(str);
  }
  return [{ text: str }];
};

// ── Helper: turn a parsed-HTML result into paragraph *children* ──────────────
// If htmlToSlateNodes returned a single paragraph node we unwrap it so the
// leaves can be used directly as `children` of a caller-supplied paragraph.
const htmlToParagraphChildren = (str: string): any[] => {
  if (!str) return [{ text: "" }];
  const nodes = parseInlineHtml(str);
  if (nodes.length === 1 && nodes[0].type === "paragraph") {
    return nodes[0].children ?? [{ text: "" }];
  }
  return nodes;
};

// ── Generic (non-BRD) table ──────────────────────────────────────────────────

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

// ── BRD table ────────────────────────────────────────────────────────────────
// FIX: uses htmlToParagraphChildren / parseInlineHtml (backed by
// htmlToSlateNodes) so fontSize, indent, align and inline marks all survive.

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

          // Array → one paragraph per item, each fully deserialised
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

          // String value — if it has block-level nodes use them directly
          const parsed = parseInlineHtml(String(val || ""));
          const hasBlocks = parsed.some(
            (n: any) => n.type !== undefined && !("text" in n),
          );
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

// ── BRD bulleted list ────────────────────────────────────────────────────────
// FIX: uses htmlToParagraphChildren so bold/italic/fontSize in item HTML is
// preserved as Slate marks rather than being stripped.

const createBrdBulletedList = (items: string[]): any => ({
  type: "bulleted-list" as const,
  children: items.map((item) => ({
    type: "list-item" as const,
    children: htmlToParagraphChildren(String(item)),
  })),
});

// ── transformBRDDataToSlate ──────────────────────────────────────────────────

export const transformBRDDataToSlate = (obj: any): any[] => {
  if (!obj) return [{ type: "paragraph", children: [{ text: "" }] }];

  return Object.entries(obj).flatMap(([key, value]) => {
    // ── Executive Summary ──────────────────────────────────────────────────
    if (
      key === "Executive_Summary" &&
      typeof value === "object" &&
      value !== null
    ) {
      const sectionHeader = {
        type: "heading-five" as const,
        children: [{ text: "Executive Summary" }],
      };
      const subNodes = Object.entries(value).flatMap(
        ([subKey, subValue]) => [
          {
            type: "heading-five" as const,
            children: [{ text: subKey.replace(/_/g, " ") }],
          },
          {
            type: "paragraph" as const,
            // FIX: was parseInlineHtml(String(subValue)) with old htmlToLeaves
            children: htmlToParagraphChildren(String(subValue)),
          },
        ],
      );
      return [sectionHeader, ...subNodes];
    }

    // ── Stakeholders ───────────────────────────────────────────────────────
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
    if (
      key === "Process_Scope_Summary" &&
      typeof value === "object" &&
      value !== null
    ) {
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
            return [
              {
                type: "paragraph" as const,
                // FIX: full deserialisation preserves fontSize/align/indent
                children: htmlToParagraphChildren(String(subValue)),
              },
            ];
          });
          return [scopeTitle, ...scopeContent];
        },
      );
      return [sectionHeader, ...scopeNodes];
    }

    // ── Glossary ───────────────────────────────────────────────────────────
    if (key === "Glossary" && Array.isArray(value)) {
      return [
        {
          type: "heading-five" as const,
          children: [{ text: "Glossary" }],
        },
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
      {
        type: "paragraph" as const,
        children: htmlToParagraphChildren(
          typeof value === "object" ? JSON.stringify(value) : String(value),
        ),
      },
    ];
  });
};
