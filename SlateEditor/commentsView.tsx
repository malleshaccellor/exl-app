const userStoryTable = () => {
    const headerRow = [
      "Req No.",
      "User Story No.",
      "User Story Description",
      "Acceptance Criteria",
      "Requirement Type",
    ];
    // These must match the exact keys in your 'rows' objects
    const dataKeys = [
      "Req_No",
      "User_Story_No",
      "User_Story_Description",
      "Acceptance_Criteria",
      "Requirement_Type",
    ];
    
    return [
      {
        type: "table",
        children: [
          {
            type: "table-row",
            children: headerRow.map((col) => ({
              type: "table-cell",
              children: [{ text: col }],
            })),
          },
          ...(userStoryRows?.map((rowData) => ({
            type: "table-row",
            children:
              dataKeys.map((key) => ({
                type: "table-cell",
                children: [
                  {
                    type: "paragraph",
                    children: [{ text: rowData[key] || "" }],
                  },
                ],
              })) || [],
          })) || []),
        ],
      },
    ];
  };

export const parseUserStoriesToRows = (raw: any) => {
  if (!raw) return [];

  const parse2 = (x: any) => {
    if (typeof x !== "string") return x;
    try {
      const a = JSON.parse(x);
      return typeof a === "string" ? JSON.parse(a) : a;
    } catch {
      return null;
    }
  };
  const obj = parse2(raw);

  if (!obj) return [];

  const rows: any[] = [];
  Object.entries(obj).forEach(([reqName, reqObj]: any) => {
    const reqId = reqObj?.req_id ?? "";
    const stories = reqObj?.UserStories ?? [];
    if (!Array.isArray(stories)) return;

    stories.forEach((us: any) => {
      const citationObject = Object.fromEntries(
        Object.entries({
          Source: us?.source,
          Document: us?.referred_document,
          Location: us?.referred_doc_location,
          Section: us?.section,
          Justification: us?.justification,
          "Referred In": us?.referred_in,
          "Source TimeStamp": us?.source_timestamp,
        }).filter(([_, value]) => Boolean(value)) // Removes keys with null/undefined/empty values
      );

      rows.push({
        Req_No: reqId,
        Requirement_Name: reqName,
        User_Story_No: us?.userstory_id ?? us?.user_story_id ?? "",
        User_Story_Description: us?.Story ?? us?.UserStoryRow ?? "",
        Acceptance_Criteria: Array.isArray(us?.AcceptanceCriteria)
          ? us.AcceptanceCriteria.map(
              (x: any, i: number) => `${i + 1}. ${x}`,
            ).join("\n")
          : (us.AcceptanceCriteria ?? ""),
        Requirement_Type: us?.RequirementType ?? "",
        citations: citationObject
      });
    });
  });

  return rows;
};

const userStoryRows = parseUserStoriesToRows(userStoryMarkDown);

const [userStoryEditorData, setUserStoryEditorData] =
    useState<Descendant[]>(null);

  useEffect(() => {
    const table = userStoryTable();
    setUserStoryEditorData(table);
  }, [userStoryData]);

<SlateEditor
                              value={userStoryEditorData}
                              onChange={setUserStoryEditorData}
                              onClickSaveBtn={() => {
                                setIsUserStoryContentEdit(false);
                              }}
                            />
