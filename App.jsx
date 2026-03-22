import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// import { createEditor, Editor, type Descendant ,Text} from "slate";
import {
  createEditor,
  type Descendant,
  Editor,
  Range,
  Transforms,
  Text,
} from "slate";
import { Slate, Editable, withReact, ReactEditor } from "slate-react";
import { withHistory } from "slate-history";
import clsx from "clsx";
import Toolbar from "./Toolbar";
import { withTables } from "./plugins/withTables";
import { jsonToSlateValue } from "./utils/jsonConversion";
import type { textStyle } from "./types";
import styles from "./slate-editor.module.css";
import CommentSidebar from "../CommentSidebar";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import type {
  repliesType,
  storedCommentsType,
} from "../OutputGeneration/ActionLogTable";
import {
  addComments,
  fetchComments,
} from "../../store/reducer/comments/action";
import FloatingCommentToolbar from "../FloatingCommentToolbar";
import { v4 as uuid } from "uuid";

interface SlateEditorProps {
  value?: Descendant[];
  defaultValue?: Descendant[];
  onChange?: (value: Descendant[]) => void;
  readOnly?: boolean;
  onClickSaveBtn?: (nodes: Descendant[]) => void;
  className?: string;
  data?: Record<string, any>;
  onDiscard?: () => void;
  hideFontActions?: boolean;
  hideAlignmentActions?: boolean;
  hideIndentActions?: boolean;
  isShowComments?: boolean;
  onCommentsWindowClose?: () => void;
  artifactJobID?: string;
  mode?: boolean;
}
interface Comment {
  id: string;
  author: string;
  text: string;
  createdAt: string;
  resolved: boolean;
  replies: any[];
  range: any; // Slate Range
  selectedText: string;
}

const toggleMark = (editor: Editor, format: textStyle) => {
  const isActive = Editor.marks(editor)?.[format] === true;
  if (isActive) {
    Editor.removeMark(editor, format);
  } else {
    Editor.addMark(editor, format, true);
  }
};
const SlateContentEditor = ({
  value,
  defaultValue = [],
  onChange,
  readOnly,
  onClickSaveBtn,
  className,
  data,
  onDiscard,
  hideFontActions,
  hideIndentActions,
  hideAlignmentActions,
  isShowComments = false,
  onCommentsWindowClose,
  artifactJobID,
  mode = false,
}: SlateEditorProps) => {
  const dispatch = useAppDispatch();
  const editor = useMemo(
    () => withTables(withHistory(withReact(createEditor()))),
    [],
  );
  // const [storedComments, setStoredComments] = useState<storedCommentsType[]>(
  //   [],
  // );
  // 1. Initial Value for Slate

  // 2. Initial Value for Comments Sidebar
  const [storedComments, setStoredComments] = useState<any[]>(() => {
    const saved = localStorage.getItem("editor-comments");
    return saved ? JSON.parse(saved) : [];
  });
  useEffect(() => {
    const saved = localStorage.getItem("editor-comments");
    // console.log(saved)
    if (saved) {
      setStoredComments(JSON.parse(saved));
    }
  }, [isShowComments]);

  const [activeCommentId, setActiveCommentId] = useState<string | undefined>();
  const [selection, setSelection] = useState<{
    text: string;
    position: { top: number; left: number };
  } | null>(null);
  const activeSpanRef = useRef<Range | null>(null);

  const getCommentsData = useAppSelector((state) => state.comments.comments);
  const addCommentMark = (editor: Editor, range: Range, commentId: string) => {
    // 1. Force the selection to the comment range
    Transforms.select(editor, range);

    // 2. Apply the mark and split the nodes at the range boundaries
    // This ensures a new 'leaf' is created specifically for this comment
    Transforms.setNodes(
      editor,
      { commentId },
      {
        at: range,
        match: (n) => Text.isText(n),
        split: true, // CRITICAL: This forces Slate to create a separate leaf for the highlight
      },
    );

    // 3. Deselect to remove the browser's native blue highlight
    Transforms.deselect(editor);
  };

  const removeCommentMark = (editor: Editor, commentId: string): void => {
    const nodes = Array.from(
      Editor.nodes(editor, {
        at: [],
        match: (n) => Text.isText(n) && (n as any).commentId === commentId,
      }),
    );

    for (const [, path] of nodes) {
      Transforms.unsetNodes(editor, "commentId", { at: path });
    }
  };

  useEffect(() => {
    if (artifactJobID) {
      dispatch(fetchComments(artifactJobID));
    }
  }, []);

  // useEffect(() => {
  //   if (getCommentsData?.jobId !== artifactJobID) {
  //     setStoredComments([]);
  //     return;
  //   }
  //   const existingComments = getCommentsData?.data.map((com) => ({
  //     id: com.id,
  //     position: {
  //       left: com.position.left,
  //       top: com.position.top,
  //     },
  //     rowIndex: com.rowIndex,
  //     colField: com.colField,
  //     text: com.text,
  //     comment: com.comment,
  //     time: com.createdAt,
  //     userId: com.useId,
  //     isResolved: com.isResolved,
  //     replies: com.replies.map((reply: repliesType) => ({
  //       id: reply?.id,
  //       text: reply?.text,
  //       createdAt: reply?.createdAt,
  //       useId: reply?.useId,
  //     })),
  //   }));
  //   setStoredComments(existingComments);
  // }, [getCommentsData, artifactJobID]);
  const deletedCommentsData = useAppSelector(
    (state) => state.comments.deleteComment,
  );

  const updatedCommentData = useAppSelector(
    (state) => state.comments.updateComment,
  );
  const uploadCommentData = useAppSelector(
    (state) => state.comments.addComment,
  );
  useEffect(() => {
    if (artifactJobID) {
      dispatch(fetchComments(artifactJobID));
    }
  }, [uploadCommentData?.data]);
  useEffect(() => {
    if (deletedCommentsData?.message === "OK" && artifactJobID) {
      dispatch(fetchComments(artifactJobID));
    }
    if (updatedCommentData?.message === "OK" && artifactJobID) {
      dispatch(fetchComments(artifactJobID));
    }
  }, [deletedCommentsData, updatedCommentData]);

  // Keep callbacks in refs to avoid stale closures
  const onSaveRef = useRef(onClickSaveBtn);
  onSaveRef.current = onClickSaveBtn;
  const onDiscardRef = useRef(onDiscard);
  onDiscardRef.current = onDiscard;

  const computedDefault = useMemo(() => {
    if (data) return jsonToSlateValue(data);
    return defaultValue;
  }, [data, defaultValue]);

  const [internalValue, setInternalValue] =
    useState<Descendant[]>(computedDefault);
  const editorValue = useMemo(
    () => value ?? internalValue,
    [value, internalValue],
  );

  // const handleChange = useCallback(
  //   (val: Descendant[]) => {
  //     if (!value) {
  //       setInternalValue(val);
  //     }
  //     onChange?.(val);
  //   },
  //   [value, onChange],
  // );
  const handleChange = useCallback(
    (val: Descendant[]) => {
      if (!value) {
        setInternalValue(val);
      }

      onChange?.(val);
    },
    [value, onChange],
  );

  const handleSave = useCallback(() => {
    onSaveRef.current?.(editor.children);
  }, [editor]);

  const handleDiscard = useCallback(() => {
    onDiscardRef.current?.();
  }, []);

  const renderLeaf = useCallback(
    ({ attributes, children, leaf }: any) => {
      // 1. TYPING/SELECTING highlight (isTempHighlight)
      // Changed from #0369a1 to Light Blue to match your request
      if (leaf.isTempHighlight) {
        children = (
          <span
            {...attributes}
            style={{ backgroundColor: "#e0f2fe", textDecoration: "none" }}
          >
            {children}
          </span>
        );
      }

      // 2. SAVED COMMENTS
      if (leaf.commentId) {
        const isActive = leaf.isActive;

        children = (
          <mark
            {...attributes}
            className={clsx(
              styles.commentHighlight,
              isActive && styles.activeHighlight,
            )}
            style={{
              // Light Blue if active, Light Grey (#eeeeee) if inactive
              backgroundColor: isActive ? "#e0f2fe" : "#eeeeee",
              textDecoration: "none", // No underline
              cursor: "pointer",
              color: "inherit",
            }}
          >
            {children}
          </mark>
        );
      }

      // Standard marks
      if (leaf.bold) children = <strong>{children}</strong>;
      if (leaf.italic) children = <em>{children}</em>;
      if (leaf.underline) children = <u>{children}</u>;
      if (leaf.strikethrough) children = <s>{children}</s>;
      if (leaf.code) children = <code>{children}</code>;

      return <span {...attributes}>{children}</span>;
    },
    [activeCommentId],
  ); // Add dependency to ensure re-render on click

  const renderElement = useCallback(
    ({ attributes, children, element }: any) => {
      const style = {
        textAlign: element.align || "left",
        paddingLeft: element.indent ? `${element.indent * 24}px` : undefined,
        fontSize: element.fontSize ? `${element.fontSize}px` : undefined,
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
            <h5
              {...attributes}
              style={style}
              className={element.className || "heading-five"}
            >
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
                color: "#666",
                ...style,
                paddingLeft: style.paddingLeft || "12px",
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
          return (
            <tr {...attributes} style={style}>
              {children}
            </tr>
          );
        case "table-cell-header":
          return (
            <th {...attributes} style={style}>
              {children}
            </th>
          );
        case "table-cell":
          if (element.isHeader) {
            return (
              <th {...attributes} style={style}>
                {children}
              </th>
            );
          }
          return (
            <td {...attributes} style={style}>
              {children}
            </td>
          );
        case "paragraph":
          return (
            <p
              {...attributes}
              style={{ ...style }}
              className={element.className || "paragraph"}
            >
              {children}
            </p>
          );
        default:
          return (
            <p
              {...attributes}
              style={style}
              className={element.className || "paragraph"}
            >
              {children}
            </p>
          );
      }
    },
    [],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      switch (event.key) {
        case "b":
          event.preventDefault();
          toggleMark(editor, "bold");
          break;
        case "i":
          event.preventDefault();
          toggleMark(editor, "italic");
          break;
        case "u":
          event.preventDefault();
          toggleMark(editor, "underline");
          break;
      }
    },
    [editor],
  );

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isShowComments) return;

    // Get the Slate selection instead of DOM selection
    const { selection: slateSelection } = editor;

    if (!slateSelection || Range.isCollapsed(slateSelection)) return;

    const selectedText = Editor.string(editor, slateSelection);
    if (!selectedText.trim()) return;

    const domSelection = window.getSelection();
    const domRange = domSelection?.getRangeAt(0);
    const rect = domRange?.getBoundingClientRect();

    setSelection({
      text: selectedText,
      position: {
        left: (rect?.right ?? 0) + window.scrollX + 8,
        top: (rect?.top ?? 0) + window.scrollY,
      },
    });

    // Store the SLATE selection, not the DOM range
    activeSpanRef.current = slateSelection;
  };

  const sendComment = useCallback(
    (text: string) => {
      const range = activeSpanRef.current;
      if (!range || !selection) return;

      const commentId = uuid();

      const newComment = {
        id: commentId,
        // userId: usersDetails?.id,
        comment: text,
        time: new Date().toISOString(),
        range, // We bind using this range
        selectedText: selection.text,
      };

      setStoredComments((prev) => {
        const updated = [...prev, newComment];
        // ONLY save the comments array to LocalStorage
        localStorage.setItem(`editor-comments`, JSON.stringify(updated));
        return updated;
      });

      // Clean up UI
      setSelection(null);
      activeSpanRef.current = null;
      Transforms.deselect(editor);
    },
    [selection, artifactJobID],
  );

  const decorate = useCallback(
    ([node, path]: any) => {
      const ranges: any[] = [];
      if (!Text.isText(node)) return ranges;

      // 1. ALWAYS show temp highlight (Light Blue) while selecting text
      if (activeSpanRef.current) {
        const intersection = Range.intersection(activeSpanRef.current, {
          anchor: { path, offset: 0 },
          focus: { path, offset: node.text.length },
        });
        if (intersection)
          ranges.push({ ...intersection, isTempHighlight: true });
      }

      // 2. CONDITIONALLY show existing comments (Grey/Blue)
      // Only execute this loop if showComments is true
      if (isShowComments) {
        storedComments.forEach((comment: any) => {
          if (comment.range) {
            const intersection = Range.intersection(comment.range, {
              anchor: { path, offset: 0 },
              focus: { path, offset: node.text.length },
            });

            if (intersection) {
              ranges.push({
                ...intersection,
                commentId: comment.id,
                isActive: comment.id === activeCommentId,
              });
            }
          }
        });
      }

      return ranges;
    },
    [storedComments, activeCommentId, selection, isShowComments],
  ); // Add showComments to dependencies

  useEffect(() => {
    if (!selection) return;

    const handleMouseDown = (e: MouseEvent) => {
      const toolbar = document.getElementById("floating-toolbar");
      if (!toolbar) return;
      if (!toolbar.contains(e.target as Node)) {
        setSelection(null);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [selection]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelection(null);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const activeCommentFunction = (commentId: string | undefined) => {
    // 1. Update the state (this triggers the "glow" in the editor via decorate)
    setActiveCommentId(commentId);

    if (!commentId) return;

    // 2. Find the comment to get its range
    const target = storedComments.find((c: any) => c.id === commentId);

    if (target?.range) {
      try {
        // 3. Focus and select the text in Slate
        ReactEditor.focus(editor);
        Transforms.select(editor, target.range);

        // 4. Scroll the Slate editor to the text
        const domRange = ReactEditor.toDOMRange(editor, target.range);
        domRange.startContainer.parentElement?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      } catch (e) {
        console.warn("Could not scroll to comment range", e);
      }
    }

    // 5. Scroll the sidebar (existing logic)
    requestAnimationFrame(() => {
      const el = document.getElementById(`comment-${commentId}`);
      if (el) {
        el.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    });
  };

  return (
    <>
      <div
        className={clsx(
          styles.editorContainer,
          isShowComments && styles.editorWithComments,
        )}
      >
        <div className={styles.editorArea}>
          <Slate
            editor={editor}
            initialValue={editorValue}
            onChange={handleChange}
          >
            {!mode && (
              <Toolbar
                onClickSaveBtn={onClickSaveBtn ? handleSave : undefined}
                buttonLabel="Save"
                onDiscard={onDiscard ? handleDiscard : undefined}
                hideFontActions={hideFontActions}
                hideIndentActions={hideIndentActions}
                hideAlignmentActions={hideAlignmentActions}
              />
            )}
            <Editable
              renderLeaf={renderLeaf}
              renderElement={renderElement}
              readOnly={readOnly}
              decorate={decorate}
              onKeyDown={handleKeyDown}
              onMouseUp={handleMouseUp}
              className={clsx(styles.editableArea, className)}
            />
          </Slate>
        </div>
        {isShowComments && (
          <CommentSidebar
            comments={storedComments}
            setComments={setStoredComments}
            onCommentsWindowClose={onCommentsWindowClose}
            artifactJobID={artifactJobID}
            activeCommentId={activeCommentId}
            setActiveCommentId={setActiveCommentId}
            activeCommentFunction={activeCommentFunction}
          />
        )}
        {selection && (
          <FloatingCommentToolbar
            position={selection.position}
            onAddComment={(text) => {
              if (activeSpanRef.current) {
                sendComment(text);
                setSelection(null);
              }
            }}
          />
        )}
      </div>
    </>
  );
};

export default SlateContentEditor;
