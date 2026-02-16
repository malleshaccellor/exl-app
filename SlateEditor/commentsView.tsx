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
