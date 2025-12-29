/* ---------- LEAF (INLINE FORMATTING) ---------- */

export const renderLeaf = ({ attributes, children, leaf }) => {
  if (leaf.bold) children = <strong>{children}</strong>;
  if (leaf.italic) children = <em>{children}</em>;
  if (leaf.strikethrough) children = <s>{children}</s>;
  if (leaf.code) children = <code>{children}</code>;

  return <span {...attributes}>{children}</span>;
};

/* ---------- ELEMENT (BLOCK TYPES) ---------- */

export const renderElement = ({ attributes, children, element }) => {
  switch (element.type) {
    case "heading-1":
      return <h1 {...attributes}>{children}</h1>;
    case "heading-2":
      return <h2 {...attributes}>{children}</h2>;
    case "heading-3":
      return <h3 {...attributes}>{children}</h3>;

    case "bulleted-list":
      return <ul {...attributes}>{children}</ul>;
    case "numbered-list":
      return <ol {...attributes}>{children}</ol>;
    case "list-item":
      return <li {...attributes}>{children}</li>;

    case "block-quote":
      return <blockquote {...attributes}>{children}</blockquote>;

    case "code-block":
      return (
        <pre {...attributes}>
          <code>{children}</code>
        </pre>
      );

    case "paragraph":
    default:
      return <p {...attributes}>{children}</p>;
  }
};
