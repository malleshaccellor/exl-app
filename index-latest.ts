export const slateToBrdJson = (nodes: Descendant[]): any => {
  const result: Record<string, any> = {};
  const headingsMap: Record<string, string> = {};
  const nodeList = nodes as any[];

  const getPlainText = (node: any) =>
    childrenToText(node.children).trim();

  const getStyledHtml = (node: any) =>
    serializeBlockNode(node);

  let i = 0;

  while (i < nodeList.length) {
    const node = nodeList[i];

    if (node.type === "heading-five") {
      const plain = getPlainText(node);
      const styledKey = getStyledHtml(node);
      const normalizedKey = displayNameToKey(plain);

      headingsMap[normalizedKey] = plain;

      i++;

      // -------- EXECUTIVE SUMMARY --------
      if (normalizedKey === "Executive_Summary") {
        const execObj: Record<string, any> = {};

        while (i < nodeList.length) {
          const curr = nodeList[i];

          if (curr.type === "heading-five") {
            const subPlain = getPlainText(curr);
            const subStyled = getStyledHtml(curr);
            const subKey = subPlain.replace(/ /g, "_");

            headingsMap[subKey] = subPlain;

            i++;
            let content = "";

            while (
              i < nodeList.length &&
              nodeList[i].type !== "heading-five"
            ) {
              content += serializeBlockNode(nodeList[i]);
              i++;
            }

            execObj[subStyled] = content;
          } else {
            break;
          }
        }

        result[styledKey] = execObj;
      }

      // -------- TABLE SECTIONS --------
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
          if (curr.type === "heading-five") break;
          i++;
        }

        result[normalizedKey] = tableData;
      }

      // -------- GOALS & OBJECTIVES --------
      else if (normalizedKey === "Goals_and_Objectives") {
        let listData: string[] = [];

        while (i < nodeList.length) {
          const curr = nodeList[i];

          if (curr.type === "bulleted-list") {
            listData = extractBulletedListItems(curr);
            i++;
            break;
          }

          if (curr.type === "heading-five") break;
          i++;
        }

        result[normalizedKey] = listData;
      }

      // -------- PROCESS SCOPE --------
      else if (normalizedKey === "Process_Scope_Summary") {
        const scopeObj: Record<string, any> = {};

        while (i < nodeList.length) {
          const curr = nodeList[i];

          if (curr.type === "heading-five") {
            const subPlain = getPlainText(curr);
            const subKey = subPlain.replace(/ /g, "_");

            headingsMap[subKey] = subPlain;

            i++;

            const subObj: Record<string, any> = {};

            while (
              i < nodeList.length &&
              nodeList[i].type !== "heading-five"
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
          } else {
            break;
          }
        }

        result[normalizedKey] = scopeObj;
      }

      // -------- DEFAULT SECTION --------
      else {
        let content = "";

        while (
          i < nodeList.length &&
          nodeList[i].type !== "heading-five"
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

  // attach heading map
  result["_headings"] = headingsMap;

  return {
    response: "```json\n" + JSON.stringify(result, null, 2) + "\n```",
  };
};
