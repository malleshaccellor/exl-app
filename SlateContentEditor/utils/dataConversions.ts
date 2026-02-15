import type { Descendant } from "slate";
import { cellToHtml, htmlToCellChildren, slateToHtml } from "./htmlConversion";
import { transformBRDDataToSlate } from "./index";

// --- Helper: parse agent response (string → object) ---

export const parseAgentResponse = (raw: unknown): any => {
  if (typeof raw !== "string") return raw;
  let str = raw.trim();
  if (str.startsWith("```")) {
    str = str.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return JSON.parse(str);
};

// ============================================================
// TEST CASES
// ============================================================

const TC_VISIBLE_COLUMNS = [
  { key: "req_id", label: "Req ID" },
  { key: "userstory_id", label: "User Story ID" },
  { key: "TestCaseId", label: "Test Case ID" },
  { key: "TestCaseTitle", label: "Test Case Title" },
  { key: "Description", label: "Description" },
  { key: "Preconditions", label: "Preconditions" },
  { key: "TestData", label: "Test Data" },
  { key: "TestSteps", label: "Test Steps" },
  { key: "ExpectedResults", label: "Expected Results" },
];

export const testCasesToSlateValue = (data: any): Descendant[] => {
  const allRows: any[] = [];

  for (const req of data.Requirements || []) {
    for (const story of req.UserStories || []) {
      for (const act of story.AcceptanceCriteriaTests || []) {
        for (const tc of act.TestCases || []) {
          const hiddenData: Record<string, string> = {
            AcceptanceCriterion: act.AcceptanceCriterion || "",
            ActualResults: tc.ActualResults || "",
            PassFail: tc.PassFail || "",
          };

          const rowData: Record<string, any> = {
            req_id: req.req_id,
            userstory_id: story.userstory_id,
            TestCaseId: tc.TestCaseId,
            TestCaseTitle: tc.TestCaseTitle,
            Description: tc.Description,
            Preconditions: Array.isArray(tc.Preconditions)
              ? tc.Preconditions
              : [String(tc.Preconditions || "")],
            TestData: Array.isArray(tc.TestData)
              ? tc.TestData
              : [String(tc.TestData || "")],
            TestSteps: Array.isArray(tc.TestSteps)
              ? tc.TestSteps
              : [String(tc.TestSteps || "")],
            ExpectedResults: tc.ExpectedResults,
          };

          allRows.push({
            type: "table-row",
            hiddenData,
            children: TC_VISIBLE_COLUMNS.map(({ key }) => {
              const val = rowData[key];
              if (Array.isArray(val)) {
                return {
                  type: "table-cell",
                  children: val.map((item: string) => ({
                    type: "paragraph" as const,
                    children: [{ text: String(item) }],
                  })),
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
    }
  }

  const headerRow = {
    type: "table-row" as const,
    children: TC_VISIBLE_COLUMNS.map(({ label }) => ({
      type: "table-cell" as const,
      isHeader: true,
      children: [{ type: "paragraph" as const, children: [{ text: label }] }],
    })),
  };

  if (allRows.length === 0) {
    return [{ type: "paragraph", children: [{ text: "" }] }];
  }

  return [{ type: "table", children: [headerRow, ...allRows] }];
};

export const slateToTestCasesJson = (nodes: Descendant[]): any => {
  const tableNode = (nodes as any[]).find((n) => n.type === "table");
  if (!tableNode) return { Requirements: [] };

  const dataRows = tableNode.children.slice(1);
  const reqMap: Record<string, any> = {};

  for (const row of dataRows) {
    const cells = row.children;
    const hidden = row.hiddenData || {};

    const reqId = cellToHtml(cells[0]).trim();
    const userstoryId = cellToHtml(cells[1]).trim();

    if (!reqMap[reqId]) {
      reqMap[reqId] = { req_id: reqId, UserStories: {} };
    }
    if (!reqMap[reqId].UserStories[userstoryId]) {
      reqMap[reqId].UserStories[userstoryId] = {
        userstory_id: userstoryId,
        AcceptanceCriteriaTests: {},
      };
    }

    const criterion = hidden.AcceptanceCriterion || "";
    const storyObj = reqMap[reqId].UserStories[userstoryId];
    if (!storyObj.AcceptanceCriteriaTests[criterion]) {
      storyObj.AcceptanceCriteriaTests[criterion] = {
        AcceptanceCriterion: criterion,
        TestCases: [],
      };
    }

    storyObj.AcceptanceCriteriaTests[criterion].TestCases.push({
      TestCaseId: cellToHtml(cells[2]).trim(),
      TestCaseTitle: cellToHtml(cells[3]).trim(),
      Description: cellToHtml(cells[4]).trim(),
      Preconditions: cellToHtml(cells[5])
        .split("\n")
        .map((s: string) => s.trim())
        .filter(Boolean),
      TestData: cellToHtml(cells[6])
        .split("\n")
        .map((s: string) => s.trim())
        .filter(Boolean),
      TestSteps: cellToHtml(cells[7])
        .split("\n")
        .map((s: string) => s.trim())
        .filter(Boolean),
      ExpectedResults: cellToHtml(cells[8]).trim(),
      ActualResults: hidden.ActualResults || "",
      PassFail: hidden.PassFail || "",
    });
  }

  // Convert maps back to arrays
  const requirements = Object.values(reqMap).map((req: any) => ({
    req_id: req.req_id,
    UserStories: Object.values(req.UserStories).map((story: any) => ({
      userstory_id: story.userstory_id,
      AcceptanceCriteriaTests: Object.values(story.AcceptanceCriteriaTests),
    })),
  }));

  return { Requirements: requirements };
};

// ============================================================
// ACTION LOG
// ============================================================

const AL_COLUMNS = [
  { key: "Action_Item", label: "Action Item" },
  { key: "Requestor", label: "Requestor" },
  { key: "Owner", label: "Owner" },
  { key: "Status", label: "Status" },
  { key: "Priority", label: "Priority" },
  { key: "Start_Date", label: "Start Date" },
  { key: "Due_Date", label: "Due Date" },
  { key: "Comments", label: "Comments" },
];

export const actionLogToSlateValue = (data: any): Descendant[] => {
  const items = data.Minutes_of_Meeting;
  if (!items || items.length === 0) {
    return [{ type: "paragraph", children: [{ text: "" }] }];
  }

  const allRows = items.map((item: any) => ({
    type: "table-row" as const,
    children: AL_COLUMNS.map(({ key }) => ({
      type: "table-cell" as const,
      children: htmlToCellChildren(item[key] != null ? String(item[key]) : ""),
    })),
  }));

  const headerRow = {
    type: "table-row" as const,
    children: AL_COLUMNS.map(({ label }) => ({
      type: "table-cell" as const,
      isHeader: true,
      children: [{ type: "paragraph" as const, children: [{ text: label }] }],
    })),
  };

  return [{ type: "table", children: [headerRow, ...allRows] }];
};

export const slateToActionLogJson = (nodes: Descendant[]): any => {
  const tableNode = (nodes as any[]).find((n) => n.type === "table");
  if (!tableNode) return { Minutes_of_Meeting: [] };

  const dataRows = tableNode.children.slice(1);

  const minutes = dataRows.map((row: any) => {
    const result: Record<string, string> = {};
    AL_COLUMNS.forEach(({ key }, i) => {
      result[key] = cellToHtml(row.children[i]).trim();
    });
    return result;
  });

  return { Minutes_of_Meeting: minutes };
};

// ============================================================
// SUMMARY (markdown text → Slate, save as HTML)
// ============================================================

export const summaryToSlateValue = (text: string): Descendant[] => {
  if (!text || text.trim() === "") {
    return [{ type: "paragraph", children: [{ text: "" }] }];
  }

  const lines = text.split("\n");
  const nodes: Descendant[] = [];
  let currentListItems: Descendant[] = [];
  let currentListType: "bulleted-list" | null = null;

  const flushList = () => {
    if (currentListItems.length > 0 && currentListType) {
      nodes.push({
        type: currentListType,
        children: currentListItems as any,
      });
      currentListItems = [];
      currentListType = null;
    }
  };

  const parseInlineMarks = (
    text: string
  ): Array<{ text: string; bold?: boolean }> => {
    const parts: Array<{ text: string; bold?: boolean }> = [];
    const regex = /\*\*(.+?)\*\*/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ text: text.slice(lastIndex, match.index) });
      }
      parts.push({ text: match[1], bold: true });
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push({ text: text.slice(lastIndex) });
    }

    return parts.length > 0 ? parts : [{ text }];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "") {
      flushList();
      continue;
    }

    const numberedHeadingMatch = trimmed.match(/^\d+\.\s+\*\*(.+?)\*\*\s*$/);
    if (numberedHeadingMatch) {
      flushList();
      nodes.push({
        type: "heading-six",
        children: [{ text: numberedHeadingMatch[1] }],
      });
      continue;
    }

    const subHeadingMatch = trimmed.match(/^([A-Z][^-*].+):$/);
    if (
      subHeadingMatch &&
      !trimmed.startsWith("-") &&
      !trimmed.startsWith("*")
    ) {
      flushList();
      nodes.push({
        type: "paragraph",
        children: [{ text: subHeadingMatch[1], bold: true }],
      });
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      if (currentListType !== "bulleted-list") {
        flushList();
        currentListType = "bulleted-list";
      }
      currentListItems.push({
        type: "list-item",
        children: parseInlineMarks(bulletMatch[1]),
      });
      continue;
    }

    flushList();
    nodes.push({
      type: "paragraph",
      children: parseInlineMarks(trimmed),
    });
  }

  flushList();

  return nodes.length > 0
    ? nodes
    : [{ type: "paragraph", children: [{ text: "" }] }];
};

export const slateToSummaryJson = (nodes: Descendant[]): any => {
  return { response: slateToHtml(nodes) };
};

// ============================================================
// BRD (save as HTML — structure too complex to reverse)
// ============================================================

export const brdToSlateValue = (rawResponse: string): Descendant[] => {
  const parsed = parseAgentResponse(rawResponse);
  return transformBRDDataToSlate(parsed);
};

export const slateToBrdJson = (nodes: Descendant[]): any => {
  return { response: slateToHtml(nodes) };
};
