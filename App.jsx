import { htmlToLeaves, slateToHtml } from "./htmlConversion";

/** If the string contains HTML tags, parse into Slate leaves with marks; otherwise plain text. */
const parseInlineHtml = (str: string): any[] => {
  if (!str) return [{ text: "" }];
  if (/<\/?[a-z][\s\S]*?>/i.test(str)) {
    return htmlToLeaves(str);
  }
  return [{ text: str }];
};

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

export const createSlateBulletedList = (items: string[]): any => {
  return {
    type: "bulleted-list" as const,
    children: items.map((item) => ({
      type: "list-item" as const,
      // list-item MUST contain block elements, not raw leaves
      children: [{ type: "paragraph" as const, children: [{ text: String(item) }] }],
    })),
  };
};

export const createSlateNumberedList = (items: string[]): any => {
  return {
    type: "numbered-list" as const,
    children: items.map((item) => ({
      type: "list-item" as const,
      children: [{ type: "paragraph" as const, children: [{ text: String(item) }] }],
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
            return {
              type: "table-cell" as const,
              children:
                val.length > 0
                  ? val.map((item: string) => ({
                      // Each array item → its own paragraph (block-safe)
                      type: "paragraph" as const,
                      children: parseInlineHtml(String(item)),
                    }))
                  : [{ type: "paragraph" as const, children: [{ text: "" }] }],
            };
          }
          return {
            type: "table-cell" as const,
            // Single value → wrapped in paragraph (block-safe)
            children: [
              {
                type: "paragraph" as const,
                children: parseInlineHtml(String(val || "")),
              },
            ],
          };
        }),
      })),
    ],
  };
};

/** BRD-specific bulleted list that parses inline HTML in items */
const createBrdBulletedList = (items: string[]): any => {
  return {
    type: "bulleted-list" as const,
    children: items.map((item) => ({
      type: "list-item" as const,
      // Paragraph wrapper is required — raw leaves inside list-item block formatting (align/indent/fontSize)
      children: [
        { type: "paragraph" as const, children: parseInlineHtml(String(item)) },
      ],
    })),
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
        {
          type: "paragraph" as const,
          children: parseInlineHtml(String(subValue)),
        },
      ]);

      return [sectionHeader, ...subNodes];
    }

    if (key === "Stakeholders_and_Key_Personnel" && Array.isArray(value)) {
      return [
        {
          type: "heading-five" as const,
          children: [{ text: "Stakeholders & Key Personnel" }],
        },
        createBrdSlateTable(value),
      ];
    }

    if (key === "Goals_and_Objectives" && Array.isArray(value)) {
      return [
        {
          type: "heading-five" as const,
          children: [{ text: "Goals & objectives" }],
        },
        createBrdBulletedList(value),
      ];
    }

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
                children: parseInlineHtml(String(subValue)),
              },
            ];
          });

          return [scopeTitle, ...scopeContent];
        },
      );

      return [sectionHeader, ...scopeNodes];
    }

    if (key === "Glossary" && Array.isArray(value)) {
      return [
        { type: "heading-five" as const, children: [{ text: "Glossary" }] },
        createBrdSlateTable(value),
      ];
    }

    if (key === "Actors_Personas" && Array.isArray(value)) {
      return [
        {
          type: "heading-five" as const,
          children: [{ text: "Actors/Personas" }],
        },
        createBrdSlateTable(value),
      ];
    }

    return [
      { type: "heading-one" as const, children: [{ text: key }] },
      {
        type: "paragraph" as const,
        children: parseInlineHtml(
          typeof value === "object" ? JSON.stringify(value) : String(value),
        ),
      },
    ];
  });
};
