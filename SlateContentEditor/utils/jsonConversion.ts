import type { Descendant } from "slate";
import {
  cellToHtml,
  cellToHtmlArray,
  htmlToCellChildren,
  htmlArrayToCellChildren,
} from "./htmlConversion";

export const VISIBLE_COLUMNS = [
  { key: "req_id", label: "Req No." },
  { key: "userstory_id", label: "User Story No." },
  { key: "Story", label: "User Story Description" },
  { key: "AcceptanceCriteria", label: "Acceptance Criteria" },
  { key: "RequirementType", label: "Requirement Type" },
];

export const HIDDEN_STORY_KEYS = [
  "source",
  "referred_document",
  "referred_doc_location",
  "section",
  "justification",
  "referred_in",
  "source_timestamp",
];

export const jsonToSlateValue = (data: Record<string, any>): Descendant[] => {
  const allRows: any[] = [];

  for (const [reqName, reqData] of Object.entries(data)) {
    for (const story of reqData.UserStories || []) {
      const hiddenData: Record<string, string> = {
        Requirement: reqName,
        RequirementDescription: reqData.RequirementDescription,
      };
      for (const key of HIDDEN_STORY_KEYS) {
        hiddenData[key] = story[key] != null ? String(story[key]) : "";
      }

      allRows.push({
        type: "table-row",
        hiddenData,
        children: VISIBLE_COLUMNS.map(({ key }) => {
          let val: any;
          if (key === "req_id") val = reqData.req_id;
          else val = story[key];

          if (Array.isArray(val)) {
            return {
              type: "table-cell",
              children: htmlArrayToCellChildren(val),
            };
          }
          return {
            type: "table-cell",
            children: htmlToCellChildren(val != null ? String(val) : ""),
          };
        }),
      });
    }
  }

  const headerRow = {
    type: "table-row" as const,
    children: VISIBLE_COLUMNS.map(({ label }) => ({
      type: "table-cell" as const,
      isHeader: true,
      children: [
        { type: "paragraph" as const, children: [{ text: label }] },
      ],
    })),
  };

  return [
    {
      type: "table",
      className: "editor-custom-table",
      children: [headerRow, ...allRows],
    },
  ];
};

export const slateValueToJson = (
  nodes: Descendant[]
): Record<string, any> => {
  const tableNode = (nodes as any[]).find(
    (n: any) => n.type === "table"
  );
  if (!tableNode) return {};

  const rows = tableNode.children;
  const dataRows = rows.slice(1);

  const result: Record<string, any> = {};

  for (const row of dataRows) {
    const cells = row.children;
    const hidden = row.hiddenData || {};

    const reqId = cellToHtml(cells[0]);
    const reqName = hidden.Requirement || "";
    const reqDesc = hidden.RequirementDescription || "";

    if (!result[reqName]) {
      result[reqName] = {
        req_id: reqId,
        RequirementDescription: reqDesc,
        UserStories: [],
      };
    }

    const story: Record<string, any> = {
      userstory_id: cellToHtml(cells[1]),
      Story: cellToHtml(cells[2]),
      AcceptanceCriteria: cellToHtmlArray(cells[3]),
      RequirementType: cellToHtml(cells[4]),
    };

    for (const key of HIDDEN_STORY_KEYS) {
      story[key] = hidden[key] || "";
    }

    result[reqName].UserStories.push(story);
  }

  return result;
};
