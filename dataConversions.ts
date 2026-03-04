import type { Descendant } from "slate";
import {
  cellToHtml,
  htmlToCellChildren,
  htmlToSlateNodes,
} from "./htmlConversion";
import { transformBRDDataToSlate } from "./index";
import type { CustomText } from "../types";

// ============================================================
// Helper: parse agent response (string → object)
// ============================================================

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
            Preconditions:   Array.isArray(tc.Preconditions)
              ? tc.Preconditions : [String(tc.Preconditions || "")],
            TestData:        Array.isArray(tc.TestData)
              ? tc.TestData : [String(tc.TestData || "")],
            TestSteps:       Array.isArray(tc.TestSteps)
              ? tc.TestSteps : [String(tc.TestSteps || "")],
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
                  children: val.flatMap((item: string) =>
                    htmlToCellChildren(String(item || ""))),
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

  if (allRows.length === 0)
    return [{ type: "paragraph", children: [{ text: "" }] }];

  return [{
    type: "table",
    className: "editor-custom-table",
    children: [headerRow, ...allRows],
  }];
};

export const slateToTestCasesJson = (nodes: Descendant[]): any => {
  const tableNode = (nodes as any[]).find((n) => n.type === "table");
  if (!tableNode) return { Requirements: [] };

  const dataRows = tableNode.children.slice(1);
  const reqMap: Record<string, any> = {};

  for (const row of dataRows) {
    const cells   = row.children;
    const hidden  = row.hiddenData || {};
    const reqId   = cellToHtml(cells[0]).trim();
    const storyId = cellToHtml(cells[1]).trim();

    if (!reqMap[reqId]) reqMap[reqId] = { req_id: reqId, UserStories: {} };
    if (!reqMap[reqId].UserStories[storyId]) {
      reqMap[reqId].UserStories[storyId] = {
        userstory_id: storyId,
        AcceptanceCriteriaTests: {},
      };
    }

    const criterion = hidden.AcceptanceCriterion || "";
    const storyObj  = reqMap[reqId].UserStories[storyId];
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
  if (!items || items.length === 0)
    return [{ type: "paragraph", children: [{ text: "" }] }];

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

  return [{
    type: "table",
    className: "editor-custom-table",
    children: [headerRow, ...allRows],
  }];
};

export const slateToActionLogJson = (nodes: Descendant[]): any => {
  const tableNode = (nodes as any[]).find((n) => n.type === "table");
  if (!tableNode) return { Minutes_of_Meeting: [] };

  const minutes = tableNode.children.slice(1).map((row: any) => {
    const result: Record<string, string> = {};
    AL_COLUMNS.forEach(({ key }, i) => {
      result[key] = cellToHtml(row.children[i]).trim();
    });
    return result;
  });

  return { Minutes_of_Meeting: minutes };
};

// ============================================================
// SUMMARY
// ============================================================

export const summaryToSlateValue = (text: string): Descendant[] => {
  if (!text || text.trim() === "")
    return [{ type: "paragraph", children: [{ text: "" }] }];

  let cleanText = text.trim();
  if (cleanText.startsWith('"') && cleanText.endsWith('"')) {
    try { cleanText = JSON.parse(cleanText); } catch { /* use as-is */ }
  }
  if (cleanText.includes("\\n")) cleanText = cleanText.replace(/\\n/g, "\n");
  if (/^<[a-z][\s\S]*>/i.test(cleanText.trim())) return htmlToSlateNodes(cleanText);

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
    const regexes: [RegExp, keyof CustomText][] = [
      [/\*\*\*(.+?)\*\*\*/g, "bold"],
      [/\*\*(.+?)\*\*/g,     "bold"],
      [/[\*_](.+?)[\*_]/g,   "italic"],
      [/~~(.+?)~~/g,         "strikethrough"],
      [/<u>(.+?)<\/u>/gi,    "underline"],
      [/`(.+?)`/g,           "code"],
    ];
    let parts: CustomText[] = [{ text }];
    for (const [regex, prop] of regexes) {
      const newParts: CustomText[] = [];
      for (const part of parts) {
        if (Object.keys(part).length > 1) { newParts.push(part); continue; }
        let last = 0; let match;
        regex.lastIndex = 0;
        while ((match = regex.exec(part.text)) !== null) {
          if (match.index > last) newParts.push({ text: part.text.slice(last, match.index) });
          newParts.push({ text: match[1], [prop]: true } as any);
          last = regex.lastIndex;
        }
        if (last < part.text.length) newParts.push({ text: part.text.slice(last) });
      }
      parts = newParts;
    }
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
    if (subHeadingMatch && !trimmed.startsWith("-") && !trimmed.startsWith("*") &&
        subHeadingMatch[1].split(/\s+/).length <= 6) {
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

const leafToMarkdown = (node: any): string => {
  if (!node || !("text" in node)) return "";
  let t = node.text as string;
  if (!t) return "";
  if (node.code)          t = `\`${t}\``;
  if (node.bold)          t = `**${t}**`;
  if (node.italic)        t = `*${t}*`;
  if (node.underline)     t = `<u>${t}</u>`;
  if (node.strikethrough) t = `~~${t}~~`;
  return t;
};

const childrenToMarkdown = (children: any[]): string =>
  (children || []).map((c: any) =>
    "text" in c ? leafToMarkdown(c) : childrenToMarkdown(c.children)).join("");

export const slateToSummaryJson = (nodes: Descendant[]): any => {
  const lines: string[] = [];
  let headingCounter    = 0;
  let prevType: string | null = null;

  for (const node of nodes as any[]) {
    const nodeType = node.type;
    if (prevType && lines.length > 0) {
      const tight = prevType === "heading-five" &&
        (nodeType === "bulleted-list" || nodeType === "numbered-list");
      if (!tight) lines.push("");
    }
    switch (nodeType) {
      case "heading-five":
        headingCounter++;
        lines.push(`${headingCounter}. **${childrenToMarkdown(node.children)}**`);
        break;
      case "paragraph": {
        const ch = node.children || [];
        if (ch.length === 1 && ch[0].bold && !ch[0].italic && !ch[0].strikethrough &&
            !ch[0].underline && !ch[0].code && ch[0].text &&
            ch[0].text.split(/\s+/).length <= 6) {
          lines.push(`${ch[0].text}:`);
        } else {
          lines.push(childrenToMarkdown(ch));
        }
        break;
      }
      case "bulleted-list":
        for (const item of node.children || []) {
          const ind = (item as any).indent || 0;
          lines.push(ind >= 1
            ? `     * ${childrenToMarkdown(item.children)}`
            : `   - ${childrenToMarkdown(item.children)}`);
        }
        break;
      case "numbered-list":
        (node.children || []).forEach((item: any, idx: number) => {
          lines.push(`${idx + 1}. ${childrenToMarkdown(item.children)}`);
        });
        break;
      default: {
        const t = childrenToMarkdown(node.children);
        if (t) lines.push(t);
        break;
      }
    }
    prevType = nodeType;
  }

  return { response: lines.join("\n") };
};

// ============================================================
// BRD — internal serialisation helpers
// ============================================================

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
 * Fully block-aware + inline-mark-aware serialiser.
 * Handles fontSize / indent / align on every block type
 * AND bold / italic / underline / code / strikethrough on every leaf.
 */
const serializeBlockNode = (node: any): string => {
  if ("text" in node) return serializeLeafBrd(node);

  const inner = (node.children || []).map(serializeBlockNode).join("");

  const styleProps: string[] = [];
  if (node.fontSize)                       styleProps.push(`font-size:${node.fontSize}px`);
  if (node.indent)                         styleProps.push(`padding-left:${node.indent * 24}px`);
  if (node.align && node.align !== "left") styleProps.push(`text-align:${node.align}`);
  const s = styleProps.length ? ` style="${styleProps.join(";")}"` : "";

  switch (node.type) {
    case "heading-one":   return `<h1${s}>${inner}</h1>`;
    case "heading-two":   return `<h2${s}>${inner}</h2>`;
    case "heading-three": return `<h3${s}>${inner}</h3>`;
    case "heading-four":  return `<h4${s}>${inner}</h4>`;
    case "heading-five":  return `<h5${s}>${inner}</h5>`;
    case "heading-six":   return `<h6${s}>${inner}</h6>`;
    case "paragraph":     return s ? `<p${s}>${inner}</p>` : inner;
    case "bulleted-list": return `<ul${s}>${inner}</ul>`;
    case "numbered-list": return `<ol${s}>${inner}</ol>`;
    case "list-item":     return `<li${s}>${inner}</li>`;
    default:              return s ? `<span${s}>${inner}</span>` : inner;
  }
};

/** Plain text extraction — used ONLY for section-key detection, never for display. */
const childrenToText = (children: any[]): string =>
  (children || []).map((c: any) =>
    "text" in c ? c.text || "" : childrenToText(c.children)).join("");

const extractBulletedListItems = (listNode: any): string[] =>
  (listNode.children || []).map((item: any) => {
    const full = serializeBlockNode(item);
    return full.replace(/^<li[^>]*>([\s\S]*)<\/li>$/, "$1") || full;
  });

const extractTableAsArray = (tableNode: any): any[] => {
  const rows = tableNode.children || [];
  if (rows.length < 2) return [];

  const headers = (rows[0].children || []).map((cell: any) =>
    childrenToText(cell.children).replace(/ /g, "_"));

  return rows.slice(1).map((row: any) => {
    const obj: Record<string, any> = {};
    (row.children || []).forEach((cell: any, i: number) => {
      if (i >= headers.length) return;
      const paragraphs = (cell.children || []).filter((c: any) => c.type === "paragraph");
      obj[headers[i]] = paragraphs.length > 1
        ? paragraphs.map((p: any) => serializeBlockNode(p))
        : (cell.children || []).map(serializeBlockNode).join("");
    });
    return obj;
  });
};

// ============================================================
// BRD section key mapping
// ============================================================

const BRD_SECTION_DISPLAY_TO_KEY: Record<string, string> = {
  "Executive Summary":            "Executive_Summary",
  "Stakeholders & Key Personnel": "Stakeholders_and_Key_Personnel",
  "Goals & objectives":           "Goals_and_Objectives",
  "Goals & Objectives":           "Goals_and_Objectives",
  "Process Scope Summary":        "Process_Scope_Summary",
  "Actors/Personas":              "Actors_Personas",
  "Glossary":                     "Glossary",
};

const displayNameToKey = (name: string): string =>
  BRD_SECTION_DISPLAY_TO_KEY[name] || name.replace(/ /g, "_");

// ============================================================
// BRD — brdToSlateValue
// ============================================================

export const brdToSlateValue = (rawResponse: string): Descendant[] => {
  let cleanRaw: any = typeof rawResponse === "string" ? rawResponse.trim() : rawResponse;

  if (typeof cleanRaw === "string") {
    // Strip wrapping quotes
    if (cleanRaw.startsWith('"') && cleanRaw.endsWith('"')) {
      try { cleanRaw = JSON.parse(cleanRaw); } catch { /* use as-is */ }
    }
    // Replace escaped newlines
    if (typeof cleanRaw === "string" && cleanRaw.includes("\\n"))
      cleanRaw = cleanRaw.replace(/\\n/g, "\n");
    // If raw HTML
    if (typeof cleanRaw === "string" && /^<[a-z][\s\S]*>/i.test(cleanRaw.trim()))
      return htmlToSlateNodes(cleanRaw);
  }

  // Parse JSON / strip ```json fences
  const parsed = parseAgentResponse(cleanRaw);

  // parsed may be:
  //   (a) the full BRD object  { Executive_Summary: {...}, _headings: {...}, ... }
  //   (b) a wrapper object     { response: "```json\n{...}\n```" }
  // Handle (b) by unwrapping
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
      typeof parsed.response === "string" &&
      Object.keys(parsed).length === 1) {
    try {
      const inner = parseAgentResponse(parsed.response);
      return transformBRDDataToSlate(inner);
    } catch { /* fall through */ }
  }

  return transformBRDDataToSlate(parsed);
};

// ============================================================
// BRD — slateToBrdJson
// ============================================================

/**
 * HOW HEADING STYLES ARE PERSISTED
 * ─────────────────────────────────
 * The JSON uses heading plain-text as the key ("Executive_Summary" etc.)
 * so there is no natural place to store bold / italic / fontSize / indent /
 * align applied to the heading node itself.
 *
 * Solution: a `_headings` sibling key that maps every section key to the
 * full serialised HTML of its heading node:
 *
 *   "_headings": {
 *     "Executive_Summary": "<h5 style='font-size:20px'><strong>Executive Summary</strong></h5>",
 *     "Introduction":      "<h5 style='text-align:center'><em>Introduction</em></h5>",
 *     ...
 *   }
 *
 * On load, transformBRDDataToSlate (index.ts) reads this map and passes the
 * HTML to makeHeadingFive() which deserialises it back to a full Slate node —
 * restoring every style the user applied.
 *
 * IMPORTANT: `_headings` is stored at the TOP LEVEL of result so it is
 * preserved inside the JSON string that slateToBrdJson returns, and is
 * available to brdToSlateValue / transformBRDDataToSlate on reload.
 */
export const slateToBrdJson = (nodes: Descendant[]): any => {
  const result:   Record<string, any>    = {};
  const headings: Record<string, string> = {};

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

    // ── heading-five ──────────────────────────────────────────────────────
    if (node.type === "heading-five") {
      const plainText  = childrenToText(node.children);
      const sectionKey = displayNameToKey(plainText);

      // Serialise the entire heading node to HTML — this captures:
      //   • block-level styles: fontSize, indent, align (via style="…")
      //   • inline marks on children: bold, italic, underline, etc.
      headings[sectionKey] = serializeBlockNode(node);
      i++;

      // ── 1. EXECUTIVE SUMMARY ───────────────────────────────────────────
      if (sectionKey === "Executive_Summary") {
        const execSummary: Record<string, string> = {};

        while (i < nodeList.length) {
          const curr    = nodeList[i];
          const currKey = displayNameToKey(childrenToText(curr.children));
          if (curr.type === "heading-one" ||
              (curr.type === "heading-five" && TOP_LEVEL_SECTIONS.includes(currKey))) break;

          if (curr.type === "heading-five") {
            const subPlain = childrenToText(curr.children);
            const subKey   = subPlain.replace(/ /g, "_");
            headings[subKey] = serializeBlockNode(curr);   // ← save sub-heading styles
            i++;

            let content = "";
            while (i < nodeList.length &&
                   !["heading-five", "heading-one"].includes(nodeList[i].type)) {
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

      // ── 2. TABLE SECTIONS ─────────────────────────────────────────────
      else if (["Stakeholders_and_Key_Personnel", "Actors_Personas", "Glossary"]
               .includes(sectionKey)) {
        let tableData: any[] = [];
        while (i < nodeList.length) {
          const curr    = nodeList[i];
          const currKey = displayNameToKey(childrenToText(curr.children));
          if (curr.type === "heading-one" ||
              (curr.type === "heading-five" && TOP_LEVEL_SECTIONS.includes(currKey))) break;
          if (curr.type === "table") {
            tableData = safeCall(extractTableAsArray, curr, []);
            i++; break;
          } else { i++; }
        }
        result[sectionKey] = tableData;
      }

      // ── 3. GOALS & OBJECTIVES ─────────────────────────────────────────
      else if (sectionKey === "Goals_and_Objectives") {
        let listData: any[] = [];
        while (i < nodeList.length) {
          const curr    = nodeList[i];
          const currKey = displayNameToKey(childrenToText(curr.children));
          if (curr.type === "heading-one" ||
              (curr.type === "heading-five" && TOP_LEVEL_SECTIONS.includes(currKey))) break;
          if (curr.type === "bulleted-list") {
            listData = safeCall(extractBulletedListItems, curr, []);
            i++; break;
          } else { i++; }
        }
        result[sectionKey] = listData;
      }

      // ── 4. PROCESS SCOPE SUMMARY ──────────────────────────────────────
      else if (sectionKey === "Process_Scope_Summary") {
        const scopeObj: Record<string, any> = {};

        while (i < nodeList.length) {
          const curr    = nodeList[i];
          const currKey = displayNameToKey(childrenToText(curr.children));
          if (curr.type === "heading-one" ||
              (curr.type === "heading-five" && TOP_LEVEL_SECTIONS.includes(currKey))) break;

          if (curr.type === "heading-five") {
            const subPlain = childrenToText(curr.children);
            const subKey   = subPlain.replace(/ /g, "_");
            headings[subKey] = serializeBlockNode(curr);   // ← save sub-heading styles
            i++;

            const subObj: Record<string, any> = {};
            while (i < nodeList.length &&
                   !["heading-five", "heading-one"].includes(nodeList[i].type)) {
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

      // ── 5. FALLBACK ───────────────────────────────────────────────────
      else {
        const parts: string[] = [];
        while (i < nodeList.length &&
               !["heading-five", "heading-one"].includes(nodeList[i].type)) {
          parts.push(serializeBlockNode(nodeList[i]));
          i++;
        }
        result[sectionKey] = parts.join("\n");
      }
    }

    // ── heading-one (metadata) ───────────────────────────────────────────
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

  // Always include _headings so transformBRDDataToSlate can restore styles
  result["_headings"] = headings;

  return {
    response: "```json\n" + JSON.stringify(result, null, 2) + "\n```",
  };
};
