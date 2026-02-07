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
      });
    });
  });

  return rows;
};

  const userStoryRows = parseUserStoriesToRows(userStoryMarkDown);

  const userStoryCols = [
    { key: "Req_No", label: "Req No." },
    { key: "User_Story_No", label: "User Story No." },
    { key: "User_Story_Description", label: "User Story Description" },
    { key: "Acceptance_Criteria", label: "Acceptance Criteria" },
    { key: "Requirement_Type", label: "Requirement Type" },
  ];
