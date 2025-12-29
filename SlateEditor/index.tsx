import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import {
  createEditor,
  Range,
  Text,
  type Descendant,
  type NodeEntry,
} from "slate";
import { Slate, Editable, withReact, ReactEditor } from "slate-react";
import { v4 as uuid } from "uuid";

import CommentSidebar from "./CommentSidebar";
import type { Comment } from "./types/types";
import { useSlateStore } from "./hooks/useCommentsStore";
import Toolbar from "./Toolbar";
import { markdownToSlate } from "./markdownToSlate";
import FloatingCommentToolbar from "./FloatingCommentToolbar";
import styles from "./slate-editor.module.css";

const markdownFromApi = `
# User Story 1

As a project manager, I want to be notified when a project reaches a certain stage so that I can initiate requesting resources

Acceptance Criteria
- Project manager receives a notification when the project reaches the specific stage (eg.. stage 3)
- Notification contains a link to request resources for the project
- Project Manager can access the request resources page directly from the notification.

# User Story 2

As a project manager, I want to proactively request resources for a project so that I can secure resources in advance.

Acceptance Criteria
- Project manager can access the request resources page directly.
- Project details are pre-populated based on the project selected.
- Project Manager can submit a resource request.

Liberty Mutual will review mailbox setup, address security considerations, and define how EXL should gain access. This step is critical for moving the invoice automation process forward smoothly.
`;

export const SlateEditor = () => {
  const editor = useMemo(() => withReact(createEditor()), []);
  const [readOnly, setReadOnly] = useState(false);
  const { content, setContent, comments, setComments } = useSlateStore([]);

  const [selection, setSelection] = useState<Range | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(
    null
  ) as React.RefObject<HTMLDivElement>;

  useEffect(() => {
    if (content.length === 0) {
      const slateValue = markdownToSlate(markdownFromApi);
      setContent(slateValue);
    }
  }, [content, setContent]);

  const decorate = useCallback(
    ([node, path]: NodeEntry) => {
      if (!Text.isText(node)) return [];

      return comments
        .filter((c) => Range.includes(c.range, path))
        .map((c) => ({ ...c.range, commentId: c.id }));
    },
    [comments]
  );

  const addComment = (text: string) => {
    if (!selection) return;

    const comment: Comment = {
      id: uuid(),
      text,
      range: selection,
      replies: [],
    };

    setComments((prev) => [...prev, comment]);
    ReactEditor.focus(editor);
  };

  const renderLeaf = useCallback(
    ({ attributes, children, leaf }: any) => {
      if (leaf.bold) children = <strong>{children}</strong>;
      if (leaf.italic) children = <em>{children}</em>;
      if (leaf.underline) children = <u>{children}</u>;
      if (leaf.strikethrough) children = <s>{children}</s>;
      if (leaf.code) children = <code>{children}</code>;

      if (leaf.commentId) {
        return (
          <span
            {...attributes}
            onMouseEnter={() => setHoveredId(leaf.commentId)}
            onMouseLeave={() => setHoveredId(null)}
            style={{ background: "#fff3b0", position: "relative" }}
          >
            {children}
          </span>
        );
      }

      return <span {...attributes}>{children}</span>;
    },
    [comments, hoveredId]
  );

  const renderElement = useCallback(
    ({ attributes, children, element }: any) => {
      const style = { textAlign: element.align || "left" };

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
          return (
            <blockquote
              {...attributes}
              style={{ borderLeft: "3px solid #ccc", paddingLeft: 12 }}
            >
              {children}
            </blockquote>
          );

        case "code-block":
          return (
            <pre {...attributes} style={{ background: "#f5f5f5", padding: 12 }}>
              <code>{children}</code>
            </pre>
          );

        case "paragraph":
        default:
          return (
            <p {...attributes} style={style}>
              {children}
            </p>
          );
      }
    },
    []
  );

  return (
    <>
      <div className={styles.editorContainer}>
        <div className={styles.editorArea} ref={containerRef}>
          <Slate
            editor={editor}
            initialValue={content}
            onChange={() => {
              setContent(editor.children as Descendant[]);
              const sel = editor.selection;
              setSelection(sel && Range.isExpanded(sel) ? sel : null);
            }}
          >
            <Toolbar
              onClickSaveBtn={() => console.log("Saved...")}
              buttonLabel="Save"
            />

            <Editable
              decorate={decorate}
              renderLeaf={renderLeaf}
              renderElement={renderElement}
              readOnly={readOnly}
              className={styles.editableArea}
            />
            <CommentSidebar
              comments={comments}
              setComments={setComments}
              editor={editor}
            />
            {!readOnly && (
              <FloatingCommentToolbar
                editor={editor}
                containerRef={containerRef}
                onAddComment={(text) => {
                  if (!selection) return;
                  addComment(text);
                }}
              />
            )}
          </Slate>
        </div>
      </div>
    </>
  );
};

export default SlateEditor;
