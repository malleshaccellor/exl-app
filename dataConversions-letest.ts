import type { Descendant } from "slate";
import {
  cellToHtml,
  htmlToCellChildren,
  htmlToSlateNodes,
} from "./htmlConversions";

/* =========================================================
   SAFE JSON PARSER (FIXED)
========================================================= */

export const parseAgentResponse = (raw: unknown): any => {
  if (typeof raw !== "string") return raw;

  let str = raw.trim();

  if (str.startsWith("```")) {
    str = str
      .replace(/^```(?:json)?\s*\n?/, "")
      .replace(/\n?```$/, "");
  }

  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
};

/* =========================================================
   SAFE CELL ACCESS
========================================================= */

const safeCell = (cells: any[], index: number) =>
  cellToHtml(cells?.[index]);

/* =========================================================
   TEST CASE TABLE
========================================================= */

export const slateToTestCasesJson = (rows: any[]) =>
  rows.map((row) => {
    const cells = row.children ?? [];

    return {
      testCaseId: safeCell(cells, 0),
      description: safeCell(cells, 1),
      steps: safeCell(cells, 2),
      expectedResult: safeCell(cells, 3),
      status: safeCell(cells, 4),
    };
  });

/* =========================================================
   ACTION LOG TABLE
========================================================= */

export const slateToActionLogJson = (rows: any[]) =>
  rows.map((row) => {
    const cells = row.children ?? [];

    return {
      action: safeCell(cells, 0),
      owner: safeCell(cells, 1),
      dueDate: safeCell(cells, 2),
      status: safeCell(cells, 3),
    };
  });

/* =========================================================
   MARKDOWN EXPORT (CLEANED)
========================================================= */

export const slateToMarkdown = (nodes: Descendant[]): string => {
  const lines: string[] = [];

  nodes.forEach((node: any) => {
    const text =
      node.children?.map((c: any) => c.text).join("") ?? "";

    switch (node.type) {
      case "heading_one":
        lines.push(`# ${text}`);
        break;
      case "heading_two":
        lines.push(`## ${text}`);
        break;
      case "heading_three":
        lines.push(`### ${text}`);
        break;
      case "bulleted_list":
        node.children?.forEach((li: any) => {
          const liText =
            li.children?.map((c: any) => c.text).join("") ?? "";
          lines.push(`- ${liText}`);
        });
        break;
      case "numbered_list":
        node.children?.forEach((li: any, i: number) => {
          const liText =
            li.children?.map((c: any) => c.text).join("") ?? "";
          lines.push(`${i + 1}. ${liText}`);
        });
        break;
      default:
        lines.push(text);
    }
  });

  return lines.join("\n");
};

/* =========================================================
   SUMMARY TO SLATE (FIXED REGEX)
========================================================= */

export const summaryToSlateValue = (
  text: string
): Descendant[] => {
  const lines = text.split("\n");

  return lines.map((line) => {
    const children: any[] = [];

    const boldRegex = /\*\*(.+?)\*\*/g;
    const italicRegex =
      /\*(?!\*)(.+?)\*(?!\*)|_(.+?)_/g;

    let remaining = line;

    remaining = remaining.replace(boldRegex, (_, match) => {
      children.push({ text: match, bold: true });
      return "";
    });

    remaining = remaining.replace(
      italicRegex,
      (_, m1, m2) => {
        children.push({ text: m1 || m2, italic: true });
        return "";
      }
    );

    if (remaining.trim()) {
      children.push({ text: remaining });
    }

    return {
      type: "paragraph",
      children:
        children.length > 0
          ? children
          : [{ text: "" }],
    };
  });
};
