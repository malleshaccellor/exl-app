import { useCallback, useMemo, useState } from "react";
import { createEditor, type Descendant } from "slate";
import { Slate, Editable, withReact } from "slate-react";
import clsx from "clsx";
import Toolbar from "./Toolbar";
import styles from "./slate-editor.module.css";

interface SlateEditorProps {
  value?: Descendant[];
  defaultValue?: Descendant[];
  onChange?: (value: Descendant[]) => void;
  readOnly?: boolean;
  onClickSaveBtn?: () => void;
  className?: string;
}

const VISIBLE_COLUMNS = [
  { key: 'req_id', label: 'Req_No' },
  { key: 'userstory_id', label: 'User Story No' },
  { key: 'Story', label: 'user_story_description' },
  { key: 'AcceptanceCriteria', label: 'AcceptanceCriteria' },
  { key: 'RequirementType', label: 'RequirementType' },
]

const HIDDEN_STORY_KEYS = [
  'source',
  'referred_document',
  'referred_doc_location',
  'section',
  'justification',
  'referred_in',
  'source_timestamp',
]

const leafToHtml = (leaf) => {
  let html = leaf.text
  if (leaf.code) html = `<code>${html}</code>`
  if (leaf.italic) html = `<em>${html}</em>`
  if (leaf.bold) html = `<strong>${html}</strong>`
  if (leaf.underline) html = `<u>${html}</u>`
  return html
}

// Map Slate element types to HTML tags
const BLOCK_TAG_MAP = {
  'heading-one': 'h1',
  'heading-two': 'h2',
  'block-quote': 'blockquote',
  'numbered-list': 'ol',
  'bulleted-list': 'ul',
  'list-item': 'li',
}

// Recursively convert any Slate node to HTML
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

const htmlToLeaves = (html) => {
  if (!html || html.trim() === '') return [{ text: '' }]

  const leaves = []
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  const walk = (node, marks) => {
    if (node.nodeType === 3) {
      const text = node.textContent
      if (text) leaves.push({ text, ...marks })
      return
    }
    if (node.nodeType === 1) {
      const newMarks = { ...marks }
      const tag = node.tagName.toLowerCase()
      if (tag === 'strong' || tag === 'b') newMarks.bold = true
      if (tag === 'em' || tag === 'i') newMarks.italic = true
      if (tag === 'u') newMarks.underline = true
      if (tag === 'code') newMarks.code = true
      for (const child of node.childNodes) {
        walk(child, newMarks)
      }
    }
  }

  for (const child of doc.body.childNodes) {
    walk(child, {})
  }

  return leaves.length > 0 ? leaves : [{ text: '' }]
}

// Map HTML tags to Slate element types
const HTML_TAG_TO_SLATE = {
  h1: 'heading-one',
  h2: 'heading-two',
  blockquote: 'block-quote',
  ol: 'numbered-list',
  ul: 'bulleted-list',
  li: 'list-item',
}

const htmlToSlateNodes = (html) => {
  if (!html || html.trim() === '') return [{ type: 'paragraph', children: [{ text: '' }] }]

  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  const parseNode = (domNode) => {
    // Text node
    if (domNode.nodeType === 3) {
      const text = domNode.textContent
      if (!text || text.trim() === '') return null
      return { type: 'paragraph', children: [{ text }] }
    }

    if (domNode.nodeType !== 1) return null

    const tag = domNode.tagName.toLowerCase()
    const slateType = HTML_TAG_TO_SLATE[tag]

    if (slateType) {
      // Block element — recurse for children
      if (tag === 'ol' || tag === 'ul') {
        // List: children should be list-items
        const items = Array.from(domNode.childNodes)
          .map(child => parseNode(child))
          .filter(Boolean)
        return { type: slateType, children: items.length > 0 ? items : [{ type: 'list-item', children: [{ text: '' }] }] }
      }
      // h1, h2, blockquote, li — inline content inside
      const leaves = []
      const walkInline = (node, marks) => {
        if (node.nodeType === 3) {
          const text = node.textContent
          if (text) leaves.push({ text, ...marks })
          return
        }
        if (node.nodeType === 1) {
          const newMarks = { ...marks }
          const t = node.tagName.toLowerCase()
          if (t === 'strong' || t === 'b') newMarks.bold = true
          if (t === 'em' || t === 'i') newMarks.italic = true
          if (t === 'u') newMarks.underline = true
          if (t === 'code') newMarks.code = true
          for (const child of node.childNodes) {
            walkInline(child, newMarks)
          }
        }
      }
      for (const child of domNode.childNodes) {
        walkInline(child, {})
      }
      return { type: slateType, children: leaves.length > 0 ? leaves : [{ text: '' }] }
    }

    // Inline tags (strong, em, etc.) or p — treat as paragraph with inline marks
    return { type: 'paragraph', children: htmlToLeaves(domNode.innerHTML || domNode.textContent || '') }
  }

  const nodes = Array.from(doc.body.childNodes)
    .map(child => parseNode(child))
    .filter(Boolean)

  return nodes.length > 0 ? nodes : [{ type: 'paragraph', children: [{ text: '' }] }]
}

const htmlToCellChildren = (html) => {
  if (!html) return [{ type: 'paragraph', children: [{ text: '' }] }]
  return htmlToSlateNodes(html)
}

const htmlArrayToCellChildren = (arr) => {
  if (!arr || arr.length === 0) return [{ type: 'paragraph', children: [{ text: '' }] }]
  return arr.flatMap(item => htmlToSlateNodes(item))
}

const jsonToSlateValue = (data) => {
  const allRows = []

  for (const [reqName, reqData] of Object.entries(data)) {
    for (const story of (reqData.UserStories || [])) {
      const hiddenData = {
        Requirement: reqName,
        RequirementDescription: reqData.RequirementDescription,
      }
      for (const key of HIDDEN_STORY_KEYS) {
        hiddenData[key] = story[key] != null ? String(story[key]) : ''
      }

      allRows.push({
        type: 'table-row',
        hiddenData,
        children: VISIBLE_COLUMNS.map(({ key }) => {
          let val
          if (key === 'req_id') val = reqData.req_id
          else val = story[key]

          if (Array.isArray(val)) {
            return {
              type: 'table-cell',
              children: htmlArrayToCellChildren(val),
            }
          }
          return {
            type: 'table-cell',
            children: htmlToCellChildren(val != null ? String(val) : ''),
          }
        }),
      })
    }
  }

  const headerRow = {
    type: 'table-row',
    children: VISIBLE_COLUMNS.map(({ label }) => ({
      type: 'table-cell',
      isHeader: true,
      children: [{ type: 'paragraph', children: [{ text: label }] }],
    })),
  }

  return [
    {
      type: 'table',
      children: [headerRow, ...allRows],
    },
  ]
}


export const SlateEditor = ({
  value,
  defaultValue = [],
  onChange,
  readOnly,
  onClickSaveBtn,
  className,
}: SlateEditorProps) => {
  const editor = useMemo(() => withReact(createEditor()), []);

  const [internalValue, setInternalValue] =
    useState<Descendant[]>(defaultValue);
  const editorValue = useMemo(() => jsonToSlateValue(value ?? internalValue), [value, internalValue]);

  const handleChange = useCallback(
    (val: Descendant[]) => {
      if (!value) {
        setInternalValue(val);
      }
      onChange?.(val);
    },
    [value, onChange],
  );

  const renderLeaf = useCallback(({ attributes, children, leaf }: any) => {
    if (leaf.bold) children = <strong>{children}</strong>;
    if (leaf.italic) children = <em>{children}</em>;
    if (leaf.underline) children = <u>{children}</u>;
    if (leaf.strikethrough) children = <s>{children}</s>;
    if (leaf.code) children = <code>{children}</code>;

    return <span {...attributes}>{children}</span>;
  }, []);

  const renderElement = useCallback(
    ({ attributes, children, element }: any) => {
      const style = {
        textAlign: element.align || "left",
        paddingLeft: `${element.indent * 24}px`,
        fontSize: `${element.fontSize}px`,
      };

      switch (element.type) {
        case "heading-one":
          return (
            <h1 {...attributes} style={style}>
              {children}
            </h1>
          );
        case "heading-two":
          return (
            <h2 {...attributes} style={style}>
              {children}
            </h2>
          );
        case "heading-three":
          return (
            <h3 {...attributes} style={style}>
              {children}
            </h3>
          );
        case "heading-four":
          return (
            <h4 {...attributes} style={style}>
              {children}
            </h4>
          );
        case "heading-five":
          return (
            <h5 {...attributes} style={style}>
              {children}
            </h5>
          );
        case "heading-six":
          return (
            <h6 {...attributes} style={style}>
              {children}
            </h6>
          );
        case "bulleted-list":
          return (
            <ul {...attributes} style={style}>
              {children}
            </ul>
          );
        case "numbered-list":
          return (
            <ol {...attributes} style={style}>
              {children}
            </ol>
          );
        case "list-item":
          return (
            <li {...attributes} style={style}>
              {children}
            </li>
          );

        case "block-quote":
          return (
            <blockquote
              {...attributes}
              style={{
                borderLeft: "3px solid #ccc",
                ...style,
              }}
            >
              {children}
            </blockquote>
          );

        case "code-block":
          return (
            <pre
              {...attributes}
              style={{
                background: "#f5f5f5",
                padding: 12,
                ...style,
              }}
            >
              <code>{children}</code>
            </pre>
          );
        case "table":
          return (
            <table className={element.className || "table"}>
              <tbody {...attributes}>{children}</tbody>
            </table>
          );
        case "table-row":
          return <tr {...attributes} style={style}>{children}</tr>;
        case "table-cell-header":
          return <th {...attributes} style={style}>{children}</th>;
        case "table-cell":
          return <td {...attributes} style={style}>{children}</td>;
        case "paragraph":
          return <p {...attributes} style={style}>{children}</p>;
        default:
          return (
            <p {...attributes} style={style}>
              {children}
            </p>
          );
      }
    },
    [],
  );

  return (
    <>
      <div className={styles.editorContainer}>
        <div className={styles.editorArea}>
          <Slate
            editor={editor}
            initialValue={editorValue}
            onChange={handleChange}
          >
            <Toolbar onClickSaveBtn={onClickSaveBtn} buttonLabel="Save" />
            <Editable
              renderLeaf={renderLeaf}
              renderElement={renderElement}
              readOnly={readOnly}
              className={clsx(styles.editableArea, className)}
            />
          </Slate>
        </div>
      </div>
    </>
  );
};

export default SlateEditor;
