import type { Descendant } from "slate";
import {
  cellToHtml,
  htmlToCellChildren,
  htmlToSlateNodes,
} from "./htmlConversion";
import { transformBRDDataToSlate } from "./index";
import type { CustomText } from "../types";

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
                  children: val.flatMap((item: string) => {
                    return htmlToCellChildren(String(item || ""));
                  }),
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

  return [
    {
      type: "table",
      className: "editor-custom-table",
      children: [headerRow, ...allRows],
    },
  ];
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

  return [
    {
      type: "table",
      className: "editor-custom-table",
      children: [headerRow, ...allRows],
    },
  ];
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
// SUMMARY (markdown text → Slate)
// ============================================================

export const summaryToSlateValue = (text: string): Descendant[] => {
  if (!text || text.trim() === "") {
    return [{ type: "paragraph", children: [{ text: "" }] }];
  }

  let cleanText = text.trim();
  if (cleanText.startsWith('"') && cleanText.endsWith('"')) {
    try {
      cleanText = JSON.parse(cleanText);
    } catch {
      // not valid JSON, use as-is
    }
  }
  if (cleanText.includes("\\n")) {
    cleanText = cleanText.replace(/\\n/g, "\n");
  }
  if (/^<[a-z][\s\S]*>/i.test(cleanText.trim())) {
    return htmlToSlateNodes(cleanText);
  }

  const lines = cleanText.split("\n");
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

  const parseInlineMarks = (text: string): CustomText[] => {
    const boldItalicRegex = /\*\*\*(.+?)\*\*\*/g;
    const boldRegex = /\*\*(.+?)\*\*/g;
    const italicRegex = /[\*_](.+?)[\*_]/g;
    const strikethroughRegex = /~~(.+?)~~/g;
    const underlineRegex = /<u>(.+?)<\/u>/gi;
    const codeRegex = /`(.+?)`/g;

    let parts: CustomText[] = [{ text }];

    const applyRegex = (regex: RegExp, prop: keyof CustomText) => {
      const newParts: CustomText[] = [];
      parts.forEach((part) => {
        if (Object.keys(part).length > 1) {
          newParts.push(part);
          return;
        }

        let lastIndex = 0;
        let match;
        const partText = part.text;
        regex.lastIndex = 0;

        while ((match = regex.exec(partText)) !== null) {
          if (match.index > lastIndex) {
            newParts.push({ text: partText.slice(lastIndex, match.index) });
          }
          newParts.push({ text: match[1], [prop]: true } as any);
          lastIndex = regex.lastIndex;
        }
        if (lastIndex < partText.length) {
          newParts.push({ text: partText.slice(lastIndex) });
        }
      });
      parts = newParts;
    };

    applyRegex(boldItalicRegex, "bold");
    applyRegex(boldRegex, "bold");
    applyRegex(italicRegex, "italic");
    applyRegex(strikethroughRegex, "strikethrough");
    applyRegex(underlineRegex, "underline");
    applyRegex(codeRegex, "code");

    return parts.length > 0 ? parts : [{ text: "" }];
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
        type: "heading-five",
        children: [{ text: numberedHeadingMatch[1] }],
      });
      continue;
    }

    const subHeadingMatch = trimmed.match(/^([A-Z][^-*].+):$/);
    if (
      subHeadingMatch &&
      !trimmed.startsWith("-") &&
      !trimmed.startsWith("*") &&
      subHeadingMatch[1].split(/\s+/).length <= 6
    ) {
      flushList();
      nodes.push({
        type: "paragraph",
        children: [{ text: subHeadingMatch[1], bold: true }],
      });
      continue;
    }

    const bulletMatch = line.match(/^(\s*)([-*])\s+(.+)$/);
    if (bulletMatch) {
      const leadingSpaces = bulletMatch[1].length;
      const indent = leadingSpaces >= 4 ? 1 : 0;

      if (currentListType !== "bulleted-list") {
        flushList();
        currentListType = "bulleted-list";
      }
      currentListItems.push({
        type: "list-item",
        indent,
        children: parseInlineMarks(bulletMatch[3]),
      } as any);
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

// ---- Helpers: Slate → Markdown ----

const leafToMarkdown = (node: any): string => {
  if (!node || !("text" in node)) return "";
  let text = node.text as string;
  if (!text) return "";
  if (node.code) text = `\`${text}\``;
  if (node.bold) text = `**${text}**`;
  if (node.italic) text = `*${text}*`;
  if (node.underline) text = `<u>${text}</u>`;
  if (node.strikethrough) text = `~~${text}~~`;
  return text;
};

const childrenToMarkdown = (children: any[]): string => {
  return (children || [])
    .map((c: any) => {
      if ("text" in c) return leafToMarkdown(c);
      return childrenToMarkdown(c.children);
    })
    .join("");
};

export const slateToSummaryJson = (nodes: Descendant[]): any => {
  const lines: string[] = [];
  let headingCounter = 0;
  let prevType: string | null = null;

  for (const node of nodes as any[]) {
    const nodeType = (node as any).type;

    if (prevType && lines.length > 0) {
      const isHeadingToList =
        prevType === "heading-five" &&
        (nodeType === "bulleted-list" || nodeType === "numbered-list");

      if (!isHeadingToList) {
        lines.push("");
      }
    }

    switch (nodeType) {
      case "heading-five": {
        headingCounter++;
        const text = childrenToMarkdown(node.children);
        lines.push(`${headingCounter}. **${text}**`);
        break;
      }
      case "paragraph": {
        const children = node.children || [];
        if (
          children.length === 1 &&
          children[0].bold &&
          !children[0].italic &&
          !children[0].strikethrough &&
          !children[0].underline &&
          !children[0].code &&
          children[0].text &&
          children[0].text.split(/\s+/).length <= 6
        ) {
          lines.push(`${children[0].text}:`);
        } else {
          const text = childrenToMarkdown(children);
          lines.push(text);
        }
        break;
      }
      case "bulleted-list": {
        for (const item of node.children || []) {
          const text = childrenToMarkdown(item.children);
          const indent = (item as any).indent || 0;
          if (indent >= 1) {
            lines.push(`     * ${text}`);
          } else {
            lines.push(`   - ${text}`);
          }
        }
        break;
      }
      case "numbered-list": {
        (node.children || []).forEach((item: any, i: number) => {
          const text = childrenToMarkdown(item.children);
          lines.push(`${i + 1}. ${text}`);
        });
        break;
      }
      default: {
        const text = childrenToMarkdown(node.children);
        if (text) lines.push(text);
        break;
      }
    }

    prevType = nodeType;
  }

  return { response: lines.join("\n") };
};

// ============================================================
// BRD — shared inline serializer (marks only, no block props)
// ============================================================

const leafToInlineHtml = (node: any): string => {
  if (!node || !("text" in node)) return "";
  let html = node.text as string;
  if (!html) return "";
  if (node.code) html = `<code>${html}</code>`;
  if (node.italic) html = `<em>${html}</em>`;
  if (node.bold) html = `<strong>${html}</strong>`;
  if (node.underline) html = `<u>${html}</u>`;
  if (node.strikethrough) html = `<s>${html}</s>`;
  return html;
};

const childrenToInlineHtml = (children: any[]): string => {
  return (children || [])
    .map((c: any) => {
      if ("text" in c) return leafToInlineHtml(c);
      return childrenToInlineHtml(c.children);
    })
    .join("");
};

// ============================================================
// BRD — NEW: block serializer that preserves align/indent/fontSize
// ============================================================

/**
 * Serializes a single Slate block node (paragraph, list-item, heading, etc.)
 * to an HTML string that includes a style attribute for alignment, indent,
 * and font-size so the round-trip through htmlToSlateNodes restores them.
 */
const blockToStyledHtml = (node: any): string => {
  const styleProps: string[] = [];
  if (node.align && node.align !== "left")
    styleProps.push(`text-align:${node.align}`);
  if (node.indent)
    styleProps.push(`padding-left:${node.indent * 24}px`);
  if (node.fontSize)
    styleProps.push(`font-size:${node.fontSize}px`);

  const inner = childrenToInlineHtml(node.children);
  const styleAttr = styleProps.length ? ` style="${styleProps.join(";")}"` : "";

  const tagMap: Record<string, string> = {
    paragraph: "p",
    "heading-one": "h1",
    "heading-two": "h2",
    "heading-three": "h3",
    "heading-four": "h4",
    "heading-five": "h5",
    "heading-six": "h6",
    "list-item": "li",
    "block-quote": "blockquote",
  };
  const tag = tagMap[node.type] || "p";
  return `<${tag}${styleAttr}>${inner}</${tag}>`;
};

// ============================================================
// BRD — NEW: bullet list extractor that preserves block props
// ============================================================

/**
 * Extracts list items from a bulleted-list node as styled HTML strings.
 * Each <li> carries style attributes for alignment, indent, and font-size
 * so that htmlToSlateNodes can restore them on the return trip.
 *
 * Previously this just called childrenToInlineHtml(item.children) which
 * only preserved inline marks (bold/italic) and silently dropped every
 * block-level property.
 */
const extractStyledBulletedListItems = (listNode: any): string[] => {
  return (listNode.children || []).map((item: any) => {
    return blockToStyledHtml(item);
  });
};

// ============================================================
// BRD (Slate → structured JSON)
// ============================================================

const BRD_SECTION_DISPLAY_TO_KEY: Record<string, string> = {
  "Executive Summary": "Executive_Summary",
  "Stakeholders & Key Personnel": "Stakeholders_and_Key_Personnel",
  "Goals & objectives": "Goals_and_Objectives",
  "Goals & Objectives": "Goals_and_Objectives",
  "Process Scope Summary": "Process_Scope_Summary",
  "Actors/Personas": "Actors_Personas",
  Glossary: "Glossary",
};

const displayNameToKey = (name: string): string => {
  return BRD_SECTION_DISPLAY_TO_KEY[name] || name.replace(/ /g, "_");
};

const childrenToText = (children: any[]): string => {
  return (children || [])
    .map((c: any) => {
      if ("text" in c) return c.text || "";
      return childrenToText(c.children);
    })
    .join("");
};

const extractTableAsArray = (tableNode: any): any[] => {
  const rows = tableNode.children || [];
  if (rows.length < 2) return [];

  const headerCells = rows[0].children || [];
  const headers = headerCells.map((cell: any) => {
    const text = childrenToText(cell.children);
    return text.replace(/ /g, "_");
  });

  return rows.slice(1).map((row: any) => {
    const obj: Record<string, any> = {};
    (row.children || []).forEach((cell: any, i: number) => {
      if (i < headers.length) {
        const paragraphs = (cell.children || []).filter(
          (c: any) => c.type === "paragraph"
        );
        if (paragraphs.length > 1) {
          obj[headers[i]] = paragraphs.map((p: any) =>
            childrenToInlineHtml([p])
          );
        } else {
          obj[headers[i]] = childrenToInlineHtml(cell.children);
        }
      }
    });
    return obj;
  });
};

export const brdToSlateValue = (rawResponse: string): Descendant[] => {
  let cleanRaw =
    typeof rawResponse === "string" ? rawResponse.trim() : rawResponse;
  if (typeof cleanRaw === "string") {
    if (cleanRaw.startsWith('"') && cleanRaw.endsWith('"')) {
      try {
        cleanRaw = JSON.parse(cleanRaw);
      } catch {
        // not valid JSON string, use as-is
      }
    }
    if (typeof cleanRaw === "string" && cleanRaw.includes("\\n")) {
      cleanRaw = cleanRaw.replace(/\\n/g, "\n");
    }
    if (
      typeof cleanRaw === "string" &&
      /^<[a-z][\s\S]*>/i.test(cleanRaw.trim())
    ) {
      return htmlToSlateNodes(cleanRaw);
    }
  }
  const parsed = parseAgentResponse(cleanRaw);
  return transformBRDDataToSlate(parsed);
};

export const slateToBrdJson = (nodes: Descendant[]): any => {
  const result: Record<string, any> = {};
  const nodeList = nodes as any[];
  let i = 0;

  // These are the ONLY display names that map to known top-level section keys.
  // Used to detect section boundaries when heading-five is used for both
  // top-level sections AND sub-sections (as transformBRDDataToSlate does).
  const TOP_LEVEL_DISPLAY_NAMES = new Set([
    "Executive Summary",
    "Stakeholders & Key Personnel",
    "Goals & objectives",
    "Goals & Objectives",
    "Process Scope Summary",
    "Actors/Personas",
    "Glossary",
  ]);

  // Returns true only for nodes that begin a NEW top-level section.
  // heading-five nodes whose text is NOT a known top-level display name are
  // sub-section headings and must NOT trigger a section boundary.
  const isTopLevelBoundary = (node: any): boolean => {
    if (!node) return false;
    if (node.type === "heading-one") return true;
    if (node.type === "heading-five") {
      const text = childrenToText(node.children);
      return TOP_LEVEL_DISPLAY_NAMES.has(text);
    }
    return false;
  };

  // Returns true for heading-five nodes that are sub-section headings
  // (i.e. heading-five but NOT a known top-level section name).
  const isSubHeading = (node: any): boolean => {
    if (!node) return false;
    if (node.type === "heading-five") {
      const text = childrenToText(node.children);
      return !TOP_LEVEL_DISPLAY_NAMES.has(text);
    }
    // heading-six is always a sub-heading
    return node.type === "heading-six";
  };

  // Serialises a bulleted-list node's items as strings for JSON storage.
  //
  // Plain items (no block styles) → bare inline HTML string, e.g. "Goal text"
  // Styled items (indent/align/fontSize) → "<span data-brd-li="padding-left:24px">text</span>"
  //
  // The data-brd-li marker is detected by createBrdBulletedList in index.ts,
  // which extracts the style string back onto the list-item Slate node.
  // We avoid wrapping in <li> because htmlToSlateNodes would double-nest it
  // inside another bulleted-list when createBrdBulletedList processes it.
  const bulletListToStrings = (listNode: any): string[] => {
    return (listNode.children || []).map((item: any) => {
      const styleProps: string[] = [];
      if (item.align && item.align !== "left")
        styleProps.push(`text-align:${item.align}`);
      if (item.indent)
        styleProps.push(`padding-left:${item.indent * 24}px`);
      if (item.fontSize)
        styleProps.push(`font-size:${item.fontSize}px`);

      const inner = childrenToInlineHtml(item.children);
      if (styleProps.length === 0) return inner;
      return `<span data-brd-li="${styleProps.join(";")}">${inner}</span>`;
    });
  };

  while (i < nodeList.length) {
    const node = nodeList[i];

    if (node.type === "heading-five" && !isSubHeading(node)) {
      // ── Top-level section heading ──────────────────────────────────────────
      const sectionKey = displayNameToKey(childrenToText(node.children));
      i++;

      // ── 1. EXECUTIVE SUMMARY ─────────────────────────────────────────────
      // Structure produced by transformBRDDataToSlate:
      //   heading-five "Executive Summary"   ← consumed above
      //   heading-five "Introduction"        ← sub-key (isSubHeading = true)
      //   paragraph    "..."
      //   heading-five "Problem Statement"   ← sub-key
      //   paragraph    "..."
      if (sectionKey === "Executive_Summary") {
        const execSummary: Record<string, string> = {};

        while (i < nodeList.length && !isTopLevelBoundary(nodeList[i])) {
          const curr = nodeList[i];

          if (isSubHeading(curr)) {
            const subKey = childrenToText(curr.children).replace(/ /g, "_");
            i++;
            const contentParts: string[] = [];

            // Collect everything until the next sub-heading or top-level boundary
            while (
              i < nodeList.length &&
              !isTopLevelBoundary(nodeList[i]) &&
              !isSubHeading(nodeList[i])
            ) {
              contentParts.push(blockToStyledHtml(nodeList[i]));
              i++;
            }
            execSummary[subKey] = contentParts.join("");
          } else {
            i++;
          }
        }
        result[sectionKey] = execSummary;
      }

      // ── 2. TABLE SECTIONS ────────────────────────────────────────────────
      else if (
        ["Stakeholders_and_Key_Personnel", "Actors_Personas", "Glossary"].includes(
          sectionKey
        )
      ) {
        let tableData: any[] = [];

        while (i < nodeList.length && !isTopLevelBoundary(nodeList[i])) {
          if (nodeList[i].type === "table") {
            tableData = extractTableAsArray(nodeList[i]);
            i++;
            break;
          }
          i++;
        }
        result[sectionKey] = tableData;
      }

      // ── 3. GOALS AND OBJECTIVES ──────────────────────────────────────────
      // Structure: heading-five → bulleted-list
      // Items are plain strings in JSON; only wrap in <li> if styled.
      else if (sectionKey === "Goals_and_Objectives") {
        let listData: string[] = [];

        while (i < nodeList.length && !isTopLevelBoundary(nodeList[i])) {
          if (nodeList[i].type === "bulleted-list") {
            listData = bulletListToStrings(nodeList[i]);
            i++;
            break;
          }
          i++;
        }
        result[sectionKey] = listData;
      }

      // ── 4. PROCESS SCOPE SUMMARY ─────────────────────────────────────────
      // Structure produced by transformBRDDataToSlate:
      //   heading-five "Process Scope Summary"   ← consumed above
      //   heading-five "In Scope"                ← sub-key (isSubHeading)
      //   paragraph    "Summary text"
      //   bulleted-list                          ← High_Level_Requirements
      //   heading-five "Out of Scope"            ← sub-key (isSubHeading)
      //   paragraph    "Summary text"
      //   bulleted-list                          ← Exclusions
      else if (sectionKey === "Process_Scope_Summary") {
        const scopeObj: Record<string, any> = {};

        while (i < nodeList.length && !isTopLevelBoundary(nodeList[i])) {
          const curr = nodeList[i];

          if (isSubHeading(curr)) {
            // Normalise the sub-key: "In Scope" → "In_Scope", etc.
            const rawSubName = childrenToText(curr.children);
            const subKey = rawSubName.replace(/ /g, "_");
            i++;
            const subObj: Record<string, any> = {};

            while (
              i < nodeList.length &&
              !isTopLevelBoundary(nodeList[i]) &&
              !isSubHeading(nodeList[i])
            ) {
              const item = nodeList[i];

              if (item.type === "paragraph") {
                subObj["Summary"] = blockToStyledHtml(item);
                i++;
              } else if (item.type === "bulleted-list") {
                // In_Scope → High_Level_Requirements; anything else → Exclusions
                const listKey =
                  subKey === "In_Scope" ? "High_Level_Requirements" : "Exclusions";
                subObj[listKey] = bulletListToStrings(item);
                i++;
              } else {
                i++;
              }
            }
            scopeObj[subKey] = subObj;
          } else {
            i++;
          }
        }
        result[sectionKey] = scopeObj;
      }

      // ── 5. FALLBACK ──────────────────────────────────────────────────────
      else {
        const contentParts: string[] = [];
        while (i < nodeList.length && !isTopLevelBoundary(nodeList[i])) {
          contentParts.push(blockToStyledHtml(nodeList[i]));
          i++;
        }
        result[sectionKey] = contentParts.join("\n");
      }
    }

    // ── 6. HEADING-ONE (Section_Citations / metadata) ─────────────────────
    else if (node.type === "heading-one") {
      const key = childrenToText(node.children).replace(/ /g, "_");
      i++;
      if (i < nodeList.length && nodeList[i].type === "paragraph") {
        const text = childrenToText(nodeList[i].children);
        try {
          result[key] = JSON.parse(text);
        } catch {
          result[key] = text;
        }
        i++;
      }
    } else {
      i++;
    }
  }

  return {
    response: "```json\n" + JSON.stringify(result, null, 2) + "\n```",
  };
};
