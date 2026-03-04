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

    if (isHeading(node.type)) {
      const plainText = getPlainText(node);
      const normalizedKey = displayNameToKey(plainText);
      const styledKey = getStyledHtml(node);

      headingsMap[normalizedKey] = plainText;

      i++;

      // ===============================
      // EXECUTIVE SUMMARY
      // ===============================
      if (normalizedKey === "Executive_Summary") {
        const execObj: Record<string, any> = {};

        while (i < nodeList.length && !isHeading(nodeList[i].type)) {
          const curr = nodeList[i];

          if (isHeading(curr.type)) break;

          if (curr.type === "paragraph") {
            execObj[plainText] = serializeBlockNode(curr);
          }

          i++;
        }

        result[styledKey] = execObj;
      }

      // ===============================
      // TABLE SECTIONS
      // ===============================
      else if (
        ["Stakeholders_and_Key_Personnel", "Actors_Personas", "Glossary"]
          .includes(normalizedKey)
      ) {
        let tableData: any[] = [];

        while (i < nodeList.length) {
          const curr = nodeList[i];

          if (curr.type === "table") {
            tableData = extractTableAsArray(curr);
            i++;
            break;
          }

          if (isHeading(curr.type)) break;

          i++;
        }

        result[normalizedKey] = tableData;
      }

      // ===============================
      // GOALS & OBJECTIVES
      // ===============================
      else if (normalizedKey === "Goals_and_Objectives") {
        let listData: string[] = [];

        while (i < nodeList.length) {
          const curr = nodeList[i];

          if (curr.type === "bulleted-list") {
            listData = extractBulletedListItems(curr);
            i++;
            break;
          }

          if (isHeading(curr.type)) break;

          i++;
        }

        result[normalizedKey] = listData;
      }

      // ===============================
      // PROCESS SCOPE SUMMARY
      // ===============================
      else if (normalizedKey === "Process_Scope_Summary") {
        const scopeObj: Record<string, any> = {};

        while (i < nodeList.length) {
          const curr = nodeList[i];

          if (isHeading(curr.type)) break;

          if (isHeading(curr.type)) {
            const subPlain = getPlainText(curr);
            const subKey = subPlain.replace(/ /g, "_");
            headingsMap[subKey] = subPlain;
            i++;

            const subObj: Record<string, any> = {};

            while (
              i < nodeList.length &&
              !isHeading(nodeList[i].type)
            ) {
              const item = nodeList[i];

              if (item.type === "paragraph") {
                subObj["Summary"] = serializeBlockNode(item);
              }

              if (item.type === "bulleted-list") {
                subObj[
                  subKey === "In_Scope"
                    ? "High_Level_Requirements"
                    : "Exclusions"
                ] = extractBulletedListItems(item);
              }

              i++;
            }

            scopeObj[subKey] = subObj;
          }

          i++;
        }

        result[normalizedKey] = scopeObj;
      }

      // ===============================
      // DEFAULT SECTION
      // ===============================
      else {
        let content = "";

        while (
          i < nodeList.length &&
          !isHeading(nodeList[i].type)
        ) {
          content += serializeBlockNode(nodeList[i]);
          i++;
        }

        result[normalizedKey] = content;
      }
    } else {
      i++;
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
