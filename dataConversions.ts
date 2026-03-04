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
  { key: "req_id",          label: "Req ID" },
  { key: "userstory_id",    label: "User Story ID" },
  { key: "TestCaseId",      label: "Test Case ID" },
  { key: "TestCaseTitle",   label: "Test Case Title" },
  { key: "Description",     label: "Description" },
  { key: "Preconditions",   label: "Preconditions" },
  { key: "TestData",        label: "Test Data" },
  { key: "TestSteps",       label: "Test Steps" },
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
            ActualResults:       tc.ActualResults        || "",
            PassFail:            tc.PassFail             || "",
          };

          const rowData: Record<string, any> = {
            req_id:          req.req_id,
            userstory_id:    story.userstory_id,
            TestCaseId:      tc.TestCaseId,
            TestCaseTitle:   tc.TestCaseTitle,
            Description:     tc.Description,
            Preconditions:   Array.isArray(tc.Preconditions)   ? tc.Preconditions   : [String(tc.Preconditions   || "")],
            TestData:        Array.isArray(tc.TestData)        ? tc.TestData        : [String(tc.TestData        || "")],
            TestSteps:       Array.isArray(tc.TestSteps)       ? tc.TestSteps       : [String(tc.TestSteps       || "")],
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
                  children: val.flatMap((item: string) => htmlToCellChildren(String(item || ""))),
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
    const cells  = row.children;
    const hidden = row.hiddenData || {};

    const reqId      = cellToHtml(cells[0]).trim();
    const userstoryId = cellToHtml(cells[1]).trim();

    if (!reqMap[reqId]) reqMap[reqId] = { req_id: reqId, UserStories: {} };
    if (!reqMap[reqId].UserStories[userstoryId]) {
      reqMap[reqId].UserStories[userstoryId] = {
        userstory_id: userstoryId,
        AcceptanceCriteriaTests: {},
      };
    }

    const criterion = hidden.AcceptanceCriterion || "";
    const storyObj  = reqMap[reqId].UserStories[userstoryId];
    if (!storyObj.AcceptanceCriteriaTests[criterion]) {
      storyObj.AcceptanceCriteriaTests[criterion] = {
        AcceptanceCriterion: criterion,
        TestCases: [],
      };
    }

    storyObj.AcceptanceCriteriaTests[criterion].TestCases.push({
      TestCaseId:      cellToHtml(cells[2]).trim(),
      TestCaseTitle:   cellToHtml(cells[3]).trim(),
      Description:     cellToHtml(cells[4]).trim(),
      Preconditions:   cellToHtml(cells[5]).split("\n").map((s: string) => s.trim()).filter(Boolean),
      TestData:        cellToHtml(cells[6]).split("\n").map((s: string) => s.trim()).filter(Boolean),
      TestSteps:       cellToHtml(cells[7]).split("\n").map((s: string) => s.trim()).filter(Boolean),
      ExpectedResults: cellToHtml(cells[8]).trim(),
      ActualResults:   hidden.ActualResults || "",
      PassFail:        hidden.PassFail      || "",
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
  { key: "Requestor",   label: "Requestor" },
  { key: "Owner",       label: "Owner" },
  { key: "Status",      label: "Status" },
  { key: "Priority",    label: "Priority" },
  { key: "Start_Date",  label: "Start Date" },
  { key: "Due_Date",    label: "Due Date" },
  { key: "Comments",    label: "Comments" },
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
  const minutes  = dataRows.map((row: any) => {
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
    try { cleanText = JSON.parse(cleanText); } catch { /* use as-is */ }
  }
  if (cleanText.includes("\\n")) {
    cleanText = cleanText.replace(/\\n/g, "\n");
  }
  if (/^<[a-z][\s\S]*>/i.test(cleanText.trim())) {
    return htmlToSlateNodes(cleanText);
  }

  const lines: string[]     = cleanText.split("\n");
  const nodes: Descendant[] = [];
  let currentListItems: Descendant[]          = [];
  let currentListType: "bulleted-list" | null = null;

  const flushList = () => {
    if (currentListItems.length > 0 && currentListType) {
      nodes.push({ type: currentListType, children: currentListItems as any });
      currentListItems = [];
      currentListType  = null;
    }
  };

  const parseInlineMarks = (text: string): CustomText[] => {
    const boldItalicRegex    = /\*\*\*(.+?)\*\*\*/g;
    const boldRegex          = /\*\*(.+?)\*\*/g;
    const italicRegex        = /[\*_](.+?)[\*_]/g;
    const strikethroughRegex = /~~(.+?)~~/g;
    const underlineRegex     = /<u>(.+?)<\/u>/gi;
    const codeRegex          = /`(.+?)`/g;

    let parts: CustomText[] = [{ text }];

    const applyRegex = (regex: RegExp, prop: keyof CustomText) => {
      const newParts: CustomText[] = [];
      parts.forEach((part) => {
        if (Object.keys(part).length > 1) { newParts.push(part); return; }
        let lastIndex = 0;
        let match;
        const partText = part.text;
        regex.lastIndex = 0;
        while ((match = regex.exec(partText)) !== null) {
          if (match.index > lastIndex)
            newParts.push({ text: partText.slice(lastIndex, match.index) });
          newParts.push({ text: match[1], [prop]: true } as any);
          lastIndex = regex.lastIndex;
        }
        if (lastIndex < partText.length)
          newParts.push({ text: partText.slice(lastIndex) });
      });
      parts = newParts;
    };

    applyRegex(boldItalicRegex,    "bold");
    applyRegex(boldRegex,          "bold");
    applyRegex(italicRegex,        "italic");
    applyRegex(strikethroughRegex, "strikethrough");
    applyRegex(underlineRegex,     "underline");
    applyRegex(codeRegex,          "code");

    return parts.length > 0 ? parts : [{ text: "" }];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "") { flushList(); continue; }

    const numberedHeadingMatch = trimmed.match(/^\d+\.\s+\*\*(.+?)\*\*\s*$/);
    if (numberedHeadingMatch) {
      flushList();
      nodes.push({ type: "heading-five", children: [{ text: numberedHeadingMatch[1] }] });
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
      nodes.push({ type: "paragraph", children: [{ text: subHeadingMatch[1], bold: true }] });
      continue;
    }

    const bulletMatch = line.match(/^(\s*)([-*])\s+(.+)$/);
    if (bulletMatch) {
      const indent = bulletMatch[1].length >= 4 ? 1 : 0;
      if (currentListType !== "bulleted-list") { flushList(); currentListType = "bulleted-list"; }
      currentListItems.push({ type: "list-item", indent, children: parseInlineMarks(bulletMatch[3]) } as any);
      continue;
    }

    flushList();
    nodes.push({ type: "paragraph", children: parseInlineMarks(trimmed) });
  }

  flushList();
  return nodes.length > 0 ? nodes : [{ type: "paragraph", children: [{ text: "" }] }];
};

// ---- Helpers: Slate → Markdown ----

const leafToMarkdown = (node: any): string => {
  if (!node || !("text" in node)) return "";
  let text = node.text as string;
  if (!text) return "";
  if (node.code)          text = `\`${text}\``;
  if (node.bold)          text = `**${text}**`;
  if (node.italic)        text = `*${text}*`;
  if (node.underline)     text = `<u>${text}</u>`;
  if (node.strikethrough) text = `~~${text}~~`;
  return text;
};

const childrenToMarkdown = (children: any[]): string =>
  (children || []).map((c: any) => ("text" in c ? leafToMarkdown(c) : childrenToMarkdown(c.children))).join("");

export const slateToSummaryJson = (nodes: Descendant[]): any => {
  const lines: string[]     = [];
  let headingCounter = 0;
  let prevType: string | null = null;

  for (const node of nodes as any[]) {
    const nodeType = node.type;

    if (prevType && lines.length > 0) {
      const isHeadingToList =
        prevType === "heading-five" &&
        (nodeType === "bulleted-list" || nodeType === "numbered-list");
      if (!isHeadingToList) lines.push("");
    }

    switch (nodeType) {
      case "heading-five": {
        headingCounter++;
        lines.push(`${headingCounter}. **${childrenToMarkdown(node.children)}**`);
        break;
      }
      case "paragraph": {
        const children = node.children || [];
        if (
          children.length === 1 && children[0].bold &&
          !children[0].italic && !children[0].strikethrough &&
          !children[0].underline && !children[0].code &&
          children[0].text && children[0].text.split(/\s+/).length <= 6
        ) {
          lines.push(`${children[0].text}:`);
        } else {
          lines.push(childrenToMarkdown(children));
        }
        break;
      }
      case "bulleted-list": {
        for (const item of node.children || []) {
          const indent = (item as any).indent || 0;
          lines.push(indent >= 1
            ? `     * ${childrenToMarkdown(item.children)}`
            : `   - ${childrenToMarkdown(item.children)}`);
        }
        break;
      }
      case "numbered-list": {
        (node.children || []).forEach((item: any, i: number) => {
          lines.push(`${i + 1}. ${childrenToMarkdown(item.children)}`);
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
// BRD — shared serialisation helpers  (Slate → HTML)
// ============================================================

// FIX: serializeBlockNode must handle BOTH:
//   1. Block-level style props (fontSize, indent, align) on the node itself
//   2. Inline marks (bold, italic, underline, etc.) on text-leaf children
//
// Previously it used a simple leafToInlineHtml that only emitted inline marks
// but dropped block-style props on headings when those headings also had styled
// children. The unified approach below handles both in the same recursion.

const serializeLeafBrd = (node: any): string => {
  if (!node || !("text" in node)) return "";
  let html = node.text as string;
  if (!html) return "";
  if (node.code)          html = `<code>${html}</code>`;
  if (node.italic)        html = `<em>${html}</em>`;
  if (node.bold)          html = `<strong>${html}</strong>`;
  if (node.underline)     html = `<u>${html}</u>`;
  if (node.strikethrough) html = `<s>${html}</s>`;
  return html;
};

/**
 * Block-aware serialiser used by slateToBrdJson.
 *
 * Emits:
 *  • Inline marks (bold/italic/underline/code/strikethrough) on text leaves
 *  • Block-level style attributes (font-size, padding-left, text-align) on
 *    every block node — including headings (h1–h6), paragraphs, and list items
 *  • The correct semantic HTML tag for every known Slate block type
 */
const serializeBlockNode = (node: any): string => {
  // Text leaf — inline marks only
  if ("text" in node) return serializeLeafBrd(node);

  // Recurse first
  const inner = (node.children || []).map(serializeBlockNode).join("");

  // Block-level style props
  const styleProps: string[] = [];
  if (node.fontSize)                      styleProps.push(`font-size:${node.fontSize}px`);
  if (node.indent)                        styleProps.push(`padding-left:${node.indent * 24}px`);
  if (node.align && node.align !== "left") styleProps.push(`text-align:${node.align}`);
  const styleAttr = styleProps.length ? ` style="${styleProps.join(";")}"` : "";

  switch (node.type) {
    // FIX: all heading levels are explicitly handled here so that a heading
    // like { type:"heading-five", fontSize:20, children:[{text:"Intro",bold:true}] }
    // correctly serialises to <h5 style="font-size:20px"><strong>Intro</strong></h5>
    case "heading-one":   return `<h1${styleAttr}>${inner}</h1>`;
    case "heading-two":   return `<h2${styleAttr}>${inner}</h2>`;
    case "heading-three": return `<h3${styleAttr}>${inner}</h3>`;
    case "heading-four":  return `<h4${styleAttr}>${inner}</h4>`;
    case "heading-five":  return `<h5${styleAttr}>${inner}</h5>`;
    case "heading-six":   return `<h6${styleAttr}>${inner}</h6>`;
    case "paragraph":     return styleAttr ? `<p${styleAttr}>${inner}</p>` : inner;
    case "bulleted-list": return `<ul${styleAttr}>${inner}</ul>`;
    case "numbered-list": return `<ol${styleAttr}>${inner}</ol>`;
    case "list-item":     return `<li${styleAttr}>${inner}</li>`;
    default:
      return styleAttr ? `<span${styleAttr}>${inner}</span>` : inner;
  }
};

const childrenToInlineHtml = (children: any[]): string =>
  (children || []).map(serializeBlockNode).join("");

const childrenToText = (children: any[]): string =>
  (children || [])
    .map((c: any) => ("text" in c ? c.text || "" : childrenToText(c.children)))
    .join("");

/**
 * Serialize a bulleted-list node's items to an array of HTML strings.
 * FIX: serialises the whole list-item node (capturing indent/align) then
 * strips the outer <li> wrapper, so item-level styles survive to JSON.
 */
const extractBulletedListItems = (listNode: any): string[] =>
  (listNode.children || []).map((item: any) => {
    const full = serializeBlockNode(item);
    // Strip <li …>…</li> wrapper — only the content goes into the JSON array
    return full.replace(/^<li[^>]*>([\s\S]*)<\/li>$/, "$1") || full;
  });

/**
 * Serialize a table node to an array of row objects.
 * FIX: uses serializeBlockNode per paragraph/cell so block-level styles
 * (fontSize, indent, align) are emitted as <p style="…"> in the JSON values.
 */
const extractTableAsArray = (tableNode: any): any[] => {
  const rows = tableNode.children || [];
  if (rows.length < 2) return [];

  const headers = (rows[0].children || []).map((cell: any) =>
    childrenToText(cell.children).replace(/ /g, "_"),
  );

  return rows.slice(1).map((row: any) => {
    const obj: Record<string, any> = {};
    (row.children || []).forEach((cell: any, i: number) => {
      if (i >= headers.length) return;
      const paragraphs = (cell.children || []).filter((c: any) => c.type === "paragraph");
      if (paragraphs.length > 1) {
        obj[headers[i]] = paragraphs.map((p: any) => serializeBlockNode(p));
      } else {
        obj[headers[i]] = childrenToInlineHtml(cell.children);
      }
    });
    return obj;
  });
};

// ============================================================
// BRD — brdToSlateValue
// ============================================================

export const brdToSlateValue = (rawResponse: string): Descendant[] => {
  let cleanRaw = typeof rawResponse === "string" ? rawResponse.trim() : rawResponse;
  if (typeof cleanRaw === "string") {
    if (cleanRaw.startsWith('"') && cleanRaw.endsWith('"')) {
      try { cleanRaw = JSON.parse(cleanRaw); } catch { /* use as-is */ }
    }
    if (typeof cleanRaw === "string" && cleanRaw.includes("\\n")) {
      cleanRaw = cleanRaw.replace(/\\n/g, "\n");
    }
    if (typeof cleanRaw === "string" && /^<[a-z][\s\S]*>/i.test(cleanRaw.trim())) {
      return htmlToSlateNodes(cleanRaw);
    }
  }
  const parsed = parseAgentResponse(cleanRaw);
  return transformBRDDataToSlate(parsed);
};

// ============================================================
// BRD — slateToBrdJson
// ============================================================

const BRD_SECTION_DISPLAY_TO_KEY: Record<string, string> = {
  "Executive Summary":              "Executive_Summary",
  "Stakeholders & Key Personnel":   "Stakeholders_and_Key_Personnel",
  "Goals & objectives":             "Goals_and_Objectives",
  "Goals & Objectives":             "Goals_and_Objectives",
  "Process Scope Summary":          "Process_Scope_Summary",
  "Actors/Personas":                "Actors_Personas",
  "Glossary":                       "Glossary",
};

const displayNameToKey = (name: string): string =>
  BRD_SECTION_DISPLAY_TO_KEY[name] || name.replace(/ /g, "_");

export const slateToBrdJson = (nodes: Descendant[]): any => {
  const result: Record<string, any> = {};
  const nodeList = nodes as any[];
  let i = 0;

  const TOP_LEVEL_SECTIONS = [
    "Executive_Summary",
    "Stakeholders_and_Key_Personnel",
    "Actors_Personas",
    "Glossary",
    "Goals_and_Objectives",
    "Process_Scope_Summary",
  ];

  const safeCall = (fn: any, arg: any, fallback: any = []) => {
    try { return typeof fn === "function" ? fn(arg) : fallback; }
    catch (err) { console.error("Parser Error:", err); return fallback; }
  };

  while (i < nodeList.length) {
    const node = nodeList[i];

    // ── heading-five (BRD sections) ─────────────────────────────────────────
    if (node.type === "heading-five") {
      const sectionKey = displayNameToKey(childrenToText(node.children));
      i++;

      /** 1. EXECUTIVE SUMMARY */
      if (sectionKey === "Executive_Summary") {
        const execSummary: Record<string, string> = {};
        while (i < nodeList.length) {
          const curr    = nodeList[i];
          const currKey = displayNameToKey(childrenToText(curr.children));
          if (
            curr.type === "heading-one" ||
            (curr.type === "heading-five" && TOP_LEVEL_SECTIONS.includes(currKey))
          ) break;

          if (curr.type === "heading-five") {
            const subKey = childrenToText(curr.children).replace(/ /g, "_");
            i++;
            let content = "";
            while (
              i < nodeList.length &&
              !["heading-five", "heading-one"].includes(nodeList[i].type)
            ) {
              // FIX: serializeBlockNode preserves fontSize/align/indent AND
              // inline marks (bold/italic) on the content paragraphs
              content += serializeBlockNode(nodeList[i]);
              i++;
            }
            execSummary[subKey] = content;
          } else {
            i++;
          }
        }
        result[sectionKey] = execSummary;
      }

      /** 2. TABLE SECTIONS */
      else if (["Stakeholders_and_Key_Personnel", "Actors_Personas", "Glossary"].includes(sectionKey)) {
        let tableData: any[] = [];
        while (i < nodeList.length) {
          const curr    = nodeList[i];
          const currKey = displayNameToKey(childrenToText(curr.children));
          if (
            curr.type === "heading-one" ||
            (curr.type === "heading-five" && TOP_LEVEL_SECTIONS.includes(currKey))
          ) break;
          if (curr.type === "table") {
            tableData = safeCall(extractTableAsArray, curr, []);
            i++;
            break;
          } else { i++; }
        }
        result[sectionKey] = tableData;
      }

      /** 3. GOALS & OBJECTIVES */
      else if (sectionKey === "Goals_and_Objectives") {
        let listData: any[] = [];
        while (i < nodeList.length) {
          const curr    = nodeList[i];
          const currKey = displayNameToKey(childrenToText(curr.children));
          if (
            curr.type === "heading-one" ||
            (curr.type === "heading-five" && TOP_LEVEL_SECTIONS.includes(currKey))
          ) break;
          if (curr.type === "bulleted-list") {
            listData = safeCall(extractBulletedListItems, curr, []);
            i++;
            break;
          } else { i++; }
        }
        result[sectionKey] = listData;
      }

      /** 4. PROCESS SCOPE SUMMARY */
      else if (sectionKey === "Process_Scope_Summary") {
        const scopeObj: Record<string, any> = {};
        while (i < nodeList.length) {
          const curr    = nodeList[i];
          const currKey = displayNameToKey(childrenToText(curr.children));
          if (
            curr.type === "heading-one" ||
            (curr.type === "heading-five" && TOP_LEVEL_SECTIONS.includes(currKey))
          ) break;

          if (curr.type === "heading-five") {
            const subKey = childrenToText(curr.children).replace(/ /g, "_");
            i++;
            const subObj: Record<string, any> = {};
            while (
              i < nodeList.length &&
              !["heading-five", "heading-one"].includes(nodeList[i].type)
            ) {
              const item = nodeList[i];
              if (item.type === "paragraph") {
                subObj["Summary"] = serializeBlockNode(item);
              } else if (item.type === "bulleted-list") {
                const listKey = subKey === "In_Scope" ? "High_Level_Requirements" : "Exclusions";
                subObj[listKey] = safeCall(extractBulletedListItems, item, []);
              }
              i++;
            }
            scopeObj[subKey] = subObj;
          } else { i++; }
        }
        result[sectionKey] = scopeObj;
      }

      /** 5. FALLBACK */
      else {
        const contentParts: string[] = [];
        while (
          i < nodeList.length &&
          !["heading-five", "heading-one"].includes(nodeList[i].type)
        ) {
          contentParts.push(serializeBlockNode(nodeList[i]));
          i++;
        }
        result[sectionKey] = contentParts.join("\n");
      }
    }

    /** 6. HEADING-ONE (metadata / citations) */
    else if (node.type === "heading-one") {
      const key = childrenToText(node.children).replace(/ /g, "_");
      i++;
      if (i < nodeList.length && nodeList[i].type === "paragraph") {
        const text = childrenToText(nodeList[i].children);
        try { result[key] = JSON.parse(text); }
        catch { result[key] = text; }
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
