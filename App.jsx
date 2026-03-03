import { htmlToLeaves, htmlToSlateNodes } from "./htmlConversion";

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
            return {
              type: "table-cell" as const,
              children: val.length > 0
                ? val.map((item: string) => ({
                    type: "paragraph" as const,
                    children: parseInlineHtml(String(item)),
                  }))
                : [{ type: "paragraph" as const, children: [{ text: "" }] }],
            };
          }
          return {
            type: "table-cell" as const,
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

/**
 * BRD-specific bulleted list builder.
 *
 * Items can be either:
 *   1. Plain strings  → "Some goal text"
 *   2. Styled spans   → "<span data-brd-li="padding-left:24px">text</span>"
 *      (written by bulletListToStrings in slateToBrdJson when indent/align/fontSize present)
 *
 * For styled items we parse the wrapper span's data-brd-li attribute to restore
 * block-level props (indent, align, fontSize) onto the list-item node, and
 * parse the inner content with parseInlineHtml for inline marks.
 *
 * We must NOT use htmlToSlateNodes here because it would re-wrap the <li>
 * into a bulleted-list, causing double-nesting.
 */
const createBrdBulletedList = (items: string[]): any => {
  const listItems = items.map((item) => {
    const str = String(item);

    // Check for our styled span marker written by bulletListToStrings
    const styledMatch = str.match(/^<span data-brd-li="([^"]*)">([\s\S]*)<\/span>$/);

    if (styledMatch) {
      const styleStr = styledMatch[1]; // e.g. "padding-left:24px;text-align:center"
      const innerHtml = styledMatch[2];

      // Parse block-level style props back to Slate node props
      const nodeProps: Record<string, any> = {};
      styleStr.split(";").forEach((decl) => {
        const [prop, val] = decl.split(":").map((s) => s.trim());
        if (prop === "padding-left") {
          const px = parseInt(val, 10);
          if (!isNaN(px)) nodeProps.indent = Math.round(px / 24);
        } else if (prop === "text-align") {
          nodeProps.align = val;
        } else if (prop === "font-size") {
          const px = parseInt(val, 10);
          if (!isNaN(px)) nodeProps.fontSize = px;
        }
      });

      return {
        type: "list-item" as const,
        ...nodeProps,
        children: parseInlineHtml(innerHtml),
      };
    }

    // Plain string or plain inline HTML (no block styles)
    return {
      type: "list-item" as const,
      children: parseInlineHtml(str),
    };
  });

  return {
    type: "bulleted-list" as const,
    children: listItems,
  };
};

/**
 * BRD-specific paragraph builder.
 *
 * The value stored in JSON may be:
 *   1. Plain text        → "Some summary"
 *   2. Inline HTML       → "<strong>bold</strong> text"
 *   3. Styled paragraph  → "<p style="text-align:center">text</p>"
 *
 * For case 3 we use htmlToSlateNodes which correctly restores alignment/indent/
 * fontSize via the deserialize function in htmlConversion.ts.
 * For cases 1 and 2 we use parseInlineHtml (inline marks only).
 */
const createBrdParagraph = (value: string): any[] => {
  const str = String(value || "");

  // If the value is a block-level HTML element (p, div, h*), parse it fully
  // so that style attributes (text-align, padding-left, font-size) are restored.
  if (/^<(p|div|h[1-6])\b/i.test(str.trim())) {
    return htmlToSlateNodes(str);
  }

  // Otherwise treat as inline HTML or plain text
  return [
    {
      type: "paragraph" as const,
      children: parseInlineHtml(str),
    },
  ];
};

export const transformBRDDataToSlate = (obj: any) => {
  if (!obj) return [{ type: "paragraph", children: [{ text: "" }] }];

  return Object.entries(obj).flatMap(([key, value]) => {

    // ── Executive Summary ────────────────────────────────────────────────────
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
        // FIX: use createBrdParagraph so stored <p style="..."> values restore
        // their alignment/indent/fontSize instead of being parsed as plain text.
        ...createBrdParagraph(String(subValue)),
      ]);

      return [sectionHeader, ...subNodes];
    }

    // ── Stakeholders & Key Personnel ─────────────────────────────────────────
    if (key === "Stakeholders_and_Key_Personnel" && Array.isArray(value)) {
      return [
        {
          type: "heading-five" as const,
          children: [{ text: "Stakeholders & Key Personnel" }],
        },
        createBrdSlateTable(value),
      ];
    }

    // ── Goals & Objectives ───────────────────────────────────────────────────
    if (key === "Goals_and_Objectives" && Array.isArray(value)) {
      return [
        {
          type: "heading-five" as const,
          children: [{ text: "Goals & objectives" }],
        },
        // FIX: createBrdBulletedList now handles plain strings AND styled spans,
        // restoring indent/align/fontSize from the data-brd-li attribute written
        // by bulletListToStrings in slateToBrdJson.
        createBrdBulletedList(value),
      ];
    }

    // ── Process Scope Summary ────────────────────────────────────────────────
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
            scopeValue as Record<string, any>
          ).flatMap(([_subKey, subValue]: [string, any]) => {
            if (Array.isArray(subValue)) {
              // FIX: use createBrdBulletedList (handles styled spans)
              return [createBrdBulletedList(subValue)];
            }
            // FIX: use createBrdParagraph (restores block styles)
            return createBrdParagraph(String(subValue));
          });

          return [scopeTitle, ...scopeContent];
        }
      );

      return [sectionHeader, ...scopeNodes];
    }

    // ── Glossary ─────────────────────────────────────────────────────────────
    if (key === "Glossary" && Array.isArray(value)) {
      return [
        {
          type: "heading-five" as const,
          children: [{ text: "Glossary" }],
        },
        createBrdSlateTable(value),
      ];
    }

    // ── Actors/Personas ──────────────────────────────────────────────────────
    if (key === "Actors_Personas" && Array.isArray(value)) {
      return [
        {
          type: "heading-five" as const,
          children: [{ text: "Actors/Personas" }],
        },
        createBrdSlateTable(value),
      ];
    }

    // ── Fallback (Section_Citations, unknown keys) ───────────────────────────
    return [
      { type: "heading-one" as const, children: [{ text: key }] },
      {
        type: "paragraph" as const,
        children: parseInlineHtml(
          typeof value === "object" ? JSON.stringify(value) : String(value)
        ),
      },
    ];
  });
};
