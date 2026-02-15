export const createSlateTable = (data: any[]): any => {
  if (!data || data.length === 0)
    return { type: "paragraph", children: [{ text: "" }] };

  // Get headers from the first object's keys
  const headers = Object.keys(data[0]);

  return {
    type: "table" as const,
    className: "editor-custom-table",
    children: [
      // HEADER ROW
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
      // DATA ROWS
      ...data.map((row) => ({
        type: "table-row" as const,
        children: headers.map((key) => ({
          type: "table-cell" as const,
          children: [
            {
              type: "paragraph" as const,
              children: [{ text: String(row[key] || "") }],
            },
          ],
        })),
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
            type: "heading-six" as const,
            children: [{ text: subKey.replace(/_/g, " ") }],
          },
          {
            type: "paragraph" as const,
            children: [{ text: String(subValue) }],
          },
        ]);

        return [sectionHeader, ...subNodes];
      }

      if (key === "Stakeholders_and_Key_Personnel" && Array.isArray(value)) {
        const sectionHeader = {
          type: "heading-five" as const,
          children: [{ text: "Stakeholders & Key Personnel" }],
        };

        const tableNode = createSlateTable(value);

        return [sectionHeader, tableNode];
      }

      if (key === "Goals_and_Objectives" && Array.isArray(value)) {
        const sectionHeader = {
          type: "heading-five" as const,
          children: [{ text: "Goals & objectives" }],
        };

        const listNodes = createSlateBulletedList(value);

        return [sectionHeader, listNodes];
      }

      if (key === "Process_Scope_Summary" && typeof value === "object") {
        const sectionHeader = {
          type: "heading-five" as const,
          children: [{ text: "Process Scope Summary" }],
        };

        const scopeNodes = Object.entries(value).flatMap(
          ([scopeKey, scopeValue]: [string, any]) => {
            const scopeTitle = {
              type: "heading-six" as const,
              children: [{ text: scopeKey.replace(/_/g, " ") }],
            };

            // Process the content inside In_Scope / Out_of_Scope
            const scopeContent = Object.entries(scopeValue).flatMap(
              ([subKey, subValue]: [string, any]) => {              

                // 1. If it's the list of requirements/exclusions (Array)
                if (Array.isArray(subValue)) {
                  return [createSlateBulletedList(subValue)];
                }

                // 2. If it's the Summary (String)
                return [
                  {
                    type: "paragraph" as const,
                    children: [{ text: String(subValue) }],
                  },
                ];
              },
            );

            return [scopeTitle, ...scopeContent];
          },
        );

        return [sectionHeader, ...scopeNodes];
      }

      if (key === "Glossary" && Array.isArray(value)) {
        const sectionHeader = {
          type: "heading-five" as const,
          children: [{ text: "Glossary" }],
        };

        const tableNode = createSlateTable(value);

        return [sectionHeader, tableNode];
      }

      if (key === "Actors_Personas" && Array.isArray(value)) {
        const sectionHeader = {
          type: "heading-five" as const,
          children: [{ text: "Actors/Personas" }],
        };

        const tableNode = createSlateTable(value);

        return [sectionHeader, tableNode];
      }

      return [
        { type: "heading-one" as const, children: [{ text: key }] },
        {
          type: "paragraph" as const,
          children: [
            {
              text:
                typeof value === "object"
                  ? JSON.stringify(value)
                  : String(value),
            },
          ],
        },
      ];
    });
  };

  const BLOCK_TAG_MAP = {
  'heading-one': 'h1',
  'heading-two': 'h2',
  'block-quote': 'blockquote',
  'numbered-list': 'ol',
  'bulleted-list': 'ul',
  'list-item': 'li',
}

// const HIDDEN_STORY_KEYS = [
//   'source',
//   'referred_document',
//   'referred_doc_location',
//   'section',
//   'justification',
//   'referred_in',
//   'source_timestamp',
// ]

const leafToHtml = (leaf) => {
  let html = leaf.text
  if (leaf.code) html = `<code>${html}</code>`
  if (leaf.italic) html = `<em>${html}</em>`
  if (leaf.bold) html = `<strong>${html}</strong>`
  if (leaf.underline) html = `<u>${html}</u>`
  return html
}

  const nodeToHtml = (node) => {
  // Text leaf node
  if (typeof node.text === 'string') {
    return leafToHtml(node)
  }
  // Element node — recurse into children
  const inner = (node.children || []).map(child => nodeToHtml(child)).join('')
  const tag = BLOCK_TAG_MAP[node.type]
  if (tag) return `<${tag}>${inner}</${tag}>`
  return inner
}

  const cellToHtml = (cell) => {
  const children = cell.children || []
  return children.map(child => nodeToHtml(child)).join('\n')
}

const cellToHtmlArray = (cell) => {
  const children = cell.children || []
  return children
    .map(child => nodeToHtml(child))
    .filter(t => t.trim().length > 0)
}

  export const slateValueToJson = (nodes) => {
    const tableNode = nodes.find(n => n.type === 'table')
    if (!tableNode) return {}
  
    const rows = tableNode.children
    const dataRows = rows.slice(1)
  
    const result = {}
  
    for (const row of dataRows) {
      const cells = row.children
      const hidden = row.hiddenData || {}
  
      const reqId = cellToHtml(cells[0])
      const reqName = hidden.Requirement || ''
      const reqDesc = hidden.RequirementDescription || ''
  
      if (!result[reqName]) {
        result[reqName] = {
          req_id: reqId,
          RequirementDescription: reqDesc,
          UserStories: [],
        }
      }
  
      const story = {
        userstory_id: cellToHtml(cells[1]),
        Story: cellToHtml(cells[2]),
        AcceptanceCriteria: cellToHtmlArray(cells[3]),
        RequirementType: cellToHtml(cells[4]),
      }
  
      for (const key of HIDDEN_STORY_KEYS) {
        story[key] = hidden[key] || ''
      }
  
      result[reqName].UserStories.push(story)
    }
  
    return result
  }


  const VISIBLE_COLUMNS: ColumnConfig[] = [
  { label: "Req No.", key: "req_id" },
  { label: "User Story No.", key: "userstory_id" },
  { label: "User Story Description", key: "Story" },
  { label: "Acceptance Criteria", key: "AcceptanceCriteria" },
  { label: "Requirement Type", key: "RequirementType" },
];

const HIDDEN_STORY_KEYS: string[] = [
  'source', 'referred_document', 'referred_doc_location', 
  'section', 'justification', 'referred_in', 'source_timestamp'
];

interface UserStory {
  userstory_id: string;
  Story: string;
  AcceptanceCriteria: string[];
  RequirementType: string;
  source?: string;
  referred_document?: string;
  referred_doc_location?: string;
  section?: string;
  justification?: string;
  referred_in?: string;
  source_timestamp?: string;
  [key: string]: any; // For dynamic access via HIDDEN_STORY_KEYS
}

interface Requirement {
  req_id: string;
  RequirementDescription: string;
  UserStories: UserStory[];
}

interface ColumnConfig {
  label: string;
  key: keyof UserStory | "req_id";
}

// Slate Types
interface SlateText {
  text: string;
}

interface SlateElement {
  type: string;
  children: (SlateElement | SlateText)[];
  isHeader?: boolean;
  hiddenData?: Record<string, string>;
}

export const convertJsonToSlate = (data: any): any[] => {
  // 1. Convert the Object Map into a flat array of values
  // This turns { "Role-Based...": { req_id: ... } } into [{ req_id: ... }]
  const rawDataArray = typeof data === 'object' && !Array.isArray(data) 
    ? Object.values(data) 
    : Array.isArray(data) ? data : [];

    console.log(rawDataArray, "rawDataArray")

  const allRows: any[] = [];

  rawDataArray.forEach((req: any) => {
    // 2. Safety check: Ensure the requirement object exists
    if (!req || typeof req !== 'object') return;
    console.log(req, "req")

    // 3. Access UserStories (Case-sensitive must match your JSON)
    const stories = req.UserStories || [];

    stories.forEach((story: any) => {
      // Pack Hidden Metadata
      const hiddenData: Record<string, string> = {
        RequirementDescription: req.RequirementDescription || "",
        // Store the original Map Key if you need it back later
        RequirementName: req.RequirementName || "" 
      };

      HIDDEN_STORY_KEYS.forEach(key => {
        hiddenData[key] = story?.[key] != null ? String(story[key]) : "";
      });

      // Build Visible Cells
      const children = VISIBLE_COLUMNS.map(({ key }) => {
        const val = key === 'req_id' ? req.req_id : story?.[key];

        return {
          type: "table-cell",
          children: Array.isArray(val)
            ? val.map((text: string) => ({
                type: "paragraph",
                children: [{ text: String(text || "") }],
              }))
            : [{
                type: "paragraph",
                children: [{ text: String(val ?? "") }],
              }],
        };
      });

      allRows.push({
        type: "table-row",
        hiddenData,
        children,
      });
    });
  });

  return [{
    type: "table",
    children: [
      {
        type: "table-row",
        children: VISIBLE_COLUMNS.map((col) => ({
          type: "table-cell",
          isHeader: true,
          children: [{ type: "paragraph", children: [{ text: col.label }] }],
        })),
      },
      ...allRows,
    ],
  }];
};




