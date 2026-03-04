import type { Descendant } from "slate";
import {
  cellToHtml,
  htmlToCellChildren,
  htmlToSlateNodes,
} from "./htmlConversion";
import { transformBRDDataToSlate } from "./index";
import type { CustomText } from "../types";

// ============================================================
// Helper: parse agent response
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
            Preconditions:   Array.isArray(tc.Preconditions) ? tc.Preconditions : [String(tc.Preconditions || "")],
            TestData:        Array.isArray(tc.TestData)      ? tc.TestData      : [String(tc.TestData      || "")],
            TestSteps:       Array.isArray(tc.TestSteps)     ? tc.TestSteps     : [String(tc.TestSteps     || "")],
            ExpectedResults: tc.ExpectedResults,
          };
          allRows.push({
            type: "table-row",
            hiddenData,
            children: TC_VISIBLE_COLUMNS.map(({ key }) => {
              const val = rowData[key];
              if (Array.isArray(val)) {
                return { type: "table-cell", children: val.flatMap((item: string) => htmlToCellChildren(String(item || ""))) };
              }
              return { type: "table-cell", children: htmlToCellChildren(val != null ? String(val) : "") };
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

  if (allRows.length === 0) return [{ type: "paragraph", children: [{ text: "" }] }];
  return [{ type: "table", className: "editor-custom-table", children: [headerRow, ...allRows] }];
};

export const slateToTestCasesJson = (nodes: Descendant[]): any => {
  const tableNode = (nodes as any[]).find((n) => n.type === "table");
  if (!tableNode) return { Requirements: [] };

  const reqMap: Record<string, any> = {};
  for (const row of tableNode.children.slice(1)) {
    const cells   = row.children;
    const hidden  = row.hiddenData || {};
    const reqId   = cellToHtml(cells[0]).trim();
    const storyId = cellToHtml(cells[1]).trim();

    if (!reqMap[reqId]) reqMap[reqId] = { req_id: reqId, UserStories: {} };
    if (!reqMap[reqId].UserStories[storyId])
      reqMap[reqId].UserStories[storyId] = { userstory_id: storyId, AcceptanceCriteriaTests: {} };

    const criterion = hidden.AcceptanceCriterion || "";
    const storyObj  = reqMap[reqId].UserStories[storyId];
    if (!storyObj.AcceptanceCriteriaTests[criterion])
      storyObj.AcceptanceCriteriaTests[criterion] = { AcceptanceCriterion: criterion, TestCases: [] };

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

  return {
    Requirements: Object.values(reqMap).map((req: any) => ({
      req_id: req.req_id,
      UserStories: Object.values(req.UserStories).map((story: any) => ({
        userstory_id: story.userstory_id,
        AcceptanceCriteriaTests: Object.values(story.AcceptanceCriteriaTests),
      })),
    })),
  };
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
  if (!items || items.length === 0) return [{ type: "paragraph", children: [{ text: "" }] }];

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
    children: [
      headerRow,
      ...items.map((item: any) => ({
        type: "table-row" as const,
        children: AL_COLUMNS.map(({ key }) => ({
          type: "table-cell" as const,
          children: htmlToCellChildren(item[key] != null ? String(item[key]) : ""),
        })),
      })),
    ],
  }];
};

export const slateToActionLogJson = (nodes: Descendant[]): any => {
  const tableNode = (nodes as any[]).find((n) => n.type === "table");
  if (!tableNode) return { Minutes_of_Meeting: [] };

  return {
    Minutes_of_Meeting: tableNode.children.slice(1).map((row: any) => {
      const result: Record<string, string> = {};
      AL_COLUMNS.forEach(({ key }, i) => { result[key] = cellToHtml(row.children[i]).trim(); });
      return result;
    }),
  };
};

// ============================================================
// SUMMARY
// ============================================================

export const summaryToSlateValue = (text: string): Descendant[] => {
  if (!text || text.trim() === "") return [{ type: "paragraph", children: [{ text: "" }] }];

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
      currentListItems = []; currentListType = null;
    }
  };

  const parseInlineMarks = (text: string): CustomText[] => {
    const regexes: [RegExp, keyof CustomText][] = [
      [/\*\*\*(.+?)\*\*\*/g, "bold"], [/\*\*(.+?)\*\*/g, "bold"],
      [/[\*_](.+?)[\*_]/g, "italic"], [/~~(.+?)~~/g, "strikethrough"],
      [/<u>(.+?)<\/u>/gi, "underline"], [/`(.+?)`/g, "code"],
    ];
    let parts: CustomText[] = [{ text }];
    for (const [regex, prop] of regexes) {
      const newParts: CustomText[] = [];
      for (const part of parts) {
        if (Object.keys(part).length > 1) { newParts.push(part); continue; }
        let last = 0; let match; regex.lastIndex = 0;
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

    const m1 = trimmed.match(/^\d+\.\s+\*\*(.+?)\*\*\s*$/);
    if (m1) { flushList(); nodes.push({ type: "heading-five", children: [{ text: m1[1] }] }); continue; }

    const m2 = trimmed.match(/^([A-Z][^-*].+):$/);
    if (m2 && !trimmed.startsWith("-") && !trimmed.startsWith("*") && m2[1].split(/\s+/).length <= 6) {
      flushList(); nodes.push({ type: "paragraph", children: [{ text: m2[1], bold: true }] }); continue;
    }

    const m3 = line.match(/^(\s*)([-*])\s+(.+)$/);
    if (m3) {
      const indent = m3[1].length >= 4 ? 1 : 0;
      if (currentListType !== "bulleted-list") { flushList(); currentListType = "bulleted-list"; }
      currentListItems.push({ type: "list-item", indent, children: parseInlineMarks(m3[3]) } as any);
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
  if (node.code) t = `\`${t}\``;
  if (node.bold) t = `**${t}**`;
  if (node.italic) t = `*${t}*`;
  if (node.underline) t = `<u>${t}</u>`;
  if (node.strikethrough) t = `~~${t}~~`;
  return t;
};
const childrenToMarkdown = (children: any[]): string =>
  (children || []).map((c: any) => "text" in c ? leafToMarkdown(c) : childrenToMarkdown(c.children)).join("");

export const slateToSummaryJson = (nodes: Descendant[]): any => {
  const lines: string[] = [];
  let hCount = 0; let prevType: string | null = null;
  for (const node of nodes as any[]) {
    const t = node.type;
    if (prevType && lines.length > 0) {
      if (!(prevType === "heading-five" && (t === "bulleted-list" || t === "numbered-list"))) lines.push("");
    }
    switch (t) {
      case "heading-five": hCount++; lines.push(`${hCount}. **${childrenToMarkdown(node.children)}**`); break;
      case "paragraph": {
        const ch = node.children || [];
        if (ch.length === 1 && ch[0].bold && !ch[0].italic && !ch[0].strikethrough && !ch[0].underline && !ch[0].code && ch[0].text?.split(/\s+/).length <= 6)
          lines.push(`${ch[0].text}:`);
        else lines.push(childrenToMarkdown(ch));
        break;
      }
      case "bulleted-list":
        for (const item of node.children || [])
          lines.push((item as any).indent >= 1 ? `     * ${childrenToMarkdown(item.children)}` : `   - ${childrenToMarkdown(item.children)}`);
        break;
      case "numbered-list":
        (node.children || []).forEach((item: any, idx: number) => lines.push(`${idx + 1}. ${childrenToMarkdown(item.children)}`));
        break;
      default: { const tx = childrenToMarkdown(node.children); if (tx) lines.push(tx); }
    }
    prevType = t;
  }
  return { response: lines.join("\n") };
};

// ============================================================
// BRD serialisation helpers
// ============================================================

// Serialize a text leaf → HTML with inline marks
const serializeLeaf = (node: any): string => {
  if (!node || !("text" in node)) return "";
  let h = String(node.text ?? "");
  if (node.code)          h = `<code>${h}</code>`;
  if (node.italic)        h = `<em>${h}</em>`;
  if (node.bold)          h = `<strong>${h}</strong>`;
  if (node.underline)     h = `<u>${h}</u>`;
  if (node.strikethrough) h = `<s>${h}</s>`;
  return h;
};

// Wrap inner content with marks stored directly on a block node
// (some toolbars set bold/italic on the block node, not on text leaves)
const applyBlockMarks = (node: any, inner: string): string => {
  let h = inner;
  if (node.strikethrough) h = `<s>${h}</s>`;
  if (node.underline)     h = `<u>${h}</u>`;
  if (node.bold)          h = `<strong>${h}</strong>`;
  if (node.italic)        h = `<em>${h}</em>`;
  if (node.code)          h = `<code>${h}</code>`;
  return h;
};

// Serialize any Slate node → HTML preserving ALL styles and marks
const serializeNode = (node: any): string => {
  if (!node) return "";
  if ("text" in node) return serializeLeaf(node);

  const children = node.children || [];
  let inner = children.map(serializeNode).join("");
  inner = applyBlockMarks(node, inner);

  const sp: string[] = [];
  if (node.fontSize)                       sp.push(`font-size:${node.fontSize}px`);
  if (node.indent)                         sp.push(`padding-left:${node.indent * 24}px`);
  if (node.align && node.align !== "left") sp.push(`text-align:${node.align}`);
  const s = sp.length ? ` style="${sp.join(";")}"` : "";

  switch (node.type) {
    case "heading-one":   return `<h1${s}>${inner}</h1>`;
    case "heading-two":   return `<h2${s}>${inner}</h2>`;
    case "heading-three": return `<h3${s}>${inner}</h3>`;
    case "heading-four":  return `<h4${s}>${inner}</h4>`;
    case "heading-five":  return `<h5${s}>${inner}</h5>`;
    case "heading-six":   return `<h6${s}>${inner}</h6>`;
    case "paragraph":     return `<p${s}>${inner}</p>`;
    case "bulleted-list": return `<ul${s}>${inner}</ul>`;
    case "numbered-list": return `<ol${s}>${inner}</ol>`;
    case "list-item":     return `<li${s}>${inner}</li>`;
    default:              return s ? `<div${s}>${inner}</div>` : inner;
  }
};

// Extract plain text only — used for section-key detection, never for display
const nodeText = (node: any): string => {
  if (!node) return "";
  if ("text" in node) return String(node.text ?? "");
  return (node.children || []).map(nodeText).join("");
};

const extractBulletItems = (listNode: any): string[] =>
  (listNode.children || []).map((item: any) => {
    const html = serializeNode(item);
    return html.replace(/^<li[^>]*>([\s\S]*)<\/li>$/, "$1") || html;
  });

const extractTable = (tableNode: any): any[] => {
  const rows = tableNode.children || [];
  if (rows.length < 2) return [];
  const headers = (rows[0].children || []).map((cell: any) =>
    (cell.children || []).map(nodeText).join("").replace(/ /g, "_"));
  return rows.slice(1).map((row: any) => {
    const obj: Record<string, any> = {};
    (row.children || []).forEach((cell: any, ci: number) => {
      if (ci >= headers.length) return;
      const paras = (cell.children || []).filter((c: any) => c.type === "paragraph");
      obj[headers[ci]] = paras.length > 1
        ? paras.map((p: any) => serializeNode(p))
        : (cell.children || []).map(serializeNode).join("");
    });
    return obj;
  });
};

// ============================================================
// BRD section key map
// ============================================================

const SECTION_KEY_MAP: Record<string, string> = {
  "Executive Summary":            "Executive_Summary",
  "Stakeholders & Key Personnel": "Stakeholders_and_Key_Personnel",
  "Goals & objectives":           "Goals_and_Objectives",
  "Goals & Objectives":           "Goals_and_Objectives",
  "Process Scope Summary":        "Process_Scope_Summary",
  "Actors/Personas":              "Actors_Personas",
  "Glossary":                     "Glossary",
};

const toSectionKey = (text: string): string =>
  SECTION_KEY_MAP[text] || text.replace(/ /g, "_");

const TOP_LEVEL_KEYS = new Set([
  "Executive_Summary", "Stakeholders_and_Key_Personnel",
  "Actors_Personas", "Glossary", "Goals_and_Objectives", "Process_Scope_Summary",
]);

// ============================================================
// brdToSlateValue
// ============================================================

export const brdToSlateValue = (rawResponse: string): Descendant[] => {
  let clean: any = typeof rawResponse === "string" ? rawResponse.trim() : rawResponse;
  if (typeof clean === "string") {
    if (clean.startsWith('"') && clean.endsWith('"')) { try { clean = JSON.parse(clean); } catch { /* ok */ } }
    if (typeof clean === "string" && clean.includes("\\n")) clean = clean.replace(/\\n/g, "\n");
    if (typeof clean === "string" && /^<[a-z][\s\S]*>/i.test(clean.trim())) return htmlToSlateNodes(clean);
  }
  const parsed = parseAgentResponse(clean);
  // Unwrap { response: "```json...```" } envelope
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
      typeof parsed.response === "string" && Object.keys(parsed).length === 1) {
    try { return transformBRDDataToSlate(parseAgentResponse(parsed.response)); } catch { /* ok */ }
  }
  return transformBRDDataToSlate(parsed);
};

// ============================================================
// slateToBrdJson
// ============================================================
//
// HOW HEADING STYLES ARE STORED IN JSON
// ──────────────────────────────────────
// Every section title heading is serialised to HTML via serializeNode(), which
// captures ALL of:
//   • block-level CSS (fontSize, indent, align) → style="…"
//   • inline marks on text leaf children (bold, italic, etc.) → <strong>, <em>…
//   • inline marks stored on the block node itself → wrapped around inner HTML
//
// The HTML is stored in TWO places so both the JSON viewer and reload path work:
//
//  A) Inside the section object as "_title":
//       "Executive_Summary": { "_title": "<h5 style='…'>…</h5>", … }
//       "Stakeholders_and_Key_Personnel": { "_title": "<h5>…</h5>", "_data": […] }
//
//  B) In the top-level "_headings" map (backward compat):
//       "_headings": { "Executive_Summary": "<h5>…</h5>", … }
//
// Sub-headings (Introduction, Problem Statement, etc.) use { _title, _content }:
//       "Introduction": { "_title": "<h5 …>Intro</h5>", "_content": "<p …>…</p>" }

export const slateToBrdJson = (nodes: Descendant[]): any => {
  const result:   Record<string, any>    = {};
  const headings: Record<string, string> = {};

  const list = nodes as any[];
  let i = 0;

  const safeExtract = (fn: (n: any) => any, node: any, fallback: any) => {
    try { return fn(node); } catch (e) { console.error(e); return fallback; }
  };

  // Check whether node at position j is a top-level section boundary
  const isTopBoundary = (j: number): boolean => {
    if (j >= list.length) return true;
    const n = list[j];
    if (n.type === "heading-one") return true;
    if (n.type === "heading-five" && TOP_LEVEL_KEYS.has(toSectionKey(nodeText(n)))) return true;
    return false;
  };

  while (i < list.length) {
    const node = list[i];

    // ── heading-five → BRD section ────────────────────────────────────────
    if (node.type === "heading-five") {
      const plainText  = nodeText(node);
      const sectionKey = toSectionKey(plainText);
      const titleHtml  = serializeNode(node); // ← full HTML: <h5 style="…"><strong>…</strong></h5>

      headings[sectionKey] = titleHtml;
      i++;

      // 1. EXECUTIVE SUMMARY
      if (sectionKey === "Executive_Summary") {
        const section: Record<string, any> = { _title: titleHtml };

        while (i < list.length && !isTopBoundary(i)) {
          const curr = list[i];

          if (curr.type === "heading-five") {
            // sub-heading: Introduction, Problem Statement, Recommended Potential Solutions…
            const subText     = nodeText(curr);
            const subKey      = subText.replace(/ /g, "_");
            const subTitleHtml = serializeNode(curr);
            headings[subKey]   = subTitleHtml;
            i++;

            // collect all content nodes until next heading or section boundary
            let content = "";
            while (i < list.length && list[i].type !== "heading-five" && list[i].type !== "heading-one") {
              content += serializeNode(list[i]);
              i++;
            }

            section[subKey] = { _title: subTitleHtml, _content: content };
          } else {
            i++;
          }
        }
        result[sectionKey] = section;
      }

      // 2. TABLE SECTIONS
      else if (sectionKey === "Stakeholders_and_Key_Personnel" ||
               sectionKey === "Actors_Personas"                ||
               sectionKey === "Glossary") {
        let data: any[] = [];
        while (i < list.length && !isTopBoundary(i)) {
          if (list[i].type === "table") { data = safeExtract(extractTable, list[i], []); i++; break; }
          i++;
        }
        result[sectionKey] = { _title: titleHtml, _data: data };
      }

      // 3. GOALS & OBJECTIVES
      else if (sectionKey === "Goals_and_Objectives") {
        let data: string[] = [];
        while (i < list.length && !isTopBoundary(i)) {
          if (list[i].type === "bulleted-list") { data = safeExtract(extractBulletItems, list[i], []); i++; break; }
          i++;
        }
        result[sectionKey] = { _title: titleHtml, _data: data };
      }

      // 4. PROCESS SCOPE SUMMARY
      else if (sectionKey === "Process_Scope_Summary") {
        const section: Record<string, any> = { _title: titleHtml };

        while (i < list.length && !isTopBoundary(i)) {
          const curr = list[i];
          if (curr.type === "heading-five") {
            const subText      = nodeText(curr);
            const subKey       = subText.replace(/ /g, "_");
            const subTitleHtml = serializeNode(curr);
            headings[subKey]   = subTitleHtml;
            i++;

            const sub: Record<string, any> = { _title: subTitleHtml };
            while (i < list.length && list[i].type !== "heading-five" && list[i].type !== "heading-one") {
              const item = list[i];
              if (item.type === "paragraph") {
                sub["Summary"] = serializeNode(item);
              } else if (item.type === "bulleted-list") {
                sub[subKey === "In_Scope" ? "High_Level_Requirements" : "Exclusions"] =
                  safeExtract(extractBulletItems, item, []);
              }
              i++;
            }
            section[subKey] = sub;
          } else { i++; }
        }
        result[sectionKey] = section;
      }

      // 5. FALLBACK
      else {
        let content = "";
        while (i < list.length && !isTopBoundary(i)) {
          content += serializeNode(list[i]);
          i++;
        }
        result[sectionKey] = { _title: titleHtml, _content: content };
      }
    }

    // ── heading-one → metadata ────────────────────────────────────────────
    else if (node.type === "heading-one") {
      const key = nodeText(node).replace(/ /g, "_");
      i++;
      if (i < list.length && list[i].type === "paragraph") {
        const text = nodeText(list[i]);
        try { result[key] = JSON.parse(text); } catch { result[key] = text; }
        i++;
      }
    }

    else { i++; }
  }

  result["_headings"] = headings;
  return { response: "```json\n" + JSON.stringify(result, null, 2) + "\n```" };
};
