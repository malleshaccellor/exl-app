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
 
/** BRD-specific bulleted list that parses inline HTML in items */
const createBrdBulletedList = (items: string[]): any => {
  return {
    type: "bulleted-list" as const,
    children: items.map((item) => ({
      type: "list-item" as const,
      children: parseInlineHtml(String(item)),
    })),
  };
};
