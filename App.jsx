export async function handleDownloadAsPdfUserStories(
  userStoryRows: any[],
  fileName: string
) {
  console.log("user stories-pdf clicked");
  const doc = new jsPDF("p", "mm", "a4");
  const state: any = {
    doc,
    margin: 20,
    pageWidth: doc.internal.pageSize.getWidth(),
    currentY: 20,
  };
  addHeading(state, "User Stories", 10);
  const userStoryCols = ["Req_No", "User_Story_No", "User_Story_Description", "Acceptance_Criteria", "Requirement_Type"];
  autoTable(state.doc, {
    startY: state.currentY,
    head: [["Req No.", "User Story No.", "Description", "Acceptance Criteria", "Type"]],
    body: userStoryRows.map((row: any) => userStoryCols.map((col) => row[col])),
    theme: "grid",
    styles: {
      fontSize: 7,
      cellPadding: 2,
      overflow: 'linebreak',
      font: "helvetica",
      valign: 'top'
    },
    columnStyles: {
      0: { cellWidth: 15 },
      1: { cellWidth: 20 },
      2: { cellWidth: 50 },
      3: { cellWidth: 'auto' },
      4: { cellWidth: 20 },
    },
    headStyles: { fillColor: [234, 235, 236], textColor: [0, 0, 0], fontStyle: 'bold' },
    didParseCell: (dataCell) => {
      if (dataCell.section === 'body') {
        const raw = String(dataCell.cell.raw || "");
        if (raw.includes('<')) {
          const parser = new DOMParser();
          const htmlDoc = parser.parseFromString(
            raw.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n"),
            "text/html"
          );
          const parsedLines: any[] = [];
          function walk(node: Node, styles: any) {
            if (node.nodeType === Node.TEXT_NODE) {
              (node.textContent || "").split(/\r?\n/).forEach((line) => {
                parsedLines.push({ text: line, ...styles });
              });
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node as Element;
              const tag = el.tagName.toLowerCase();
              const inlineStyle = el.getAttribute("style") || "";
              const newStyles = { ...styles };
              if (tag === "strong" || tag === "b" || inlineStyle.includes("font-weight: bold")) newStyles.bold = true;
              if (tag === "em" || tag === "i" || inlineStyle.includes("font-style: italic")) newStyles.italic = true;
              if (tag === "u" || inlineStyle.includes("text-decoration: underline")) newStyles.underline = true;
              if (tag === "s" || tag === "strike" || inlineStyle.includes("line-through")) newStyles.strike = true;
              if (inlineStyle.includes("text-align: center")) newStyles.align = "center";
              else if (inlineStyle.includes("text-align: right")) newStyles.align = "right";
              const sizeMatch = inlineStyle.match(/font-size:\s*(\d+)px/i);
              if (sizeMatch) newStyles.fontSize = Math.max(6, Math.min(parseInt(sizeMatch[1]) * 0.75, 24));
              el.childNodes.forEach((child) => walk(child, newStyles));
            }
          }
          walk(htmlDoc.body, { bold: false, italic: false, underline: false, strike: false });
          (dataCell.cell as any)._parsedLines = parsedLines;
          dataCell.cell.text = parsedLines.map((l) => l.text);
        }
      }
    },
    didDrawCell: (dataCell) => {
      if (dataCell.section === 'body') {
        const parsedLines: any[] = (dataCell.cell as any)._parsedLines;
        if (!parsedLines) return;
        const { cell, doc } = dataCell;
        const baseFontSize = cell.styles.fontSize || 7;
        const lineHeight = (doc as any).getLineHeight() / doc.internal.scaleFactor;
        parsedLines.forEach((line, index) => {
          const fSize = line.fontSize || baseFontSize;
          doc.setFontSize(fSize);
          if (line.bold && line.italic) doc.setFont("helvetica", "bolditalic");
          else if (line.bold) doc.setFont("helvetica", "bold");
          else if (line.italic) doc.setFont("helvetica", "italic");
          else doc.setFont("helvetica", "normal");
          const textWidth = doc.getTextWidth(line.text);
          let startX = cell.x + cell.padding('left');
          const align = line.align || cell.styles.halign || 'left';
          if (align === 'center') startX = cell.x + (cell.width - textWidth) / 2;
          else if (align === 'right') startX = cell.x + cell.width - textWidth - cell.padding('right');
          const baselineY = cell.y + cell.padding('top') + (index * lineHeight) + (fSize * 0.25);
          doc.text(line.text, startX, baselineY);
          if (line.underline || line.strike) {
            doc.setLineWidth(0.2);
            doc.setDrawColor(0, 0, 0);
            if (line.underline) doc.line(startX, baselineY + 0.6, startX + textWidth, baselineY + 0.6);
            if (line.strike) doc.line(startX, baselineY - (fSize * 0.1), startX + textWidth, baselineY - (fSize * 0.1));
          }
        });
        doc.setFont("helvetica", "normal");
        doc.setFontSize(baseFontSize);
      }
    },
    didDrawPage: (data) => {
      state.currentY = (data?.cursor?.y ?? 0) + 10;
    },
  });
  const finalName = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  state.doc.save(finalName);
}
 
