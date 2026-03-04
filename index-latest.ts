export const slateToBrdJson = (nodes: Descendant[]): any => {
  const result: Record<string, any> = {};
  const headingsMap: Record<string, string> = {};
  const nodeList = nodes as any[];

  const isHeading = (type: string) =>
    typeof type === "string" && type.startsWith("heading");

  const getPlainText = (node: any) =>
    childrenToText(node.children).trim();

  const getStyledHtml = (node: any) =>
    serializeBlockNode(node);

  let i = 0;

  while (i < nodeList.length) {
    const node = nodeList[i];

    if (!isHeading(node.type)) {
      i++;
      continue;
    }

    // 🔹 Extract heading
    const headingPlain = getPlainText(node);
    const normalizedKey = displayNameToKey(headingPlain);

    // Store heading mapping (for _headings)
    headingsMap[normalizedKey] = headingPlain;

    i++;

    // ================================
    // EXECUTIVE SUMMARY
    // ================================
    if (normalizedKey === "Executive_Summary") {
      const sectionObj: Record<string, any> = {};

      while (i < nodeList.length && !isHeading(nodeList[i].type)) {
        const curr = nodeList[i];

        if (isHeading(curr.type)) break;

        if (isHeading(curr.type)) {
          const subPlain = getPlainText(curr);
          const subKey = displayNameToKey(subPlain);
          headingsMap[subKey] = subPlain;
          i++;

          if (nodeList[i]?.type === "paragraph") {
            sectionObj[subKey] = serializeBlockNode(nodeList[i]);
            i++;
          }
        } else if (curr.type === "paragraph") {
          sectionObj["Introduction"] = serializeBlockNode(curr);
          i++;
        } else {
          i++;
        }
      }

      result[normalizedKey] = sectionObj;
    }

    // ================================
    // TABLE BASED SECTIONS
    // ================================
    else if (
      ["Stakeholders_and_Key_Personnel", "Actors_Personas", "Glossary"]
        .includes(normalizedKey)
    ) {
      let tableData: any[] = [];

      while (i < nodeList.length) {
        const curr = nodeList[i];

        if (curr.type === "table") {
          tableData = extractTableAsArray(curr, true); // styled cells
          i++;
          break;
        }

        if (isHeading(curr.type)) break;

        i++;
      }

      result[normalizedKey] = tableData;
    }

    // ================================
    // GOALS (BULLET LIST)
    // ================================
    else if (normalizedKey === "Goals_and_Objectives") {
      let list: string[] = [];

      while (i < nodeList.length) {
        const curr = nodeList[i];

        if (curr.type === "bulleted-list") {
          list = extractBulletedListItems(curr, true); // styled li
          i++;
          break;
        }

        if (isHeading(curr.type)) break;

        i++;
      }

      result[normalizedKey] = list;
    }

    // ================================
    // PROCESS SCOPE
    // ================================
    else if (normalizedKey === "Process_Scope_Summary") {
      const scopeObj: Record<string, any> = {};

      while (i < nodeList.length) {
        const curr = nodeList[i];

        if (isHeading(curr.type)) {
          const subPlain = getPlainText(curr);
          const subKey = displayNameToKey(subPlain);
          headingsMap[subKey] = subPlain;
          i++;

          const subObj: Record<string, any> = {};

          while (i < nodeList.length && !isHeading(nodeList[i].type)) {
            const item = nodeList[i];

            if (item.type === "paragraph") {
              subObj["Summary"] = serializeBlockNode(item);
            }

            if (item.type === "bulleted-list") {
              subObj[
                subKey === "In_Scope"
                  ? "High_Level_Requirements"
                  : "Exclusions"
              ] = extractBulletedListItems(item, true);
            }

            i++;
          }

          scopeObj[subKey] = subObj;
        } else {
          break;
        }
      }

      result[normalizedKey] = scopeObj;
    }

    // ================================
    // DEFAULT SECTION
    // ================================
    else {
      let content = "";

      while (i < nodeList.length && !isHeading(nodeList[i].type)) {
        content += serializeBlockNode(nodeList[i]);
        i++;
      }

      result[normalizedKey] = content;
    }
  }

  result["_headings"] = headingsMap;

  return {
    response:
      "```json\n" +
      JSON.stringify(result, null, 2) +
      "\n```",
  };
};
