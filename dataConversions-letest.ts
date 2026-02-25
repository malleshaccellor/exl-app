import { Descendant } from "slate";

export const slateToSummaryJson = (nodes: Descendant[]) => {
  if (!nodes || nodes.length === 0) {
    return { response: "<p></p>" };
  }

  // -------- Inline Leaf Renderer --------
  const leafToHtml = (leaf: any): string => {
    let text = leaf.text || "";
    if (!text) return "";

    if (leaf.bold) text = `<strong>${text}</strong>`;
    if (leaf.italic) text = `<em>${text}</em>`;
    if (leaf.underline) text = `<u>${text}</u>`;
    if (leaf.code) text = `<code>${text}</code>`;
    if (leaf.strikethrough) text = `<s>${text}</s>`;

    if (leaf.fontSize) {
      text = `<span style="font-size:${leaf.fontSize}px">${text}</span>`;
    }

    return text;
  };

  const childrenToHtml = (children: any[]): string => {
    return (children || [])
      .map((child) =>
        "text" in child
          ? leafToHtml(child)
          : serialize(child)
      )
      .join("");
  };

  // -------- Block Style Builder --------
  const getBlockStyle = (node: any): string => {
    const styles: string[] = [];

    if (node.align && node.align !== "left") {
      styles.push(`text-align:${node.align}`);
    }

    if (node.indent) {
      styles.push(`padding-left:${node.indent * 24}px`);
    }

    return styles.length ? ` style="${styles.join(";")}"` : "";
  };

  // -------- Block Serializer --------
  const serialize = (node: any): string => {
    if ("text" in node) {
      return leafToHtml(node);
    }

    const styleAttr = getBlockStyle(node);
    const children = childrenToHtml(node.children);

    switch (node.type) {
      case "paragraph":
        return `<p${styleAttr}>${children}</p>`;

      case "heading-six":
        return `<h6${styleAttr}>${children}</h6>`;

      case "bulleted-list":
        return `<ul${styleAttr}>${children}</ul>`;

      case "list-item":
        return `<li${styleAttr}>${children}</li>`;

      default:
        return `<p${styleAttr}>${children}</p>`;
    }
  };

  const html = nodes.map(serialize).join("");

  return {
    response: html,
  };
};

export const summaryToSlateValue = (html: string): Descendant[] => {
  if (!html || html.trim() === "") {
    return [{ type: "paragraph", children: [{ text: "" }] }];
  }

  // Handle double-encoded strings
  let cleanHtml = html.trim();
  if (cleanHtml.startsWith('"') && cleanHtml.endsWith('"')) {
    try {
      cleanHtml = JSON.parse(cleanHtml);
    } catch {
      // ignore if not valid JSON
    }
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(cleanHtml, "text/html");

  // -------- DESERIALIZE --------

  const deserialize = (el: any): any => {
    // Text node
    if (el.nodeType === 3) {
      return { text: el.textContent };
    }

    // Not element
    if (el.nodeType !== 1) {
      return null;
    }

    const nodeName = el.nodeName.toUpperCase();

    let children = Array.from(el.childNodes)
      .map(deserialize)
      .flat()
      .filter(Boolean);

    if (children.length === 0) {
      children = [{ text: "" }];
    }

    // -------- INLINE MARKS --------

    const applyMark = (mark: string) =>
      children.map((child: any) => ({
        ...child,
        [mark]: true,
      }));

    switch (nodeName) {
      case "STRONG":
      case "B":
        return applyMark("bold");

      case "EM":
      case "I":
        return applyMark("italic");

      case "U":
        return applyMark("underline");

      case "CODE":
        return applyMark("code");

      case "S":
        return applyMark("strikethrough");

      case "SPAN": {
        const fontSize = el.style?.fontSize;
        if (fontSize) {
          const px = parseInt(fontSize.replace("px", ""));
          return children.map((child: any) => ({
            ...child,
            fontSize: px,
          }));
        }
        return children;
      }
    }

    // -------- BLOCK STYLE EXTRACTION --------

    const block: any = {
      children,
    };

    if (el.style?.textAlign) {
      block.align = el.style.textAlign;
    }

    if (el.style?.paddingLeft) {
      const px = parseInt(el.style.paddingLeft.replace("px", ""));
      block.indent = Math.round(px / 24); // must match export
    }

    // -------- BLOCK TYPES --------

    switch (nodeName) {
      case "P":
      case "DIV":
        return { type: "paragraph", ...block };

      case "H6":
        return { type: "heading-six", ...block };

      case "UL":
        return { type: "bulleted-list", children };

      case "LI":
        return { type: "list-item", ...block };

      default:
        return children;
    }
  };

  const nodes = Array.from(doc.body.childNodes)
    .map(deserialize)
    .flat()
    .filter(Boolean);

  // Wrap loose text nodes in paragraph
  const normalized = nodes.map((node: any) => {
    if (node.text !== undefined) {
      return {
        type: "paragraph",
        children: [node],
      };
    }
    return node;
  });

  return normalized.length > 0
    ? normalized
    : [{ type: "paragraph", children: [{ text: "" }] }];
};

export const summaryToSlateValue = (text: string): Descendant[] => {
  if (!text || text.trim() === "") {
    return [{ type: "paragraph", children: [{ text: "" }] }];
  }

  // Handle previously saved HTML data (from old save code)
  let cleanText = text.trim();
  // Strip wrapping quotes if present (double-encoded responses)
  if (cleanText.startsWith('"') && cleanText.endsWith('"')) {
    try {
      cleanText = JSON.parse(cleanText);
    } catch {
      // not valid JSON, use as-is
    }
  }
  // Replace literal \n (escaped newlines) with actual newlines
  if (cleanText.includes("\\n")) {
    cleanText = cleanText.replace(/\\n/g, "\n");
  }
  // If the content is HTML, parse it using the HTML parser
  if (/^<[a-z][\s\S]*>/i.test(cleanText.trim())) {
    return htmlToSlateNodes(cleanText);
  }

  const lines = cleanText.split("\n");
  const nodes: Descendant[] = [];
  let currentListItems: Descendant[] = [];
  let currentListType: "bulleted-list" | null = null;

  const flushList = () => {
    if (currentListItems.length > 0 && currentListType) {
      nodes.push({
        type: currentListType,
        children: currentListItems as any,
      });
      currentListItems = [];
      currentListType = null;
    }
  };

  const parseInlineMarks = (text: string): CustomText[] => {
    const boldItalicRegex = /\*\*\*(.+?)\*\*\*/g;
    const boldRegex = /\*\*(.+?)\*\*/g;
    const italicRegex = /[\*_](.+?)[\*_]/g;
    const strikethroughRegex = /~~(.+?)~~/g;
    const underlineRegex = /<u>(.+?)<\/u>/gi;
    const codeRegex = /`(.+?)`/g;

    let parts: CustomText[] = [{ text }];

    const applyRegex = (regex: RegExp, prop: keyof CustomText) => {
      const newParts: CustomText[] = [];
      parts.forEach((part) => {
        if (Object.keys(part).length > 1) {
          newParts.push(part);
          return;
        }

        let lastIndex = 0;
        let match;
        const partText = part.text;
        regex.lastIndex = 0;

        while ((match = regex.exec(partText)) !== null) {
          if (match.index > lastIndex) {
            newParts.push({ text: partText.slice(lastIndex, match.index) });
          }
          newParts.push({ text: match[1], [prop]: true } as any);
          lastIndex = regex.lastIndex;
        }
        if (lastIndex < partText.length) {
          newParts.push({ text: partText.slice(lastIndex) });
        }
      });
      parts = newParts;
    };

    applyRegex(boldItalicRegex, "bold"); // Will need manual fix for nested marks
    applyRegex(boldRegex, "bold");
    applyRegex(italicRegex, "italic");
    applyRegex(strikethroughRegex, "strikethrough");
    applyRegex(underlineRegex, "underline");
    applyRegex(codeRegex, "code");

    return parts.length > 0 ? parts : [{ text: "" }];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "") {
      flushList();
      continue;
    }

    // Numbered heading: "1. **Heading Text**"
    const numberedHeadingMatch = trimmed.match(/^\d+\.\s+\*\*(.+?)\*\*\s*$/);
    if (numberedHeadingMatch) {
      flushList();
      nodes.push({
        type: "heading-six",
        children: [{ text: numberedHeadingMatch[1] }],
      });
      continue;
    }

    // Sub-heading: short title-case phrase ending with colon (max 6 words)
    // Avoids matching full sentences like "Here's a structured summary...:"
    const subHeadingMatch = trimmed.match(/^([A-Z][^-*].+):$/);
    if (
      subHeadingMatch &&
      !trimmed.startsWith("-") &&
      !trimmed.startsWith("*") &&
      subHeadingMatch[1].split(/\s+/).length <= 6
    ) {
      flushList();
      nodes.push({
        type: "paragraph",
        children: [{ text: subHeadingMatch[1], bold: true }],
      });
      continue;
    }

    // Bullet item — use raw line to detect indentation level
    const bulletMatch = line.match(/^(\s*)([-*])\s+(.+)$/);
    if (bulletMatch) {
      const leadingSpaces = bulletMatch[1].length;
      const indent = leadingSpaces >= 4 ? 1 : 0;

      if (currentListType !== "bulleted-list") {
        flushList();
        currentListType = "bulleted-list";
      }
      currentListItems.push({
        type: "list-item",
        indent,
        children: parseInlineMarks(bulletMatch[3]),
      } as any);
      continue;
    }

    flushList();
    nodes.push({
      type: "paragraph",
      children: parseInlineMarks(trimmed),
    });
  }

  flushList();

  return nodes.length > 0
    ? nodes
    : [{ type: "paragraph", children: [{ text: "" }] }];
};

// ---- Helpers: Slate → Markdown ----

const leafToMarkdown = (node: any): string => {
  if (!node || !("text" in node)) return "";
  
  let text = node.text as string;
  if (!text) return "";

  if (node.fontSize) {
    text = `<span style="font-size:${node.fontSize}px">${text}</span>`;
  }

  if (node.code) text = `\`${text}\``;
  if (node.bold) text = `**${text}**`;
  if (node.italic) text = `*${text}*`;
  if (node.strikethrough) text = `~~${text}~~`;
  if (node.underline) text = `<u>${text}</u>`;

  return text;
};

const childrenToMarkdown = (children: any[]): string => {
  return (children || [])
    .map((child: any) => {
      if ("text" in child) {
        return leafToMarkdown(child);
      }
      // If there's a nested element (rare in summary, but safe)
      if (child.children) {
        return childrenToMarkdown(child.children);
      }
      return "";
    })
    .join("");
};

export const slateToSummaryJson = (nodes: Descendant[]): any => {
  const lines: string[] = [];
  let headingCounter = 0;
  let prevType: string | null = null;

  // Helper to build the style attribute string
  const getBlockStyle = (node: any) => {
    const styles: string[] = [];
    if (node.align && node.align !== "left") styles.push(`text-align:${node.align}`);
    if (node.indent) styles.push(`padding-left:${node.indent * 24}px`);
    if (node.fontSize) styles.push(`font-size:${node.fontSize}px`);
    return styles.length > 0 ? ` style="${styles.join(";")}"` : "";
  };

  for (const node of nodes as any[]) {
    const nodeType = node.type;
    const styleAttr = getBlockStyle(node);

    if (prevType && lines.length > 0) {
      const isHeadingToList = prevType === "heading-six" && 
        (nodeType === "bulleted-list" || nodeType === "numbered-list");
      if (!isHeadingToList) lines.push("");
    }

    switch (nodeType) {
      case "heading-six": {
        headingCounter++;
        const text = childrenToMarkdown(node.children);
        const content = `${headingCounter}. **${text}**`;
        // Wrap heading in div if it has custom alignment/indent
        lines.push(styleAttr ? `<div${styleAttr}>${content}</div>` : content);
        break;
      }
      case "paragraph": {
  const children = node.children || [];
  
  // 1. Get the formatted text from the children (leaves)
  const text = childrenToMarkdown(children);

  // 2. Build the parent-level style (Align/Indent)
  const styleProps: string[] = [];
  if (node.align && node.align !== "left") styleProps.push(`text-align:${node.align}`);
  if (node.indent) styleProps.push(`padding-left:${node.indent * 24}px`);
  
  const styleAttr = styleProps.length > 0 ? ` style="${styleProps.join(";")}"` : "";

  // 3. Wrap in <p> if parent styles exist, otherwise raw markdown
  if (styleAttr) {
    lines.push(`<p${styleAttr}>${text}</p>`);
  } else {
    lines.push(text);
  }
  break;
}
      case "bulleted-list": {
        // Build style for the whole list if applicable
        const listStyle = styleAttr ? `<div${styleAttr}>` : "";
        if (listStyle) lines.push(listStyle);

        for (const item of node.children || []) {
          const itemText = childrenToMarkdown(item.children);
          const indent = (item as any).indent || 0;
          // Note: Markdown lists use spaces for visual indent
          const prefix = indent >= 1 ? "     *" : "   -";
          lines.push(`${prefix} ${itemText}`);
        }

        if (listStyle) lines.push("</div>");
        break;
      }
      default: {
        const text = childrenToMarkdown(node.children);
        if (text) {
          lines.push(styleAttr ? `<div${styleAttr}>${text}</div>` : text);
        }
        break;
      }
    }
    prevType = nodeType;
  }

  return { response: lines.join("\n") };
};


const leafToInlineHtml = (node: any): string => {
  if (!node || !("text" in node)) return "";
  let html = node.text as string;
  if (!html) return "";
  if (node.code) html = `<code>${html}</code>`;
  if (node.italic) html = `<em>${html}</em>`;
  if (node.bold) html = `<strong>${html}</strong>`;
  if (node.underline) html = `<u>${html}</u>`;
  if (node.strikethrough) html = `<s>${html}</s>`;
  return html;
};

const childrenToInlineHtml = (children: any[]): string => {
  return (children || [])
    .map((c: any) => {
      if ("text" in c) return leafToInlineHtml(c);
      return childrenToInlineHtml(c.children);
    })
    .join("");
};

export const htmlToSlateNodes = (html: string): Descendant[] => {
  if (!html || html.trim() === "")
    return [{ type: "paragraph", children: [{ text: "" }] }];

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const fragment = deserialize(doc.body);

  // Wrap loose leaves in paragraphs for Slate compatibility
  return fragment.reduce((acc: any[], node) => {
    if (node.text !== undefined) {
      const last = acc[acc.length - 1];
      if (last && last.type === "paragraph") {
        last.children.push(node);
      } else {
        acc.push({ type: "paragraph", children: [node] });
      }
    } else {
      acc.push(node);
    }
    return acc;
  }, []);
};
