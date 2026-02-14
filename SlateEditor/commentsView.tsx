import { useMemo, useCallback, useState, useEffect } from 'react'
import { createEditor, Editor, Transforms, Element as SlateElement } from 'slate'
import { Slate, Editable, withReact, useSlate } from 'slate-react'
import { withHistory } from 'slate-history'

// --- HTML <-> Slate leaf conversion utilities ---

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

// Parse an HTML string into Slate block nodes (paragraphs, headings, lists, etc.)
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

const htmlToParagraph = (html) => {
  const nodes = htmlToSlateNodes(html)
  return nodes[0] || { type: 'paragraph', children: [{ text: '' }] }
}

const htmlToCellChildren = (html) => {
  if (!html) return [{ type: 'paragraph', children: [{ text: '' }] }]
  return htmlToSlateNodes(html)
}

const htmlArrayToCellChildren = (arr) => {
  if (!arr || arr.length === 0) return [{ type: 'paragraph', children: [{ text: '' }] }]
  return arr.flatMap(item => htmlToSlateNodes(item))
}

// --- Column configuration ---

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

// --- JSON <-> Slate conversion ---

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

const slateValueToJson = (nodes) => {
  const tableNode = nodes.find(n => n.type === 'table')
  if (!tableNode) return {}

  const rows = tableNode.children
  const dataRows = rows.slice(1)

  const result = {}

  for (const row of dataRows) {
    const cells = row.children
    const hidden = row.hiddenData || {}

    const reqId = cellToHtml(cells[0])
    const reqName = hidden.Requirement || ''
    const reqDesc = hidden.RequirementDescription || ''

    if (!result[reqName]) {
      result[reqName] = {
        req_id: reqId,
        RequirementDescription: reqDesc,
        UserStories: [],
      }
    }

    const story = {
      userstory_id: cellToHtml(cells[1]),
      Story: cellToHtml(cells[2]),
      AcceptanceCriteria: cellToHtmlArray(cells[3]),
      RequirementType: cellToHtml(cells[4]),
    }

    for (const key of HIDDEN_STORY_KEYS) {
      story[key] = hidden[key] || ''
    }

    result[reqName].UserStories.push(story)
  }

  return result
}

// --- Slate plugins ---

const withTables = (editor) => {
  const { deleteBackward, deleteForward, insertBreak } = editor

  editor.deleteBackward = (unit) => {
    const { selection } = editor
    if (selection) {
      const [cell] = Editor.nodes(editor, {
        match: n => !Editor.isEditor(n) && SlateElement.isElement(n) && n.type === 'table-cell',
      })
      if (cell) {
        const [, cellPath] = cell
        if (Editor.isStart(editor, selection.anchor, cellPath)) return
      }
    }
    deleteBackward(unit)
  }

  editor.deleteForward = (unit) => {
    const { selection } = editor
    if (selection) {
      const [cell] = Editor.nodes(editor, {
        match: n => !Editor.isEditor(n) && SlateElement.isElement(n) && n.type === 'table-cell',
      })
      if (cell) {
        const [, cellPath] = cell
        if (Editor.isEnd(editor, selection.anchor, cellPath)) return
      }
    }
    deleteForward(unit)
  }

  editor.insertBreak = () => {
    const [cell] = Editor.nodes(editor, {
      match: n => !Editor.isEditor(n) && SlateElement.isElement(n) && n.type === 'table-cell',
    })
    if (cell) {
      Transforms.insertNodes(editor, {
        type: 'paragraph',
        children: [{ text: '' }],
      })
      return
    }
    insertBreak()
  }

  return editor
}

// --- Toolbar helpers ---

const isMarkActive = (editor, format) => {
  const marks = Editor.marks(editor)
  return marks ? marks[format] === true : false
}

const toggleMark = (editor, format) => {
  if (isMarkActive(editor, format)) {
    Editor.removeMark(editor, format)
  } else {
    Editor.addMark(editor, format, true)
  }
}

const isBlockActive = (editor, format) => {
  const [match] = Editor.nodes(editor, {
    match: n => !Editor.isEditor(n) && SlateElement.isElement(n) && n.type === format,
  })
  return !!match
}

const toggleBlock = (editor, format) => {
  const LIST_TYPES = ['numbered-list', 'bulleted-list']
  const isActive = isBlockActive(editor, format)
  const isList = LIST_TYPES.includes(format)

  Transforms.unwrapNodes(editor, {
    match: n => !Editor.isEditor(n) && SlateElement.isElement(n) && LIST_TYPES.includes(n.type),
    split: true,
  })

  Transforms.setNodes(editor, {
    type: isActive ? 'paragraph' : isList ? 'list-item' : format,
  })

  if (!isActive && isList) {
    Transforms.wrapNodes(editor, { type: format, children: [] })
  }
}

// --- Toolbar components ---

const MarkButton = ({ format, label }) => {
  const editor = useSlate()
  const active = isMarkActive(editor, format)
  return (
    <button
      style={{
        padding: '4px 8px',
        marginRight: '4px',
        fontWeight: active ? 'bold' : 'normal',
        background: active ? '#ddd' : '#f5f5f5',
        border: '1px solid #ccc',
        borderRadius: '3px',
        cursor: 'pointer',
      }}
      onMouseDown={e => {
        e.preventDefault()
        toggleMark(editor, format)
      }}
    >
      {label}
    </button>
  )
}

const BlockButton = ({ format, label }) => {
  const editor = useSlate()
  const active = isBlockActive(editor, format)
  return (
    <button
      style={{
        padding: '4px 8px',
        marginRight: '4px',
        fontWeight: active ? 'bold' : 'normal',
        background: active ? '#ddd' : '#f5f5f5',
        border: '1px solid #ccc',
        borderRadius: '3px',
        cursor: 'pointer',
      }}
      onMouseDown={e => {
        e.preventDefault()
        toggleBlock(editor, format)
      }}
    >
      {label}
    </button>
  )
}

const SaveButton = ({ editor, onSave }) => (
  <button
    style={{
      padding: '6px 16px',
      marginLeft: 'auto',
      background: '#4CAF50',
      color: 'white',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontWeight: 'bold',
    }}
    onMouseDown={e => {
      e.preventDefault()
      const json = slateValueToJson(editor.children)
      console.log('Exported JSON:', JSON.stringify(json, null, 2))
      onSave(json)
    }}
  >
    Save as JSON
  </button>
)

const Toolbar = ({ onSave }) => {
  const editor = useSlate()
  
  return (
    <div style={{ borderBottom: '1px solid #ccc', paddingBottom: '8px', marginBottom: '12px', display: 'flex', alignItems: 'center' }}>
      <div>
        <MarkButton format="bold" label="B" />
        <MarkButton format="italic" label="I" />
        <MarkButton format="underline" label="U" />
        <MarkButton format="code" label="<>" />
        <span style={{ margin: '0 4px', color: '#ccc' }}>|</span>
        <BlockButton format="heading-one" label="H1" />
        <BlockButton format="heading-two" label="H2" />
        <BlockButton format="block-quote" label="&#x201C;&#x201D;" />
        <BlockButton format="numbered-list" label="1." />
        <BlockButton format="bulleted-list" label="&#x2022;" />
      </div>
      <SaveButton editor={editor} onSave={onSave} />
    </div>
  )
}

// --- Styles ---

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  marginBottom: '24px',
  fontSize: '13px',
}

const cellStyle = {
  border: '1px solid #ccc',
  padding: '6px 8px',
  verticalAlign: 'top',
  minWidth: '80px',
}

const headerCellStyle = {
  ...cellStyle,
  background: '#f0f0f0',
  fontWeight: 'bold',
  whiteSpace: 'nowrap',
}

// --- Main editor component ---

// TODO: Replace with your actual API endpoint
const API_ENDPOINT = '/api/save'

const submitJson = async (json) => {
  try {
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(json),
    })
    const result = await response.json()
    console.log('API response:', result)
    return result
  } catch (error) {
    console.error('API error:', error)
    throw error
  }
}
const SlateEditorNew = ({ data, onAction }) => {
  const editor = useMemo(() => withTables(withHistory(withReact(createEditor()))), [])
  const initialValue = useMemo(() => jsonToSlateValue(data), [data])
  const [exportedJson, setExportedJson] = useState(null)

  useEffect(() => {
    if (!exportedJson) return

    submitJson(exportedJson)
      .then(() => console.log('Saved successfully'))
      .catch((err) => console.error('Save failed:', err))
  }, [exportedJson])

  const handleSave = useCallback((json) => {
    setExportedJson(json)
    onAction(json)
  }, [])

  const renderElement = useCallback(({ attributes, children, element }) => {
    switch (element.type) {
      case 'heading-one':
        return <h1 style={{ marginTop: '24px' }} {...attributes}>{children}</h1>
      case 'heading-two':
        return <h2 style={{ marginTop: '16px' }} {...attributes}>{children}</h2>
      case 'block-quote':
        return <blockquote style={{ borderLeft: '3px solid #ccc', paddingLeft: '12px', color: '#666' }} {...attributes}>{children}</blockquote>
      case 'numbered-list':
        return <ol {...attributes}>{children}</ol>
      case 'bulleted-list':
        return <ul {...attributes}>{children}</ul>
      case 'list-item':
        return <li {...attributes}>{children}</li>
      case 'table':
        return (
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle} {...attributes}>
              <tbody>{children}</tbody>
            </table>
          </div>
        )
      case 'table-row':
        return <tr {...attributes}>{children}</tr>
      case 'table-cell':
        if (element.isHeader) {
          return <th style={headerCellStyle} {...attributes}>{children}</th>
        }
        return <td style={cellStyle} {...attributes}>{children}</td>
      case 'paragraph':
        return <p style={{ margin: '2px 0' }} {...attributes}>{children}</p>
      default:
        return <p {...attributes}>{children}</p>
    }
  }, [])

  const renderLeaf = useCallback(({ attributes, children, leaf }) => {
    if (leaf.bold) children = <strong>{children}</strong>
    if (leaf.italic) children = <em>{children}</em>
    if (leaf.underline) children = <u>{children}</u>
    if (leaf.code) children = <code style={{ background: '#f0f0f0', padding: '2px 4px', borderRadius: '3px' }}>{children}</code>
    return <span {...attributes}>{children}</span>
  }, [])

  const handleKeyDown = useCallback((event) => {
    if (!event.ctrlKey && !event.metaKey) return
    switch (event.key) {
      case 'b':
        event.preventDefault()
        toggleMark(editor, 'bold')
        break
      case 'i':
        event.preventDefault()
        toggleMark(editor, 'italic')
        break
      case 'u':
        event.preventDefault()
        toggleMark(editor, 'underline')
        break
    }
  }, [editor])

  return (
    <div style={{ border: '1px solid #ccc', padding: '16px', borderRadius: '4px' }}>
      <Slate editor={editor} initialValue={initialValue}>
        <Toolbar onSave={handleSave} />
        <Editable
          renderElement={renderElement}
          renderLeaf={renderLeaf}
          onKeyDown={handleKeyDown}
          style={{ outline: 'none' }}
        />
      </Slate>
    </div>
  )
}

export default SlateEditorNew
